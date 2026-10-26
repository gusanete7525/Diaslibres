// Only the supplier's original price is a valid comparison. Competitor suggestions
// and documentation examples are never treated as an active promotion.
function amount(value, currency = 'EUR') {
  if (Array.isArray(value)) return amount(value.find(v => v?.currency === currency), currency);
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (!value || (value.currency && value.currency !== currency)) return null;
  return amount(value.amount, currency);
}
export function offerPromotion(offer, rooms = 1) {
  const currency = 'EUR';
  const total = amount(offer.offerRetailRate, currency);
  const rates = offer.rates || [];
  const original = amount(offer.offerInitialPrice, currency) ??
    (rooms === 1 && rates.length === 1 ? amount(rates[0].retailRate?.initialPrice, currency) : null);
  if (!total || !original || original <= total + 0.009) return null;
  const savings = Math.round((original - total) * 100) / 100;
  const names = [...new Set(rates.flatMap(r => r.retailRate?.promotions || []).map(p => typeof p?.name === 'string' ? p.name.trim().slice(0, 120) : '').filter(Boolean))];
  return { originalTotal: Math.round(original * 100) / 100, total, savings, percent: Math.floor(savings / original * 100), currency, names };
}
