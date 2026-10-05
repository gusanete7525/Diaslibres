// Cuentas de usuario sin contraseña: enlace de acceso por email (Resend) o Google.
// Todo se guarda en el almacén clave → valor (tabla kv):
//   user:<email>   → { email, name, provider, createdAt, history: [búsquedas] }
//   login:<hash>   → { email, exp }   enlace del email, de un solo uso (30 min)
//   sess:<hash>    → { email, exp }   sesión (cookie dl_s, 180 días)
// De los tokens solo se guarda su SHA-256: quien lea la base de datos no puede entrar.
// Google se activa con GOOGLE_CLIENT_ID (ID de cliente OAuth «Aplicación web»).
// Apple se activa con APPLE_CLIENT_ID (el «Services ID» de Apple Developer, p. ej. com.diaslibre.web).
// Microsoft (cuentas personales: Outlook, Hotmail, Live) con MICROSOFT_CLIENT_ID (Azure, «Id. de aplicación»).
// Facebook con FACEBOOK_APP_ID (identificador de la app de Meta).

import { randomBytes, createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

const LOGIN_TTL = 30 * 60 * 1000;
const SESSION_TTL = 180 * 24 * 60 * 60 * 1000;
const HISTORY_MAX = 30;
export const COOKIE = 'dl_s';
// Dominios de email que son de Microsoft (su dueño es quien tiene la cuenta personal).
const MS_EMAIL = /@(outlook|hotmail|live|msn|passport)\.[a-z.]{2,10}$/;
const MS_CONSUMERS = '9188040d-6c67-4c5b-b112-36a304b66dad'; // «inquilino» de las cuentas personales de Microsoft

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
  constructor({ store, mailer, googleClientId = process.env.GOOGLE_CLIENT_ID, appleClientId = process.env.APPLE_CLIENT_ID, microsoftClientId = process.env.MICROSOFT_CLIENT_ID, facebookAppId = process.env.FACEBOOK_APP_ID, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    this.store = store;
    this.mailer = mailer;
    this.googleClientId = String(googleClientId || '').trim() || null;
    this.appleClientId = String(appleClientId || '').trim() || null;
    this.microsoftClientId = String(microsoftClientId || '').trim() || null;
    this.facebookAppId = String(facebookAppId || '').trim() || null;
    this.jwks = new Map(); // url → { at, keys }
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
    if (data.msSub) user.msSub = data.msSub;
    return this.#saveUser(user);
  }

  // Envía el enlace de acceso. No dice si la cuenta existía (se crea al entrar).
  async sendLoginLink({ email, lang = 'es', site, ip = '', link = null }) {
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
    await this.store.kvSet('login:' + hash(token), { email, exp: t + LOGIN_TTL, ...(link ? { link } : {}) });
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
    let user = await this.#upsertUser(row.email, { provider: 'email' });
    // Enlace pedido al entrar con Microsoft: el email ya está confirmado, se une esa cuenta de Microsoft.
    if (row.link?.provider === 'microsoft' && row.link.sub) {
      await this.store.kvSet('msid:' + row.link.sub, { email: user.email });
      user = await this.#upsertUser(user.email, { provider: 'microsoft', msSub: row.link.sub });
    }
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
    const claims = await this.#verifyJwt(idToken, 'https://appleid.apple.com/auth/keys');
    const email = normEmail(claims?.email);
    const valid = claims && claims.iss === 'https://appleid.apple.com' && claims.aud === this.appleClientId && String(claims.email_verified) !== 'false' && isEmail(email);
    if (!valid) throw Object.assign(new Error('No se pudo comprobar tu cuenta de Apple.'), { status: 401 });
    const user = await this.#upsertUser(email, { provider: 'apple', name });
    return { user, session: await this.#newSession(user.email) };
  }

  // Microsoft: solo cuentas personales (Outlook, Hotmail, Live). La cuenta de Microsoft se
  // identifica por su «sub» (fijo), no por el email. Microsoft no garantiza que el email de una
  // cuenta personal esté verificado (se puede crear con cualquier dirección), así que la primera
  // vez solo se entra directamente si el email es de Microsoft (outlook, hotmail, live, msn);
  // si no, se envía un enlace a ese email para confirmar que es suyo y desde entonces queda unida.
  async loginWithMicrosoft(idToken, nonce, { lang = 'es', site = '', ip = '' } = {}) {
    if (!this.microsoftClientId) throw Object.assign(new Error('El acceso con Microsoft no está activado.'), { status: 404 });
    const claims = await this.#verifyJwt(idToken, 'https://login.microsoftonline.com/consumers/discovery/v2.0/keys');
    const email = normEmail(claims?.email || claims?.preferred_username);
    const sub = typeof claims?.sub === 'string' && /^[\w-]{8,128}$/.test(claims.sub) ? claims.sub : null;
    const valid = claims && sub && claims.iss === `https://login.microsoftonline.com/${MS_CONSUMERS}/v2.0` && claims.tid === MS_CONSUMERS && claims.aud === this.microsoftClientId && nonce && claims.nonce === nonce && isEmail(email);
    if (!valid) throw Object.assign(new Error('No se pudo comprobar tu cuenta de Microsoft.'), { status: 401 });
    const name = String(claims.name || '').split(' ')[0];
    const linked = await this.store.kvGet('msid:' + sub);
    if (linked?.email && (await this.getUser(linked.email))?.msSub === sub) {
      const user = await this.#upsertUser(linked.email, { provider: 'microsoft', name });
      return { user, session: await this.#newSession(user.email) };
    }
    if (MS_EMAIL.test(email)) {
      await this.store.kvSet('msid:' + sub, { email });
      const user = await this.#upsertUser(email, { provider: 'microsoft', name, msSub: sub });
      return { user, session: await this.#newSession(user.email) };
    }
    await this.sendLoginLink({ email, lang, site, ip, link: { provider: 'microsoft', sub } });
    return { pending: email };
  }

  // Facebook: se pregunta a Facebook para qué app es el token y el email de la persona
  // (Facebook solo da emails confirmados).
  async loginWithFacebook(accessToken) {
    if (!this.facebookAppId) throw Object.assign(new Error('El acceso con Facebook no está activado.'), { status: 404 });
    const fail = (msg = 'No se pudo comprobar tu cuenta de Facebook.') => Object.assign(new Error(msg), { status: 401 });
    const token = encodeURIComponent(String(accessToken || ''));
    if (!token) throw fail();
    const get = async (path) => {
      const res = await this.fetch(`https://graph.facebook.com/v21.0/${path}${path.includes('?') ? '&' : '?'}access_token=${token}`);
      return res.ok ? res.json() : null;
    };
    const app = await get('app');
    if (String(app?.id) !== this.facebookAppId) throw fail();
    const me = await get('me?fields=id,first_name,email');
    if (!me?.email) throw fail('Tu cuenta de Facebook no tiene un email confirmado. Entra con tu email.');
    if (!isEmail(normEmail(me.email))) throw fail();
    const user = await this.#upsertUser(me.email, { provider: 'facebook', name: me.first_name });
    return { user, session: await this.#newSession(user.email) };
  }

  // Comprueba un JWT RS256 con las claves públicas del proveedor (se guardan 1 hora;
  // si llega una clave nueva, se vuelven a pedir). Devuelve sus datos o null.
  async #verifyJwt(token, jwksUrl) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    let header, claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    } catch {
      return null;
    }
    if (header.alg !== 'RS256') return null;
    let cached = this.jwks.get(jwksUrl);
    const find = () => cached?.keys.find((k) => k.kid === header.kid);
    if (!find() || this.now() - cached.at > 60 * 60 * 1000) {
      const res = await this.fetch(jwksUrl);
      if (res.ok) this.jwks.set(jwksUrl, (cached = { at: this.now(), keys: (await res.json()).keys || [] }));
    }
    const jwk = find();
    if (!jwk) return null;
    try {
      const { kid, alg, use, x5c, x5t, issuer, ...key } = jwk;
      const ok = verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
      return ok && Number(claims.exp) * 1000 > this.now() ? claims : null;
    } catch {
      return null;
    }
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
    const user = await this.getUser(email);
    if (user?.msSub) await this.store.kvDelete('msid:' + user.msSub);
    await this.store.kvDelete('user:' + normEmail(email));
  }
}

export const publicUser = (u) => (u ? { email: u.email, name: u.name || '', provider: u.provider, providers: u.providers || [u.provider], historyCount: u.history?.length || 0 } : null);
