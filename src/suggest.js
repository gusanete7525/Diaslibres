// Sugerencias de destino mientras se escribe («par» → París, Parma, Paros…).
// Primero la lista propia (CITIES, con su nombre en los 7 idiomas) y después
// el buscador de lugares de LiteAPI, que cubre cualquier ciudad del mundo.
// Si LiteAPI tarda o falla, se responde solo con la lista propia.
import { CITIES } from './places.js';

export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

const KEEP = new Set(['locality', 'postal_town', 'colloquial_area', 'archipelago', 'natural_feature', 'sublocality_level_1']);
const MAX = 8;
const TTL = 6 * 60 * 60 * 1000;
const countryNames = new Map();

function countryName(code, lang) {
  if (!code) return null;
  const key = lang + '|' + code;
  if (!countryNames.has(key)) {
    let name = code;
    try { name = new Intl.DisplayNames([lang], { type: 'region' }).of(code) || code; } catch { /* código tal cual */ }
    countryNames.set(key, name);
  }
  return countryNames.get(key);
}

// Ciudades propias cuyo nombre (en cualquier idioma) empieza por lo escrito,
// o tiene una palabra que empieza por ello («mallorca» → Palma de Mallorca).
export function localMatches(q, lang = 'es', { airports = false } = {}) {
  const n = norm(q);
  if (n.length < 2) return [];
  const seen = new Set();
  const scored = [];
  for (const c of CITIES) {
    if (airports && !c.iata) continue;
    const name = c[lang] || c.es;
    const id = norm(name) + '|' + c.country;
    if (seen.has(id)) continue;
    const names = [...new Set(['es', 'en', 'fr', 'de', 'it', 'pt', 'nl', lang].map((l) => norm(c[l])).filter(Boolean))];
    let score = 0;
    for (const x of names) {
      if (x === n) score = Math.max(score, 3);
      else if (x.startsWith(n)) score = Math.max(score, 2);
      else if (x.split(/[\s-]+/).some((w) => w.startsWith(n))) score = Math.max(score, 1);
    }
    if (!score) continue;
    seen.add(id);
    scored.push({ score, names, item: { name, country: countryName(c.country, lang), code: c.country, iata: c.iata || null, source: 'local' } });
  }
  // `names` (todos sus nombres) no se envía al navegador: solo sirve para quitar duplicados.
  return scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, lang)).map((s) => Object.defineProperty(s.item, 'names', { value: s.names, enumerable: false }));
}

function fromLite(data = []) {
  return data
    .filter((p) => !p.types || p.types.some((t) => KEEP.has(t)) || (p.types.includes('administrative_area_level_1') && !String(p.formattedAddress || '').includes(',')))
    .map((p) => {
      const parts = String(p.formattedAddress || '').split(',').map((x) => x.trim()).filter(Boolean);
      return { name: p.displayName, country: parts.at(-1) || null, region: parts.length > 1 ? parts[0] : null, placeId: p.placeId || null, source: 'liteapi' };
    })
    .filter((p) => p.name);
}

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

// Aeropuertos de LiteAPI agrupados por ciudad (para Origen/Destino de vuelos).
function fromAirports(list = [], lang = 'es') {
  const byCity = new Map();
  for (const a of list) {
    const city = a.city || a.name;
    if (!city) continue;
    const id = norm(city) + '|' + norm(a.country);
    if (!byCity.has(id)) byCity.set(id, { name: city, country: /^[A-Z]{2}$/.test(a.country || '') ? countryName(a.country, lang) : a.country || null, iata: a.code, source: 'liteapi' });
  }
  return [...byCity.values()];
}

export function createSuggester({ live = null, timeoutMs = 2500, maxEntries = 1000 } = {}) {
  const cache = new Map();
  return async function suggest(q, lang = 'es', kind = 'city') {
    const airports = kind === 'airport';
    const text = String(q ?? '').slice(0, 60).trim();
    if (norm(text).length < 2) return [];
    const key = kind + '|' + lang + '|' + norm(text);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.value;
    const local = localMatches(text, lang, { airports });
    let remote = [];
    let ok = !live;
    if (live && local.length < MAX) {
      try {
        remote = airports
          ? fromAirports(await withTimeout(live.airports(text), timeoutMs), lang)
          : fromLite((await withTimeout(live.placesRaw(text, lang), timeoutMs)).data);
        ok = true;
      } catch { /* sin LiteAPI: solo la lista propia */ }
    }
    const seen = new Set(local.map((p) => norm(p.name) + '|' + norm(p.country)));
    const value = [...local];
    for (const p of remote) {
      const id = norm(p.name) + '|' + norm(p.country);
      // Mismo sitio que una ciudad propia con otro nombre («München» = «Múnich»).
      if (seen.has(id) || local.some((l) => (l.names || [norm(l.name)]).includes(norm(p.name)) && (!p.region || p.iata))) continue;
      seen.add(id);
      value.push(p);
    }
    const out = value.slice(0, MAX);
    if (ok) {
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
      cache.set(key, { at: Date.now(), value: out });
    }
    return out;
  };
}
