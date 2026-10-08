import express from 'express';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { BookingStore, PgBookingStore, createStore } from './src/store.js';
import { searchHotels, searchFlights, quote, todayISO, addDays, isISODate } from './src/availability.js';
import { aiSearch } from './src/ai.js';
import { AIRPORTS } from './src/catalog.js';
import { readFileSync } from 'node:fs';
import { minify } from 'terser';
import { renderPage, sitemap, sitemapIndex, cityFromSlug, routeFromSlug, filterFromSlug, cityPage, routePage, homePage, hubPage, HUBS, cityStats, cityKey, cityByName, cityByIata, placeName, cityName, CITIES } from './src/seo.js';
import { LANGS, LANG_CODES, isLang, langOf, trText } from './src/i18n.js';
import { OsmHotels } from './src/osm.js';
import { Mailer } from './src/mail.js';
import { Accounts, COOKIE, publicUser, mergeHistory } from './src/accounts.js';
import { recommend } from './src/recommend.js';
import { railOption, railFrom, railBookUrl, DOOR_FLIGHT } from './src/rail.js';
import { LiteApi, LiteApiError, PriceChangedError, PaymentPendingError, occupancy, FACILITIES, BOARDS, STAY_TYPES } from './src/liteapi.js';

const root = dirname(fileURLToPath(import.meta.url));

// Códigos de reserva: 8 caracteres de un alfabeto sin confusiones (sin 0/O ni 1/I), unos 10^12 combinaciones, para que
// no se puedan adivinar a partir de un email.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const randomCode = () => 'DL-' + [...randomBytes(8)].map((byte) => CODE_ALPHABET[byte % 32]).join('');

// Límite de peticiones por IP en una ventana de tiempo (en memoria; vale para una sola instancia).
export function rateLimit({ max, windowMs, message = 'Demasiadas peticiones. Prueba dentro de un rato.' }) {
  const hits = new Map(); // ip → [marcas de tiempo]
  return (req, res, next) => {
    const now = Date.now();
    const recent = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) return res.status(429).json({ error: message });
    recent.push(now);
    hits.set(req.ip, recent);
    if (hits.size > 5000) hits.delete(hits.keys().next().value);
    next();
  };
}

export function createApp({
  store = new BookingStore(join(root, 'data', 'bookings.json')),
  osm = process.env.DIASLIBRES_OSM === 'off' ? null : new OsmHotels({ file: join(root, 'data', 'osm-cache.json') }),
  live = process.env.LITEAPI_KEY?.trim() ? new LiteApi({ key: process.env.LITEAPI_KEY }) : null,
  // 'customer': paga el cliente con su tarjeta (pasarela de LiteAPI). 'account': se
  // carga a la cuenta de LiteAPI del titular de la clave.
  livePayment = process.env.LITEAPI_PAYMENT === 'account' ? 'account' : 'customer',
  mailer = new Mailer(),
  accounts = new Accounts({ store, mailer }),
  // Peticiones por IP y por ventana: la búsqueda con IA cuesta una llamada a Claude, y cada pago o reserva crea una
  // prerreserva en LiteAPI o una fila en la base de datos.
  limits = { aiSearch: 30, checkout: 20, demoBooking: 20, windowMs: 10 * 60 * 1000 },
  // Cada cuánto se revisan los pagos que se quedaron a medias (0 = nunca; las pruebas lo llaman a mano).
  reconcileEveryMs = 15 * 60 * 1000,
} = {}) {
  // Los emails se envían en segundo plano: nunca retrasan ni deshacen una reserva.
  const notify = (fn, b) => { if (b && mailer?.[fn]) Promise.resolve().then(() => mailer[fn](b)).catch(() => {}); };
  const app = express();
  // Solo el proxy de Render (un salto): con `true`, cualquiera podría poner su propia X-Forwarded-For y cambiar su IP,
  // y los límites de intentos por IP no servirían. TRUST_PROXY permite otro número de saltos.
  app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    next();
  });
  const aiLimit = rateLimit({ max: limits.aiSearch, windowMs: limits.windowMs, message: 'Has hecho muchas búsquedas seguidas. Prueba dentro de unos minutos.' });
  const checkoutLimit = rateLimit({ max: limits.checkout, windowMs: limits.windowMs, message: 'Demasiados intentos de pago seguidos. Prueba dentro de unos minutos.' });
  const bookingLimit = rateLimit({ max: limits.demoBooking, windowMs: limits.windowMs, message: 'Demasiadas reservas seguidas. Prueba dentro de unos minutos.' });
  // Qué se le enseña al cliente de un error: los mensajes propios (en español, pensados para él) tal cual; los que llegan
  // en crudo del proveedor o de un fallo interno, uno genérico. El detalle queda en el registro del servidor.
  const shown = (err, fallback) => (err instanceof LiteApiError && !err.provider ? err.message : fallback);
  // Las reservas de un mismo hotel o vuelo, de una en una: entre leer la disponibilidad y guardar hay esperas (código,
  // base de datos), y dos reservas simultáneas de la última plaza veían las dos hueco. Vale para una sola instancia.
  const locks = new Map();
  const oneAtATime = async (key, fn) => {
    const previous = locks.get(key) || Promise.resolve();
    let release;
    const mine = previous.then(() => new Promise((resolve) => { release = resolve; }));
    locks.set(key, mine);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(key) === mine) locks.delete(key);
    }
  };
  // Un código que no esté ya en uso (con la base de datos, uno repetido rompería la reserva después de prerreservar).
  const newCode = async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomCode();
      if (!(await store.get(code))) return code;
    }
    throw new Error('No se pudo generar un código de reserva.');
  };
  app.use(express.json({ limit: '20kb' }));
  // ---------- Buscadores y app Android ----------
  const indexHtml = readFileSync(join(root, 'public', 'index.html'), 'utf8');
  // La dirección pública: SITE_URL o, en Render, la que da Render. Solo en local se usa la cabecera Host, porque se puede
  // falsear: con ella, un enlace de inicio de sesión pedido para otra persona podría apuntar a una web ajena.
  const siteUrl = (req) => (process.env.SITE_URL?.trim() || process.env.PUBLIC_URL?.trim() || process.env.RENDER_EXTERNAL_URL?.trim() || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  // Con dominio propio (SITE_URL), las demás direcciones (onrender.com, www.) redirigen a él.
  // El archivo de verificación de Google no: la propiedad antigua debe seguir verificada.
  app.use((req, res, next) => {
    const site = process.env.SITE_URL?.trim();
    if (!site || !['GET', 'HEAD'].includes(req.method) || req.path.startsWith('/api/') || req.path.startsWith('/.well-known/') || /^\/google[0-9a-f]+\.html$/.test(req.path)) return next();
    let host;
    try { host = new URL(site).host; } catch { return next(); }
    if (req.get('host') === host || /^localhost(:|$)|^127\./.test(req.get('host') || '')) return next();
    res.redirect(301, site.replace(/\/$/, '') + req.originalUrl);
  });
  // Los avisos de index.html están escritos para el modo demostración. Con LiteAPI se entregan ya
  // los del modo real, para que buscadores y visitantes sin JavaScript no lean «precios simulados».
  let liveHtml;
  const pageHtml = () => {
    if (!live) return indexHtml;
    if (liveHtml) return liveHtml;
    const footer = ['Precios y disponibilidad en tiempo real.', live.sandbox ? 'Entorno de pruebas: las reservas son de prueba y no se cobran.' : '', liveFlights ? '' : 'Los vuelos son simulados.'].filter(Boolean).join(' ');
    const bookNote = live.sandbox ? 'Entorno de pruebas: la reserva es de prueba y no se cobra nada.'
      : livePayment === 'customer' ? 'Pago seguro con tarjeta. La reserva se confirma al completar el pago.' : null;
    liveHtml = indexHtml.replace(/(<span id="footerNote"[^>]*>)[^<]*(<\/span>)/, `$1${footer}$2`);
    if (bookNote) liveHtml = liveHtml.replace(/(<p id="bookNote" class="meta">)[^<]*(<\/p>)/, `$1${bookNote}$2`);
    return liveHtml;
  };
  const sendPage = (req, res, page, lang = 'es') => {
    res.set('Cache-Control', 'public, max-age=300');
    res.type('html').send(renderPage(pageHtml(), page, { site: siteUrl(req), verification: process.env.GOOGLE_SITE_VERIFICATION?.trim(), lang }));
  };

  // Datos de cada ciudad para sus páginas (nº de hoteles, estrellas, servicios, mejor valorados).
  // Se calculan en segundo plano con la lista completa de hoteles y se guardan (sobreviven a reinicios).
  const STATS_TTL = 7 * 24 * 60 * 60 * 1000;
  const seoStats = new Map(); // cityKey -> datos
  const statsOf = (city) => seoStats.get(cityKey(city)) || null;
  const statsQueue = [];
  const statsLoaded = Promise.resolve(store.kvList?.('seo:') || []).then((rows) => {
    // Los datos de antes de contar los apartamentos se vuelven a calcular.
    for (const [k, v] of rows) if (v?.stay) seoStats.set(k.slice(4), v);
  }).catch((err) => console.error('[seo]', err.message));
  // Pide los datos de una ciudad (las que se visitan van primero).
  // Los datos sin foto de portada (de antes de «Para ti») se renuevan poco a poco.
  const stale = (s) => !s || Date.now() - s.at > STATS_TTL || !('cover' in s);
  const wantStats = (city) => {
    const s = statsOf(city);
    if (stale(s) && !statsQueue.includes(city)) statsQueue.unshift(city);
    if (statsQueue.length > 50) statsQueue.length = 50;
  };
  let statsBusy = false;
  async function statsTick() {
    if (!live || statsBusy) return;
    await statsLoaded;
    const city = statsQueue.shift() || CITIES.find((c) => stale(statsOf(c)));
    if (!city) return;
    statsBusy = true;
    try {
      const hotels = await live.hotels(city.es, { keep: false });
      const s = cityStats(hotels);
      seoStats.set(cityKey(city), s);
      await store.kvSet?.('seo:' + cityKey(city), s);
    } catch (err) {
      console.error('[seo]', city.es, err.message);
    } finally {
      statsBusy = false;
    }
  }
  app.locals.statsTick = statsTick;

  // ---------- IndexNow: avisa a Bing, Yandex, Seznam, Naver y Yep de todas las páginas ----------
  // La clave es pública (se publica en /<clave>.txt); se puede cambiar con INDEXNOW_KEY.
  const INDEXNOW_KEY = process.env.INDEXNOW_KEY?.trim() || '5f3c9e1a7b2d4c8e9a0f6b1d3e7c2a94';
  app.get(`/${INDEXNOW_KEY}.txt`, (_req, res) => res.type('text/plain').send(INDEXNOW_KEY));
  // Una vez al día como mucho (o si hay páginas nuevas), solo con dominio propio (SITE_URL).
  async function submitIndexNow(fetchImpl = globalThis.fetch) {
    const site = process.env.SITE_URL?.trim().replace(/\/$/, '');
    if (!site) return { sent: 0 };
    await statsLoaded;
    const urls = LANG_CODES.flatMap((l) => [...sitemap(site, l, statsOf).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&')));
    const last = (await store.kvList?.('indexnow:last'))?.[0]?.[1];
    if (last && Date.now() - last.at < 24 * 60 * 60 * 1000 && last.count === urls.length) return { sent: 0 };
    const host = new URL(site).host;
    for (let i = 0; i < urls.length; i += 10000) {
      const res = await fetchImpl('https://api.indexnow.org/indexnow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation: `${site}/${INDEXNOW_KEY}.txt`, urlList: urls.slice(i, i + 10000) }),
      });
      if (!res.ok && res.status !== 202) throw new Error(`IndexNow respondió ${res.status}`);
    }
    await store.kvSet?.('indexnow:last', { at: Date.now(), count: urls.length });
    console.log(`[indexnow] ${urls.length} páginas enviadas`);
    return { sent: urls.length };
  }
  app.locals.submitIndexNow = submitIndexNow;

  for (const lang of LANG_CODES) {
    const L = LANGS[lang];
    const home = lang === 'es' ? ['/', '/index.html'] : [`/${lang}/`];
    // Las vueltas del pago (?pago=, ?vuelo=) no son páginas para Google.
    // Otros parámetros (utm_*, gclid, fbclid…) no cambian la página: basta el canonical, sin noindex.
    app.get(home, (req, res) => sendPage(req, res, homePage(lang, 'pago' in req.query || 'vuelo' in req.query), lang));
    const hotelsPage = async (req, res) => {
      const city = cityFromSlug(lang, req.params.slug);
      const filter = req.params.filter ? filterFromSlug(lang, req.params.filter) : null;
      if (!city || (req.params.filter && !filter)) return res.redirect(301, L.prefix + '/');
      await statsLoaded;
      const stats = statsOf(city);
      if (live) wantStats(city);
      const page = cityPage(lang, city, filter, stats);
      sendPage(req, res, page, lang);
    };
    // Páginas generales: /hoteles, /vuelos, /escapadas, /donde-viajar (y sus equivalentes en cada idioma).
    for (const kind of HUBS) app.get(`${L.prefix}/${L[kind]}`, (req, res) => sendPage(req, res, hubPage(lang, kind), lang));
    app.get(`${L.prefix}/${L.hotels}/:slug`, hotelsPage);
    app.get(`${L.prefix}/${L.hotels}/:slug/:filter`, hotelsPage);
    app.get(`${L.prefix}/${L.flights}/:slug`, (req, res) => {
      const route = routeFromSlug(lang, req.params.slug);
      if (!route) return res.redirect(301, L.prefix + '/');
      sendPage(req, res, routePage(lang, route.o, route.d), lang);
    });
  }
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${siteUrl(req)}/sitemap.xml\n`);
  });
  // Resumen para asistentes de IA (ChatGPT, Claude, Perplexity…): https://llmstxt.org
  app.get('/llms.txt', (req, res) => {
    const site = siteUrl(req);
    res.type('text/plain').send([
      '# DíasLibres', '',
      '> Buscador y agencia de viajes de Gusansoft: encuentra vuelos, hoteles y trenes y descubre dónde viajar describiendo el viaje con tus palabras (búsqueda con IA en lenguaje natural).', '',
      'En cada hotel y vuelo muestra un calendario con los días libres (verde, con su precio) y completos (rojo), una gráfica de precios de los próximos días y el botón «Días más baratos». Reserva y pago con tarjeta. Web en español, inglés, francés, alemán, italiano, portugués y neerlandés.', '',
      '## Páginas',
      `- [Inicio](${site}/): buscador de hoteles, vuelos y trenes, también en lenguaje natural.`,
      `- [Hoteles](${site}/hoteles), [Vuelos](${site}/vuelos), [Escapadas](${site}/escapadas) y [¿Dónde viajar?](${site}/donde-viajar): todos los destinos, rutas e ideas de viaje.`,
      `- [Hoteles en Madrid](${site}/hoteles/madrid), [Barcelona](${site}/hoteles/barcelona), [Lisboa](${site}/hoteles/lisboa) y más ciudades: precio por noche y disponibilidad.`,
      `- [Vuelos Madrid–Barcelona](${site}/vuelos/madrid-barcelona) y otras rutas.`,
      `- [Sitemap](${site}/sitemap.xml) · [Información legal](${site}/legal.html)`, '',
      '## Empresa', '- Gusansoft (https://gusansoft.com) · contact@gusansoft.com', '',
    ].join('\n'));
  });
  app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(sitemapIndex(siteUrl(req))));
  app.get('/sitemap-:lang.xml', async (req, res, next) => {
    if (!isLang(req.params.lang)) return next();
    await statsLoaded;
    res.type('application/xml').send(sitemap(siteUrl(req), req.params.lang, statsOf));
  });
  // Errores de la API en el idioma de la página (cabecera X-Lang).
  app.use('/api', (req, res, next) => {
    const lang = langOf(req);
    if (lang !== 'es') {
      const json = res.json.bind(res);
      res.json = (body) => json(body && typeof body.error === 'string' ? { ...body, error: trText(lang, body.error) } : body);
    }
    next();
  });
  // App Android (Trusted Web Activity): Google Play comprueba que la web y la app son del mismo dueño.
  app.get('/.well-known/assetlinks.json', (_req, res) => {
    const pkg = process.env.ANDROID_PACKAGE?.trim();
    const prints = String(process.env.ANDROID_SHA256 || '').split(',').map((x) => x.trim()).filter(Boolean);
    res.json(pkg && prints.length ? [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: prints },
    }] : []);
  });
  // El código del navegador se sirve compacto y sin comentarios (más ligero y menos legible).
  let appJs = null;
  app.get('/app.js', async (_req, res, next) => {
    try {
      appJs ??= minify(readFileSync(join(root, 'public', 'app.js'), 'utf8'), {
        module: true, compress: { passes: 2 }, mangle: { toplevel: true }, format: { comments: false },
      }).then((r) => r.code);
      res.type('application/javascript').set('Cache-Control', 'public, max-age=300').send(await appJs);
    } catch (err) {
      console.error('[app.js]', err.message);
      appJs = null;
      next(); // si falla, el archivo original
    }
  });
  app.use(express.static(join(root, 'public'), { index: false }));

  const list = (v) => (Array.isArray(v) ? v : v ? String(v).split(',') : []);

  // Con destino, se añaden hoteles reales de OpenStreetMap (si responde a tiempo).
  async function osmHotels(destination) {
    if (!osm || !destination || String(destination).trim().length < 2) return { hotels: [], error: null };
    let timer;
    try {
      const timeout = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('OpenStreetMap tarda demasiado')), 20000)));
      return { hotels: await Promise.race([osm.hotelsFor(String(destination)), timeout]), error: null };
    } catch (err) {
      console.error('[osm]', err.message);
      return { hotels: [], error: 'No se pudo consultar OpenStreetMap; se muestran solo los hoteles del catálogo.' };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- Hoteles con datos reales de LiteAPI (si hay LITEAPI_KEY) ----------
  const LIVE_DAYS = 30;
  const HOTEL_PAGE = 15;
  // Si paga el cliente, se puede reservar siempre. Si se carga a la cuenta del titular,
  // con la clave real solo con ALLOW_REAL_BOOKINGS=1 (si no, cualquiera reservaría a su costa).
  const liveFlights = !!live && process.env.LITEAPI_FLIGHTS !== 'off';
  const liveBookingEnabled = !!live && (livePayment === 'customer' || live.sandbox || process.env.ALLOW_REAL_BOOKINGS === '1');
  // Datos internos de la reserva que no salen al navegador.
  const publicBooking = (b) => {
    if (!b) return b;
    const { prebookId, transactionId, checkoutId, ...rest } = b;
    return rest;
  };
  const validCustomer = (body) => {
    const name = String(body.name || '').trim().slice(0, 80);
    const email = String(body.email || '').trim().slice(0, 120);
    if (name.length < 2) return { error: 'Indica tu nombre.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Email no válido.' };
    return { name, email };
  };
  const isLive = (id) => !!live && String(id || '').startsWith('lite-');

  // Sin destino escrito, la portada mezcla hoteles bien valorados de varias ciudades y países
  // (cambian cada día) en vez de enseñar solo una ciudad.
  // Con el país: «Athens» a secas puede ser Athens (Georgia, EE. UU.).
  const MIX_CITIES = ['Barcelona, Spain', 'Lisbon, Portugal', 'Paris, France', 'Rome, Italy', 'London, United Kingdom', 'Amsterdam, Netherlands', 'Malaga, Spain', 'Prague, Czech Republic', 'Vienna, Austria', 'Porto, Portugal', 'Seville, Spain', 'Florence, Italy', 'Athens, Greece', 'Dublin, Ireland', 'Berlin, Germany', 'Valencia, Spain', 'Palma de Mallorca, Spain', 'Budapest, Hungary'];
  const MIX_PER_DAY = 6;
  async function mixedHotels(lang) {
    const day = Math.floor(Date.now() / 864e5);
    const cities = Array.from({ length: MIX_PER_DAY }, (_, i) => MIX_CITIES[(day * MIX_PER_DAY + i) % MIX_CITIES.length]);
    const lists = await Promise.all(cities.map((c) => live.hotels(c, { lang }).catch(() => [])));
    const good = (h) => (h.rating || 0) >= 8 && (h.reviewCount || 0) >= 50;
    // Solo hoteles de la propia ciudad (no de pueblos de alrededor como Swords o Schönefeld), si hay bastantes.
    const plain = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const inCity = (l, c) => { const k = plain(c).slice(0, 3); const own = l.filter((h) => plain(h.city).startsWith(k)); return own.length >= 5 ? own : l; };
    const tops = lists.map((l, i) => [...inCity(l, cities[i])].sort((a, b) => good(b) - good(a) || (b.rating || 0) - (a.rating || 0) || (b.reviewCount || 0) - (a.reviewCount || 0)).slice(0, 10));
    const out = [];
    for (let i = 0; i < 10; i++) for (const t of tops) if (t[i]) out.push(t[i]);
    return out;
  }

  async function liveHotels(q, res) {
    const typed = String(q.destination || '').trim();
    const city = typed || 'Madrid';
    const mixed = !typed;
    try {
      let hotels = mixed ? await mixedHotels(q.lang) : await live.hotels(city, { lang: q.lang });
      if (mixed && !hotels.length) hotels = await live.hotels(city, { lang: q.lang });
      // Filtros: estrellas, puntuación y servicios (todos los marcados).
      const fac = list(q.fac).filter((k) => k in FACILITIES);
      if (q.minStars) hotels = hotels.filter((h) => (h.stars || 0) >= Number(q.minStars));
      if (q.minRating) hotels = hotels.filter((h) => (h.rating || 0) >= Number(q.minRating));
      if (fac.length) hotels = hotels.filter((h) => fac.every((k) => h.facilities?.includes(k)));
      // Tipo de alojamiento: hoteles, apartamentos, casas o hostales (uno o varios).
      const stay = list(q.stay).filter((k) => k in STAY_TYPES);
      if (stay.length) hotels = hotels.filter((h) => stay.includes(h.stay || 'hotel'));
      const byStars = (a, b) => (b.stars || 0) - (a.stars || 0) || (b.rating || 0) - (a.rating || 0);
      const byRating = (a, b) => (b.rating || 0) - (a.rating || 0) || (b.reviewCount || 0) - (a.reviewCount || 0);
      const byReviews = (a, b) => (b.reviewCount || 0) - (a.reviewCount || 0) || byRating(a, b);
      // «Más baratos» se ordena en el navegador cuando llegan los precios; aquí, por puntuación.
      const sorter = { rating: byRating, price: byRating, reviews: byReviews }[q.sort];
      // La mezcla de portada va intercalada por ciudades salvo que se pida otro orden.
      if (!mixed || sorter) hotels = [...hotels].sort(sorter || byStars);
      const board = q.board in BOARDS ? q.board : null;
      // El calendario empieza hoy; si la fecha de entrada pedida queda más allá, empieza ese día.
      const nights = Math.max(1, Math.min(30, Number(q.nights) || 3));
      const today = todayISO();
      const start = isISODate(q.checkIn) && q.checkIn > addDays(today, LIVE_DAYS - nights) && q.checkIn <= addDays(today, 330) ? q.checkIn : today;
      // Se envían por páginas: la ciudad puede tener cientos de hoteles.
      const page = Math.max(0, Math.floor(Number(q.page) || 0));
      const total = hotels.length;
      hotels = hotels.slice(page * HOTEL_PAGE, (page + 1) * HOTEL_PAGE);
      // Las fichas llegan al momento; los precios de cada noche se piden después por tandas.
      const results = hotels.map((h) => ({
        ...h,
        calendar: Array.from({ length: LIVE_DAYS }, (_, i) => ({ date: addDays(start, i), price: null, available: null, left: null, pending: true })),
        summary: { freeDays: 0, minPrice: null, maxPrice: null, avgPrice: null },
        bestStay: null,
      }));
      res.json({ start, days: LIVE_DAYS, total, page, hasMore: (page + 1) * HOTEL_PAGE < total, board, boardName: board ? BOARDS[board] : null, nights, results, live: { sandbox: live.sandbox, city, mixed, bookingEnabled: liveBookingEnabled, payment: livePayment }, guests: occupancy({ adults: q.adults, children: q.children }) });
    } catch (err) {
      console.error('[liteapi]', err.message);
      res.status(502).json({ error: 'No se pudieron consultar los hoteles ahora mismo. Inténtalo de nuevo en unos segundos.' });
    }
  }

  app.get('/api/live/prices', async (req, res) => {
    if (!live) return res.status(404).json({ error: 'Precios reales no disponibles.' });
    const ids = list(req.query.ids).filter((id) => id.startsWith('lite-')).slice(0, 20);
    const start = isISODate(req.query.start) && req.query.start >= todayISO() ? req.query.start : todayISO();
    const days = Math.max(1, Math.min(7, Number(req.query.days) || 7));
    try {
      res.json({ start, days, prices: await live.nightlyPrices(ids, start, days, { adults: req.query.adults, children: req.query.children }, req.query.board) });
    } catch (err) {
      console.error('[liteapi]', err.message);
      res.status(502).json({ error: 'No se pudieron consultar los precios. Inténtalo de nuevo.' });
    }
  });

  // Ficha del hotel: fotos, descripción, servicios y habitaciones.
  app.get('/api/live/hotel/:id', async (req, res) => {
    if (!isLive(req.params.id)) return res.status(404).json({ error: 'Hotel no encontrado. Vuelve a buscar la ciudad.' });
    try {
      res.json(await live.hotelDetails(req.params.id, langOf(req)));
    } catch (err) {
      console.error('[liteapi]', err.message);
      res.status(502).json({ error: 'No se pudo cargar la ficha del hotel. Inténtalo de nuevo.' });
    }
  });

  app.get('/api/hotels', async (req, res) => {
    const q = req.query;
    if (live) return liveHotels({ ...q, lang: langOf(req) }, res);
    const extra = await osmHotels(q.destination);
    const data = searchHotels(await store.all(), { ...q, tags: list(q.tags) }, extra.hotels);
    data.osm = { count: data.results.filter((h) => h.origin === 'osm').length, error: extra.error };
    res.json(data);
  });

  app.get('/api/flights', async (req, res) => {
    if (liveFlights) return liveFlightSearch({ ...req.query, lang: langOf(req) }, res);
    if (live) return res.status(404).json({ error: 'Los vuelos todavía no están disponibles.' });
    res.json(searchFlights(await store.all(), req.query));
  });

  // ---------- Trenes (Europa) ----------
  // Trayecto en tren entre dos ciudades, con su duración y la comparación puerta a puerta con el avión.
  app.get('/api/trains', (req, res) => {
    const lang = langOf(req);
    const from = cityByName(req.query.origin);
    const to = cityByName(req.query.destination);
    const adults = Math.max(1, Math.min(6, Number(req.query.adults) || 1));
    const date = isISODate(req.query.date) && req.query.date >= todayISO() ? req.query.date : null;
    const name = (c) => cityName(c, lang);
    if (!from) return res.status(400).json({ error: trText(lang, 'Escribe una ciudad de salida que conozcamos (p. ej. Madrid, París o Roma).') });
    const nearby = railFrom(from).slice(0, 12).map((r) => ({ to: name(r.to), minutes: r.minutes, operators: r.operators }));
    if (!to) return res.json({ from: name(from), to: null, train: null, nearby });
    if (to === from) return res.status(400).json({ error: trText(lang, 'La salida y el destino son la misma ciudad.') });
    const train = railOption(from, to, lang);
    res.json({
      from: name(from), to: name(to), date, adults, nearby,
      fromIata: from.iata, toIata: to.iata,
      doorFlight: DOOR_FLIGHT,
      train: train && { ...train, bookUrl: railBookUrl({ from, to, date, adults }) },
    });
  });

  // ---------- Vuelos reales con LiteAPI (si hay LITEAPI_KEY y no LITEAPI_FLIGHTS=off) ----------
  const norm = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  // «MAD», «Madrid» o cualquier ciudad con aeropuerto → código IATA.
  async function airportCode(q) {
    const text = String(q || '').trim();
    if (/^[a-z]{3}$/i.test(text)) return { code: text.toUpperCase(), name: AIRPORTS[text.toUpperCase()] || text.toUpperCase() };
    const known = Object.entries(AIRPORTS).find(([, city]) => norm(city) === norm(text));
    if (known) return { code: known[0], name: known[1] };
    // Destinos conocidos, con su nombre en cualquier idioma («Londres», «London», «Londen»…).
    const place = cityByName(text);
    if (place?.iata) return { code: place.iata, name: place.es };
    if (text.length < 2) return null;
    const found = await live.airports(text);
    // «Ciudad del Cabo» no da Cape Town, sino Cabo Frío: si ningún aeropuerto es de esa ciudad, se busca por su nombre en inglés.
    let first = found.find((a) => norm(a.city) === norm(text) || norm(a.name).includes(norm(text)));
    if (!first) {
      const en = await live.placeName(text).catch(() => null);
      if (en && norm(en) !== norm(text)) [first] = await live.airports(en).catch(() => []);
    }
    first ??= found[0];
    return first ? { code: first.code, name: first.city || first.name } : null;
  }

  // Escalas: «0» solo directos, «1» como máximo una escala por trayecto, «many» con alguna escala.
  const STOP_FILTERS = {
    0: (t) => [t.outbound, t.inbound].every((l) => !l || l.stops === 0),
    1: (t) => [t.outbound, t.inbound].every((l) => !l || l.stops <= 1),
    many: (t) => [t.outbound, t.inbound].some((l) => l && l.stops >= 1),
  };
  const byStops = (trips, s) => (STOP_FILTERS[s] ? trips.filter(STOP_FILTERS[s]) : trips);

  async function liveFlightSearch(q, res) {
    const adults = Math.max(1, Math.min(6, Number(q.adults) || 1));
    const date = isISODate(q.date) && q.date > todayISO() ? q.date : addDays(todayISO(), 14);
    const returnDate = isISODate(q.returnDate) && q.returnDate >= date ? q.returnDate : null;
    const base = { live: { sandbox: live.sandbox, flights: true }, date, returnDate, adults, results: [] };
    if (!String(q.origin || '').trim() || !String(q.destination || '').trim()) {
      return res.json({ ...base, needRoute: true });
    }
    try {
      const [from, to] = await Promise.all([airportCode(q.origin), airportCode(q.destination)]);
      if (!from || !to) return res.status(400).json({ error: `No encontramos el aeropuerto de ${!from ? q.origin : q.destination}. Prueba con su código, por ejemplo MAD.` });
      if (from.code === to.code) return res.status(400).json({ error: 'El origen y el destino son el mismo aeropuerto.' });
      let trips = await live.flightSearch({ origin: from.code, destination: to.code, date, returnDate, adults });
      if (q.maxPrice) trips = trips.filter((t) => t.total <= Number(q.maxPrice));
      trips = byStops(trips, q.stops);
      const named = (a) => ({ ...a, name: cityByIata(a.code) ? placeName(a.code, q.lang) : a.name });
      res.json({ ...base, stops: q.stops in STOP_FILTERS ? q.stops : null, origin: named(from), destination: named(to), results: trips });
    } catch (err) {
      console.error('[liteapi vuelos]', err.message);
      res.status(502).json({ error: 'No se pudieron consultar los vuelos ahora mismo. Inténtalo de nuevo en unos segundos.' });
    }
  }

  // Precio actual de una oferta antes de pedir los datos de los pasajeros.
  // ---------- Calendario de vuelos: una búsqueda por día, en segundo plano ----------
  const iata = (x) => (/^[A-Z]{3}$/.test(String(x || '').toUpperCase()) ? String(x).toUpperCase() : null);
  app.get('/api/flights/days', async (req, res) => {
    if (!liveFlights) return res.status(404).json({ error: 'Los vuelos reales no están activados.' });
    const q = req.query;
    const origin = iata(q.origin);
    const destination = iata(q.destination);
    if (!origin || !destination || origin === destination) return res.status(400).json({ error: 'Ruta no válida.' });
    const tomorrow = addDays(todayISO(), 1);
    const dates = [...new Set(list(q.dates))].filter((d) => isISODate(d) && d >= tomorrow).slice(0, 7);
    if (!dates.length) return res.status(400).json({ error: 'Fechas no válidas.' });
    const stay = q.stay != null && q.stay !== '' ? Math.max(0, Math.min(30, Number(q.stay) || 0)) : null; // null = solo ida
    const adults = Math.max(1, Math.min(6, Number(q.adults) || 1));
    const out = await Promise.all(dates.map(async (date) => {
      try {
        const trips = await live.flightSearch({ origin, destination, date, returnDate: stay == null ? null : addDays(date, stay), adults }, { priority: false });
        return { date, trips: byStops(trips, q.stops) };
      } catch (err) {
        console.error('[liteapi vuelos]', date, err.message);
        return { date, error: true };
      }
    }));
    res.json({ days: out });
  });

  // ---------- Ofertas: el vuelo más barato de rutas populares (se renuevan cada 2 h) ----------
  const DEAL_ROUTES = [['MAD', 'BCN'], ['MAD', 'LIS'], ['MAD', 'CDG'], ['MAD', 'FCO'], ['MAD', 'TFN'], ['BCN', 'AGP'], ['BCN', 'LHR'], ['VLC', 'PMI'], ['VLC', 'AMS']];
  const DEALS_TTL = 2 * 60 * 60 * 1000;
  const deals = { at: 0, date: null, list: [], running: null };
  function refreshDeals() {
    if (!liveFlights || deals.running) return deals.running;
    const date = addDays(todayISO(), 14);
    const fresh = [];
    const place = (code) => ({ code, name: AIRPORTS[code] || code });
    deals.running = Promise.all(DEAL_ROUTES.map(async ([o, d]) => {
      try {
        const [t] = await live.flightSearch({ origin: o, destination: d, date, adults: 1 }, { priority: false });
        if (t) fresh.push({ origin: place(o), destination: place(d), date, total: t.total, currency: t.currency, airlines: t.outbound.airlines, departure: t.outbound.departure, stops: t.outbound.stops, minutes: t.outbound.minutes });
      } catch (err) {
        console.error('[liteapi ofertas]', o, d, err.message);
      }
      if (!deals.at) { deals.list = [...fresh]; deals.date = date; } // la primera vez se van enseñando según llegan
    })).then(() => {
      if (fresh.length) Object.assign(deals, { list: fresh, date, at: Date.now() });
    }).finally(() => { deals.running = null; });
    return deals.running;
  }
  app.locals.refreshDeals = refreshDeals;
  app.get('/api/flights/deals', (req, res) => {
    if (!liveFlights) return res.status(404).json({ error: 'Los vuelos reales no están activados.' });
    if (Date.now() - deals.at > DEALS_TTL) refreshDeals();
    const lang = langOf(req);
    const named = (p) => ({ ...p, name: placeName(p.code, lang, p.name) });
    res.json({ date: deals.date, deals: [...deals.list].sort((a, b) => a.total - b.total).map((d) => ({ ...d, origin: named(d.origin), destination: named(d.destination) })), pending: !deals.at && !!deals.running });
  });

  app.post('/api/flights/quote', async (req, res) => {
    if (!liveFlights) return res.status(404).json({ error: 'Los vuelos reales no están activados.' });
    try {
      const v = await live.flightVerify(String(req.body?.offerId || ''));
      res.json(v);
    } catch (err) {
      console.error('[liteapi vuelos]', err.message);
      res.status(409).json({ error: shown(err, 'No se pudo comprobar la tarifa con la aerolínea. Inténtalo de nuevo o elige otro vuelo.') });
    }
  });

  const DOC_TYPES = ['passport', 'id']; // LiteAPI: pasaporte o DNI
  function validFlightCustomer(body, adults, flightDate) {
    const email = String(body.email || '').trim().slice(0, 120);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Email no válido.' };
    const phoneCountryCode = String(body.phoneCountryCode || '34').replace(/\D/g, '').slice(0, 4);
    const phoneNumber = String(body.phoneNumber || '').replace(/\D/g, '').slice(0, 15);
    if (!phoneCountryCode || phoneNumber.length < 6) return { error: 'Indica un teléfono de contacto.' };
    const list = Array.isArray(body.passengers) ? body.passengers.slice(0, 6) : [];
    if (list.length !== adults) return { error: `Faltan los datos de ${adults === 1 ? 'el pasajero' : 'los ' + adults + ' pasajeros'}.` };
    const passengers = [];
    for (const [i, p] of list.entries()) {
      const who = `Pasajero ${i + 1}`;
      const firstName = String(p.firstName || '').trim().slice(0, 40);
      const lastName = String(p.lastName || '').trim().slice(0, 60);
      if (firstName.length < 1 || lastName.length < 2) return { error: `${who}: escribe nombre y apellidos como en el documento.` };
      if (!isISODate(p.birthday)) return { error: `${who}: fecha de nacimiento no válida.` };
      const age = (Date.parse(flightDate) - Date.parse(p.birthday)) / (365.25 * 86400000);
      if (age < 12 || age > 120) return { error: `${who}: por ahora solo se pueden reservar pasajeros de 12 años o más.` };
      if (!['M', 'F'].includes(p.gender)) return { error: `${who}: indica el sexo que figura en el documento.` };
      const nationality = String(p.nationality || '').toUpperCase();
      if (!/^[A-Z]{2}$/.test(nationality)) return { error: `${who}: indica la nacionalidad.` };
      if (p.documentType === 'id_card') p.documentType = 'id'; // páginas antiguas
      if (!DOC_TYPES.includes(p.documentType)) return { error: `${who}: elige el tipo de documento.` };
      const documentNumber = String(p.documentNumber || '').replace(/\s/g, '').toUpperCase().slice(0, 20);
      if (documentNumber.length < 5) return { error: `${who}: número de documento no válido.` };
      if (!isISODate(p.documentExpiry) || p.documentExpiry <= flightDate) return { error: `${who}: el documento debe estar en vigor el día del vuelo.` };
      const documentIssueCountry = /^[A-Z]{2}$/i.test(p.documentIssueCountry || '') ? p.documentIssueCountry.toUpperCase() : nationality;
      passengers.push({ firstName, lastName, birthday: p.birthday, gender: p.gender, nationality, documentType: p.documentType, documentNumber, documentExpiry: p.documentExpiry, documentIssueCountry, passengerType: 0 });
    }
    const contact = { email, firstName: passengers[0].firstName, lastName: passengers[0].lastName, phoneCountryCode, phoneNumber };
    return { email, contact, passengers };
  }

  // 1) Bloquea la tarifa y crea el pago; 2) el cliente paga con Stripe y vuelve a
  // /?vuelo=<id>; 3) se confirma la reserva con la aerolínea.
  app.post('/api/flights/checkout', checkoutLimit, async (req, res) => {
    if (!liveFlights) return res.status(404).json({ error: 'Los vuelos reales no están activados.' });
    const body = req.body || {};
    const trip = live.flightOffer(String(body.offerId || ''));
    if (!trip) return res.status(409).json({ error: 'Esa tarifa ha caducado. Vuelve a buscar el vuelo.' });
    const adults = trip.adults || Math.max(1, Math.min(6, Number(body.adults) || 1));
    const flightDate = trip.outbound.departure.slice(0, 10);
    const who = validFlightCustomer(body, adults, flightDate);
    if (who.error) return res.status(400).json({ error: who.error });
    try {
      const pre = await live.flightPrebook({ offerId: trip.offerId, contact: who.contact, passengers: who.passengers });
      const checkoutId = randomBytes(16).toString('hex');
      const booking = await store.add({
        code: await newCode(),
        lang: langOf(req),
        type: 'flight',
        itemId: 'lite-flight',
        itemName: `${trip.outbound.from} → ${trip.outbound.to}${trip.inbound ? ' (ida y vuelta)' : ''} · ${trip.outbound.airlines.join(', ')}`,
        date: flightDate,
        returnDate: trip.inbound ? trip.inbound.departure.slice(0, 10) : undefined,
        flight: { outbound: trip.outbound, inbound: trip.inbound, fare: trip.fare },
        units: adults,
        total: pre.price ?? trip.total,
        name: `${who.contact.firstName} ${who.contact.lastName}`,
        email: who.email,
        passengers: who.passengers.map((p) => `${p.firstName} ${p.lastName}`),
        status: 'pendiente_pago',
        provider: 'liteapi',
        sandbox: live.sandbox,
        refundable: trip.refundable,
        checkoutId,
        prebookId: pre.prebookId,
        transactionId: pre.transactionId,
        createdAt: new Date().toISOString(),
      });
      const base = siteUrl(req);
      res.status(201).json({
        checkoutId,
        code: booking.code,
        total: booking.total,
        currency: pre.currency,
        searchTotal: trip.total,
        secretKey: pre.secretKey,
        publishableKey: pre.publishableKey,
        publicKey: live.sandbox ? 'sandbox' : 'live',
        returnUrl: `${base}${LANGS[langOf(req)].prefix}/?vuelo=${checkoutId}`,
      });
    } catch (err) {
      console.error('[liteapi vuelos]', err.message);
      res.status(409).json({ error: shown(err, 'No se pudo comprobar la tarifa con la aerolínea. Inténtalo de nuevo o elige otro vuelo.') });
    }
  });

  const confirmingFlights = new Set();
  // Confirmar en el proveedor una reserva ya pagada (o intentarlo: si el pago no se completó, PaymentPendingError).
  const confirmFlight = async (b) => {
    const r = await live.flightBook({ prebookId: b.prebookId, transactionId: b.transactionId });
    const done = await store.update(b.code, {
      status: 'confirmada',
      providerBookingId: r.bookingId,
      bookingRef: r.bookingRef,
      pnr: r.pnr,
      total: r.total ?? b.total,
      paidAt: new Date().toISOString(),
    });
    notify('bookingConfirmed', done);
    return done;
  };
  const confirmHotel = async (b) => {
    const r = await live.confirm({ prebookId: b.prebookId, name: b.name, email: b.email, units: b.units, transactionId: b.transactionId });
    const done = await store.update(b.code, { status: 'confirmada', providerBookingId: r.bookingId, total: r.total ?? b.total, paidAt: new Date().toISOString() });
    notify('bookingConfirmed', done);
    return done;
  };

  app.post('/api/flights/checkout/:id/confirm', async (req, res) => {
    const id = String(req.params.id);
    const b = await store.findByCheckout(id);
    if (!b || b.type !== 'flight') return res.status(404).json({ error: 'No encontramos ese pago.' });
    if (b.status !== 'pendiente_pago') return res.json(publicBooking(b));
    if (!liveFlights) return res.status(503).json({ error: 'No se puede confirmar ahora: falta la conexión con el proveedor.' });
    if (confirmingFlights.has(id)) return res.status(409).json({ error: 'Estamos confirmando tu reserva. Espera unos segundos.' });
    confirmingFlights.add(id);
    try {
      res.json(publicBooking(await confirmFlight(b)));
    } catch (err) {
      console.error('[liteapi vuelos]', err.message);
      if (err instanceof PaymentPendingError) return res.status(402).json({ error: 'El pago no se ha completado. No se ha hecho ningún cargo ni reserva.' });
      notify('paymentWithoutBooking', { ...b, error: err.message });
      res.status(502).json({ error: 'Hemos recibido el pago, pero la aerolínea aún no ha confirmado el billete. Lo revisamos y te escribimos; tu código es ' + b.code + '.' });
    } finally {
      confirmingFlights.delete(id);
    }
  });

  app.get('/api/airports', (req, res) => res.json(Object.fromEntries(Object.entries(AIRPORTS).map(([code, name]) => [code, placeName(code, langOf(req), name)]))));
  // flights: false con datos reales de hoteles y los vuelos apagados (no se enseñan vuelos simulados).
  app.get('/api/config', (_req, res) => res.json({
    googleClientId: accounts?.googleClientId || null,
    appleClientId: accounts?.appleClientId || null,
    microsoftClientId: accounts?.microsoftClientId || null,
    facebookAppId: accounts?.facebookAppId || null,
    liveFlights, flights: liveFlights || !live, sandbox: live?.sandbox ?? null,
    facilities: Object.fromEntries(Object.entries(FACILITIES).map(([k, f]) => [k, { label: f.label, icon: f.icon }])),
    boards: BOARDS,
  }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, live: !!live, sandbox: live?.sandbox ?? null, storage: store instanceof PgBookingStore ? 'postgres' : 'file', payment: live ? livePayment : null, flights: liveFlights, lastLiteApiError: live?.lastError ?? null, mail: mailer?.status ?? null }));

  app.post('/api/ai-search', aiLimit, async (req, res) => {
    try {
      res.json(await aiSearch(req.body?.query, langOf(req)));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/quote', async (req, res) => {
    const body = req.body || {};
    if (isLive(body.itemId)) {
      try {
        const q = await live.quote(body);
        const { item, offerId, ...rest } = q;
        return res.json(rest);
      } catch (err) {
        console.error('[liteapi]', err.message);
        return res.status(400).json({ error: shown(err, 'No se pudo comprobar la habitación con el hotel. Inténtalo de nuevo o elige otra.') });
      }
    }
    try {
      const q = quote(await store.all(), req.body || {}, osm?.known());
      res.json({ total: q.total, units: q.units, nights: q.nights, perNight: q.perNight });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---------- Pago del cliente (pasarela de LiteAPI) ----------
  // 1) /api/checkout bloquea la habitación al precio visto y devuelve la clave del pago.
  // 2) El navegador muestra el formulario de tarjeta; al pagar vuelve a /?pago=<id>.
  // 3) /api/checkout/:id/confirm confirma la reserva en LiteAPI con el pago hecho.
  app.post('/api/checkout', checkoutLimit, async (req, res) => {
    const body = req.body || {};
    if (!isLive(body.itemId) || livePayment !== 'customer') return res.status(400).json({ error: 'Este alojamiento no admite pago con tarjeta.' });
    const who = validCustomer(body);
    if (who.error) return res.status(400).json({ error: who.error });
    const seen = Number(body.expectedTotal);
    if (!Number.isFinite(seen) || seen <= 0) return res.status(400).json({ error: 'Falta el precio del presupuesto. Vuelve a abrir la reserva.' });
    try {
      const q = await live.quote(body);
      if (q.total > seen + 0.01) throw new PriceChangedError(q.total);
      const pre = await live.prebook({ offerId: q.offerId, maxTotal: seen, customerPays: true });
      const checkoutId = randomBytes(16).toString('hex');
      const booking = await store.add({
        code: await newCode(),
        lang: langOf(req),
        type: 'hotel',
        itemId: q.item.id,
        itemName: `${q.item.name} (${q.item.city})`,
        checkIn: body.checkIn,
        checkOut: body.checkOut,
        units: q.units,
        total: pre.price ?? q.total,
        name: who.name,
        email: who.email,
        guests: occupancy(body),
        status: 'pendiente_pago',
        provider: 'liteapi',
        sandbox: live.sandbox,
        refundable: q.refundable,
        freeCancellationUntil: q.freeCancellationUntil,
        payAtHotel: q.payAtHotel,
        roomName: q.roomName,
        checkoutId,
        prebookId: pre.prebookId,
        transactionId: pre.transactionId,
        createdAt: new Date().toISOString(),
      });
      const base = siteUrl(req);
      res.status(201).json({
        checkoutId,
        code: booking.code,
        total: booking.total,
        secretKey: pre.secretKey,
        publicKey: live.sandbox ? 'sandbox' : 'live',
        returnUrl: `${base}${LANGS[langOf(req)].prefix}/?pago=${checkoutId}`,
      });
    } catch (err) {
      console.error('[liteapi]', err.message);
      res.status(409).json({ error: shown(err, 'No se pudo comprobar la habitación con el hotel. Inténtalo de nuevo o elige otra.'), ...(err instanceof PriceChangedError ? { newTotal: err.total } : {}) });
    }
  });

  const confirming = new Set(); // evita confirmar dos veces el mismo pago a la vez
  app.post('/api/checkout/:id/confirm', async (req, res) => {
    const id = String(req.params.id);
    const b = await store.findByCheckout(id);
    if (!b) return res.status(404).json({ error: 'No encontramos ese pago.' });
    if (b.status === 'confirmada' || b.status === 'cancelada') return res.json(publicBooking(b));
    if (b.status !== 'pendiente_pago') return res.status(409).json({ error: 'Esta reserva no se puede confirmar.' });
    // Sin LiteAPI no se puede confirmar: no es un «pago sin reserva» (no se avisa al titular), solo hay que reintentarlo.
    if (!live) return res.status(503).json({ error: 'No se puede confirmar ahora: falta la conexión con el proveedor.' });
    if (confirming.has(id)) return res.status(409).json({ error: 'Estamos confirmando tu reserva. Espera unos segundos.' });
    confirming.add(id);
    try {
      res.json(publicBooking(await confirmHotel(b)));
    } catch (err) {
      console.error('[liteapi]', err.message);
      if (err instanceof PaymentPendingError) return res.status(402).json({ error: 'El pago no se ha completado. No se ha hecho ningún cargo ni reserva.' });
      // El cliente ha pagado y no hay reserva: hay que avisar al titular para resolverlo.
      notify('paymentWithoutBooking', { ...b, error: err.message });
      const why = shown(err, '');
      res.status(502).json({ error: 'El pago se recibió, pero el hotel no confirmó la reserva' + (why ? ': ' + why : '.') + ' Escríbenos con tu código ' + b.code + '.' });
    } finally {
      confirming.delete(id);
    }
  });

  // Pagos a medias: el cliente paga en la pasarela y no vuelve a la web (cierra la pestaña, se queda sin conexión), así que
  // nadie llama a «confirm» y la reserva se queda en «pendiente_pago». Cada cierto tiempo se intenta confirmar como si
  // hubiera vuelto. Pagada → se confirma y le llega el correo. Sin pagar tras 24 h → «caducada» (no hubo cargo). Otro
  // error → se avisa al titular una sola vez y se deja para revisarla a mano.
  const RECONCILE_AFTER = 10 * 60 * 1000;
  const EXPIRE_AFTER = 24 * 60 * 60 * 1000;
  const reconcilePending = async (now = Date.now()) => {
    if (!live) return { confirmed: 0, expired: 0, alerted: 0 };
    const result = { confirmed: 0, expired: 0, alerted: 0 };
    const pending = (await store.all()).filter((b) => b.status === 'pendiente_pago' && b.provider === 'liteapi' && now - Date.parse(b.createdAt) >= RECONCILE_AFTER);
    for (const b of pending) {
      const flight = b.type === 'flight';
      if (flight && !liveFlights) continue;
      const busy = flight ? confirmingFlights : confirming;
      if (busy.has(b.checkoutId)) continue;
      busy.add(b.checkoutId);
      try {
        await (flight ? confirmFlight(b) : confirmHotel(b));
        result.confirmed += 1;
      } catch (err) {
        if (err instanceof PaymentPendingError) {
          if (now - Date.parse(b.createdAt) >= EXPIRE_AFTER) {
            await store.update(b.code, { status: 'caducada', expiredAt: new Date(now).toISOString() });
            result.expired += 1;
          }
        } else if (!b.alertedAt) {
          console.error('[conciliación]', b.code, err.message);
          notify('paymentWithoutBooking', { ...b, error: err.message });
          await store.update(b.code, { alertedAt: new Date(now).toISOString() });
          result.alerted += 1;
        }
      } finally {
        busy.delete(b.checkoutId);
      }
    }
    return result;
  };
  app.locals.reconcilePending = reconcilePending;
  if (live && reconcileEveryMs > 0) {
    setInterval(() => reconcilePending().catch((err) => console.error('[conciliación]', err.message)), reconcileEveryMs).unref();
  }

  app.post('/api/bookings', bookingLimit, async (req, res) => {
    const body = req.body || {};
    const name = String(body.name || '').trim().slice(0, 80);
    const email = String(body.email || '').trim().slice(0, 120);
    if (name.length < 2) return res.status(400).json({ error: 'Indica tu nombre.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email no válido.' });
    // Con datos reales solo se reservan hoteles reales: nada simulado.
    if (live && !isLive(body.itemId)) return res.status(403).json({ error: 'Esta reserva no está disponible.' });
    if (isLive(body.itemId)) {
      if (livePayment === 'customer') return res.status(400).json({ error: 'Para reservar este hotel hay que pagar con tarjeta.' });
      if (!liveBookingEnabled) {
        return res.status(403).json({ error: 'En esta web de demostración las reservas reales están desactivadas: puedes ver precios y disponibilidad reales, pero no reservar.' });
      }
      try {
        // El precio que vio el cliente en el presupuesto; nunca se reserva por encima.
        const seen = Number(body.expectedTotal);
        if (!Number.isFinite(seen) || seen <= 0) return res.status(400).json({ error: 'Falta el precio del presupuesto. Vuelve a abrir la reserva.' });
        const q = await live.quote(body);
        if (q.total > seen + 0.01) throw new PriceChangedError(q.total);
        const b = await live.book({ offerId: q.offerId, name, email, units: q.units, maxTotal: seen });
        const booking = await store.add({
          code: await newCode(),
        lang: langOf(req),
          type: 'hotel',
          itemId: q.item.id,
          itemName: `${q.item.name} (${q.item.city})`,
          checkIn: body.checkIn,
          checkOut: body.checkOut,
          units: q.units,
          total: b.total ?? q.total,
          name,
          email,
          guests: occupancy(body),
          status: 'confirmada',
          provider: 'liteapi',
          providerBookingId: b.bookingId,
          sandbox: live.sandbox,
          refundable: q.refundable,
          freeCancellationUntil: q.freeCancellationUntil,
          payAtHotel: q.payAtHotel,
          roomName: q.roomName,
          createdAt: new Date().toISOString(),
        });
        notify('bookingConfirmed', booking);
        return res.status(201).json(publicBooking(booking));
      } catch (err) {
        console.error('[liteapi]', err.message);
        return res.status(409).json({ error: shown(err, 'No se pudo comprobar la habitación con el hotel. Inténtalo de nuevo o elige otra.'), ...(err instanceof PriceChangedError ? { newTotal: err.total } : {}) });
      }
    }
    try {
      const booking = await oneAtATime('item:' + String(body.itemId), async () => {
        const q = quote(await store.all(), body, osm?.known());
        return store.add({
          code: await newCode(),
          lang: langOf(req),
          type: body.type,
          itemId: q.item.id,
          itemName: body.type === 'hotel' ? `${q.item.name} (${q.item.city})` : `${q.item.airline} ${q.item.origin}→${q.item.destination} ${q.item.departure}`,
          checkIn: body.type === 'hotel' ? body.checkIn : undefined,
          checkOut: body.type === 'hotel' ? body.checkOut : undefined,
          date: body.type === 'flight' ? body.date : undefined,
          units: q.units,
          total: q.total,
          name,
          email,
          status: 'confirmada',
          createdAt: new Date().toISOString(),
        });
      });
      notify('bookingConfirmed', booking);
      res.status(201).json(publicBooking(booking));
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  });

  // ---------- Cuentas (enlace por email o Google) y «Para ti» ----------
  const setSession = (req, res, session) =>
    res.cookie(COOKIE, session.token, { httpOnly: true, secure: req.secure, sameSite: 'lax', maxAge: session.maxAge, path: '/' });
  const authError = (res, err) => res.status(err.status || 500).json({ error: err.status ? err.message : 'No se pudo completar. Inténtalo de nuevo.' });
  const me = (req) => (accounts?.enabled ? accounts.userFromRequest(req).catch(() => null) : null);

  app.post('/api/auth/email', async (req, res) => {
    try {
      await accounts.sendLoginLink({ email: req.body?.email, lang: langOf(req), site: siteUrl(req), ip: req.ip });
      res.json({ ok: true });
    } catch (err) {
      if (!err.status) console.error('[cuentas]', err.message);
      authError(res, err);
    }
  });
  app.post('/api/auth/verify', async (req, res) => {
    try {
      const { user, session } = await accounts.verifyLoginLink(String(req.body?.token || ''));
      setSession(req, res, session);
      res.json({ user: publicUser(user) });
    } catch (err) {
      authError(res, err);
    }
  });
  app.post('/api/auth/google', async (req, res) => {
    try {
      const { user, session } = await accounts.loginWithGoogle(req.body?.credential);
      setSession(req, res, session);
      res.json({ user: publicUser(user) });
    } catch (err) {
      if (!err.status) console.error('[cuentas]', err.message);
      authError(res, err);
    }
  });
  for (const [path, login] of [
    ['microsoft', (b, req) => accounts.loginWithMicrosoft(b?.idToken, String(b?.nonce || ''), { lang: langOf(req), site: siteUrl(req), ip: req.ip })],
    ['facebook', (b) => accounts.loginWithFacebook(b?.accessToken)],
  ]) {
    app.post('/api/auth/' + path, async (req, res) => {
      try {
        const { user, session, pending } = await login(req.body, req);
        // Hay que confirmar el email con el enlace que se acaba de enviar.
        if (pending) return res.json({ pending });
        setSession(req, res, session);
        res.json({ user: publicUser(user) });
      } catch (err) {
        if (!err.status) console.error('[cuentas]', err.message);
        authError(res, err);
      }
    });
  }
  app.post('/api/auth/apple', async (req, res) => {
    try {
      const { user, session } = await accounts.loginWithApple(req.body?.idToken, String(req.body?.name || '').slice(0, 80));
      setSession(req, res, session);
      res.json({ user: publicUser(user) });
    } catch (err) {
      if (!err.status) console.error('[cuentas]', err.message);
      authError(res, err);
    }
  });
  app.post('/api/auth/logout', async (req, res) => {
    await accounts?.logout(req).catch(() => {});
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });
  app.get('/api/me', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ user: publicUser(await me(req)) });
  });
  app.delete('/api/me', async (req, res) => {
    const user = await me(req);
    if (!user) return res.status(401).json({ error: 'Entra en tu cuenta primero.' });
    await accounts.deleteUser(req, user.email);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });
  // Propuestas: con cuenta se guardan y se usan sus búsquedas; sin cuenta, las que manda el navegador.
  app.post('/api/recommendations', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const sent = Array.isArray(req.body?.history) ? req.body.history.slice(0, 30) : [];
    let user = await me(req);
    if (user && sent.length) user = await accounts.addSearches(user.email, sent);
    const history = mergeHistory(user?.history || [], sent);
    const items = recommend(history, { lang: langOf(req) }).map((r) => {
      const c = cityByName(r.city);
      if (c && r.kind === 'hotel') wantStats(c);
      return { ...r, photo: (c && statsOf(c)?.cover) || null };
    });
    res.json({ items });
  });

  // «Mis reservas»: solo con la sesión de la cuenta de ese email o con email + código de una
  // de sus reservas (el código llega por email). Así nadie ve ni cancela reservas ajenas
  // sabiendo solo un email. Los intentos fallidos se limitan por IP.
  const lookupFails = new Map(); // ip → [marcas de tiempo]
  const failsOf = (ip) => (lookupFails.get(ip) || []).filter((x) => Date.now() - x < 60 * 60 * 1000);
  const blocked = (req, res) => {
    if (failsOf(req.ip).length < 20) return false;
    res.status(429).json({ error: 'Demasiados intentos. Prueba dentro de un rato.' });
    return true;
  };
  const failed = (req) => {
    lookupFails.set(req.ip, [...failsOf(req.ip), Date.now()]);
    if (lookupFails.size > 5000) lookupFails.delete(lookupFails.keys().next().value);
  };
  // ¿Puede esta petición ver o cancelar la reserva? (sesión del mismo email, o email + su código)
  const owns = async (req, found, email) => {
    if (!found) return false;
    const owner = found.email.toLowerCase();
    if ((await me(req))?.email === owner) return true;
    return !!email && email === owner;
  };

  app.get('/api/bookings', async (req, res) => {
    const user = await me(req);
    const email = String(req.query.email || '').trim().toLowerCase();
    const code = String(req.query.code || '').trim().toUpperCase();
    const list = async (e) => res.json((await store.listByEmail(e)).filter((b) => b.status !== 'pendiente_pago' && b.status !== 'caducada').map(publicBooking));
    if (user && (!email || email === user.email)) return list(user.email);
    if (!email) return res.status(400).json({ error: 'Indica tu email.' });
    if (!code) return res.status(401).json({ error: 'Escribe también el código de una de tus reservas (DL-…), que te enviamos por email, o entra con tu cuenta.' });
    if (blocked(req, res)) return;
    const found = await store.get(code);
    if (!found || found.email.toLowerCase() !== email) {
      failed(req);
      return res.status(404).json({ error: 'No hay ninguna reserva con ese email y ese código.' });
    }
    list(email);
  });

  // Cuánto se devolvería al cancelar un vuelo (estimación de la aerolínea).
  app.get('/api/bookings/:code/cancel-quote', async (req, res) => {
    const email = String(req.query.email || '').toLowerCase();
    if (blocked(req, res)) return;
    const found = await store.get(String(req.params.code).toUpperCase());
    if (!(await owns(req, found, email)) || found.status !== 'confirmada') {
      if (!found || !(await owns(req, found, email))) failed(req);
      return res.status(404).json({ error: 'Reserva no encontrada.' });
    }
    if (found.type !== 'flight' || found.provider !== 'liteapi' || !live) return res.json({ refundable: !!found.refundable, refund: null });
    try {
      res.json(await live.flightCancelQuote(found.providerBookingId));
    } catch (err) {
      console.error('[liteapi vuelos]', err.message);
      res.status(502).json({ error: 'No se pudo consultar el reembolso ahora mismo. Inténtalo de nuevo.' });
    }
  });

  app.post('/api/bookings/:code/cancel', async (req, res) => {
    const email = String(req.body?.email || '').toLowerCase();
    if (blocked(req, res)) return;
    const found = await store.get(String(req.params.code).toUpperCase());
    if (!(await owns(req, found, email)) || found.status !== 'confirmada') {
      if (!found || !(await owns(req, found, email))) failed(req);
      return res.status(404).json({ error: 'Reserva no encontrada.' });
    }
    let cancellation;
    if (found.provider === 'liteapi') {
      if (!live) return res.status(503).json({ error: 'No se puede cancelar ahora: falta la conexión con el proveedor.' });
      try {
        cancellation = found.type === 'flight' ? await live.flightCancel(found.providerBookingId) : await live.cancel(found.providerBookingId);
      } catch (err) {
        console.error('[liteapi cancelar]', found.code, err.message);
        const why = shown(err, 'Inténtalo de nuevo más tarde o escríbenos con tu código.');
        return res.status(502).json({ error: (found.type === 'flight' ? 'La aerolínea' : 'El hotel') + ' no ha aceptado la cancelación: ' + why });
      }
      // La aerolínea a veces confirma la cancelación más tarde.
      if (cancellation.pending) {
        const b = await store.update(found.code, { status: 'cancelacion_solicitada', cancellation });
        return res.json(publicBooking(b));
      }
    }
    const b = await store.cancel(found.code, found.email);
    if (!b) return res.status(404).json({ error: 'Reserva no encontrada.' });
    const cancelled = cancellation ? await store.update(b.code, { cancellation }) : b;
    notify('bookingCancelled', cancelled);
    res.json(publicBooking(cancelled));
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const store = await createStore({ file: join(root, 'data', 'bookings.json') });
  const app = createApp({ store });
  app.listen(port, () => {
    console.log(process.env.DATABASE_URL ? 'Reservas en PostgreSQL.' : 'Reservas en data/bookings.json (se pierden si el disco no es permanente).');
    console.log(`DíasLibres en http://localhost:${port}`);
    if (!process.env.ANTHROPIC_API_KEY) console.log('Sin ANTHROPIC_API_KEY: la búsqueda con IA usa el intérprete local.');
    if (process.env.LITEAPI_KEY?.trim()) console.log(`Hoteles con datos reales de LiteAPI${process.env.LITEAPI_KEY.trim().replace(/^["']/, '').startsWith('sand_') ? ' (entorno de pruebas)' : ''}.`);
    else console.log('Sin LITEAPI_KEY: hoteles con precios y disponibilidad simulados.');
    app.locals.refreshDeals(); // las ofertas de vuelos ya preparadas para la primera visita
    // Datos de las ciudades para las páginas de buscadores: una ciudad cada 20 s, sin prisa.
    setInterval(() => app.locals.statsTick(), 20000).unref();
    // Avisar a los buscadores de IndexNow pasado un rato (con los datos de las ciudades ya cargados).
    setTimeout(() => app.locals.submitIndexNow().catch((err) => console.error('[indexnow]', err.message)), 5 * 60 * 1000).unref();
  });
}
