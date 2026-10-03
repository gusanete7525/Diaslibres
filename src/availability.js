import { HOTELS, FLIGHTS, AIRPORTS, seeded, demand } from './catalog.js';

export const MAX_DAYS = 180;

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isISODate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

// Cuántas unidades (habitaciones o plazas) ya están ocupadas por la "demanda
// simulada" de otros clientes ese día.
function simulatedTaken(id, iso, capacity) {
  const dm = demand(id, iso);
  const p = Math.min(1, Math.max(0, 0.45 + (dm - 0.8) * 1.0 + (seeded(id, iso, 'o') - 0.5) * 0.7));
  return Math.min(capacity, Math.floor(capacity * p + seeded(id, iso, 'x') * 1.6));
}

function bookedUnits(bookings, type, itemId, iso) {
  let n = 0;
  for (const b of bookings) {
    if (b.status !== 'confirmada' || b.type !== type || b.itemId !== itemId) continue;
    if (type === 'hotel' ? iso >= b.checkIn && iso < b.checkOut : iso === b.date) n += b.units;
  }
  return n;
}

function dayInfo(item, type, iso, bookings) {
  const capacity = type === 'hotel' ? item.rooms : item.seats;
  const taken = Math.min(capacity, simulatedTaken(item.id, iso, capacity) + bookedUnits(bookings, type, item.id, iso));
  const left = capacity - taken;
  const occ = taken / capacity;
  // Cuanto más lleno y más demanda, más caro.
  const price = Math.round(item.basePrice * demand(item.id, iso) * (1 + 0.35 * occ));
  return { date: iso, price, left, available: left > 0 };
}

export function calendarFor(item, type, bookings, start, days) {
  const out = [];
  for (let i = 0; i < days; i++) out.push(dayInfo(item, type, addDays(start, i), bookings));
  return out;
}

// Ventana de `nights` noches seguidas libres con el menor coste total.
export function cheapestStay(calendar, nights) {
  let best = null;
  for (let i = 0; i + nights <= calendar.length; i++) {
    const slice = calendar.slice(i, i + nights);
    if (!slice.every((d) => d.available)) continue;
    const total = slice.reduce((s, d) => s + d.price, 0);
    if (!best || total < best.total) best = { checkIn: slice[0].date, checkOut: addDays(slice[0].date, nights), total };
  }
  return best;
}

function summarize(calendar) {
  const free = calendar.filter((d) => d.available);
  const prices = free.map((d) => d.price);
  return {
    freeDays: free.length,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    avgPrice: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
  };
}

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

// `extra`: hoteles adicionales ya acotados al destino (p. ej. de OpenStreetMap).
export function searchHotels(bookings, f = {}, extra = []) {
  const start = f.start && f.start >= todayISO() ? f.start : todayISO();
  const days = Math.min(MAX_DAYS, Math.max(7, Number(f.days) || 60));
  const nights = Math.max(1, Math.min(30, Number(f.nights) || 3));
  const q = norm(f.destination);
  const tags = (f.tags || []).map(norm).filter(Boolean);

  const curated = new Set(HOTELS.map((h) => norm(h.name)));
  const pool = [...HOTELS, ...extra.filter((h) => !curated.has(norm(h.name)))];
  let list = pool.filter((h) => {
    if (q && !h.origin && !norm(`${h.city} ${h.country} ${h.name}`).includes(q)) return false;
    if (f.minStars && h.stars < Number(f.minStars)) return false;
    if (tags.length && !tags.some((t) => h.tags.map(norm).includes(t))) return false;
    return true;
  }).map((h) => {
    const calendar = calendarFor(h, 'hotel', bookings, start, days);
    return { ...h, calendar, summary: summarize(calendar), bestStay: cheapestStay(calendar, nights) };
  });

  if (f.maxPrice) list = list.filter((h) => h.summary.minPrice !== null && h.summary.minPrice <= Number(f.maxPrice));
  // Si se pide una fecha concreta, se ordenan primero los hoteles libres esas noches.
  if (isISODate(f.checkIn)) {
    const ci = daysBetween(start, f.checkIn);
    const freeThen = (h) => h.calendar.slice(ci, ci + nights).length === nights && h.calendar.slice(ci, ci + nights).every((d) => d.available);
    list.sort((a, b) => Number(freeThen(b)) - Number(freeThen(a)));
  } else if (f.sort === 'price') {
    list.sort((a, b) => (a.summary.minPrice ?? 1e9) - (b.summary.minPrice ?? 1e9));
  } else {
    list.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0) || a.name.localeCompare(b.name, 'es'));
  }
  return { start, days, nights, results: list };
}

export function searchFlights(bookings, f = {}) {
  const start = f.start && f.start >= todayISO() ? f.start : todayISO();
  const days = Math.min(MAX_DAYS, Math.max(7, Number(f.days) || 60));
  const matchAirport = (code, q) => !q || norm(code) === norm(q) || norm(AIRPORTS[code]).includes(norm(q));
  let list = FLIGHTS.filter((fl) => matchAirport(fl.origin, f.origin) && matchAirport(fl.destination, f.destination)).map((fl) => {
    const calendar = calendarFor(fl, 'flight', bookings, start, days);
    return { ...fl, originCity: AIRPORTS[fl.origin], destinationCity: AIRPORTS[fl.destination], calendar, summary: summarize(calendar) };
  });
  if (f.maxPrice) list = list.filter((x) => x.summary.minPrice !== null && x.summary.minPrice <= Number(f.maxPrice));
  list.sort((a, b) => (a.summary.minPrice ?? 1e9) - (b.summary.minPrice ?? 1e9));
  return { start, days, results: list };
}

// Valida y calcula el precio de una reserva. Lanza Error con mensaje en español.
export function quote(bookings, req, extraHotels = []) {
  const units = Math.max(1, Math.min(4, Number(req.units) || 1));
  const today = todayISO();
  if (req.type === 'hotel') {
    const hotel = HOTELS.find((h) => h.id === req.itemId) || extraHotels.find((h) => h.id === req.itemId);
    if (!hotel) throw new Error('Hotel no encontrado.');
    if (!isISODate(req.checkIn) || !isISODate(req.checkOut)) throw new Error('Fechas no válidas.');
    const nights = daysBetween(req.checkIn, req.checkOut);
    if (req.checkIn < today) throw new Error('La fecha de entrada ya ha pasado.');
    if (nights < 1 || nights > 30) throw new Error('La estancia debe ser de 1 a 30 noches.');
    if (daysBetween(today, req.checkOut) > MAX_DAYS) throw new Error('Solo se aceptan reservas en los próximos 6 meses.');
    const cal = calendarFor(hotel, 'hotel', bookings, req.checkIn, nights);
    const full = cal.find((d) => d.left < units);
    if (full) throw new Error(`No quedan ${units > 1 ? units + ' habitaciones' : 'habitaciones'} libres la noche del ${full.date}.`);
    const total = cal.reduce((s, d) => s + d.price, 0) * units;
    return { item: hotel, units, nights, total, perNight: cal.map((d) => ({ date: d.date, price: d.price })) };
  }
  if (req.type === 'flight') {
    const flight = FLIGHTS.find((x) => x.id === req.itemId);
    if (!flight) throw new Error('Vuelo no encontrado.');
    if (!isISODate(req.date) || req.date < today) throw new Error('Fecha de vuelo no válida.');
    if (daysBetween(today, req.date) >= MAX_DAYS) throw new Error('Solo se aceptan reservas en los próximos 6 meses.');
    const [d] = calendarFor(flight, 'flight', bookings, req.date, 1);
    if (d.left < units) throw new Error('No quedan plazas suficientes en ese vuelo.');
    return { item: flight, units, total: d.price * units, perNight: [{ date: d.date, price: d.price }] };
  }
  throw new Error('Tipo de reserva no válido.');
}
