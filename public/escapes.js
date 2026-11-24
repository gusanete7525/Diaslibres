const lang = document.documentElement.lang || 'es';
const dict = lang === 'es' ? {} : await import(`/i18n/${lang}.js`).then(m => m.default, () => ({}));
const t = (s, vars = {}) => Object.entries(vars).reduce((a, [k, v]) => a.replaceAll(`{${k}}`, v), dict[s] || s);
const form = document.getElementById('escapeForm');
const status = document.getElementById('escapeStatus');
const list = document.getElementById('escapeList');
const compactHome = document.body.classList.contains('home-page');
const seasonal = document.body.dataset.seasonal;
const activeSeason = document.body.dataset.seasonalActive === 'true';
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
  const preview = compactHome && !scroll;
  document.getElementById('escapeFeatured').hidden = false;
  const button = form.querySelector('button[type="submit"]');
  // Background inspiration must leave the main search available.
  button.disabled = scroll;
  list.replaceChildren();
  document.getElementById('escapeSchema')?.remove();
  status.textContent = t('Comprobando precios de alojamiento…');
  const heading = document.getElementById('escapeHeading');
  const marketNote = document.getElementById('escapeMarket');
  const tripType = form.elements.tripType;
  const selectedTheme = scroll && tripType?.value ? tripType.selectedOptions[0].textContent : '';
  marketNote.hidden = Boolean(selectedTheme);
  heading.textContent = !scroll && seasonal === 'navidad' ? 'Alojamiento para esquiar en Navidad'
    : !scroll && seasonal === 'black-friday' ? 'Hoteles con descuento comprobado'
    : [t('Escapadas de {n} días', { n: form.elements.days.value }), selectedTheme].filter(Boolean).join(' · ');
  if (scroll) document.getElementById('escapeFeatured').scrollIntoView({ behavior: 'smooth', block: 'start' });
  const query = scroll ? new URLSearchParams(new FormData(form)) : new URLSearchParams({ featured: '1' });
  if (!scroll && seasonal === 'navidad') query.set('theme', 'ski');
  if (!scroll && seasonal === 'black-friday') {
    query.set('theme', 'black-friday');
    query.set('from', '2026-12-04');
    query.set('to', '2026-12-13');
  }
  for (const [key, value] of [...query]) if (!value) query.delete(key);
  try {
    const response = await fetch(`/api/escapes?${query}`, { headers: { 'X-Lang': lang }, cache: 'no-store', signal: AbortSignal.timeout(60000) });
    const data = await response.json();
    if (id !== requestId) return;
    if (!response.ok) throw new Error(data.error || t('No se pudieron comprobar las escapadas. Inténtalo de nuevo.'));
    if (data.market?.season === 'christmas' && data.market.theme !== 'ski') {
      document.getElementById('escapeHeading').textContent = 'Escapadas de Navidad en España y Europa';
    }
    if (data.market?.tripType) {
      marketNote.hidden = true;
    } else if (data.market?.theme === 'ski') {
      document.getElementById('escapeMarket').textContent = 'Sierra Nevada, Baqueira Beret y Andorra';
    } else if (data.market?.basedOn === 'country') {
      const origin = new Intl.DisplayNames([lang], { type: 'region' }).of(data.market.origin);
      document.getElementById('escapeMarket').textContent = t('Ideas de alojamiento pensadas para viajeros desde {country}.', { country: origin });
    } else if (data.market?.countries?.length) {
      const names = new Intl.DisplayNames([lang], { type: 'region' });
      const countries = new Intl.ListFormat(lang).format(data.market.countries.map(c => names.of(c)));
      document.getElementById('escapeMarket').textContent = t('Ideas de alojamiento en {countries} según el idioma seleccionado.', { countries });
    }
    if (data.unavailable) {
      status.textContent = t('Los precios de escapadas no están disponibles ahora. Puedes explorar destinos con la búsqueda manual.');
      return;
    }
    status.textContent = data.results.length
      ? t('Muestra de {cities} destinos y {dates} fechas de llegada. Total de alojamiento para 2 adultos; transporte no incluido.', { cities: data.citiesChecked, dates: data.datesChecked })
      : t('No hemos encontrado opciones verificadas en esta muestra. Amplía el presupuesto o cambia las fechas.');
    if (data.market?.theme === 'ski') status.textContent = data.results.length
      ? 'Total de alojamiento para dos adultos. Forfait, equipo y transporte se contratan aparte.'
      : 'Nuitée no devolvió disponibilidad para estas fechas. Consulta los destinos de esquí más abajo.';
    if (data.market?.theme === 'black-friday' && !data.results.length) status.textContent = 'Nuitée no devolvió descuentos verificables en las fechas consultadas.';
    if (data.sandbox) status.textContent += ' ' + t('Entorno de pruebas: estos precios no son ofertas para reservar.');
    const trips = [];
    for (const offer of data.results) {
      const card = element('article', '', list, 'escape-card');
      if (!preview && offer.photo?.startsWith('https://')) {
        const image = document.createElement('img');
        image.src = offer.photo; image.alt = offer.name; image.loading = 'lazy'; image.width = 400; image.height = 160;
        card.append(image);
      }
      const summary = element('div', '', card, 'escape-summary');
      element('h3', offer.city, summary);
      element('p', `${date(offer.checkIn)} – ${date(offer.checkOut)} · ${data.nights} ${t('noches')}`, summary, 'escape-dates');
      element('p', money(offer.total), summary, 'escape-total');
      const details = preview ? element('details', '', card, 'escape-card-details') : card;
      if (preview) element('summary', t('Ver detalles del hotel'), details);
      element('p', offer.name, details);
      element('small', t('Total a pagar online · 2 adultos · 1 habitación'), details);
      if (offer.promotion?.percent > 0 && offer.promotion.originalTotal > offer.total) {
        element('small', t('Descuento verificado: {percent}% · antes {price}', { percent: offer.promotion.percent, price: money(offer.promotion.originalTotal) }), details, 'market-discount');
      }
      if (offer.roomName) element('small', offer.roomName, details);
      for (const tax of offer.payAtHotel) element('small', `${t('A pagar en el hotel')}: ${tax.amount} ${tax.currency} · ${tax.description}`, details);
      if (offer.knownTotal > offer.total) element('small', t('Total con tasas conocidas: {price}', { price: money(offer.knownTotal) }), details);
      element('small', t('Comprobado a las {time}. Precio sujeto a disponibilidad; se vuelve a comprobar antes de pagar.', { time: new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(offer.checkedAt)) }), details);
      const url = new URL(location.pathname, location.origin);
      url.search = new URLSearchParams({ escape: offer.id, destination: offer.city, checkIn: offer.checkIn, nights: data.nights });
      const link = element('a', t('Ver disponibilidad y precio actual'), details, 'btn primary');
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
document.getElementById('europa-en-navidad')?.addEventListener('click', async event => {
  const button = event.target.closest('[data-quote-city]');
  if (!button || button.disabled) return;
  const card = button.closest('[data-christmas-city]');
  const prices = card.querySelector('[data-city-prices]');
  button.disabled = true;
  prices.textContent = 'Consultando Nuitée…';
  try {
    const response = await fetch(`/api/christmas-cities/${encodeURIComponent(card.dataset.christmasCity)}`, { cache: 'no-store', signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('No se pudieron consultar las tarifas ahora.');
    const { hotel, flight, sandbox, checkedAt } = await response.json();
    prices.replaceChildren();
    element('p', hotel ? `Alojamiento · ${money(hotel.total)} · ${hotel.name}` : 'Sin tarifa de alojamiento en la muestra consultada.', prices);
    for (const tax of hotel?.payAtHotel || []) element('small', `A pagar en el hotel: ${tax.amount} ${tax.currency} · ${tax.description}`, prices);
    element('p', flight ? `Vuelos de ida y vuelta · ${money(flight.total)} para dos` : 'Sin tarifa de vuelo compatible con las fechas consultadas.', prices);
    if ((hotel || flight) && checkedAt) element('small', 'Tarifas consultadas a las ' + new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(checkedAt)) + '. Sujetas a disponibilidad.', prices);
    if (sandbox) element('small', 'Entorno de pruebas. Estas tarifas no son ofertas para reservar.', prices);
  } catch {
    prices.textContent = 'No se pudieron consultar las tarifas ahora. Puedes abrir los buscadores de vuelos y hoteles.';
  } finally {
    button.disabled = false;
  }
});
// Load after the first paint; never delay the initial page or booking return.
if ((!document.body.dataset.startView || activeSeason) && !location.search) {
  if ('requestIdleCallback' in window) requestIdleCallback(() => discover(), { timeout: 1500 });
  else setTimeout(() => discover(), 0);
} else {
  status.textContent = t('Elige tus días y descubre escapadas sin fijar un destino.');
}
