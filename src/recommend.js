// «Para ti»: propuestas a partir de las últimas búsquedas (de la cuenta o del dispositivo).
// Sin modelos ni datos de otros usuarios: se mira qué tipo de destino busca más
// (playa, isla, ciudad, montaña), en qué país, con qué filtros (apartamento, comidas,
// precio) y desde qué aeropuerto vuela, y se proponen sitios parecidos que aún no ha mirado.
import { CITIES } from './places.js';
import { cityByName, cityName } from './seo.js';

const DECAY = 0.85; // cada búsqueda anterior pesa un 15 % menos

// Elige el valor con más peso (o null).
function top(scores) {
  let best = null;
  for (const [k, v] of scores) if (k && (!best || v > best[1])) best = [k, v];
  return best?.[0] ?? null;
}
const add = (map, k, w) => k && map.set(k, (map.get(k) || 0) + w);

// Número pseudoaleatorio estable por día: las propuestas cambian cada día, no en cada visita.
function jitter(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

export function recommend(history = [], { lang = 'es', day = new Date().toISOString().slice(0, 10), limit = 6 } = {}) {
  const types = new Map();
  const countries = new Map();
  const stays = new Map();
  const boards = new Map();
  const origins = new Map();
  const prices = [];
  const seen = new Set();
  const recent = []; // ciudades buscadas, de la más nueva a la más vieja
  const likedOfType = new Map(); // tipo → ciudad buscada más reciente de ese tipo

  history.forEach((s, i) => {
    const w = DECAY ** i;
    const c = cityByName(s.city);
    if (s.kind === 'flight') add(origins, s.origin, w);
    else {
      add(stays, s.stay, w);
      add(boards, s.board, w);
      if (s.maxPrice) prices.push(s.maxPrice);
    }
    if (c) {
      add(types, c.type, w);
      add(countries, c.country, w);
      if (!likedOfType.has(c.type)) likedOfType.set(c.type, c);
    }
    const key = (c?.es || s.city).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      recent.push({ city: c, name: c ? cityName(c, lang) : s.city, search: s });
    }
  });
  if (!recent.length) return [];

  const prefs = {
    stay: top(stays) || '',
    board: top(boards) || '',
    maxPrice: prices.length ? prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)] : null,
  };
  const origin = top(origins);
  const out = [];

  // 1) Volver a lo último que buscó, con sus mismos filtros.
  for (const r of recent.filter((x) => x.search.kind === 'hotel').slice(0, 2)) {
    const s = r.search;
    out.push({
      kind: 'hotel',
      city: r.name,
      type: r.city?.type || 'city',
      reason: { key: 'Lo buscaste hace poco' },
      query: { destination: r.name, stay: s.stay, board: s.board, maxPrice: s.maxPrice, nights: s.nights, adults: s.adults },
    });
  }

  // 2) Destinos parecidos: mismo tipo, mejor en el mismo país, que aún no ha buscado.
  const favType = top(types);
  const favCountry = top(countries);
  if (favType) {
    const ranked = CITIES.filter((c) => !seen.has(c.es.toLowerCase()))
      .map((c) => ({
        c,
        score: (types.get(c.type) || 0) * 2 + (c.country === favCountry ? 1.5 : 0) + (c.iata ? 0.2 : 0) + jitter(day + c.es),
      }))
      .filter((x) => types.has(x.c.type))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    for (const { c } of ranked) {
      const like = likedOfType.get(c.type);
      out.push({
        kind: 'hotel',
        city: cityName(c, lang),
        type: c.type,
        reason: like ? { key: 'Parecido a {city}', city: cityName(like, lang) } : { key: 'Te puede gustar' },
        query: { destination: cityName(c, lang), ...prefs },
      });
    }
  }

  // 3) Un vuelo desde donde suele salir a uno de esos destinos.
  if (origin) {
    const from = cityByName(origin);
    const to = out.map((r) => cityByName(r.city)).find((c) => c?.iata && c.iata !== from?.iata);
    if (to) {
      out.push({
        kind: 'flight',
        city: cityName(to, lang),
        origin: from ? cityName(from, lang) : origin,
        type: to.type,
        reason: { key: 'Vuelo desde {city}', city: from ? cityName(from, lang) : origin },
        query: { origin: from ? cityName(from, lang) : origin, destination: cityName(to, lang) },
      });
    }
  }
  return out.slice(0, limit);
}
