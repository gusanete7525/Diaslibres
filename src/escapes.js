import { promotionMarket, marketInfo } from './markets.js';
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

export function makeEscapeSearch(live) {
  const cache = new Map();
  return async (q, lang = 'es') => {
    const plan = escapePlan(q);
    const market = promotionMarket(lang);
    lang = market.language;
    const context = marketInfo(lang);
    if (!live) return { ...plan, results: [], unavailable: true, sandbox: false, market: context };
    const key = JSON.stringify([plan, lang]);
    const found = cache.get(key);
    if (found && found.expires > Date.now()) return found.value;
    // Coalesce repeated visits and keep discovery costs bounded.
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    const value = (async () => {
      const checkedAt = new Date().toISOString();
      const lists = await Promise.all(market.hotels.map(async city => {
        try {
          const hotels = await live.hotels(city, { lang });
          // Prefer well-rated modest properties, but compare actual stay totals before ranking.
          const modest = hotels.filter(h => h.rating >= 7 && h.stars > 0 && h.stars <= 3);
          const pool = modest.length ? modest : hotels.filter(h => h.rating >= 8);
          const selected = (pool.length ? pool : hotels).slice(0, 2);
          const offers = await Promise.all(selected.flatMap(hotel => plan.dates.map(async checkIn => {
            try {
              const checkOut = addDays(checkIn, plan.nights);
              const rate = await live.quote({ itemId: hotel.id, checkIn, checkOut, units: 1, adults: 2, children: [] });
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
    })();
    cache.set(key, { value, expires: Date.now() + 10 * 60 * 1000 });
    try {
      const result = await value;
      // Do not cache transient empty responses, so visitors can retry.
      if (!result.results.length) cache.delete(key);
      return result;
    } catch (err) { cache.delete(key); throw err; }
  };
}
