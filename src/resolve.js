// Ciudades que la IA no puede decidir sola: varias con el mismo nombre («Cartagena») o un nombre
// mal escrito («Chiclyo»). Devuelve la ciudad elegida o la pregunta que la web le hace al usuario.
import { CITIES, cityName } from './seo.js';
import { LANGS, LANG_CODES, tr } from './i18n.js';

const norm = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const IATA = /^[A-Z]{3}$/;

// País: código ISO ↔ nombre en cualquiera de nuestros idiomas (LiteAPI da el nombre) y su nombre en el de la página.
const CODES = [];
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) CODES.push(String.fromCharCode(a, b));
const CODE_BY_NAME = new Map([['usa', 'US'], ['uk', 'GB'], ['united states of america', 'US']]);
for (const locale of ['en', ...Object.values(LANGS).map((l) => l.locale)]) {
  const dn = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' });
  for (const c of CODES) { try { const n = dn.of(c); if (n && !CODE_BY_NAME.has(norm(n))) CODE_BY_NAME.set(norm(n), c); } catch { /* código no válido */ } }
}
const countryCode = (x) => (/^[A-Z]{2}$/.test(String(x || '')) ? x : CODE_BY_NAME.get(norm(x)) || null);
function countryName(code, lang, fallback) {
  try { return (code && new Intl.DisplayNames([LANGS[lang]?.locale || 'es-ES'], { type: 'region' }).of(code)) || fallback || ''; } catch { return fallback || code || ''; }
}

function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const names = (c) => [...new Set(LANG_CODES.map((l) => norm(c[l])).filter(Boolean))];
// Destinos de nuestra lista con ese nombre (o que empiezan por él: «Cartagena» → «Cartagena de Indias»).
function curated(key, flight) {
  const out = [];
  for (const c of CITIES) {
    if (flight && !c.iata) continue;
    const ns = names(c);
    const exact = ns.includes(key);
    if (exact || ns.some((n) => n.startsWith(key + ' '))) out.push({ c, exact, country: c.country });
  }
  return out;
}
// Mal escrito: los de nuestra lista que se parecen («Chiclyo» → «Chiclayo»).
function similar(key, flight) {
  if (key.length < 4) return [];
  const max = key.length >= 8 ? 2 : 1;
  return CITIES.filter((c) => (!flight || c.iata) && names(c).some((n) => distance(n, key) <= max)).slice(0, 4);
}

export function makeResolver(live) {
  // Las mismas consultas se repiten mucho: una hora en memoria.
  const cache = new Map();
  const cached = (kind, q, fn) => {
    const k = `${kind}|${norm(q)}`;
    const hit = cache.get(k);
    if (hit && Date.now() - hit.at < 3600e3) return hit.value;
    const value = fn().catch(() => []);
    cache.set(k, { at: Date.now(), value });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return value;
  };
  const airports = (q) => (live ? cached('a', q, () => live.airports(q)) : Promise.resolve([]));
  const places = (q, lang) => (live?.findPlaces ? cached(`p${lang}`, q, () => live.findPlaces(q, lang)) : Promise.resolve([]));

  // Opciones de vuelo: aeropuertos de las ciudades que se llaman así, una por ciudad y país.
  async function flightOptions(text, lang) {
    const key = norm(text);
    const opts = new Map();
    const add = (o) => { const k = `${norm(o.city)}|${o.country}`; if (!opts.has(k) && ![...opts.values()].some((x) => x.value === o.value)) opts.set(k, o); };
    const mine = curated(key, true);
    for (const { c, exact, country } of mine) add({ value: c.iata, city: cityName(c, lang), country, exact, curated: true });
    for (const a of await airports(text)) {
      const n = norm(a.city);
      if (n === key || n.startsWith(key + ' ')) add({ value: a.code, city: a.city, country: countryCode(a.country) || a.country, exact: n === key });
    }
    return { list: [...opts.values()], mine };
  }

  // Opciones de hotel: ciudades con ese nombre en nuestra lista y en el buscador de lugares.
  async function hotelOptions(text, lang) {
    const key = norm(text);
    const opts = new Map();
    const add = (o) => { const k = `${norm(o.city)}|${o.country}`; if (!opts.has(k)) opts.set(k, o); };
    const mine = curated(key, false);
    for (const { c, exact, country } of mine) add({ value: cityName(c, lang), city: cityName(c, lang), country, exact, curated: true });
    for (const p of await places(text, lang)) {
      const n = norm(p.name);
      if (!p.country || !(n === key || n.startsWith(key + ' '))) continue;
      add({ value: `${p.name}, ${p.countryName || p.country}`, city: p.name, country: countryCode(p.country) || p.country, exact: n === key });
    }
    return { list: [...opts.values()], mine };
  }

  // Elige sola si puede; si no, devuelve las opciones para preguntar.
  function decide(list, mine, otherCountry, named) {
    if (list.length <= 1) return { pick: list[0] || null };
    // «Córdoba, Argentina»: el país escrito decide.
    const inNamed = named && list.filter((o) => o.country === named);
    if (inNamed?.length) return { pick: inNamed.find((o) => o.exact) || inNamed[0] };
    if (otherCountry) {
      const same = (l) => l.filter((o) => o.country === otherCountry);
      const exact = same(list.filter((o) => o.exact));
      if (exact.length === 1) return { pick: exact[0] };
      if (same(list).length === 1) return { pick: same(list)[0] };
    }
    // Un destino de nuestra lista con ese nombre exacto y ningún otro nuestro: es ese («París», no Paris de Texas).
    if (mine.length === 1 && mine[0].exact) return { pick: list.find((o) => o.curated) };
    // Se pregunta entre los nuestros si hay (no por cada pueblo con ese nombre); si no, entre los que se llaman igual.
    const ours = list.filter((o) => o.curated);
    const same = list.filter((o) => o.exact);
    const ask = ours.length > 1 ? ours : same.length > 1 ? same : list;
    return { ask: ask.slice(0, 5) };
  }

  const label = (o, lang) => `${o.city} (${countryName(/^[A-Z]{2}$/.test(o.country) ? o.country : null, lang, o.country)})`;
  const countryOf = async (value, flight) => {
    if (!value) return null;
    if (flight && IATA.test(value)) { const c = CITIES.find((x) => x.iata === value); if (c) return c.country; const [a] = await airports(value); return a ? countryCode(a.country) : null; }
    const c = curated(norm(value), false).find((x) => x.exact);
    return c?.country || null;
  };

  // País nombrado en la búsqueda («hoteles en córdoba argentina»).
  const namedCountry = (query) => {
    const words = norm(query).replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean);
    for (let n = 3; n >= 1; n--) for (let i = 0; i + n <= words.length; i++) {
      const c = CODE_BY_NAME.get(words.slice(i, i + n).join(' '));
      if (c) return c;
    }
    return null;
  };

  async function one(f, field, lang, query) {
    const flight = f.kind === 'flight';
    let text = f[field + 'Text'] || (IATA.test(f[field] || '') ? null : f[field]);
    if (!text) return null;
    // «Córdoba Argentina» → se busca «Córdoba» y el país decide.
    const named = namedCountry(query);
    if (named) {
      const words = text.split(/[\s,]+/);
      for (let i = 1; i < words.length; i++) if (CODE_BY_NAME.get(norm(words.slice(i).join(' '))) === named) { text = words.slice(0, i).join(' '); break; }
    }
    const otherField = field === 'origin' ? 'destination' : 'origin';
    const otherCountry = await countryOf(f[otherField], flight);
    const { list, mine } = flight ? await flightOptions(text, lang) : await hotelOptions(text, lang);
    if (list.length) {
      let d = decide(list, mine, otherCountry, named);
      // El país escrito no está entre las opciones (solo Córdoba de España en la lista): se busca allí.
      if (named && !list.some((o) => o.country === named) && !flight) d = { pick: { value: `${list[0].city}, ${countryName(named, lang)}` } };
      if (d.pick) { f[field] = d.pick.value; return null; }
      return { field, question: tr(lang, '¿Qué {place}?', { place: list.find((o) => norm(o.city) === norm(text))?.city || text }), options: d.ask.map((o) => ({ label: label(o, lang), value: o.value })) };
    }
    // Ninguna ciudad con ese nombre: ¿está mal escrito? Primero el buscador de lugares, luego nuestra lista.
    let options = [];
    const [p] = await places(text, lang);
    if (p?.name && norm(p.name) !== norm(text)) {
      if (!flight) options = [p.country ? { label: `${p.name} (${countryName(countryCode(p.country), lang, p.country)})`, value: `${p.name}, ${p.country}` } : { label: p.name, value: p.name }];
      else {
        const a = (await airports(p.name)).find((x) => norm(x.city) === norm(p.name));
        if (a) options = [{ label: `${a.city} (${countryName(countryCode(a.country), lang, a.country)})`, value: a.code }];
      }
    }
    if (!options.length) options = similar(norm(text), flight).map((c) => ({ label: `${cityName(c, lang)} (${countryName(c.country, lang)})`, value: flight ? c.iata : cityName(c, lang) }));
    if (!options.length) return null;
    return { field, question: tr(lang, '¿Querías decir…?'), options };
  }

  // Resuelve primero el destino y luego el origen; pregunta por el primero que haga falta.
  return async function resolve(f, lang, query = '') {
    if (!['flight', 'hotel'].includes(f.kind)) return f;
    for (const field of f.kind === 'flight' ? ['destination', 'origin'] : ['destination']) {
      const ask = await one(f, field, lang, query).catch((err) => { console.error('[ia ciudades]', err.message); return null; });
      if (ask) return { ...f, ask };
    }
    return f;
  };
}
