const lang = document.documentElement.lang || 'es';
const dict = lang === 'es' ? {} : await import(`/i18n/${lang}.js`).then(m => m.default, () => ({}));
const t = (s, vars = {}) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), dict[s] || s);
const section = document.getElementById('marketFlights');
const status = document.getElementById('marketFlightStatus');
const list = document.getElementById('marketFlightList');
const money = n => new Intl.NumberFormat(lang, { style: 'currency', currency: 'EUR' }).format(n);
const date = s => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(s + 'T00:00:00Z'));
function add(tag, text, parent, className) {
  const el = document.createElement(tag); el.textContent = text;
  if (className) el.className = className;
  parent.append(el); return el;
}
async function load() {
  try {
    const configResponse = await fetch('/api/config', { signal: AbortSignal.timeout(10000) });
    if (!configResponse.ok || !(await configResponse.json()).liveFlights) return;
    section.hidden = false;
    for (let attempt = 0; attempt < 24; attempt++) {
      const response = await fetch('/api/flights/deals', { headers: { 'X-Lang': lang }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(t('No se pudieron comprobar los vuelos ahora. Prueba Buscar vuelos.'));
      const data = await response.json();
      list.replaceChildren();
      status.textContent = t('Solo ida · 1 adulto · precios en euros. Alojamiento no incluido.');
      if (data.sandbox) status.textContent += ' ' + t('Entorno de pruebas: estos precios no son ofertas para reservar.');
      if (data.pending) status.textContent += ' ' + t('Comprobando precios de vuelos…');
      if (!data.deals.length && !data.pending) status.textContent = t('Ahora mismo no hay ofertas. Escribe el origen y el destino para buscar vuelos.');
      for (const offer of data.deals.slice(0, 3)) {
        const card = add('article', '', list, 'escape-card market-flight-card');
        add('h3', `${offer.origin.name} → ${offer.destination.name}`, card);
        add('p', date(offer.date), card);
        add('p', money(offer.total), card, 'escape-total');
        add('small', t('Solo ida · 1 adulto · precios en euros. Alojamiento no incluido.'), card);
        add('small', offer.airlines.join(', '), card);
        if (data.checkedAt) add('small', t('Comprobado a las {time}. Precio sujeto a disponibilidad; se vuelve a comprobar antes de pagar.', { time: new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(data.checkedAt)) }), card);
        const url = new URL(location.pathname, location.origin);
        url.search = new URLSearchParams({ dealFlight: '1', origin: offer.origin.code, destination: offer.destination.code, date: offer.date });
        const link = add('a', t('Ver disponibilidad y precio actual'), card, 'btn primary'); link.href = url.href;
      }
      if (!data.pending) return;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    status.textContent = t('La consulta está tardando. Puedes continuar en Buscar vuelos.');
  } catch (err) {
    if (!section.hidden) status.textContent = err.name === 'TimeoutError' ? t('La consulta está tardando. Puedes continuar en Buscar vuelos.') : err.message;
  }
}
if (section && !document.body.dataset.startView && !location.search) {
  if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 2000 });
  else setTimeout(load, 0);
}
