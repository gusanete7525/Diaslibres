import Anthropic from '@anthropic-ai/sdk';
import { HOTELS, AIRPORTS } from './catalog.js';
import { todayISO, addDays, isISODate } from './availability.js';
import { FACILITIES, BOARDS } from './liteapi.js';

// Búsqueda en lenguaje natural ("algo de playa barato en julio para una semana").
// Con ANTHROPIC_API_KEY se usa Claude para convertir la frase en filtros; sin
// clave (o si la llamada falla) se usa un intérprete local por palabras clave.

const MODEL = process.env.DIASLIBRES_MODEL || 'claude-opus-5-5';
const TAGS = [...new Set(HOTELS.flatMap((h) => h.tags))];
const CITIES = [...new Set(HOTELS.map((h) => h.city))];

// Escalas de un vuelo (filtro «Escalas»).
export const STOPS = { 0: 'solo vuelos directos', 1: 'como máximo una escala', many: 'con escalas o transbordos' };

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

const FILTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'destination', 'origin', 'checkIn', 'nights', 'maxPrice', 'minStars', 'tags', 'fac', 'board', 'stops', 'sort', 'explanation'],
  properties: {
    kind: { type: 'string', enum: ['hotel', 'flight'] },
    destination: nullable({ type: 'string' }),
    origin: nullable({ type: 'string' }),
    checkIn: nullable({ type: 'string', description: 'YYYY-MM-DD' }),
    nights: nullable({ type: 'integer' }),
    maxPrice: nullable({ type: 'number' }),
    minStars: nullable({ type: 'integer' }),
    tags: { type: 'array', items: { type: 'string', enum: TAGS } },
    fac: { type: 'array', items: { type: 'string', enum: Object.keys(FACILITIES) } },
    board: nullable({ type: 'string', enum: Object.keys(BOARDS) }),
    stops: nullable({ type: 'string', enum: Object.keys(STOPS) }),
    sort: { type: 'string', enum: ['price', 'stars', 'rating'] },
    explanation: { type: 'string' },
  },
};

const SYSTEM = `Eres el buscador inteligente de DíasLibres, una agencia de reservas de hoteles y vuelos.
Convierte la petición del usuario en filtros de búsqueda. Hoy es ${'{TODAY}'}.
- kind: "flight" si pide vuelos/avión/volar; si no, "hotel".
- destination: para hoteles, la ciudad o pueblo que pida (cualquiera del mundo: la web busca hoteles reales en OpenStreetMap; ciudades con catálogo propio: ${CITIES.join(', ')}). Para vuelos, un aeropuerto de esta lista: ${Object.entries(AIRPORTS).map(([c, n]) => `${c} (${n})`).join(', ')}. Si menciona una zona o país, elige la ciudad más adecuada o déjalo en null si encajan varias.
- origin: solo para vuelos (código IATA), si lo dice.
- checkIn: solo si da una fecha o mes concreto (para un mes sin día, usa el primer día futuro de ese mes). Si no, null: la web enseña un calendario de disponibilidad y el usuario no está obligado a elegir fechas.
- nights: duración de la estancia (fin de semana = 2, una semana = 7).
- maxPrice: precio máximo por noche (hotel) o por billete (vuelo) en euros, si lo indica o si dice "barato" pon un valor razonable o deja null y usa sort "price".
- tags: solo etiquetas de la lista que encajen con lo pedido.
- fac: servicios del hotel que pida expresamente (${Object.entries(FACILITIES).map(([k, f]) => `${k} = ${f.label}`).join(', ')}).
- board: régimen de comidas si lo pide (${Object.entries(BOARDS).map(([k, v]) => `${k} = ${v}`).join(', ')}); si no, null.
- stops: solo para vuelos: "0" si pide vuelos directos o sin escalas, "1" si acepta como máximo una escala, "many" si pide vuelos con escalas o transbordos (uno o varios); si no lo dice, null.
- sort: "price" si busca barato, "rating" si pide los mejor valorados; si no, "stars".
- explanation: una frase breve en español explicando qué vas a buscar.`;

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  client ??= new Anthropic();
  return client;
}

// Instrucciones del buscador (también las usa la vista previa del navegador).
export function searchInstructions() {
  return SYSTEM.replace('{TODAY}', todayISO());
}

export async function aiSearch(query) {
  const text = String(query || '').slice(0, 500).trim();
  if (!text) throw new Error('Escribe qué buscas.');
  const c = getClient();
  if (c) {
    try {
      return { ...(await claudeParse(c, text)), source: 'claude' };
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) console.error('[ia] Clave de API no válida; uso el intérprete local.');
      else if (err instanceof Anthropic.RateLimitError) console.error('[ia] Límite de peticiones alcanzado; uso el intérprete local.');
      else if (err instanceof Anthropic.APIError) console.error(`[ia] Error de la API (${err.status}): ${err.message}`);
      else console.error('[ia]', err.message);
    }
  }
  return { ...localParse(text), source: 'local' };
}

async function claudeParse(c, text) {
  const response = await c.beta.messages.create({
    model: MODEL,
    max_tokens: 2048,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: FILTER_SCHEMA } },
    system: searchInstructions(),
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
    kind: f.kind === 'flight' ? 'flight' : 'hotel',
    destination: f.destination || null,
    origin: f.origin || null,
    checkIn: isISODate(f.checkIn) && f.checkIn >= today && f.checkIn <= addDays(today, 170) ? f.checkIn : null,
    nights: f.nights ? Math.max(1, Math.min(30, Math.round(f.nights))) : null,
    maxPrice: f.maxPrice > 0 ? Math.round(f.maxPrice) : null,
    minStars: f.minStars >= 1 && f.minStars <= 5 ? f.minStars : null,
    tags: Array.isArray(f.tags) ? f.tags.filter((t) => TAGS.includes(t)) : [],
    fac: Array.isArray(f.fac) ? [...new Set(f.fac.filter((k) => k in FACILITIES))] : [],
    board: f.board in BOARDS ? f.board : null,
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
  'miercoles', 'jueves', 'viernes', 'sabado', 'domingo', 'manana', 'hoy', 'pasado', 'proximo', 'proxima', 'cuanto', 'cuantos', 'unos', 'unas', 'poco', 'mucho']);
const REGION = { canarias: 'Tenerife', andalucia: 'Sevilla', galicia: 'Vigo', portugal: 'Lisboa', francia: 'París', italia: 'Roma', cataluna: 'Barcelona', baleares: 'Ibiza' };

export function localParse(text) {
  const t = norm(text);
  const kind = /\b(vuelo|vuelos|volar|avion|billete)/.test(t) ? 'flight' : 'hotel';
  const findCity = (s) => {
    for (const [code, name] of Object.entries(AIRPORTS)) if (s.includes(norm(name))) return kind === 'flight' ? code : name;
    for (const [region, city] of Object.entries(REGION)) if (s.includes(region)) return city;
    return null;
  };

  let origin = null;
  let destination = null;
  const route = t.match(/(?:desde|de)\s+([a-z ]+?)\s+(?:a|hacia|hasta)\s+([a-z ]+)/);
  if (kind === 'flight' && route) {
    origin = findCity(route[1]);
    destination = findCity(route[2]);
  }
  destination ??= findCity(t);
  // Cualquier otra ciudad escrita con mayúscula tras "en"/"a" (hoteles vía OpenStreetMap).
  if (!destination && kind === 'hotel') {
    const m = text.match(/\b(?:en|a|de)\s+((?:[A-ZÁÉÍÓÚÑ][\wáéíóúñüç'-]+)(?:\s+(?:de\s+|del\s+|la\s+)?[A-ZÁÉÍÓÚÑ][\wáéíóúñüç'-]+)*)/u);
    if (m && !MONTHS.includes(norm(m[1]))) destination = m[1];
  }
  // También en minúsculas («algo en gandía»), si la palabra no es un mes, una época u otra cosa conocida.
  if (!destination && kind === 'hotel') {
    for (const m of text.matchAll(/\b(?:en|a)\s+([a-záéíóúñüç][\wáéíóúñüç'-]+(?:\s+(?:de|del|la)\s+[a-záéíóúñüç][\wáéíóúñüç'-]+)?)/giu)) {
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
  if (mi >= 0) {
    const y = Number(today.slice(0, 4));
    let candidate = `${y}-${String(mi + 1).padStart(2, '0')}-01`;
    if (candidate.slice(0, 7) < today.slice(0, 7)) candidate = `${y + 1}-${String(mi + 1).padStart(2, '0')}-01`;
    checkIn = candidate < today ? today : candidate;
  }

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
  const best = /mejor valorad|mejor puntua|mejores opiniones/.test(t);
  const stops = kind !== 'flight' ? null
    : /\b(directo|directos|sin escala|sin transbordo)/.test(t) ? '0'
    : /\b(una|1|un|maximo una|max\.? 1) (escala|transbordo|conexion)\b/.test(t) ? '1'
    : /escala|transbordo|conexion/.test(t) ? 'many' : null;
  for (const k of fac) if (tags.includes(k)) tags.splice(tags.indexOf(k), 1);

  const parts = [];
  parts.push(kind === 'flight' ? 'vuelos' : 'hoteles');
  if (origin) parts.push(`desde ${AIRPORTS[origin] || origin}`);
  if (destination) parts.push(`${kind === 'flight' ? 'a' : 'en'} ${AIRPORTS[destination] || destination}`);
  if (tags.length) parts.push(`(${tags.join(', ')})`);
  if (nights) parts.push(`para ${nights} noche${nights > 1 ? 's' : ''}`);
  if (checkIn) parts.push(`a partir del ${checkIn}`);
  if (maxPrice) parts.push(`por menos de ${maxPrice} €`);
  if (fac.length) parts.push(`(${fac.map((k) => FACILITIES[k].label.toLowerCase()).join(', ')})`);
  if (board) parts.push(`en ${BOARDS[board].toLowerCase()}`);
  if (stops) parts.push(`(${STOPS[stops]})`);
  if (cheap) parts.push('ordenados por precio');
  else if (best) parts.push('ordenados por puntuación');

  return sanitize({ kind, destination, origin, checkIn, nights, maxPrice, minStars, tags, fac, board, stops, sort: cheap ? 'price' : best ? 'rating' : 'stars', explanation: `Busco ${parts.join(' ')}.` });
}
