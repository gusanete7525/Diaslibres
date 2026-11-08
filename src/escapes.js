import { promotionMarket, marketInfo, rotate } from './markets.js';
import { todayISO, addDays, isISODate, daysBetween } from './availability.js';

// Bounded discovery: sample three arrival dates, never claim an exhaustive cheapest fare.
export function escapePlan(q = {}, today = todayISO()) {
  const days = Number(q.days ?? 3);
  const budget = q.budget === undefined || q.budget === '' ? null : Number(q.budget);
  const kind = q.kind || 'any';
  if (!Number.isInteger(days) || days < 2 || days > 15 || (kind === 'weekend' && days !== 3)) throw new Error('Duración no válida.');
  if (!['any', 'weekend', 'bridge', 'week'].includes(kind)) throw new Error('Tipo de hueco no válido.');
  if (budget !== null && (!Number.isFinite(budget) || budget <= 0 || budget > 50000)) throw new Error('Presupuesto no válido.');
  const nextMonth = addDays(today.slice(0, 7) + '-01', 32).slice(0, 7);
  const month = q.month || nextMonth;
  let start, end;
  if (q.from || q.to) {
    start = q.from;
    end = q.to;
  } else {
    if (!/^\d{4}-\d{2}$/.test(month) || !isISODate(month + '-01')) throw new Error('Mes no válido.');
    start = month + '-01';
    end = addDays(addDays(start, 32).slice(0, 7) + '-01', -1);
  }
  if (!isISODate(start) || !isISODate(end) || end < start || end < today || daysBetween(start, end) > 92 || end > addDays(today, 330)) throw new Error('Elige un rango futuro de hasta 93 días, dentro de los próximos 330 días.');
  if (start < today) start = today;
  const nights = days - 1;
  const candidates = [];
  for (let d = start; addDays(d, nights) <= end; d = addDays(d, 1)) {
    if (kind !== 'weekend' || new Date(d + 'T00:00:00Z').getUTCDay() === 5) candidates.push(d);
  }
  if (!candidates.length) throw new Error('No cabe esa escapada en el rango elegido.');
  const dates = [...new Set([candidates[0], candidates[Math.floor(candidates.length / 2)], candidates.at(-1)])];
  return { days, nights, budget, kind, start, end, dates };
}

const FRESH_MS = 10 * 60 * 1000; // precios recientes: se sirven tal cual
const STALE_MS = 6 * 60 * 60 * 1000; // hasta 6 h se sirven al instante mientras se renuevan en segundo plano
const RECENT_MS = 24 * 60 * 60 * 1000; // búsquedas pedidas en las últimas 24 h se mantienen calientes
const WARM_MAX = 8; // como mucho tantas búsquedas distintas por ronda, para no gastar LiteAPI

export function makeEscapeSearch(live, { now = () => Date.now() } = {}) {
  const cache = new Map(); // clave -> { promise, result, at }
  const recent = new Map(); // JSON([q, lang, country]) -> último uso
  async function compute(plan, market, lang, context) {
    const checkedAt = new Date().toISOString();
    const lists = await Promise.all(market.hotels.map(async city => {
      try {
        const hotels = await live.hotels(city, { lang, priority: 'background' });
        // Prefer well-rated modest properties, but compare actual stay totals before ranking.
        const modest = hotels.filter(h => h.rating >= 7 && h.stars > 0 && h.stars <= 3);
        const pool = modest.length ? modest : hotels.filter(h => h.rating >= 8);
        // Rotate daily through the best few so the home page does not repeat the same two hotels.
        const selected = rotate((pool.length ? pool : hotels).slice(0, 6), 2, market.day);
        const offers = await Promise.all(selected.flatMap(hotel => plan.dates.map(async checkIn => {
          try {
            const checkOut = addDays(checkIn, plan.nights);
            const rate = await live.quote({ itemId: hotel.id, checkIn, checkOut, units: 1, adults: 2, children: [], priority: 'background' });
            if (!Number.isFinite(rate.total) || rate.total <= 0) return null;
            const taxes = rate.payAtHotel || [];
            const knownTotal = Math.round((rate.total + taxes.filter(t => t.currency === 'EUR').reduce((s, t) => s + t.amount, 0)) * 100) / 100;
            // Unknown-currency extras cannot honestly be compared to a euro budget.
            if (plan.budget !== null && (knownTotal > plan.budget || taxes.some(t => t.currency !== 'EUR'))) return null;
            return { id: hotel.id, name: hotel.name, city: hotel.city, photo: hotel.photo, checkIn, checkOut, total: rate.total, knownTotal, payAtHotel: taxes, room: rate.room, roomName: rate.roomName, board: rate.board, checkedAt, promotion: rate.promotion || null };
          } catch { return null; }
        })));
        return offers.filter(Boolean).sort((a, b) => a.knownTotal - b.knownTotal).slice(0, 1);
      } catch { return []; }
    }));
    return { ...plan, results: lists.flat().sort((a, b) => a.knownTotal - b.knownTotal), checkedAt, sandbox: !!live.sandbox, sampled: true, citiesChecked: market.hotels.length, datesChecked: plan.dates.length, market: context };
  }
  // Una sola búsqueda en curso por clave; si sale vacía o falla, se conserva el resultado anterior.
  function refresh(key, entry, plan, market, lang, context) {
    entry.promise = compute(plan, market, lang, context).then(result => {
      if (result.results.length) Object.assign(entry, { result, at: now() });
      else if (!entry.result) cache.delete(key); // vacía: que el siguiente visitante lo vuelva a intentar
      return result;
    }, err => { if (!entry.result) cache.delete(key); throw err; }).finally(() => { entry.promise = null; });
    return entry.promise;
  }
  async function search(q = {}, lang = 'es', country = null) {
    const plan = escapePlan(q);
    const market = promotionMarket(lang, undefined, country);
    lang = market.language;
    const context = marketInfo(lang, market.day, market.origin);
    if (!live) return { ...plan, results: [], unavailable: true, sandbox: false, market: context };
    const args = JSON.stringify([q, lang, country]);
    recent.delete(args);
    recent.set(args, now());
    if (recent.size > 100) recent.delete(recent.keys().next().value);
    const key = JSON.stringify([plan, market.id, lang, market.day]);
    let entry = cache.get(key);
    if (entry?.result) {
      const age = now() - entry.at;
      if (age >= FRESH_MS && !entry.promise) refresh(key, entry, plan, market, lang, context).catch(() => {});
      if (age < STALE_MS) return entry.result; // al instante, aunque se esté renovando
    }
    if (entry?.promise) return entry.promise;
    if (!entry) {
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, (entry = { promise: null, result: null, at: 0 }));
    }
    return refresh(key, entry, plan, market, lang, context);
  }
  // Renueva por adelantado las búsquedas que la gente ha hecho hace poco (y la de la portada
  // en español), para que el visitante casi nunca espere a LiteAPI.
  search.warm = async (defaults = [[{}, 'es', null]]) => {
    if (!live) return;
    const t = now();
    for (const [args, at] of recent) if (t - at > RECENT_MS) recent.delete(args);
    const list = [...recent.keys()].reverse().map(a => JSON.parse(a));
    for (const d of defaults) if (!list.some(a => JSON.stringify(a) === JSON.stringify(d))) list.push(d);
    for (const [q, lang, country] of list.slice(0, WARM_MAX)) {
      try {
        const plan = escapePlan(q);
        const market = promotionMarket(lang, undefined, country);
        const key = JSON.stringify([plan, market.id, market.language, market.day]);
        const entry = cache.get(key);
        if (entry?.promise || (entry?.result && t - entry.at < FRESH_MS - 2 * 60 * 1000)) continue;
        if (!entry) {
          if (cache.size >= 100) cache.delete(cache.keys().next().value);
          cache.set(key, { promise: null, result: null, at: 0 });
        }
        await refresh(key, cache.get(key), plan, market, market.language, marketInfo(market.language, market.day, market.origin));
      } catch { /* la siguiente ronda lo vuelve a intentar */ }
    }
  };
  return search;
}
