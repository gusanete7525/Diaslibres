import Anthropic from '@anthropic-ai/sdk';
import { HOTELS, AIRPORTS } from './catalog.js';
import { todayISO, addDays, isISODate } from './availability.js';
import { FACILITIES, BOARDS } from './liteapi.js';
import { findPlaceIn, cityName, placeName } from './seo.js';
import { LANGS, tr } from './i18n.js';
import { toSpanish } from './ai-langs.js';
import { railOption } from './rail.js';

// Búsqueda en lenguaje natural ("algo de playa barato en julio para una semana").
// Con ANTHROPIC_API_KEY se usa Claude para convertir la frase en filtros; sin
// clave (o si la llamada falla) se usa un intérprete local por palabras clave.

const MODEL = process.env.DIASLIBRES_MODEL || 'claude-opus-5-5';
const TAGS = [...new Set(HOTELS.flatMap((h) => h.tags))];
const CITIES = [...new Set(HOTELS.map((h) => h.city))];

// Escalas de un vuelo (filtro «Escalas»).
// Tipo de alojamiento: la palabra con la que se busca («Busco apartamentos en…»).
export const STAYS = { hotel: 'hoteles', apartment: 'apartamentos', house: 'casas y villas', hostel: 'hostales y pensiones' };
export const STOPS = { 0: 'solo vuelos directos', 1: 'como máximo una escala', many: 'con escalas o transbordos' };

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

const FILTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'destination', 'origin', 'checkIn', 'nights', 'maxPrice', 'minStars', 'adults', 'tags', 'fac', 'board', 'stay', 'stops', 'sort', 'explanation'],
  properties: {
    kind: { type: 'string', enum: ['hotel', 'flight', 'train'] },
    destination: nullable({ type: 'string' }),
    origin: nullable({ type: 'string' }),
    checkIn: nullable({ type: 'string', description: 'YYYY-MM-DD' }),
    nights: nullable({ type: 'integer' }),
    maxPrice: nullable({ type: 'number' }),
    minStars: nullable({ type: 'integer' }),
    adults: nullable({ type: 'integer' }),
    tags: { type: 'array', items: { type: 'string', enum: TAGS } },
    fac: { type: 'array', items: { type: 'string', enum: Object.keys(FACILITIES) } },
    board: nullable({ type: 'string', enum: Object.keys(BOARDS) }),
    stay: nullable({ type: 'string', enum: Object.keys(STAYS) }),
    stops: nullable({ type: 'string', enum: Object.keys(STOPS) }),
    sort: { type: 'string', enum: ['price', 'stars', 'rating'] },
    explanation: { type: 'string' },
  },
};

const SYSTEM = `Eres el buscador inteligente de DíasLibres, una agencia de reservas de hoteles y vuelos.
Convierte la petición del usuario en filtros de búsqueda. Hoy es ${'{TODAY}'}.
- kind: "flight" si pide vuelos/avión/volar; "train" si pide tren (AVE, Eurostar, TGV, Ouigo, Iryo…) o pregunta cómo ir o viajar de una ciudad europea a otra sin decir avión (la web compara tren y avión puerta a puerta); si no, "hotel".
- Para trenes, origin y destination son nombres de ciudad (p. ej. "Madrid", "París").
- destination: para hoteles, la ciudad o pueblo que pida (cualquiera del mundo: la web busca hoteles reales en OpenStreetMap; ciudades con catálogo propio: ${CITIES.join(', ')}). Para vuelos, un aeropuerto de esta lista: ${Object.entries(AIRPORTS).map(([c, n]) => `${c} (${n})`).join(', ')}; si la ciudad no está en la lista, su código IATA o su nombre (p. ej. "Chiclayo"): la web busca vuelos a cualquier aeropuerto del mundo. Si menciona una zona o país, elige la ciudad más adecuada o déjalo en null si encajan varias.
- origin: solo para vuelos (código IATA o nombre de la ciudad) o trenes (ciudad), si lo dice.
- checkIn: solo si da una fecha o mes concreto (para un mes sin día, usa el primer día futuro de ese mes). Si no, null: la web enseña un calendario de disponibilidad y el usuario no está obligado a elegir fechas.
- nights: duración de la estancia (fin de semana = 2, una semana = 7).
- maxPrice: precio máximo por noche (hotel) o por billete (vuelo) en euros, si lo indica o si dice "barato" pon un valor razonable o deja null y usa sort "price".
- adults: número de personas si lo dice («para 2», «somos 4»); si no, null.
- Si da un día concreto o un intervalo («del 10 al 12»), checkIn es el primer día (si no dice mes, el próximo día con ese número) y nights las noches entre las dos fechas, salvo que diga cuántas noches.
- tags: solo etiquetas de la lista que encajen con lo pedido.
- fac: servicios del hotel que pida expresamente (${Object.entries(FACILITIES).map(([k, f]) => `${k} = ${f.label}`).join(', ')}).
- board: régimen de comidas si lo pide (${Object.entries(BOARDS).map(([k, v]) => `${k} = ${v}`).join(', ')}); si no, null.
- stay: tipo de alojamiento, solo si lo pide: "apartment" (apartamento, piso, estudio, alquiler vacacional), "house" (casa rural, villa, chalet, casa de vacaciones), "hostel" (hostal, albergue, pensión), "hotel" si dice que quiere un hotel y no un apartamento; si no, null.
- stops: solo para vuelos: "0" si pide vuelos directos o sin escalas, "1" si acepta como máximo una escala, "many" si pide vuelos con escalas o transbordos (uno o varios); si no lo dice, null.
- sort: "price" si busca barato, "rating" si pide los mejor valorados; si no, "stars".
- explanation: una frase breve en {LANGUAGE} explicando qué vas a buscar.`;

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  client ??= new Anthropic();
  return client;
}

// Instrucciones del buscador (también las usa la vista previa del navegador).
export function searchInstructions(lang = 'es') {
  return SYSTEM.replace('{TODAY}', todayISO()).replace('{LANGUAGE}', lang === 'es' ? 'español' : LANGS[lang]?.name || 'español');
}

// lang: idioma de la página (la búsqueda se puede escribir en ese idioma).
export async function aiSearch(query, lang = 'es') {
  if (!LANGS[lang]) lang = 'es';
  const text = String(query || '').slice(0, 500).trim();
  if (!text) throw new Error('Escribe qué buscas.');
  const c = getClient();
  if (c) {
    try {
      return { ...(await claudeParse(c, text, lang)), source: 'claude' };
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) console.error('[ia] Clave de API no válida; uso el intérprete local.');
      else if (err instanceof Anthropic.RateLimitError) console.error('[ia] Límite de peticiones alcanzado; uso el intérprete local.');
      else if (err instanceof Anthropic.APIError) console.error(`[ia] Error de la API (${err.status}): ${err.message}`);
      else console.error('[ia]', err.message);
    }
  }
  return { ...localParse(text, lang), source: 'local' };
}

async function claudeParse(c, text, lang) {
  const response = await c.beta.messages.create({
    model: MODEL,
    max_tokens: 2048,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: FILTER_SCHEMA } },
    system: searchInstructions(lang),
    messages: [{ role: 'user', content: text }],
  });
  if (response.stop_reason === 'refusal') throw new Error('La IA no ha podido procesar la búsqueda.');
  const block = response.content.find((b) => b.type === 'text');
  if (!block) throw new Error('Respuesta vacía de la IA.');
  return sanitize(JSON.parse(block.text));
}

export function sanitize(f) {
  const today = todayISO();
  return {
    kind: ['flight', 'train'].includes(f.kind) ? f.kind : 'hotel',
    destination: f.destination || null,
    origin: f.origin || null,
    checkIn: isISODate(f.checkIn) && f.checkIn >= today && f.checkIn <= addDays(today, 330) ? f.checkIn : null,
    nights: f.nights ? Math.max(1, Math.min(30, Math.round(f.nights))) : null,
    maxPrice: f.maxPrice > 0 ? Math.round(f.maxPrice) : null,
    minStars: f.minStars >= 1 && f.minStars <= 5 ? f.minStars : null,
    adults: f.adults >= 1 && f.adults <= 6 ? Math.round(f.adults) : null,
    tags: Array.isArray(f.tags) ? f.tags.filter((t) => TAGS.includes(t)) : [],
    fac: Array.isArray(f.fac) ? [...new Set(f.fac.filter((k) => k in FACILITIES))] : [],
    board: f.board in BOARDS ? f.board : null,
    stay: (f.kind || 'hotel') === 'hotel' && f.stay in STAYS ? f.stay : null,
    stops: f.kind === 'flight' && f.stops in STOPS ? f.stops : null,
    sort: ['price', 'rating'].includes(f.sort) ? f.sort : 'stars',
    explanation: String(f.explanation || '').slice(0, 300),
  };
}

// ---------- Intérprete local (sin IA externa) ----------

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const NUMBERS = { una: 1, un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15 };
const TAG_WORDS = {
  playa: ['playa', 'mar', 'costa', 'sol y playa', 'calas'],
  montaña: ['montana', 'sierra', 'pirineo', 'nieve'],
  esquí: ['esqui', 'esquiar'],
  naturaleza: ['naturaleza', 'rural', 'senderismo'],
  ciudad: ['ciudad', 'urbano', 'escapada urbana'],
  romántico: ['romantic', 'pareja', 'luna de miel', 'aniversario'],
  familias: ['familia', 'ninos', 'hijos', 'crios'],
  lujo: ['lujo', 'lujoso', '5 estrellas', 'cinco estrellas'],
  económico: ['barato', 'economico', 'low cost', 'ajustado'],
  piscina: ['piscina'],
  spa: ['spa', 'relax', 'masaje'],
  cultura: ['cultura', 'museo', 'historia', 'monumento'],
  gastronomía: ['gastronom', 'comer', 'comida', 'marisco', 'tapas'],
  fiesta: ['fiesta', 'discoteca', 'marcha'],
  'todo incluido': ['todo incluido'],
};
// Palabras que pueden ir tras «en»/«a» y no son un sitio.
const STOP = new Set(['la', 'el', 'los', 'las', 'lo', 'mi', 'tu', 'su', 'este', 'esta', 'ese', 'esa', 'otro', 'otra', 'algun', 'alguna', 'cualquier', 'cualquiera', 'todo', 'toda', 'pleno', 'plena',
  'semana', 'semanas', 'finde', 'fin', 'verano', 'invierno', 'primavera', 'otono', 'navidad', 'navidades', 'pascua', 'puente', 'principios', 'mediados', 'finales', 'hotel', 'hoteles',
  'casa', 'apartamento', 'pareja', 'familia', 'solas', 'solo', 'sola', 'buen', 'buena', 'precio', 'oferta', 'ver', 'dormir', 'descansar', 'pasar', 'menos', 'partir', 'poder', 'ser',
  'mitad', 'centro', 'zona', 'sitio', 'lugar', 'algo', 'donde', 'nuestro', 'nuestra', 'vacaciones', 'hora', 'dia', 'dias', 'noche', 'noches', 'mes', 'ano', 'lunes', 'martes',
  'miercoles', 'jueves', 'viernes', 'sabado', 'domingo', 'manana', 'hoy', 'pasado', 'proximo', 'proxima', 'cuanto', 'cuantos', 'unos', 'unas', 'poco', 'mucho', 'por', 'para', 'the']);
// Palabras que cierran el nombre de una ciudad en «de X a Y …».
const ROUTE_END = new Set(['en', 'con', 'y', 'ida', 'vuelta', 'directo', 'directos', 'sin', 'escala', 'escalas', 'barato', 'baratos', 'economico', 'economicos', 'el', 'a', 'desde', 'hasta', 'hacia']);
const REGION = { canarias: 'Tenerife', andalucia: 'Sevilla', galicia: 'Vigo', portugal: 'Lisboa', francia: 'París', italia: 'Roma', cataluna: 'Barcelona', baleares: 'Ibiza' };

// La palabra entera («roma», no «romántica»).
const hasWord = (s, w) => ` ${s.replace(/[^a-z0-9]+/g, ' ')} `.includes(` ${w.replace(/[^a-z0-9]+/g, ' ').trim()} `);

export function localParse(text, lang = 'es') {
  if (lang !== 'es') text = toSpanish(text, lang);
  const t = norm(text);
  // «de X a Y» o «a Y desde X».
  const fwd = t.match(/(?:desde|de)\s+([a-z ]+?)\s+(?:a|hacia|hasta)\s+([a-z ]+)/);
  const back = !fwd && t.match(/(?:^|\s)(?:a|hacia|hasta)\s+([a-z ]+?)\s+desde\s+([a-z ]+)/);
  const route = fwd || (back && [back[0], back[2], back[1]]);
  const flightWords = /\b(vuelo|vuelos|volar|avion|billete)/.test(t);
  let kind = /\b(trenes|tren|ave|alvia|avant|eurostar|ferrocarril|ouigo|iryo|tgv|frecciarossa|italo|ice|railjet)\b/.test(t) ? 'train' : flightWords ? 'flight' : 'hotel';
  // «Cómo ir de Madrid a Sevilla»: si hay buen tren, se comparan tren y avión.
  if (kind === 'hotel' && route && /\b(como ir|como llegar|como viajar|ir|viajar|viaje|trayecto|itinerario|moverme)\b/.test(t)) {
    const [a, b] = [findPlaceIn(route[1]), findPlaceIn(route[2])];
    if (a && b && a !== b) kind = railOption(a, b) ? 'train' : a.iata && b.iata ? 'flight' : kind;
  }
  const findCity = (s) => {
    // Hoteles: primero el destino tal como se escribe («Tenerife», no el de su aeropuerto).
    const named = kind !== 'flight' && findPlaceIn(s);
    if (named) return cityName(named, lang);
    for (const [code, name] of Object.entries(AIRPORTS)) if (hasWord(s, norm(name))) return kind === 'flight' ? code : name;
    for (const [region, city] of Object.entries(REGION)) if (hasWord(s, region)) return city;
    // Cualquier destino conocido, escrito en cualquier idioma.
    const place = findPlaceIn(s);
    if (place) return kind === 'flight' ? place.iata || null : cityName(place, lang);
    return null;
  };

  // Ciudad que no está en nuestras listas («de Lima a Chiclayo»): va tal cual y el servidor busca su aeropuerto.
  const rawPlace = (s) => {
    const words = [];
    for (const w of s.trim().split(/\s+/)) {
      const joins = ['la', 'las', 'los'].includes(w) && ['de', 'del'].includes(words.at(-1)); // «Santa Cruz de la Sierra»
      if ((STOP.has(w) && !joins) || ROUTE_END.has(w) || MONTHS.includes(w) || w in NUMBERS || /^\d/.test(w) || words.length === 6) break;
      words.push(w);
    }
    while (['de', 'del', 'la', 'las', 'los'].includes(words.at(-1))) words.pop();
    return words.length ? words.join(' ').replace(/(^|\s)(\p{L})/gu, (x, sp, c) => sp + c.toUpperCase()).replace(/ (De|Del|La|Las|Los)(?= )/g, (x) => x.toLowerCase()) : null;
  };

  let origin = null;
  let destination = null;
  if (kind !== 'hotel' && route) {
    origin = findCity(route[1]) ?? rawPlace(route[1]);
    destination = findCity(route[2]) ?? rawPlace(route[2]);
  } else if (kind === 'flight') {
    // Una sola ciudad: «vuelos a Chiclayo», «vuelo desde Chiclayo».
    const to = t.match(/(?:^|\s)(?:a|hacia|hasta)\s+([a-z ]+)/);
    const from = t.match(/(?:^|\s)desde\s+([a-z ]+)/);
    if (to) destination = findCity(to[1]) ?? rawPlace(to[1]);
    if (from) origin = findCity(from[1]) ?? rawPlace(from[1]);
  }
  if (!origin) destination ??= findCity(t);
  // Cualquier otra ciudad escrita con mayúscula tras "en"/"a" (hoteles vía OpenStreetMap).
  if (!destination && kind === 'hotel') {
    const m = text.match(/(?<!\p{L})(?:en|a|de)\s+((?:[A-ZÁÉÍÓÚÑ][\wáéíóúñüç'-]+)(?:\s+(?:de\s+|del\s+|la\s+)?[A-ZÁÉÍÓÚÑ][\wáéíóúñüç'-]+)*)/u);
    if (m && !MONTHS.includes(norm(m[1]))) destination = m[1];
  }
  // También en minúsculas («algo en gandía»), si la palabra no es un mes, una época u otra cosa conocida.
  if (!destination && kind === 'hotel') {
    for (const m of text.matchAll(/(?<!\p{L})(?:en|a)\s+([a-záéíóúñüç][\wáéíóúñüç'-]+(?:\s+(?:de|del|la)\s+[a-záéíóúñüç][\wáéíóúñüç'-]+)?)/giu)) {
      const first = norm(m[1].split(/\s+/)[0]);
      const tagWord = Object.values(TAG_WORDS).flat().some((w) => first.startsWith(w));
      if (MONTHS.includes(first) || STOP.has(first) || first in NUMBERS || tagWord || /^\d/.test(first)) continue;
      destination = m[1].replace(/(^|\s)(\p{L})/gu, (x, sp, c) => sp + c.toUpperCase()).replace(/ (De|Del|La) /g, (x) => x.toLowerCase());
      break;
    }
  }

  let nights = null;
  const n = t.match(/(\d+|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince)\s+(noche|dia|semana)/);
  if (n) {
    const v = Number(n[1]) || NUMBERS[n[1]];
    nights = n[2] === 'semana' ? v * 7 : n[2] === 'dia' ? Math.max(1, v - 1) : v;
  } else if (/fin de semana|finde/.test(t)) nights = 2;
  else if (/semana/.test(t)) nights = 7;

  let checkIn = null;
  const today = todayISO();
  const mi = MONTHS.findIndex((m) => t.includes(m));
  // Día concreto: «del 10 al 12», «el 10 de diciembre», «desde el 3 hasta el 8 de mayo».
  const range = t.match(/\b(?:del|desde el|el|dia)\s+(\d{1,2})(?:\s+de\s+[a-z]+)?\s+(?:al|hasta el|-)\s+(\d{1,2})\b/);
  const single = !range && t.match(/\b(?:el|dia|del)\s+(\d{1,2})(?:\s+de\s+([a-z]+))?\b(?!\s*(?:noche|dia|semana|persona|adulto|euro|€|%))/);
  const day = Number((range || single)?.[1]) || null;
  const dateOf = (d, month) => {
    // Sin mes: el próximo día con ese número (este mes o el siguiente).
    let [y, m] = [Number(today.slice(0, 4)), month >= 0 ? month + 1 : Number(today.slice(5, 7))];
    const iso = () => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (iso() < today) { if (month >= 0) y++; else if (++m > 12) { m = 1; y++; } }
    return isISODate(iso()) ? iso() : null;
  };
  if (day >= 1 && day <= 31) {
    checkIn = dateOf(day, single?.[2] && MONTHS.includes(single[2]) ? MONTHS.indexOf(single[2]) : mi);
    const until = Number(range?.[2]);
    if (checkIn && until && !nights) {
      const d = new Date(checkIn + 'T00:00:00Z');
      const out = until > day ? until - day : until + new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() - day;
      nights = out >= 1 && out <= 30 ? out : null;
    }
  } else if (mi >= 0) {
    const y = Number(today.slice(0, 4));
    let candidate = `${y}-${String(mi + 1).padStart(2, '0')}-01`;
    if (candidate.slice(0, 7) < today.slice(0, 7)) candidate = `${y + 1}-${String(mi + 1).padStart(2, '0')}-01`;
    checkIn = candidate < today ? today : candidate;
  }
  // Personas: «para 2», «somos 4», «3 adultos».
  const people = t.match(/\b(?:para|somos)\s+(\d|dos|tres|cuatro|cinco|seis)\b(?!\s*(?:noche|dia|semana|euro|€))/) || t.match(/\b(\d|dos|tres|cuatro|cinco|seis)\s+(?:personas|adultos)\b/);
  const adults = people ? Number(people[1]) || NUMBERS[people[1]] : null;

  let maxPrice = null;
  const p = t.match(/(?:menos de|maximo|max|hasta|por debajo de|no mas de)\s*(\d+)/) || t.match(/(\d+)\s*(?:€|euros|eur)/);
  if (p) maxPrice = Number(p[1]);

  let minStars = null;
  const s = t.match(/(\d)\s*estrellas/);
  if (s) minStars = Number(s[1]);

  const tags = Object.entries(TAG_WORDS)
    .filter(([, words]) => words.some((w) => t.includes(w)))
    .map(([tag]) => tag)
    .filter((tag) => TAGS.includes(tag));
  const cheap = /barat|economic|low cost|ofert/.test(t);
  if (cheap) {
    const i = tags.indexOf('económico');
    if (i >= 0 && (tags.length > 1 || destination)) tags.splice(i, 1); // "barato" ordena por precio, no excluye
  }

  const FAC_WORDS = {
    mascotas: ['mascota', 'perro', 'gato', 'pet friendly'], aire: ['aire acondicionado', 'climatiza'],
    calefaccion: ['calefaccion'], piscina: ['piscina'], parking: ['parking', 'aparcamiento', 'garaje'],
    wifi: ['wifi'], spa: ['spa', 'jacuzzi', 'sauna'], gimnasio: ['gimnasio', 'gym'], restaurante: ['restaurante'],
    playa: ['primera linea', 'en la playa', 'frente al mar'], ninos: ['ninos', 'familia', 'hijos'],
    adultos: ['solo adultos'], accesible: ['silla de ruedas', 'accesible', 'movilidad reducida'], traslado: ['traslado', 'transfer'],
  };
  const fac = kind === 'hotel' ? Object.keys(FAC_WORDS).filter((k) => FAC_WORDS[k].some((w) => t.includes(w))) : [];
  const board = kind !== 'hotel' ? null
    : /todo incluido/.test(t) ? 'AI'
    : /pension completa/.test(t) ? 'FB'
    : /media pension/.test(t) ? 'HB'
    : /desayuno/.test(t) ? 'BI' : null;
  const stay = kind !== 'hotel' ? null
    : /\b(apartamentos?|apartotel|aparthotel|pisos?|estudios?|alquiler vacacional|alquileres vacacionales)\b/.test(t) ? 'apartment'
    : /\b(casas? rural(es)?|villas?|chalets?|casas? de vacaciones|cabanas?|cortijos?|masias?)\b/.test(t) ? 'house'
    : /\b(hostal(es)?|albergues?|hostels?)\b|(?<!media )\bpension(es)?\b(?! completa)/.test(t) ? 'hostel' : null;
  const best = /mejor valorad|mejor puntua|mejores opiniones/.test(t);
  const stops = kind !== 'flight' ? null
    : /\b(directo|directos|sin escala|sin transbordo)/.test(t) ? '0'
    : /\b(una|1|un|maximo una|max\.? 1) (escala|transbordo|conexion)\b/.test(t) ? '1'
    : /escala|transbordo|conexion/.test(t) ? 'many' : null;
  for (const k of fac) if (tags.includes(k)) tags.splice(tags.indexOf(k), 1);

  // Explicación en el idioma de la página.
  const x = (k, v) => tr(lang, k, v);
  const low = (w) => (lang === 'de' ? w : w.toLowerCase());
  const where = (code) => (kind === 'flight' ? placeName(code, lang, AIRPORTS[code] || code) : code);
  const parts = [x(kind === 'flight' ? 'vuelos' : kind === 'train' ? 'trenes y vuelos' : STAYS[stay] || 'hoteles')];
  if (origin) parts.push(x('desde {place}', { place: where(origin) }));
  if (destination) parts.push(x(kind !== 'hotel' ? 'a {place}' : 'en {place}', { place: where(destination) }));
  if (tags.length) parts.push(`(${tags.map((g) => x(g)).join(', ')})`);
  if (nights) parts.push(x(nights > 1 ? 'para {n} noches' : 'para {n} noche', { n: nights }));
  if (adults) parts.push(x(adults > 1 ? 'para {n} personas' : 'para {n} persona', { n: adults }));
  if (checkIn) parts.push(x('a partir del {date}', { date: new Date(checkIn + 'T00:00:00Z').toLocaleDateString(LANGS[lang]?.locale || 'es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' }) }));
  if (maxPrice) parts.push(x('por menos de {price} €', { price: maxPrice }));
  if (fac.length) parts.push(`(${fac.map((k) => low(x(FACILITIES[k].label))).join(', ')})`);
  if (board) parts.push(x('en {board}', { board: low(x(BOARDS[board])) }));
  if (stops) parts.push(`(${x(STOPS[stops])})`);
  if (cheap) parts.push(x('ordenados por precio'));
  else if (best) parts.push(x('ordenados por puntuación'));

  return sanitize({ kind, destination, origin, checkIn, nights, maxPrice, minStars, tags, fac, adults, board, stay, stops, sort: cheap ? 'price' : best ? 'rating' : 'stars', explanation: x('Busco {what}.', { what: parts.join(' ') }) });
}
