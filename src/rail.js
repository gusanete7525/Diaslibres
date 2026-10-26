import { cityByName, cityName } from './seo.js';
import { RAIL_TABLE as TABLE } from './rail-data.js';

// Del texto a las ciudades del catálogo (con todos sus nombres). Se ignoran las que no estén.
export const RAIL = TABLE.map(([a, b, minutes, operators]) => ({ a: cityByName(a), b: cityByName(b), minutes, operators }))
  .filter((r) => r.a && r.b && r.a !== r.b);

const key = (c) => c.es;
const BY_PAIR = new Map();
for (const r of RAIL) {
  BY_PAIR.set(`${key(r.a)}|${key(r.b)}`, r);
  BY_PAIR.set(`${key(r.b)}|${key(r.a)}`, r);
}

// Puerta a puerta: el tren sale del centro (llegar a la estación y embarcar, ~40 min en total);
// el avión suma llegar al aeropuerto, controles y embarque, y llegar luego a la ciudad (~2 h 30 min).
export const DOOR_TRAIN = 40;
export const DOOR_FLIGHT = 150;

// Trayecto directo entre dos ciudades del catálogo (objetos de CITIES), en cualquier sentido.
export function railBetween(a, b) {
  if (!a || !b) return null;
  return BY_PAIR.get(`${key(a)}|${key(b)}`) || null;
}

// Destinos con tren directo desde una ciudad, del más corto al más largo.
export function railFrom(a) {
  if (!a) return [];
  return RAIL.filter((r) => r.a === a || r.b === a).map((r) => ({ to: r.a === a ? r.b : r.a, minutes: r.minutes, operators: r.operators }))
    .sort((x, y) => x.minutes - y.minutes);
}

// Con una escala en una ciudad intermedia (p. ej. Sevilla → París por Madrid y Barcelona no; por Barcelona sí, si hay tramo).
export function railVia(a, b) {
  if (!a || !b) return null;
  let best = null;
  for (const first of railFrom(a)) {
    const second = railBetween(first.to, b);
    if (!second) continue;
    const minutes = first.minutes + 45 + second.minutes; // 45 min de transbordo
    if (!best || minutes < best.minutes) best = { via: first.to, minutes, legs: [first.minutes, second.minutes], operators: [first.operators, second.operators] };
  }
  return best;
}

// Enlace de reserva. RAILEUROPE_URL admite {from}, {to}, {date} y {adults} (para el enlace de afiliado o de búsqueda).
export function railBookUrl({ from, to, date, adults }, template = process.env.RAILEUROPE_URL) {
  const t = template || 'https://www.raileurope.com/';
  const fill = { from: from ? from.en : '', to: to ? to.en : '', date: date || '', adults: adults || 1 };
  return t.replace(/\{(from|to|date|adults)\}/g, (x, k) => encodeURIComponent(fill[k]));
}

// Opción de tren entre dos ciudades (directa o con un transbordo), en el idioma pedido.
export function railOption(from, to, lang = 'es') {
  const direct = railBetween(from, to);
  if (direct) return { direct: true, minutes: direct.minutes, doorMinutes: direct.minutes + DOOR_TRAIN, operators: direct.operators, via: null };
  const via = railVia(from, to);
  if (via && via.minutes <= 12 * 60) return { direct: false, minutes: via.minutes, doorMinutes: via.minutes + DOOR_TRAIN, operators: via.operators.join(' + '), via: cityName(via.via, lang) };
  return null;
}
