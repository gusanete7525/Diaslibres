import Anthropic from '@anthropic-ai/sdk';
import { HOTELS, AIRPORTS } from './catalog.js';
import { todayISO, addDays, isISODate } from './availability.js';

// Búsqueda en lenguaje natural ("algo de playa barato en julio para una semana").
// Con ANTHROPIC_API_KEY se usa Claude para convertir la frase en filtros; sin
// clave (o si la llamada falla) se usa un intérprete local por palabras clave.

const MODEL = process.env.DIASLIBRES_MODEL || 'claude-opus-5-5';
const TAGS = [...new Set(HOTELS.flatMap((h) => h.tags))];
const CITIES = [...new Set(HOTELS.map((h) => h.city))];

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

const FILTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'destination', 'origin', 'checkIn', 'nights', 'maxPrice', 'minStars', 'tags', 'sort', 'explanation'],
  properties: {
    kind: { type: 'string', enum: ['hotel', 'flight'] },
    destination: nullable({ type: 'string' }),
    origin: nullable({ type: 'string' }),
    checkIn: nullable({ type: 'string', description: 'YYYY-MM-DD' }),
    nights: nullable({ type: 'integer' }),
    maxPrice: nullable({ type: 'number' }),
    minStars: nullable({ type: 'integer' }),
    tags: { type: 'array', items: { type: 'string', enum: TAGS } },
    sort: { type: 'string', enum: ['price', 'stars'] },
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
- explanation: una frase breve en español explicando qué vas a buscar.`;

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  client ??= new Anthropic();
  return client;
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
    system: SYSTEM.replace('{TODAY}', todayISO()),
    messages: [{ role: 'user', content: text }],
  });
  if (response.stop_reason === 'refusal') throw new Error('La IA no ha podido procesar la búsqueda.');
  const block = response.content.find((b) => b.type === 'text');
  if (!block) throw new Error('Respuesta vacía de la IA.');
  return sanitize(JSON.parse(block.text));
}

function sanitize(f) {
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
    sort: f.sort === 'price' ? 'price' : 'stars',
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

  const parts = [];
  parts.push(kind === 'flight' ? 'vuelos' : 'hoteles');
  if (origin) parts.push(`desde ${AIRPORTS[origin] || origin}`);
  if (destination) parts.push(`${kind === 'flight' ? 'a' : 'en'} ${AIRPORTS[destination] || destination}`);
  if (tags.length) parts.push(`(${tags.join(', ')})`);
  if (nights) parts.push(`para ${nights} noche${nights > 1 ? 's' : ''}`);
  if (checkIn) parts.push(`a partir del ${checkIn}`);
  if (maxPrice) parts.push(`por menos de ${maxPrice} €`);
  if (cheap) parts.push('ordenados por precio');

  return sanitize({ kind, destination, origin, checkIn, nights, maxPrice, minStars, tags, sort: cheap ? 'price' : 'stars', explanation: `Busco ${parts.join(' ')}.` });
}
