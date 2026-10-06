// Páginas para buscadores, en cada idioma de la web:
//   /hoteles/<ciudad>, /hoteles/<ciudad>/<filtro> (con-piscina, todo-incluido…) y /vuelos/<origen>-<destino>
//   (en inglés /en/hotels/…, /en/flights/…; en francés /fr/hotels/…, /fr/vols/…; etc.).
// Sirven la misma web con título, textos, datos de la ciudad, preguntas frecuentes y enlaces propios.
import { CITIES, ROUTES } from './places.js';
import { LANGS, LANG_CODES, tr, translateHtml } from './i18n.js';

const norm = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
export const slug = (x) => norm(x).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const cityName = (c, lang) => c[lang] || c.es;
const CITY_BY_SLUG = Object.fromEntries(LANG_CODES.map((l) => [l, new Map(CITIES.map((c) => [slug(cityName(c, l)), c]))]));
// Aeropuerto → ciudad (la primera de la lista con ese código es la suya).
const CITY_BY_IATA = new Map();
for (const c of CITIES) if (c.iata && !CITY_BY_IATA.has(c.iata)) CITY_BY_IATA.set(c.iata, c);
// Cualquier nombre, en cualquier idioma → ciudad.
const CITY_BY_NAME = new Map();
for (const l of LANG_CODES) for (const c of CITIES) if (!CITY_BY_NAME.has(norm(c[l]))) CITY_BY_NAME.set(norm(c[l]), c);

// El destino que se nombra en un texto libre (el nombre más largo que aparezca).
// Los nombres que también son palabras corrientes («Nice», «Split», «León») solo cuentan con mayúscula.
const PLACE_NAMES = [...CITY_BY_NAME].map(([n, c]) => [' ' + n.replace(/[^a-z0-9]+/g, ' ').trim() + ' ', c]).filter(([k]) => k.length > 4).sort((a, b) => b[0].length - a[0].length);
const COMMON_WORDS = new Set(['nice', 'split', 'leon', 'ronda', 'como', 'bath', 'faro', 'lagos', 'palma', 'santiago', 'granada']);
export function findPlaceIn(text) {
  const t = ' ' + norm(text).replace(/[^a-z0-9]+/g, ' ') + ' ';
  for (const [k, c] of PLACE_NAMES) {
    if (!t.includes(k)) continue;
    if (COMMON_WORDS.has(k.trim()) && !new RegExp(`(^|[^\\p{L}])${k.trim()[0].toUpperCase()}`, 'u').test(text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) continue;
    return c;
  }
  return null;
}
export const cityByIata = (code) => CITY_BY_IATA.get(String(code || '').toUpperCase()) || null;
export const cityByName = (text) => CITY_BY_NAME.get(norm(text)) || null;
export const cityKey = (c) => norm(c.es);
// Nombre de un aeropuerto en el idioma pedido (o el que se dé si no es un destino conocido).
export const placeName = (code, lang, fallback) => {
  const c = cityByIata(code);
  return c ? cityName(c, lang) : fallback || code;
};

// Páginas por filtro. title: frase en español (se traduce con los diccionarios).
// types: solo tienen sentido en esos destinos; count: cuántos hoteles cumplen (con los datos de la ciudad).
export const FILTERS = [
  { id: 'piscina', fac: ['piscina'], title: 'Hoteles con piscina en {city}', slug: { es: 'con-piscina', en: 'with-pool', fr: 'avec-piscine', de: 'mit-pool', it: 'con-piscina', pt: 'com-piscina', nl: 'met-zwembad' } },
  { id: 'todo-incluido', board: 'AI', types: ['beach', 'island'], title: 'Hoteles con todo incluido en {city}', slug: { es: 'todo-incluido', en: 'all-inclusive', fr: 'tout-compris', de: 'all-inclusive', it: 'all-inclusive', pt: 'tudo-incluido', nl: 'all-inclusive' } },
  { id: 'playa', fac: ['playa'], types: ['beach', 'island'], title: 'Hoteles en primera línea de playa en {city}', slug: { es: 'primera-linea-de-playa', en: 'beachfront', fr: 'bord-de-mer', de: 'am-strand', it: 'fronte-mare', pt: 'em-frente-a-praia', nl: 'aan-het-strand' } },
  { id: 'mascotas', fac: ['mascotas'], title: 'Hoteles que admiten mascotas en {city}', slug: { es: 'que-admiten-mascotas', en: 'pet-friendly', fr: 'animaux-acceptes', de: 'haustierfreundlich', it: 'animali-ammessi', pt: 'aceitam-animais', nl: 'huisdieren-toegestaan' } },
  { id: 'familias', fac: ['ninos'], title: 'Hoteles para familias con niños en {city}', slug: { es: 'para-familias', en: 'family-friendly', fr: 'pour-les-familles', de: 'familienfreundlich', it: 'per-famiglie', pt: 'para-familias', nl: 'gezinsvriendelijk' } },
  { id: 'adultos', fac: ['adultos'], title: 'Hoteles solo para adultos en {city}', slug: { es: 'solo-adultos', en: 'adults-only', fr: 'reserves-aux-adultes', de: 'nur-fuer-erwachsene', it: 'solo-adulti', pt: 'so-para-adultos', nl: 'alleen-volwassenen' } },
  { id: 'spa', fac: ['spa'], title: 'Hoteles con spa en {city}', slug: { es: 'con-spa', en: 'with-spa', fr: 'avec-spa', de: 'mit-spa', it: 'con-spa', pt: 'com-spa', nl: 'met-spa' } },
  { id: '5-estrellas', minStars: 5, title: 'Hoteles de 5 estrellas en {city}', slug: { es: '5-estrellas', en: '5-star', fr: '5-etoiles', de: '5-sterne', it: '5-stelle', pt: '5-estrelas', nl: '5-sterren' } },
  { id: 'desayuno', board: 'BI', title: 'Hoteles con desayuno incluido en {city}', slug: { es: 'con-desayuno', en: 'with-breakfast', fr: 'petit-dejeuner-inclus', de: 'mit-fruehstueck', it: 'con-colazione', pt: 'com-pequeno-almoco', nl: 'met-ontbijt' } },
  { id: 'parking', fac: ['parking'], title: 'Hoteles con parking en {city}', slug: { es: 'con-parking', en: 'with-parking', fr: 'avec-parking', de: 'mit-parkplatz', it: 'con-parcheggio', pt: 'com-estacionamento', nl: 'met-parkeren' } },
  { id: 'apartamentos', stay: 'apartment', title: 'Apartamentos en {city}', found: 'Hemos encontrado {n} apartamentos en {city}.', slug: { es: 'apartamentos', en: 'apartments', fr: 'appartements', de: 'ferienwohnungen', it: 'appartamenti', pt: 'apartamentos', nl: 'appartementen' } },
  { id: 'casas', stay: 'house', title: 'Casas y villas en {city}', found: 'Hemos encontrado {n} casas y villas en {city}.', slug: { es: 'casas-y-villas', en: 'villas-and-holiday-homes', fr: 'villas-et-maisons', de: 'ferienhaeuser', it: 'ville-e-case-vacanza', pt: 'casas-e-moradias', nl: 'vakantiehuizen' } },
  { id: 'baratos', sort: 'price', title: 'Hoteles baratos en {city}', slug: { es: 'baratos', en: 'cheap', fr: 'pas-chers', de: 'guenstig', it: 'economici', pt: 'baratos', nl: 'goedkoop' } },
];
const FILTER_BY_SLUG = Object.fromEntries(LANG_CODES.map((l) => [l, new Map(FILTERS.map((f) => [f.slug[l], f]))]));
export const filterFromSlug = (lang, s) => FILTER_BY_SLUG[lang]?.get(s) || null;
const matches = (f, h) => (f.fac || []).every((k) => h.facilities?.includes(k)) && (!f.minStars || (h.stars || 0) >= f.minStars) && (!f.stay || (h.stay || 'hotel') === f.stay);
// Filtros que se pueden comprobar con los datos del hotel (las comidas dependen de cada tarifa).
const checkable = (f) => !f.board && !f.sort;

// «gandia» → Gandía si es conocida; si no, «villajoyosa» → { es: 'Villajoyosa' } (cualquier sitio del mundo).
export function cityFromSlug(lang, s) {
  const known = CITY_BY_SLUG[lang]?.get(s) || CITY_BY_SLUG.es.get(s);
  if (known) return known;
  const words = String(s).split('-').filter(Boolean).slice(0, 6);
  if (!words.length || words.some((w) => !/^[a-z0-9]+$/.test(w))) return null;
  const name = words.map((w, i) => (i && ['de', 'del', 'la', 'el', 'las', 'los'].includes(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
  return { es: name, adhoc: true };
}

const ROUTE_CITIES = ROUTES.map(([o, d]) => [cityByIata(o), cityByIata(d)]).filter(([o, d]) => o && d);
export function routeFromSlug(lang, s) {
  for (const [o, d] of ROUTE_CITIES) if (`${slug(cityName(o, lang))}-${slug(cityName(d, lang))}` === s) return { o, d };
  // Cualquier otra pareja de destinos con aeropuerto.
  const parts = String(s).split('-');
  for (let i = 1; i < parts.length; i++) {
    const a = CITY_BY_SLUG[lang].get(parts.slice(0, i).join('-'));
    const b = CITY_BY_SLUG[lang].get(parts.slice(i).join('-'));
    if (a?.iata && b?.iata && a.iata !== b.iata) return { o: a, d: b };
  }
  return null;
}

// ---------- Direcciones ----------
export const homeUrl = (lang) => LANGS[lang].prefix + '/';
export const cityUrl = (lang, city, filter) => `${LANGS[lang].prefix}/${LANGS[lang].hotels}/${slug(cityName(city, lang))}${filter ? '/' + filter.slug[lang] : ''}`;
export const routeUrl = (lang, o, d) => `${LANGS[lang].prefix}/${LANGS[lang].flights}/${slug(cityName(o, lang))}-${slug(cityName(d, lang))}`;
const urlOf = (lang, key) => (key.type === 'city' ? cityUrl(lang, key.city, key.filter) : key.type === 'route' ? routeUrl(lang, key.o, key.d) : homeUrl(lang));

// ---------- Datos de cada ciudad (de la lista completa de sus hoteles) ----------
const brief = (h) => ({ name: h.name, stars: h.stars || null, rating: h.rating || null, reviews: h.reviewCount || 0 });
const best = (list, n) => [...list].sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.reviewCount || 0) - (a.reviewCount || 0))
  .filter((h) => h.rating).slice(0, n).map(brief);
export function cityStats(hotels) {
  const rated = hotels.filter((h) => h.rating);
  const trusted = hotels.filter((h) => h.rating && (h.reviewCount || 0) >= 20);
  const fac = {};
  for (const h of hotels) for (const k of h.facilities || []) fac[k] = (fac[k] || 0) + 1;
  const filters = {};
  for (const f of FILTERS) {
    const list = checkable(f) ? hotels.filter((h) => matches(f, h)) : f.sort ? hotels.filter((h) => h.stars && h.stars <= 3) : hotels;
    filters[f.id] = { count: checkable(f) ? list.length : null, top: best(list.filter((h) => (h.reviewCount || 0) >= 10).length >= 3 ? list.filter((h) => (h.reviewCount || 0) >= 10) : list, 8) };
  }
  return {
    at: Date.now(),
    total: hotels.length,
    stars: [1, 2, 3, 4, 5].map((n) => hotels.filter((h) => h.stars === n).length),
    rating: rated.length ? Math.round((rated.reduce((s, h) => s + h.rating, 0) / rated.length) * 10) / 10 : null,
    fac,
    stay: hotels.reduce((o, h) => ({ ...o, [h.stay || 'hotel']: (o[h.stay || 'hotel'] || 0) + 1 }), {}),
    top: best(trusted.length >= 5 ? trusted : rated, 10),
    // Foto de portada de la ciudad (para «Para ti»): la del alojamiento mejor valorado que tenga foto.
    cover: [...(trusted.length >= 5 ? trusted : rated)].sort((a, b) => (b.rating || 0) - (a.rating || 0)).find((h) => /^https:\/\//.test(h.photo || ''))?.photo || null,
    filters,
  };
}

// ---------- Contenido de cada página ----------
const num = (lang, n) => Number(n).toLocaleString(LANGS[lang].locale);
const hotelLine = (lang, h) => `${h.name}${h.stars ? ' ' + '★'.repeat(h.stars) : ''}${h.rating ? ` · ${num(lang, h.rating)}/10` : ''}${h.reviews ? ` (${tr(lang, h.reviews === 1 ? '{n} opinión' : '{n} opiniones', { n: num(lang, h.reviews) })})` : ''}`;
const links = (items) => `<ul class="seo-links">${items.map(([href, text]) => `<li><a href="${esc(href)}">${esc(text)}</a></li>`).join('')}</ul>`;
const relatedCities = (city) => CITIES.filter((c) => c !== city && c.country === city.country).slice(0, 10);

function faq(lang, name, s) {
  const t = (k, v = {}) => tr(lang, k, { city: name, ...v });
  const items = [[t('¿Cuántos hoteles hay en {city}?'), t('En DíasLibres hay {total} hoteles en {city}, de los que {n} tienen 4 o 5 estrellas.', { total: num(lang, s.total), n: num(lang, s.stars[3] + s.stars[4]) })]];
  if (s.top[0]) items.push([t('¿Cuál es el hotel mejor valorado de {city}?'), t('{name}, con una puntuación de {rating} sobre 10 según {reviews} opiniones.', { name: s.top[0].name, rating: num(lang, s.top[0].rating), reviews: num(lang, s.top[0].reviews) })]);
  const pool = s.fac.piscina || 0;
  items.push([t('¿Hay hoteles con piscina en {city}?'), pool ? t('Sí, {n} hoteles de {city} tienen piscina.', { n: num(lang, pool) }) : t('No hemos encontrado hoteles con piscina en {city}.')]);
  const pets = s.fac.mascotas || 0;
  items.push([t('¿Hay hoteles que admitan mascotas en {city}?'), pets ? t('Sí, {n} hoteles de {city} admiten mascotas.', { n: num(lang, pets) }) : t('No hemos encontrado hoteles que admitan mascotas en {city}.')]);
  items.push([t('¿Cuándo es más barato dormir en {city}?'), t('Depende del día. En DíasLibres cada hotel muestra el precio de cada noche de los próximos 30 días y marca con una estrella la noche más barata.')]);
  return items;
}

// Página de hoteles de una ciudad (con filtro o sin él). stats: datos de la ciudad, si ya se tienen.
export function cityPage(lang, city, filter, stats) {
  const name = cityName(city, lang);
  const t = (k, v = {}) => tr(lang, k, { city: name, ...v });
  const fTitle = filter ? t(filter.title) : null;
  const fs = filter && stats?.filters?.[filter.id];
  const parts = [`<p>${esc(filter ? t('{title}: compara el precio de cada noche de los próximos 30 días y mira qué días están libres.', { title: fTitle }) : t('Todos los hoteles de {city} con su calendario de disponibilidad y el precio de cada noche de los próximos 30 días.'))}</p>`];
  let faqs = [];
  if (stats?.total) {
    if (!filter) {
      const facts = [t('En DíasLibres hay {total} hoteles en {city}.', { total: num(lang, stats.total) })];
      if (stats.stars[4] + stats.stars[3] + stats.stars[2]) facts.push(t('{n5} son de 5 estrellas, {n4} de 4 estrellas y {n3} de 3 estrellas.', { n5: num(lang, stats.stars[4]), n4: num(lang, stats.stars[3]), n3: num(lang, stats.stars[2]) }));
      if (stats.rating) facts.push(t('La puntuación media de los huéspedes es {avg} sobre 10.', { avg: num(lang, stats.rating) }));
      if (stats.stay?.apartment) facts.push(t('{n} son apartamentos.', { n: num(lang, stats.stay.apartment) }));
      facts.push(t('{pool} tienen piscina, {pets} admiten mascotas y {parking} tienen parking.', { pool: num(lang, stats.fac.piscina || 0), pets: num(lang, stats.fac.mascotas || 0), parking: num(lang, stats.fac.parking || 0) }));
      parts.push(`<p>${esc(facts.join(' '))}</p>`);
    } else if (fs?.count != null) {
      parts.push(`<p>${esc(t(filter.found || 'Hemos encontrado {n} hoteles en {city} que cumplen esta condición.', { n: num(lang, fs.count) }))}</p>`);
    }
    const top = filter ? fs?.top || [] : stats.top;
    if (top.length) parts.push(`<h2>${esc(filter ? t('{title}: los mejor valorados', { title: fTitle }) : t('Hoteles mejor valorados en {city}'))}</h2><ul>${top.map((h) => `<li>${esc(hotelLine(lang, h))}</li>`).join('')}</ul>`);
    if (!filter) {
      faqs = faq(lang, name, stats);
      parts.push(`<h2>${esc(t('Preguntas frecuentes'))}</h2>${faqs.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}`);
    }
  }
  if (!city.adhoc) {
    const fl = FILTERS.filter((f) => f !== filter && (!f.types || f.types.includes(city.type)) && (stats?.filters?.[f.id]?.count ?? 1) > 0);
    parts.push(`<h2>${esc(t('Más hoteles en {city}'))}</h2>${links([...(filter ? [[cityUrl(lang, city), t('Hoteles en {city}')]] : []), ...fl.map((f) => [cityUrl(lang, city, f), t(f.title)])])}`);
    const routes = ROUTE_CITIES.filter(([, d]) => d.iata === city.iata).slice(0, 12);
    if (routes.length) parts.push(`<h2>${esc(t('Vuelos a {city}'))}</h2>${links(routes.map(([o, d]) => [routeUrl(lang, o, d), t('Vuelos de {from} a {to}', { from: cityName(o, lang), to: cityName(d, lang) })]))}`);
    const near = relatedCities(city);
    if (near.length) parts.push(`<h2>${esc(t('Otros destinos'))}</h2>${links(near.map((c) => [cityUrl(lang, c, filter && (!filter.types || filter.types.includes(c.type)) ? filter : null), filter && (!filter.types || filter.types.includes(c.type)) ? tr(lang, filter.title, { city: cityName(c, lang) }) : tr(lang, 'Hoteles en {city}', { city: cityName(c, lang) })]))}`);
  }
  const ld = faqs.length ? [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }] : [];
  return {
    key: { type: 'city', city, filter },
    title: filter ? `${fTitle} · ${t('Precios y disponibilidad')} | DíasLibres` : t('Hoteles en {city} · Precios por día y disponibilidad | DíasLibres'),
    description: filter ? t('{title}: compara precios de cada noche, mira qué días están libres y reserva con pago seguro.', { title: fTitle }) : t('Hoteles en {city} con calendario de días libres y precio de cada noche. Compara, elige las fechas más baratas y reserva con pago seguro.'),
    h1: filter ? fTitle : t('Hoteles en {city}: mira qué días están libres y cuándo es más barato'),
    crumb: fTitle || t('Hoteles en {city}'),
    view: 'hotels',
    destination: name,
    filters: filter ? { fac: filter.fac, board: filter.board, minStars: filter.minStars, sort: filter.sort, stay: filter.stay } : null,
    html: parts.join(''),
    ld,
    // Un filtro sin hoteles que lo cumplan no es una página útil para Google.
    noindex: city.adhoc ? !stats?.total : filter ? !stats || fs?.count === 0 : false,
  };
}

export function routePage(lang, o, d) {
  const from = cityName(o, lang);
  const to = cityName(d, lang);
  const t = (k, v = {}) => tr(lang, k, { from, to, city: to, ...v });
  const parts = [`<p>${esc(t('Compara el precio de los vuelos de {from} a {to} día a día y reserva el más barato.'))}</p>`];
  const back = ROUTE_CITIES.find(([a, b]) => a.iata === d.iata && b.iata === o.iata);
  const others = ROUTE_CITIES.filter(([a, b]) => a.iata === o.iata && b.iata !== d.iata).slice(0, 12);
  parts.push(`<h2>${esc(t('Hoteles en {city}'))}</h2>${links([[cityUrl(lang, d), t('Hoteles en {city}')], ...FILTERS.filter((f) => !f.types || f.types.includes(d.type)).slice(0, 5).map((f) => [cityUrl(lang, d, f), t(f.title)])])}`);
  if (back || others.length) {
    parts.push(`<h2>${esc(t('Más vuelos'))}</h2>${links([...(back ? [[routeUrl(lang, d, o), t('Vuelos de {from} a {to}', { from: to, to: from })]] : []), ...others.map(([a, b]) => [routeUrl(lang, a, b), t('Vuelos de {from} a {to}', { from: cityName(a, lang), to: cityName(b, lang) })])])}`);
  }
  return {
    key: { type: 'route', o, d },
    title: t('Vuelos baratos de {from} a {to} | DíasLibres'),
    description: t('Vuelos de {from} a {to}: precio de cada día de las próximas dos semanas, gráfica de precios y reserva con pago seguro.'),
    h1: t('Vuelos de {from} a {to}: el día más barato de un vistazo'),
    crumb: t('Vuelos {from} – {to}'),
    view: 'flights',
    origin: from,
    destination: to,
    html: parts.join(''),
  };
}

export function homePage(lang, noindex) {
  return {
    key: { type: 'home' },
    title: tr(lang, 'DíasLibres · Hoteles y vuelos baratos con calendario de días libres'),
    description: tr(lang, 'Reserva hoteles y vuelos de todo el mundo viendo de un vistazo qué días están libres y cuándo es más barato. Precios reales y pago seguro.'),
    noindex,
  };
}

// Enlaces de «Destinos populares» al pie de todas las páginas.
function popular(lang) {
  const hotels = CITIES.filter((c) => c.country === 'ES').slice(0, 12).concat(CITIES.filter((c) => c.country !== 'ES').slice(0, 8));
  const routes = ROUTE_CITIES.slice(0, 8);
  return `<p><strong>${esc(tr(lang, 'Hoteles:'))}</strong> ${hotels.map((c) => `<a href="${esc(cityUrl(lang, c))}">${esc(cityName(c, lang))}</a>`).join(' · ')}</p>` +
    `<p><strong>${esc(tr(lang, 'Vuelos:'))}</strong> ${routes.map(([o, d]) => `<a href="${esc(routeUrl(lang, o, d))}">${esc(cityName(o, lang))} – ${esc(cityName(d, lang))}</a>`).join(' · ')}</p>`;
}

// Inserta en index.html (traducido) los datos de la página.
export function renderPage(html, page, { site, verification, lang = 'es' } = {}) {
  const key = page.key || { type: 'home' };
  const url = site + urlOf(lang, key);
  // Versiones en otros idiomas (no para destinos inventados: su nombre no se traduce).
  const alternates = key.city?.adhoc ? [] : LANG_CODES.map((l) => [l, site + urlOf(l, key)]);
  const ld = [{
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'DíasLibres',
    url: site + homeUrl(lang),
    inLanguage: lang,
  }, {
    '@context': 'https://schema.org',
    '@type': 'TravelAgency',
    name: 'DíasLibres',
    url: site + '/',
    email: 'contact@gusansoft.com',
    logo: site + '/icon-512.png',
    parentOrganization: { '@type': 'Organization', name: 'Gusansoft', url: 'https://gusansoft.com/' },
  }, ...(page.ld || [])];
  if (page.crumb) {
    ld.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'DíasLibres', item: site + homeUrl(lang) },
        { '@type': 'ListItem', position: 2, name: page.crumb, item: url },
      ],
    });
  }
  const head = [
    `<link rel="canonical" href="${esc(url)}" />`,
    ...(page.noindex ? [] : alternates.map(([l, u]) => `<link rel="alternate" hreflang="${l}" href="${esc(u)}" />`)),
    page.noindex || !alternates.length ? '' : `<link rel="alternate" hreflang="x-default" href="${esc(alternates[0][1])}" />`,
    page.noindex ? '<meta name="robots" content="noindex" />' : '',
    verification ? `<meta name="google-site-verification" content="${esc(verification)}" />` : '',
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="DíasLibres" />`,
    `<meta property="og:locale" content="${LANGS[lang].og}" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(site)}/og.png" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`,
  ].filter(Boolean).join('\n  ');
  let out = translateHtml(html, lang)
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(page.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(page.description)}" />\n  ${head}`)
    .replace('href="/" data-view="hotels" data-home', `href="${homeUrl(lang)}" data-view="hotels" data-home`)
    .replace('<span>ES</span></summary>', `<span>${lang.toUpperCase()}</span></summary>`)
    .replace('<!--LANG_LINKS-->', (alternates.length ? alternates : LANG_CODES.map((l) => [l, site + homeUrl(l)]))
      .map(([l, u]) => `<a href="${esc(u.slice(site.length) || '/')}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="true"' : ''}>${esc(LANGS[l].name)}</a>`).join(''))
    .replace('<!--POPULAR-->', popular(lang));
  if (page.h1) out = out.replace(/<h1( data-i18n)?>[\s\S]*?<\/h1>/, `<h1>${esc(page.h1)}</h1>`);
  if (page.view) out = out.replace('<body>', `<body data-start-view="${esc(page.view)}"${page.filters ? ` data-start-filters="${esc(JSON.stringify(page.filters))}"` : ''}>`);
  if (page.destination) out = out.replace('<input name="destination" ', `<input name="destination" value="${esc(page.destination)}" `);
  if (page.origin) out = out.replace('<input name="origin" ', `<input name="origin" value="${esc(page.origin)}" `);
  // Texto visible para buscadores (y para quien entra antes de que cargue la web);
  // la búsqueda lo sustituye en cuanto llegan los resultados.
  if (page.html) {
    out = out.replace('<main id="results" class="results" aria-live="polite"></main>', `<main id="results" class="results" aria-live="polite"><section class="seo-intro">${page.html}</section></main>`);
  }
  return out;
}

// ---------- Sitemaps: uno por idioma, con un índice en /sitemap.xml ----------
export function sitemapIndex(site) {
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${LANG_CODES
    .map((l) => `  <sitemap><loc>${esc(`${site}/sitemap-${l}.xml`)}</loc><lastmod>${today}</lastmod></sitemap>`).join('\n')}\n</sitemapindex>\n`;
}

// statsOf(city): datos de la ciudad si ya se tienen. Los filtros solo entran con al menos 3 hoteles.
export function sitemap(site, lang, statsOf = () => null) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [[homeUrl(lang), 'daily', '1.0']];
  for (const c of CITIES) {
    urls.push([cityUrl(lang, c), 'daily', '0.8']);
    const s = statsOf(c);
    if (!s) continue;
    for (const f of FILTERS) {
      if (f.types && !f.types.includes(c.type)) continue;
      const n = s.filters?.[f.id]?.count;
      if (n != null ? n >= 3 : s.total >= 20) urls.push([cityUrl(lang, c, f), 'weekly', '0.6']);
    }
  }
  for (const [o, d] of ROUTE_CITIES) urls.push([routeUrl(lang, o, d), 'daily', '0.7']);
  if (lang === 'es') urls.push(['/legal.html', 'yearly', '0.2']);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(([p, f, pr]) => `  <url><loc>${esc(site + p)}</loc><lastmod>${today}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`)
    .join('\n')}\n</urlset>\n`;
}

export { CITIES, ROUTES };
