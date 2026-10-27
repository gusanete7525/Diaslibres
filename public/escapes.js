const lang = document.documentElement.lang || 'es';
const dict = lang === 'es' ? {} : await import(`/i18n/${lang}.js`).then(m => m.default, () => ({}));
const t = (s, vars = {}) => Object.entries(vars).reduce((a, [k, v]) => a.replaceAll(`{${k}}`, v), dict[s] || s);
const form = document.getElementById('escapeForm');
const status = document.getElementById('escapeStatus');
const list = document.getElementById('escapeList');
const money = n => new Intl.NumberFormat(lang, { style: 'currency', currency: 'EUR' }).format(n);
const date = s => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(s + 'T00:00:00Z'));
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const next = new Date(today.slice(0, 7) + '-01T12:00:00Z');
next.setUTCMonth(next.getUTCMonth() + 1);
form.elements.month.value = next.toISOString().slice(0, 7);
form.elements.month.min = today.slice(0, 7);
form.elements.from.min = form.elements.to.min = today;
form.elements.kind.addEventListener('change', () => {
  const days = { weekend: 3, bridge: 4, week: 7 }[form.elements.kind.value];
  if (days) form.elements.days.value = days;
});
form.elements.days.addEventListener('input', () => { form.elements.kind.value = 'any'; });
for (const name of ['from', 'to']) form.elements[name].addEventListener('input', () => {
  const range = !!(form.elements.from.value || form.elements.to.value);
  form.elements.month.required = !range;
  form.elements.from.required = form.elements.to.required = range;
});
function element(tag, text, parent, className) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  parent.append(el);
  return el;
}
let requestId = 0;
async function discover(scroll = false) {
  const id = ++requestId;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  list.replaceChildren();
  document.getElementById('escapeSchema')?.remove();
  status.textContent = t('Comprobando precios de alojamiento…');
  document.getElementById('escapeHeading').textContent = t('Escapadas de {n} días', { n: form.elements.days.value });
  if (scroll) document.getElementById('escapeFeatured').scrollIntoView({ behavior: 'smooth', block: 'start' });
  const query = new URLSearchParams(new FormData(form));
  for (const [key, value] of [...query]) if (!value) query.delete(key);
  try {
    const response = await fetch(`/api/escapes?${query}`, { headers: { 'X-Lang': lang }, cache: 'no-store', signal: AbortSignal.timeout(60000) });
    const data = await response.json();
    if (id !== requestId) return;
    if (!response.ok) throw new Error(data.error || t('No se pudieron comprobar las escapadas. Inténtalo de nuevo.'));
    if (data.unavailable) {
      status.textContent = t('Los precios de escapadas no están disponibles ahora. Puedes explorar destinos con la búsqueda manual.');
      return;
    }
    status.textContent = data.results.length
      ? t('Muestra de {cities} destinos y {dates} fechas de llegada. Total de alojamiento para 2 adultos; transporte no incluido.', { cities: data.citiesChecked, dates: data.datesChecked })
      : t('No hemos encontrado opciones verificadas en esta muestra. Amplía el presupuesto o cambia las fechas.');
    if (data.sandbox) status.textContent += ' ' + t('Entorno de pruebas: estos precios no son ofertas para reservar.');
    const trips = [];
    for (const offer of data.results) {
      const card = element('article', '', list, 'escape-card');
      if (offer.photo?.startsWith('https://')) {
        const image = document.createElement('img');
        image.src = offer.photo; image.alt = offer.name; image.loading = 'lazy'; image.width = 400; image.height = 160;
        card.append(image);
      }
      element('h3', offer.city, card);
      element('p', offer.name, card);
      element('p', `${date(offer.checkIn)} – ${date(offer.checkOut)} · ${data.nights} ${t('noches')}`, card);
      element('p', money(offer.total), card, 'escape-total');
      element('small', t('Total a pagar online · 2 adultos · 1 habitación'), card);
      if (offer.roomName) element('small', offer.roomName, card);
      for (const tax of offer.payAtHotel) element('small', `${t('A pagar en el hotel')}: ${tax.amount} ${tax.currency} · ${tax.description}`, card);
      if (offer.knownTotal > offer.total) element('small', t('Total con tasas conocidas: {price}', { price: money(offer.knownTotal) }), card);
      element('small', t('Comprobado a las {time}. Precio sujeto a disponibilidad; se vuelve a comprobar antes de pagar.', { time: new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(offer.checkedAt)) }), card);
      const url = new URL(location.pathname, location.origin);
      url.search = new URLSearchParams({ escape: offer.id, destination: offer.city, checkIn: offer.checkIn, nights: data.nights });
      const link = element('a', t('Ver disponibilidad y precio actual'), card, 'btn primary');
      link.href = url.href;
      // Only verified production offers matching the visible cards get structured prices.
      if (!data.sandbox) trips.push({ '@type': 'TouristTrip', name: `${offer.city} · ${data.days} ${t('Días')}`, touristType: t('2 adultos'), itinerary: { '@type': 'Place', name: offer.city }, offers: { '@type': 'Offer', price: offer.total, priceCurrency: 'EUR', url: url.href, description: t('Total a pagar online · 2 adultos · 1 habitación'), validFrom: offer.checkedAt } });
    }
    if (trips.length) {
      const script = document.createElement('script');
      script.type = 'application/ld+json'; script.id = 'escapeSchema';
      script.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: trips.map((item, i) => ({ '@type': 'ListItem', position: i + 1, item })) });
      document.head.append(script);
    }
  } catch (err) {
    if (id === requestId) status.textContent = err.name === 'TimeoutError' ? t('La consulta está tardando. Vuelve a intentarlo.') : err.message;
  } finally { if (id === requestId) button.disabled = false; }
}
form.addEventListener('submit', e => { e.preventDefault(); if (form.reportValidity()) discover(true); });
// Load after the first paint; never delay the initial page or booking return.
if (!document.body.dataset.startView && !location.search) {
  if ('requestIdleCallback' in window) requestIdleCallback(() => discover(), { timeout: 1500 });
  else setTimeout(() => discover(), 0);
} else {
  status.textContent = t('Elige tus días y descubre escapadas sin fijar un destino.');
}
