// Cuentas de usuario sin contraseña: enlace de acceso por email (Resend) o Google.
// Todo se guarda en el almacén clave → valor (tabla kv):
//   user:<email>   → { email, name, provider, createdAt, history: [búsquedas] }
//   login:<hash>   → { email, exp }   enlace del email, de un solo uso (30 min)
//   sess:<hash>    → { email, exp }   sesión (cookie dl_s, 180 días)
// De los tokens solo se guarda su SHA-256: quien lea la base de datos no puede entrar.
// Google se activa con GOOGLE_CLIENT_ID (ID de cliente OAuth «Aplicación web»).
// Apple se activa con APPLE_CLIENT_ID (el «Services ID» de Apple Developer, p. ej. com.diaslibre.web).

import { randomBytes, createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

const LOGIN_TTL = 30 * 60 * 1000;
const SESSION_TTL = 180 * 24 * 60 * 60 * 1000;
const HISTORY_MAX = 30;
export const COOKIE = 'dl_s';

const hash = (token) => createHash('sha256').update(String(token)).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const isEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e) && e.length <= 254;

// Una búsqueda guardada: solo lo que sirve para recomendar (nada de nombres ni pagos).
export function cleanSearch(s = {}) {
  const str = (v, n = 80) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const out = {
    kind: s.kind === 'flight' ? 'flight' : 'hotel',
    city: str(s.city),
    origin: str(s.origin),
    stay: ['hotel', 'apartment', 'house', 'hostel'].includes(s.stay) ? s.stay : '',
    board: ['BI', 'HB', 'FB', 'AI'].includes(s.board) ? s.board : '',
    maxPrice: Number.isFinite(Number(s.maxPrice)) && Number(s.maxPrice) > 0 ? Math.min(Math.round(Number(s.maxPrice)), 100000) : null,
    nights: Number.isInteger(Number(s.nights)) && Number(s.nights) > 0 ? Math.min(Number(s.nights), 30) : null,
    adults: Number.isInteger(Number(s.adults)) && Number(s.adults) > 0 ? Math.min(Number(s.adults), 9) : null,
    fac: Array.isArray(s.fac) ? s.fac.filter((x) => typeof x === 'string').slice(0, 8).map((x) => x.slice(0, 30)) : [],
    at: Number.isFinite(Date.parse(s.at)) ? new Date(s.at).toISOString() : new Date().toISOString(),
  };
  return out.city ? out : null;
}

// Junta dos historiales (el del dispositivo y el de la cuenta) sin repetir y del más nuevo al más viejo.
export function mergeHistory(...lists) {
  const seen = new Set();
  return lists
    .flat()
    .map(cleanSearch)
    .filter(Boolean)
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((s) => {
      const k = [s.kind, s.city.toLowerCase(), s.origin.toLowerCase(), s.stay, s.board, s.maxPrice].join('|');
      return seen.has(k) ? false : seen.add(k);
    })
    .slice(0, HISTORY_MAX);
}

export function readCookie(req, name = COOKIE) {
  for (const part of String(req.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export class Accounts {
  constructor({ store, mailer, googleClientId = process.env.GOOGLE_CLIENT_ID, appleClientId = process.env.APPLE_CLIENT_ID, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    this.store = store;
    this.mailer = mailer;
    this.googleClientId = String(googleClientId || '').trim() || null;
    this.appleClientId = String(appleClientId || '').trim() || null;
    this.appleKeys = { at: 0, keys: [] };
    this.fetch = fetchImpl;
    this.now = now;
    this.ipHits = new Map(); // ip → [marcas de tiempo] (límite de emails por hora)
  }

  get enabled() {
    return typeof this.store?.kvGet === 'function';
  }

  async getUser(email) {
    return this.store.kvGet('user:' + normEmail(email));
  }

  async #saveUser(user) {
    await this.store.kvSet('user:' + user.email, user);
    return user;
  }

  async #upsertUser(email, data = {}) {
    const current = await this.getUser(email);
    const user = current || { email: normEmail(email), name: '', provider: data.provider || 'email', createdAt: new Date(this.now()).toISOString(), history: [] };
    if (data.name && !user.name) user.name = String(data.name).slice(0, 80);
    user.providers = [...new Set([...(user.providers || [user.provider]), data.provider].filter(Boolean))];
    return this.#saveUser(user);
  }

  // Envía el enlace de acceso. No dice si la cuenta existía (se crea al entrar).
  async sendLoginLink({ email, lang = 'es', site, ip = '' }) {
    email = normEmail(email);
    if (!isEmail(email)) throw Object.assign(new Error('Escribe un email válido.'), { status: 400 });
    const t = this.now();
    const hits = (this.ipHits.get(ip) || []).filter((x) => t - x < 60 * 60 * 1000);
    if (hits.length >= 10) throw Object.assign(new Error('Demasiados intentos. Prueba dentro de un rato.'), { status: 429 });
    const last = await this.store.kvGet('mailrate:' + email);
    if (last && t - last.at < 60 * 1000) throw Object.assign(new Error('Ya te hemos enviado un enlace. Espera un minuto antes de pedir otro.'), { status: 429 });
    this.ipHits.set(ip, [...hits, t]);
    if (this.ipHits.size > 5000) this.ipHits.delete(this.ipHits.keys().next().value);
    await this.store.kvSet('mailrate:' + email, { at: t });
    const token = newToken();
    await this.store.kvSet('login:' + hash(token), { email, exp: t + LOGIN_TTL });
    const prefix = lang && lang !== 'es' ? '/' + lang : '';
    const url = `${site}${prefix}/?login=${encodeURIComponent(token)}`;
    const res = await this.mailer?.loginLink?.({ email, url, lang });
    // Sin RESEND_API_KEY (pruebas en local) el enlace solo aparece en el registro del servidor.
    if (res && !res.sent && this.mailer.enabled === false) console.warn('[cuentas] email desactivado; enlace de acceso:', url);
    if (res && !res.sent) throw Object.assign(new Error('No se pudo enviar el email. Inténtalo más tarde.'), { status: 502 });
    return { url }; // solo para pruebas; el servidor no lo devuelve al navegador
  }

  // Canjea el enlace del email por una sesión.
  async verifyLoginLink(token) {
    const key = 'login:' + hash(token);
    const row = await this.store.kvGet(key);
    if (!row) throw Object.assign(new Error('El enlace no es válido o ya se usó. Pide otro.'), { status: 400 });
    await this.store.kvDelete(key);
    if (row.exp < this.now()) throw Object.assign(new Error('El enlace ha caducado. Pide otro.'), { status: 400 });
    await this.store.kvDelete('mailrate:' + row.email);
    const user = await this.#upsertUser(row.email, { provider: 'email' });
    return { user, session: await this.#newSession(user.email) };
  }

  // Comprueba el token de «Iniciar sesión con Google» con Google.
  async loginWithGoogle(credential) {
    if (!this.googleClientId) throw Object.assign(new Error('El acceso con Google no está activado.'), { status: 404 });
    const res = await this.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(String(credential || '')));
    const info = res.ok ? await res.json() : null;
    const valid = info && info.aud === this.googleClientId && ['accounts.google.com', 'https://accounts.google.com'].includes(info.iss) && String(info.email_verified) === 'true' && Number(info.exp) * 1000 > this.now();
    if (!valid || !isEmail(normEmail(info.email))) throw Object.assign(new Error('No se pudo comprobar tu cuenta de Google.'), { status: 401 });
    const user = await this.#upsertUser(info.email, { provider: 'google', name: info.given_name || info.name });
    return { user, session: await this.#newSession(user.email) };
  }

  // «Iniciar sesión con Apple»: el token es un JWT firmado con las claves públicas de Apple.
  // Apple puede dar un email de reenvío (…@privaterelay.appleid.com); funciona igual para entrar.
  async loginWithApple(idToken, name = '') {
    if (!this.appleClientId) throw Object.assign(new Error('El acceso con Apple no está activado.'), { status: 404 });
    const fail = () => Object.assign(new Error('No se pudo comprobar tu cuenta de Apple.'), { status: 401 });
    const parts = String(idToken || '').split('.');
    if (parts.length !== 3) throw fail();
    let header, claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    } catch {
      throw fail();
    }
    const jwk = header.alg === 'RS256' && (await this.#appleKey(header.kid));
    if (!jwk) throw fail();
    const ok = verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
    const email = normEmail(claims.email);
    const valid = ok && claims.iss === 'https://appleid.apple.com' && claims.aud === this.appleClientId && Number(claims.exp) * 1000 > this.now() && String(claims.email_verified) !== 'false' && isEmail(email);
    if (!valid) throw fail();
    const user = await this.#upsertUser(email, { provider: 'apple', name });
    return { user, session: await this.#newSession(user.email) };
  }

  // Claves públicas de Apple (se guardan 1 hora; si llega una clave nueva, se vuelven a pedir).
  async #appleKey(kid) {
    const find = () => this.appleKeys.keys.find((k) => k.kid === kid);
    if (!find() || this.now() - this.appleKeys.at > 60 * 60 * 1000) {
      const res = await this.fetch('https://appleid.apple.com/auth/keys');
      if (res.ok) this.appleKeys = { at: this.now(), keys: (await res.json()).keys || [] };
    }
    return find() || null;
  }

  async #newSession(email) {
    const token = newToken();
    await this.store.kvSet('sess:' + hash(token), { email, exp: this.now() + SESSION_TTL });
    return { token, maxAge: SESSION_TTL };
  }

  async userFromRequest(req) {
    const token = readCookie(req);
    if (!token) return null;
    const row = await this.store.kvGet('sess:' + hash(token));
    if (!row || row.exp < this.now()) return null;
    return this.getUser(row.email);
  }

  async logout(req) {
    const token = readCookie(req);
    if (token) await this.store.kvDelete('sess:' + hash(token));
  }

  async addSearches(email, searches) {
    const user = await this.getUser(email);
    if (!user) return null;
    user.history = mergeHistory(searches, user.history || []);
    return this.#saveUser(user);
  }

  // Borra la cuenta y su historial (las reservas se conservan: son obligatorias para la contabilidad).
  async deleteUser(req, email) {
    await this.logout(req);
    await this.store.kvDelete('user:' + normEmail(email));
  }
}

export const publicUser = (u) => (u ? { email: u.email, name: u.name || '', provider: u.provider, providers: u.providers || [u.provider], historyCount: u.history?.length || 0 } : null);
