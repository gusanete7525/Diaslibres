// DíasLibres — interfaz. Vanilla JS, sin dependencias.

const $ = (sel, el = document) => el.querySelector(sel);

// ---------- Idioma ----------
// La página dice su idioma (<html lang>). Los textos se escriben en español y se traducen
// con t('frase', { huecos }); el diccionario de cada idioma está en /i18n/<idioma>.js.
const LANG = document.documentElement.lang || 'es';
const LOCALE = { es: 'es-ES', en: 'en-GB', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-PT', nl: 'nl-NL' }[LANG] || 'es-ES';
const DICT = LANG === 'es' ? {} : await import(`/i18n/${LANG}.js`).then((m) => m.default, () => ({}));
const t = (s, vars = {}) => Object.entries(vars).reduce((out, [k, v]) => out.replaceAll(`{${k}}`, v), DICT[s] ?? s);
// Singular o plural: tn(3, '{n} noche', '{n} noches').
const tn = (n, one, many, vars = {}) => t(n === 1 ? one : many, { n, ...vars });
// En alemán los sustantivos van con mayúscula: no se pasan a minúsculas.
const lower = (s) => (LANG === 'de' ? s : s.toLowerCase());
const DOW = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(LOCALE, { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i))));
const fmtDay = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtShort = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtMonth = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const eur = (n) => `${Math.round(n).toLocaleString(LOCALE)} €`;
// Importes a pagar: con céntimos.
const eur2 = (n) => Number(n).toLocaleString(LOCALE, { style: 'currency', currency: 'EUR' });
// Lo que no es un hotel se dice en la ficha.
const STAY_LABEL = { apartment: 'Apartamento', house: 'Casa o villa', hostel: 'Hostal' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const toDate = (iso) => new Date(iso + 'T00:00:00Z');
const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};

const state = {
  view: 'hotels',
  data: null, // respuesta de la última búsqueda
  items: new Map(), // id -> item
  ui: new Map(), // id -> { month, start, end, picking }
  booking: null,
  config: {}, // { liveFlights, sandbox } del servidor
};

const results = $('#results');
const filters = $('#filters');
const tooltip = $('#tooltip');

// ---------- Tema ----------
const savedTheme = store.get('dl-theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
$('#themeToggle').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  store.set('dl-theme', document.documentElement.dataset.theme);
});

// ---------- Utilidades UI ----------
let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}
function showTip(html, x, y) {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const w = tooltip.offsetWidth / 2 + 8;
  tooltip.style.left = Math.min(innerWidth - w, Math.max(w, x)) + 'px';
  tooltip.style.top = Math.max(50, y) + 'px';
}
const hideTip = () => (tooltip.hidden = true);
async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json', 'X-Lang': LANG }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || t('Error de conexión')), { body });
  return body;
}

function setFooter(live) {
  const el = $('#footerNote');
  if (!el) return;
  el.textContent = live
    ? [t('Precios y disponibilidad en tiempo real.'), state.data?.live?.sandbox ? t('Entorno de pruebas: las reservas son de prueba y no se cobran.') : '', state.config.liveFlights || state.config.flights === false ? '' : t('Los vuelos son simulados.')].filter(Boolean).join(' ')
    : el.dataset.default;
}

// ---------- Navegación ----------
function setView(view) {
  state.view = view;
  document.body.dataset.view = view;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)));
  $('#mine').hidden = view !== 'mine';
  $('#searchSection').hidden = view === 'mine';
  results.hidden = view === 'mine';
  // Hoteles: destino libre (cualquier ciudad). Vuelos: solo aeropuertos con rutas.
  if (view === 'flights') filters.destination.setAttribute('list', 'destList');
  else filters.destination.removeAttribute('list');
  filters.destination.placeholder = view === 'flights' ? t('Ciudad o aeropuerto') : view === 'trains' ? t('Ciudad (p. ej. Barcelona)') : t('Escribe cualquier ciudad');
  filters.origin.placeholder = view === 'trains' ? t('Ciudad (p. ej. Madrid)') : state.config.liveFlights ? t('Ciudad o código (MAD)') : t('Cualquiera');
  if (view === 'mine') {
    // Con la cuenta abierta se ven sus reservas directamente; si no, hace falta email + código.
    const email = state.user?.email || store.get('dl-email');
    if (email) $('#mineForm').email.value = email;
    if (!$('#mineForm').code.value) $('#mineForm').code.value = store.get('dl-code') || '';
    if (state.user || (email && $('#mineForm').code.value)) loadMine(email);
  }
}
document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', (e) => {
    e.preventDefault();
    setView(b.dataset.view);
    if (b.dataset.view !== 'mine') search();
  }),
);

// ---------- Búsqueda ----------
function filterParams() {
  const fd = new FormData(filters);
  const p = new URLSearchParams();
  for (const [k, v] of fd) if (v && k !== 'fac') p.set(k, v);
  if (fd.getAll('fac').length) p.set('fac', fd.getAll('fac').join(','));
  p.delete('kids');
  for (const k of [...p.keys()]) if (k.startsWith('age')) p.delete(k);
  if (state.view === 'hotels') {
    const ages = [...filters.querySelectorAll('[name^="age"]')].map((s) => s.value);
    if (ages.length) p.set('children', ages.join(','));
  }
  if (state.view === 'flights') { for (const k of ['nights', 'sort', 'tags', 'minStars', 'minRating', 'board', 'stay', 'fac', 'adults']) p.delete(k); }
  else p.delete('origin');
  for (const k of ['date', 'returnDate', 'passengers', 'stops']) p.delete(k);
  return p;
}

let searchToken = 0;
async function search() {
  const token = ++searchToken;
  recordSearch();
  if (state.view === 'flights') await configReady;
  if (token !== searchToken) return;
  if (state.view === 'trains') return searchTrains(token);
  if (state.view === 'flights' && state.config.liveFlights) return searchLiveFlights(token);
  results.classList.add('loading');
  if (state.view === 'hotels' && filters.destination.value.trim()) {
    results.innerHTML = `<p class="count">${t('Buscando hoteles en {city}…', { city: esc(filters.destination.value.trim()) })}</p>`;
  }
  try {
    const p = filterParams();
    const data = await api(`/api/${state.view === 'flights' ? 'flights' : 'hotels'}?${p}`);
    if (token !== searchToken) return;
    // El servidor ya da vuelos reales aunque no se pudiera leer /api/config: se repite con su buscador.
    if (data.live?.flights) {
      state.config = { ...state.config, liveFlights: true };
      document.body.dataset.liveFlights = '1';
      return searchLiveFlights(token);
    }
    state.data = data;
    state.autoMore = 0;
    state.items = new Map(data.results.map((x) => [x.id, x]));
    state.ui = new Map();
    const checkIn = filters.checkIn.value;
    for (const item of data.results) state.ui.set(item.id, initialUi(item, data, checkIn));
    renderResults();
    if (data.live && data.results.length) loadLivePrices(token).then(() => autoMore(token, state.data.results));
  } catch (err) {
    results.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
  } finally {
    results.classList.remove('loading');
  }
}

// Edad de cada niño (LiteAPI la necesita para el precio).
function renderKidAges() {
  const box = $('#kidAges');
  const n = Number(filters.kids.value) || 0;
  const prev = [...box.querySelectorAll('select')].map((s) => s.value);
  box.innerHTML = Array.from({ length: n }, (_, i) => `<label>${t('Edad niño {n}', { n: i + 1 })}<select name="age${i}">${Array.from({ length: 18 }, (_, a) => `<option ${String(a) === (prev[i] ?? '8') ? 'selected' : ''}>${a}</option>`).join('')}</select></label>`).join('');
}
filters.kids.addEventListener('change', renderKidAges);

function guestsText(g) {
  if (!g) return '';
  const kids = g.children?.length || 0;
  const adults = tn(g.adults, '{n} adulto', '{n} adultos');
  return kids ? t('{adults} y {kids} ({ages} años)', { adults, kids: tn(kids, '{n} niño', '{n} niños'), ages: g.children.join(', ') }) : adults;
}

// ---------- Precios reales (LiteAPI): se cargan por semanas y rellenan el calendario ----------
async function loadLivePrices(token, list = state.data.results) {
  const { start, days } = state.data;
  const ids = list.map((h) => h.id).join(',');
  for (let off = 0; off < days; off += 7) {
    if (token !== searchToken) return; // hay una búsqueda más nueva
    let res;
    try {
      const g = state.data.guests || {};
      const occ = `&adults=${g.adults || 2}${g.children?.length ? '&children=' + g.children.join(',') : ''}`;
      res = await api(`/api/live/prices?ids=${encodeURIComponent(ids)}&start=${addDays(start, off)}&days=${Math.min(7, days - off)}${occ}${state.data.board ? '&board=' + state.data.board : ''}`);
    } catch (err) {
      if (token === searchToken) {
        toast(err.message);
        state.data.pricesFailed = true;
        for (const item of list) rerender(item.id);
        updateHiddenNote();
      }
      return;
    }
    if (token !== searchToken) return;
    for (const [id, nights] of Object.entries(res.prices)) {
      const item = state.items.get(id);
      if (!item) continue;
      for (const n of nights) {
        const i = diffDays(start, n.date);
        if (i >= 0 && i < item.calendar.length) item.calendar[i] = n;
      }
      refreshSummary(item);
      // Con fecha de entrada pedida, se marca la estancia en cuanto se sabe que está libre.
      const checkIn = filters.checkIn.value;
      if (checkIn && !state.ui.get(id)?.start) state.ui.set(id, initialUi(item, state.data, checkIn));
      rerender(id);
    }
    updateHiddenNote();
    const loaded = Math.min(days, off + 7);
    const note = $('#livePending');
    if (note) note.textContent = loaded < days ? t('Cargando precios reales… {loaded}/{days} días', { loaded, days }) : '';
  }
  // «Más baratos»: con todos los precios ya cargados se reordenan las tarjetas.
  if (token === searchToken && filters.sort.value === 'price' && state.view === 'hotels') {
    const price = (h) => h.summary?.minPrice ?? Infinity;
    state.data.results.sort((a, b) => price(a) - price(b));
    renderResults();
    const note = $('#livePending');
    if (note) note.textContent = '';
  }
}

// Si con las fechas o el precio pedidos no queda ninguno, se buscan solos unos cuantos más.
function autoMore(token, list) {
  if (token !== searchToken || state.view !== 'hotels' || !state.data.hasMore || list.some(passesStay)) return;
  if ((state.autoMore = (state.autoMore || 0) + 1) > 3) return;
  const btn = $('#results .btn.more');
  if (btn) { btn.dataset.auto = '1'; btn.click(); }
}

const filtering = () => state.view === 'hotels' && !!(filters.checkIn.value || Number(filters.maxPrice.value));
const settled = (list) => new Promise((resolve) => {
  const check = () => (list.some((x) => stayState(x) === 'wait') && !state.data.pricesFailed ? setTimeout(check, 300) : resolve());
  check();
});

// Con fechas o precio máximo, se ocultan los alojamientos que no están libres esas noches
// o que cuestan más (precio medio por noche). Mientras llegan sus precios no se enseñan
// (si no, aparecerían y desaparecerían): 'ok' se ve, 'no' está oculto, 'wait' aún se comprueba.
function stayState(item) {
  if (state.view !== 'hotels' || !state.data?.live || state.data.pricesFailed) return 'ok';
  const max = Number(filters.maxPrice.value) || 0;
  const checkIn = filters.checkIn.value;
  const n = state.data.nights;
  const cal = item.calendar;
  if (checkIn) {
    const i = diffDays(state.data.start, checkIn);
    const slice = i >= 0 ? cal.slice(i, i + n) : [];
    if (slice.length < n) return 'ok';
    if (slice.some((d) => !d.pending && !d.available)) return 'no';
    if (slice.some((d) => d.pending)) return 'wait';
    return !max || slice.reduce((sum, d) => sum + d.price, 0) / n <= max ? 'ok' : 'no';
  }
  if (!max) return 'ok';
  if (cal.some((d) => d.available && d.price <= max)) return 'ok';
  return cal.some((d) => d.pending) ? 'wait' : 'no';
}
function passesStay(item) {
  return stayState(item) === 'ok';
}
function updateHiddenNote() {
  const note = $('#hiddenNote');
  if (!note || state.view !== 'hotels') return;
  const states = state.data.results.map(stayState);
  const hidden = states.filter((x) => x === 'no').length;
  const waiting = states.filter((x) => x === 'wait').length;
  const max = Number(filters.maxPrice.value) || 0;
  const why = filters.checkIn.value
    ? (max ? t('sin plazas libres esas noches o más de {price} por noche', { price: eur(max) }) : t('sin plazas libres esas noches'))
    : t('más de {price} por noche', { price: eur(max) });
  const parts = [];
  if (hidden) parts.push(tn(hidden, '{n} oculto ({why}).', '{n} ocultos ({why}).', { why }));
  if (waiting) parts.push(t('Comprobando disponibilidad de {n} más…', { n: waiting }));
  if (hidden && !waiting && !states.includes('ok') && state.data.hasMore) parts.push(t('Pulsa «Ver más hoteles» para buscar entre los demás.'));
  note.hidden = !parts.length;
  note.textContent = parts.join(' ');
}

function refreshSummary(item) {
  const free = item.calendar.filter((d) => d.available);
  const prices = free.map((d) => d.price);
  item.summary = {
    freeDays: free.length,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    avgPrice: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
  };
  const n = state.data.nights;
  let best = null;
  for (let i = 0; i + n <= item.calendar.length; i++) {
    const slice = item.calendar.slice(i, i + n);
    if (!slice.every((d) => d.available)) continue;
    const total = slice.reduce((s, d) => s + d.price, 0);
    if (!best || total < best.total) best = { checkIn: slice[0].date, checkOut: addDays(slice[0].date, n), total };
  }
  item.bestStay = best;
}

function initialUi(item, data, checkIn) {
  const ui = { month: 0, start: null, end: null, picking: 'start' };
  if (!checkIn) return ui;
  const i = diffDays(data.start, checkIn);
  if (i < 0 || i >= item.calendar.length) return ui;
  ui.month = monthIndex(data.start, checkIn);
  if (state.view === 'flights') {
    if (item.calendar[i].available) ui.start = checkIn;
  } else {
    const n = data.nights;
    const slice = item.calendar.slice(i, i + n);
    if (slice.length === n && slice.every((d) => d.available)) { ui.start = checkIn; ui.end = addDays(checkIn, n); }
  }
  return ui;
}

// Algunos visores (iframes aislados) bloquean el envío de formularios y el evento
// submit nunca llega: los formularios se envían con clic en su botón o con Enter.
function onSend(form, handler) {
  const run = () => { if (form.reportValidity()) handler(); };
  form.addEventListener('submit', (e) => e.preventDefault());
  form.querySelectorAll('[data-send]').forEach((b) => b.addEventListener('click', run));
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); run(); }
  });
}

onSend(filters, search);
$('#clearFilters').addEventListener('click', () => {
  filters.reset();
  renderKidAges();
  filters.tags.value = filters.minStars.value = filters.checkIn.value = '';
  updateMoreCount();
  $('#aiExplain').hidden = true;
  search();
});

// ---------- Más filtros: servicios, régimen, estrellas y puntuación ----------
const FACILITY_FALLBACK = {
  mascotas: { label: 'Admite mascotas', icon: '🐾' }, aire: { label: 'Aire acondicionado', icon: '❄️' },
  calefaccion: { label: 'Calefacción', icon: '🔥' }, piscina: { label: 'Piscina', icon: '🏊' },
  parking: { label: 'Parking', icon: '🅿️' }, wifi: { label: 'Wifi gratis', icon: '📶' },
};
const facilityInfo = () => state.config.facilities || FACILITY_FALLBACK;
function renderFacilityList() {
  const box = $('#facilityList');
  const checked = new Set([...box.querySelectorAll('input:checked')].map((i) => i.value));
  box.innerHTML = Object.entries(facilityInfo()).map(([k, f]) =>
    `<label class="check"><input type="checkbox" name="fac" value="${esc(k)}" ${checked.has(k) ? 'checked' : ''} /> <span>${f.icon} ${esc(t(f.label))}</span></label>`).join('');
}
function updateMoreCount() {
  const n = filters.querySelectorAll('[name="fac"]:checked').length
    + ['stay', 'minStars', 'minRating', 'board'].filter((k) => filters[k].value).length;
  const badge = $('#moreCount');
  badge.textContent = n;
  badge.hidden = !n;
}
renderFacilityList();
$('#moreFiltersBtn').addEventListener('click', () => {
  const panel = $('#moreFilters');
  panel.hidden = !panel.hidden;
  $('#moreFiltersBtn').setAttribute('aria-expanded', String(!panel.hidden));
});
$('#moreFilters').addEventListener('change', () => { updateMoreCount(); search(); });
filters.sort.addEventListener('change', () => { if (state.view === 'hotels') search(); });

async function aiSearchSubmit() {
  const query = $('#aiQuery').value.trim();
  if (!query) return;
  const btn = $('#aiForm button');
  btn.disabled = true;
  btn.textContent = t('Pensando…');
  try {
    const f = await api('/api/ai-search', { method: 'POST', body: JSON.stringify({ query, lang: LANG }) });
    filters.reset();
    renderKidAges();
    filters.destination.value = f.destination || '';
    filters.origin.value = f.origin || '';
    filters.maxPrice.value = f.maxPrice || '';
    filters.nights.value = f.nights || 3;
    filters.sort.value = f.sort || 'stars';
    filters.tags.value = (f.tags || []).join(',');
    filters.minStars.value = f.minStars || '';
    const trip = f.kind === 'flight' || f.kind === 'train';
    filters.checkIn.value = trip ? '' : f.checkIn || '';
    if (trip && f.checkIn) filters.date.value = f.checkIn;
    if (f.adults) filters[trip ? 'passengers' : 'adults'].value = String(f.adults);
    filters.board.value = f.board || '';
    filters.stay.value = f.stay || '';
    filters.stops.value = f.stops || '';
    const fac = new Set(f.fac || []);
    filters.querySelectorAll('[name="fac"]').forEach((c) => { c.checked = fac.has(c.value); });
    if (fac.size || f.board || f.stay) { $('#moreFilters').hidden = false; $('#moreFiltersBtn').setAttribute('aria-expanded', 'true'); }
    updateMoreCount();
    const ex = $('#aiExplain');
    ex.textContent = `${f.source === 'claude' ? '✨' : '🔎'} ${f.explanation}`;
    ex.hidden = false;
    if (f.kind === 'flight' && state.config.flights === false) {
      toast(t('Los vuelos todavía no están disponibles. De momento solo hoteles.'));
      return;
    }
    setView(f.kind === 'flight' ? 'flights' : f.kind === 'train' ? 'trains' : 'hotels');
    await search();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = `${t('Buscar con IA')} →`;
  }
}
onSend($('#aiForm'), aiSearchSubmit);
$('#examples').addEventListener('click', (e) => {
  const card = e.target.closest('button');
  if (!card) return;
  // Las tarjetas con título y subtítulo llevan en data-q la búsqueda que lanzan.
  $('#aiQuery').value = card.dataset.q ? t(card.dataset.q) : card.textContent.trim();
  aiSearchSubmit();
});

// En el móvil la búsqueda manual va plegada tras un botón; la IA queda a la vista.
function setManual(open) {
  document.body.classList.toggle('manual-open', open);
  $('#manualToggle').setAttribute('aria-expanded', String(open));
  $('#manualToggle span').textContent = open ? t('Ocultar búsqueda manual') : t('Búsqueda manual');
}
$('#manualToggle').addEventListener('click', () => setManual(!document.body.classList.contains('manual-open')));

// ---------- Render ----------
function renderResults() {
  const { results: list } = state.data;
  const osm = state.data.osm;
  const ai = state.data.ai;
  const warnings = [osm?.error, ai?.error].filter(Boolean).map((w) => `<p class="count">⚠️ ${esc(w)}</p>`).join('');
  if (!list.length) {
    results.innerHTML = warnings + `<p class="empty">${t('No hay resultados con esos filtros. Prueba con otra ciudad o quita algún filtro.')}</p>`;
    return;
  }
  const one = list.length === 1;
  const stayWord = { apartment: 'apartamentos', house: 'casas y villas', hostel: 'hostales y pensiones' }[filters.stay.value];
  const kind = state.view === 'flights' ? (one ? t('vuelo') : t('vuelos')) : one ? t('hotel') : t(stayWord || 'hoteles');
  const osmNote = (osm?.count ? ' · ' + t('{n} de OpenStreetMap', { n: osm.count }) : '') + (ai?.count ? ' · ' + tn(ai.count, '{n} sugerido por IA', '{n} sugeridos por IA') : '');
  const live = state.data.live;
  const liveNote = live ? ' · ' + t('precios y disponibilidad en tiempo real') + (live.sandbox ? ' ' + t('(entorno de pruebas)') : '') : '';
  const boardNote = state.data.boardName ? ' · ' + t('precios con {board}', { board: lower(t(state.data.boardName)) }) : '';
  const city = live && !filters.destination.value.trim() ? `<p class="count">${live.mixed ? t('Ideas de hoteles en varias ciudades. Escribe una ciudad para ver todos sus hoteles.') : t('Mostrando {city}. Escribe otra ciudad para ver sus hoteles.', { city: esc(live.city) })}</p>` : '';
  const total = state.data.total > list.length ? t('{shown} de {total}', { shown: `<span id="shownCount">${list.length}</span>`, total: state.data.total.toLocaleString(LOCALE) }) : list.length;
  results.innerHTML = `<p class="count">${total} ${kind}${osmNote}${liveNote}${boardNote} · ${state.data.start > new Date().toISOString().slice(0, 10) ? t('{n} días desde el {date}', { n: state.data.days, date: fmtDay.format(toDate(state.data.start)) }) : t('próximos {n} días', { n: state.data.days })}</p>${city}${live ? `<p class="count" id="livePending">${t('Cargando precios reales…')}</p><p class="count" id="hiddenNote" hidden></p>` : ''}${warnings}`;
  setFooter(!!live);
  for (const item of list) results.append(renderCard(item));
  if (state.data.hasMore) results.append(moreHotelsButton());
  updateHiddenNote();
}

// La ciudad puede tener cientos de hoteles: se piden de 15 en 15.
function moreHotelsButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn more';
  btn.textContent = t('Ver más hoteles (quedan {n})', { n: (state.data.total - state.data.results.length).toLocaleString(LOCALE) });
  btn.addEventListener('click', async () => {
    const token = searchToken;
    if (!btn.dataset.auto) state.autoMore = 0;
    btn.disabled = true;
    btn.textContent = t('Cargando hoteles…');
    try {
      const p = filterParams();
      p.set('page', state.data.page + 1);
      const data = await api(`/api/hotels?${p}`);
      if (token !== searchToken) return;
      const fresh = data.results.filter((x) => !state.items.has(x.id));
      Object.assign(state.data, { page: data.page, hasMore: data.hasMore, total: data.total });
      state.data.results.push(...fresh);
      const checkIn = filters.checkIn.value;
      for (const item of fresh) {
        state.items.set(item.id, item);
        state.ui.set(item.id, initialUi(item, state.data, checkIn));
        btn.before(renderCard(item));
      }
      const shown = $('#shownCount');
      if (shown) shown.textContent = state.data.results.length;
      const prices = fresh.length && state.data.live ? loadLivePrices(token, fresh) : Promise.resolve();
      // Con fechas o precio máximo, el botón espera a saber cuáles están libres antes de volver.
      if (filtering()) {
        btn.textContent = t('Comprobando disponibilidad…');
        await Promise.race([prices, settled(fresh)]);
        if (token !== searchToken) return;
      }
      if (state.data.hasMore) btn.replaceWith(moreHotelsButton());
      else btn.remove();
      if (filtering()) prices.then(() => autoMore(token, fresh));
    } catch (err) {
      btn.disabled = false;
      btn.textContent = t('Ver más hoteles');
      toast(err.message);
    }
  });
  return btn;
}

function rerender(id) {
  const old = document.getElementById('card-' + id);
  const item = state.items.get(id);
  if (old) old.replaceWith(item.liveFlight ? liveFlightCard(item) : renderCard(item));
}

// Enlace a Google Maps: por coordenadas si las hay, si no por nombre y dirección.
function mapsUrl(item, address) {
  const query = Number.isFinite(item.lat) && Number.isFinite(item.lng)
    ? `${item.lat},${item.lng}`
    : [item.name, address || item.city].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function mapLink(item, text) {
  return `<a class="map-link" href="${esc(mapsUrl(item, text))}" target="_blank" rel="noopener" title="${esc(t('Ver en Google Maps'))}">${esc(text)}</a>`;
}

function renderCard(item) {
  const isFlight = state.view === 'flights';
  const ui = state.ui.get(item.id);
  const el = document.createElement('article');
  el.className = 'card';
  el.id = 'card-' + item.id;
  el.hidden = !passesStay(item);
  const s = item.summary;
  if (!isFlight) return renderHotelCard(el, item, ui);
  const head = isFlight
    ? `<div class="thumb">✈️</div><div>
        <h3>${esc(item.originCity)} → ${esc(item.destinationCity)}</h3>
        <div class="meta">${esc(item.airline)} · ${esc(item.origin)}–${esc(item.destination)} · ${t('sale {time}', { time: esc(item.departure) })} · ${Math.floor(item.duration / 60)} h ${item.duration % 60} min</div>
      </div>`
    : `${item.origin === 'liteapi' ? '<button type="button" class="open-hotel" data-act="info" aria-label="' + esc(t('Ver fotos y detalles')) + '">' : ''}${item.photo ? `<img class="thumb photo" src="${esc(item.photo)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;thumb&quot;>🏨</div>'">` : `<div class="thumb">${item.image}</div>`}${item.origin === 'liteapi' ? '</button>' : ''}<div>
        <h3>${item.origin === 'liteapi' ? `<button type="button" class="link-title" data-act="info">${esc(item.name)}</button>` : esc(item.name)}</h3>
        <div class="meta">${STAY_LABEL[item.stay] ? `<span class="stay-type">${t(STAY_LABEL[item.stay])}</span> · ` : ''}${item.stars ? `<span class="stars" aria-label="${t('{n} estrellas', { n: item.stars })}">${'★'.repeat(item.stars)}</span> · ` : ''}${esc(item.city)}, ${esc(item.country)}${item.rating ? ` · <span class="rating">${item.rating.toLocaleString(LOCALE)}</span>${item.reviewCount ? ` <span class="meta">(${tn(item.reviewCount, '{n} opinión', '{n} opiniones', { n: item.reviewCount.toLocaleString(LOCALE) })})</span>` : ''}` : ''}</div>
        ${item.address ? `<div class="meta">📍 ${mapLink(item, item.address)}${item.website ? ` · <a href="${esc(item.website)}" target="_blank" rel="noopener noreferrer">${t('Web oficial')} ↗</a>` : ''}</div>` : ''}
        <div class="tags">${item.origin === 'osm' ? `<a class="tag osm" href="${esc(item.source)}" target="_blank" rel="noopener noreferrer" title="${t('Ficha en OpenStreetMap')}">🗺️ OpenStreetMap</a>` : ''}${item.origin === 'ai' ? `<span class="tag osm" title="${t('Datos sugeridos por IA: compruébalos antes de viajar')}">✨ ${t('Sugerido por IA')}</span>` : ''}${item.tags.map((x) => `<span class="tag">${esc(t(x))}</span>`).join('')}${(item.facilities || []).map((k) => facilityInfo()[k]).filter(Boolean).map((f) => `<span class="tag fac" title="${esc(t(f.label))}">${f.icon} ${esc(t(f.label))}</span>`).join('')}</div>
      </div>`;
  el.innerHTML = `
    <div>
      <div class="card-head">${head}</div>
      ${isFlight ? '' : `<p class="desc">${esc(item.description)}</p>`}
      <div class="stats">
        <span>${t('Desde')} <b>${s.minPrice != null ? eur(s.minPrice) : '—'}</b></span>
        <span>${t('Media')} <b>${s.avgPrice != null ? eur(s.avgPrice) : '—'}</b></span>
        <span>${t('Días libres')} <b>${s.freeDays}/${item.calendar.length}</b></span>
      </div>
      ${renderChart(item, ui, isFlight)}
    </div>
    <div>
      ${renderCalendar(item, ui)}
      <div class="selection">${selectionText(item, ui, isFlight)}</div>
      <div class="card-actions">
        ${!isFlight && item.bestStay ? `<button class="btn" data-act="best">💡 ${t('Días más baratos ({n} noches)', { n: state.data.nights })}</button>` : ''}
        <button class="btn primary" data-act="book" ${canBook(ui, isFlight) ? '' : 'disabled'}>${t('Reservar')}</button>
      </div>
    </div>`;
  bindCard(el, item, isFlight);
  return el;
}

// «Buen precio»: la mejor noche cuesta al menos un 20 % menos que la mediana de los hoteles con sus mismas
// estrellas en esta búsqueda, y está entre los 3 con más diferencia.
function goodPrice(item) {
  const list = (state.data.results || []).filter((h) => h.bestStay);
  const nights = state.data.nights;
  const night = (h) => h.bestStay.total / nights;
  const score = (h) => {
    const peers = list.filter((p) => p !== h && (p.stars || 0) === (h.stars || 0) && (!state.data.live?.mixed || p.city === h.city)).map(night).sort((a, b) => a - b);
    if (peers.length < 3) return Infinity;
    return night(h) / peers[Math.floor(peers.length / 2)];
  };
  const mine = item.bestStay ? score(item) : Infinity;
  if (!(mine <= 0.8)) return false;
  return list.filter((h) => score(h) < mine).length < 3;
}

// Ficha de hotel: foto grande, datos y cifras en el centro, calendario y «Mejor opción» a la derecha;
// la gráfica de precios queda plegada en «Ver evolución de precios».
function renderHotelCard(el, item, ui) {
  const s = item.summary;
  const live = item.origin === 'liteapi';
  el.classList.add('hotel-card');
  const nights = state.data.nights;
  const best = item.bestStay;
  const bestNight = best ? Math.round(best.total / nights) : null;
  const ratio = bestNight && s.avgPrice ? bestNight / s.avgPrice : 1;
  const insight = ratio <= 0.75 ? t('Precio muy por debajo de la media') : ratio <= 0.85 ? t('Precio por debajo de la media') : '';
  // Etiqueta solo cuando hay una diferencia importante:
  // 🔥 ver goodPrice() (solo los 3 más destacados de la búsqueda, para que la etiqueta signifique algo);
  // 💰 elegir bien los días ahorra mucho: la mejor estancia sale un 30 % por debajo de su precio medio por noche.
  const badge = goodPrice(item) ? `🔥 ${t('Buen precio')}`
    : bestNight && s.avgPrice && bestNight <= s.avgPrice * 0.7 ? `💰 ${t('Entre los días más baratos')}` : '';
  const picked = canBook(ui, false);
  const pickedTotal = picked ? stayDays(item, ui).reduce((a, d) => a + d.price, 0) : null;
  const photo = item.photo
    ? `<img class="hotel-photo" src="${esc(item.photo)}" alt="${esc(item.name)}" loading="lazy" onerror="this.outerHTML='<div class=&quot;hotel-photo empty&quot;>🏨</div>'">`
    : `<div class="hotel-photo empty">${item.image || '🏨'}</div>`;
  const facilities = (item.facilities || []).map((k) => facilityInfo()[k]).filter(Boolean);
  el.innerHTML = `
    <div class="hotel-media">${live ? `<button type="button" class="open-hotel" data-act="info" aria-label="${esc(t('Ver fotos y detalles'))}">${photo}</button>` : photo}${badge ? `<span class="deal-badge">${badge}</span>` : ''}</div>
    <div class="hotel-info">
      <h3>${live ? `<button type="button" class="link-title" data-act="info">${esc(item.name)}</button>` : esc(item.name)}${item.stars ? ` <span class="stars" aria-label="${t('{n} estrellas', { n: item.stars })}">${'★'.repeat(item.stars)}</span>` : ''}</h3>
      <div class="meta">${STAY_LABEL[item.stay] ? `<span class="stay-type">${t(STAY_LABEL[item.stay])}</span> · ` : ''}${item.rating ? `<span class="rating">${item.rating.toLocaleString(LOCALE)}</span>${item.reviewCount ? ` ${tn(item.reviewCount, '{n} opinión', '{n} opiniones', { n: item.reviewCount.toLocaleString(LOCALE) })}` : ''}` : `${esc(item.city)}, ${esc(item.country)}`}</div>
      <div class="meta">📍 ${item.address ? mapLink(item, item.address) : `${esc(item.city)}, ${esc(item.country)}`}${item.website ? ` · <a href="${esc(item.website)}" target="_blank" rel="noopener noreferrer">${t('Web oficial')} ↗</a>` : ''}</div>
      ${item.tags.length || item.origin !== 'liteapi' ? `<div class="tags">${item.origin === 'osm' ? `<a class="tag osm" href="${esc(item.source)}" target="_blank" rel="noopener noreferrer" title="${t('Ficha en OpenStreetMap')}">🗺️ OpenStreetMap</a>` : ''}${item.origin === 'ai' ? `<span class="tag osm" title="${t('Datos sugeridos por IA: compruébalos antes de viajar')}">✨ ${t('Sugerido por IA')}</span>` : ''}${item.tags.map((x) => `<span class="tag">${esc(t(x))}</span>`).join('')}</div>` : ''}
      ${item.description ? `<p class="desc">${esc(item.description)}</p>` : ''}
      ${facilities.length ? `<ul class="fac-list">${facilities.slice(0, 6).map((f) => `<li title="${esc(t(f.label))}"><span aria-hidden="true">${f.icon}</span> ${esc(t(f.label))}</li>`).join('')}</ul>` : ''}
      <div class="stat-boxes">
        <div class="stat-box hi"><b>${s.minPrice != null ? eur(s.minPrice) : '—'}</b><span>${t('Desde')}</span></div>
        <div class="stat-box"><b>${s.avgPrice != null ? eur(s.avgPrice) : '—'}</b><span>${t('Media')}</span></div>
        <div class="stat-box"><b>${s.freeDays}/${item.calendar.length}</b><span>${t('Días libres')}</span></div>
      </div>
      ${insight ? `<p class="insight">📉 ${insight}</p>` : ''}
    </div>
    <div class="hotel-cal">
      ${renderCalendar(item, ui)}
      <div class="selection">${selectionText(item, ui, false)}</div>
    </div>
    <div class="hotel-panel">
      ${picked && !(best && ui.start === best.checkIn && ui.end === best.checkOut) ? `<div class="best-box on">
        <span class="best-title">🗓️ ${t('Tu estancia')}</span>
        <span class="best-dates">${fmtShort.format(toDate(ui.start))} → ${fmtShort.format(toDate(ui.end))}</span>
        <span class="best-night">${t('{price}/noche', { price: eur(Math.round(pickedTotal / diffDays(ui.start, ui.end))) })}</span>
        <span>${t('{price} total', { price: eur(pickedTotal) })} (${tn(diffDays(ui.start, ui.end), '{n} noche', '{n} noches')})</span>
      </div>` : best ? `<button type="button" class="best-box${picked ? ' on' : ''}" data-act="best">
        <span class="best-title">⭐ ${t('Mejor opción')}</span>
        <span class="best-dates">${fmtShort.format(toDate(best.checkIn))} → ${fmtShort.format(toDate(best.checkOut))}</span>
        <span class="best-night">${t('{price}/noche', { price: eur(bestNight) })}</span>
        <span>${t('{price} total', { price: eur(best.total) })} (${tn(nights, '{n} noche', '{n} noches')})</span>
      </button>` : ''}
      <button class="btn primary book-btn" data-act="book" ${picked || best ? '' : 'disabled'}>${picked ? t('Reservar por {price} →', { price: eur(pickedTotal) }) : best ? t('Reservar por {price} →', { price: eur(best.total) }) : t('Reservar')}</button>
      <button type="button" class="btn ghost history-btn" data-act="history" aria-expanded="${!!ui.historyOpen}">📈 ${t('Ver evolución de precios')}</button>
      ${live ? `<button type="button" class="link-title small details-link" data-act="info">${t('Ver detalles del hotel')} →</button>` : ''}
    </div>
    ${ui.historyOpen ? `<div class="hotel-chart">${renderChart(item, ui, false)}</div>` : ''}`;
  bindCard(el, item, false);
  return el;
}

const canBook = (ui, isFlight) => (isFlight ? !!ui.start : !!(ui.start && ui.end));

function selectionText(item, ui, isFlight) {
  if (isFlight) {
    if (!ui.start) return t('Toca un día <b>verde</b> para elegir la fecha del vuelo.');
    const d = item.calendar.find((x) => x.date === ui.start);
    return t('Vuelo el <b>{day}</b> · {price} · quedan {n} plazas', { day: fmtDay.format(toDate(ui.start)), price: eur(d.price), n: d.left });
  }
  if (!ui.start) return t('Toca un día <b>verde</b> para la entrada; después, el día de salida.');
  if (!ui.end) return t('Entrada <b>{day}</b>. Ahora elige el día de salida.', { day: fmtDay.format(toDate(ui.start)) });
  const nights = diffDays(ui.start, ui.end);
  const total = stayDays(item, ui).reduce((a, d) => a + d.price, 0);
  return `<b>${fmtShort.format(toDate(ui.start))} → ${fmtShort.format(toDate(ui.end))}</b> · ${tn(nights, '{n} noche', '{n} noches')} · <b>${eur(total)}</b>`;
}

function stayDays(item, ui) {
  const i = diffDays(state.data.start, ui.start);
  return item.calendar.slice(i, i + diffDays(ui.start, ui.end));
}

function monthIndex(start, iso) {
  const a = toDate(start), b = toDate(iso);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
}

function renderCalendar(item, ui) {
  const start = state.data.start;
  const cal = item.calendar;
  const end = cal[cal.length - 1].date;
  const months = monthIndex(start, end) + 1;
  const first = toDate(start);
  const mDate = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + ui.month, 1));
  const byDate = new Map(cal.map((d) => [d.date, d]));
  const cheapest = Math.min(...cal.filter((d) => d.available).map((d) => d.price));
  const offset = (mDate.getUTCDay() + 6) % 7; // lunes primero
  const daysInMonth = new Date(Date.UTC(mDate.getUTCFullYear(), mDate.getUTCMonth() + 1, 0)).getUTCDate();

  let cells = DOW.map((d) => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < offset; i++) cells += '<div class="day blank"></div>';
  for (let n = 1; n <= daysInMonth; n++) {
    const iso = new Date(Date.UTC(mDate.getUTCFullYear(), mDate.getUTCMonth(), n)).toISOString().slice(0, 10);
    const d = byDate.get(iso);
    if (!d) { cells += `<div class="day out"><span>${n}</span></div>`; continue; }
    const cls = ['day', d.pending ? 'pending' : d.available ? 'free' : 'full'];
    if (d.available && d.price === cheapest) cls.push('cheap');
    if (ui.start && (iso === ui.start || iso === ui.end)) cls.push('sel');
    else if (ui.start && ui.end && iso > ui.start && iso < ui.end) cls.push('in-range');
    const label = `${fmtDay.format(toDate(iso))}: ${d.pending ? t('cargando precio') : d.available ? t('libre, {price} €', { price: d.price }) : item.liveFlight ? t('sin vuelo') : t('completo')}`;
    cells += `<button class="${cls.join(' ')}" data-date="${iso}" aria-label="${label}"><span>${n}</span><small>${d.pending ? '…' : d.available ? d.price : '—'}</small></button>`;
  }
  return `<div class="cal">
    <div class="cal-head">
      <button data-act="prev" aria-label="${t('Mes anterior')}" ${ui.month <= 0 ? 'disabled' : ''}>‹</button>
      <strong>${cap(fmtMonth.format(mDate))}</strong>
      <button data-act="next" aria-label="${t('Mes siguiente')}" ${ui.month >= months - 1 ? 'disabled' : ''}>›</button>
    </div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-legend">
      <span><i style="background:var(--good-bg);outline:1px solid var(--good)"></i>${t('Libre (precio €)')}</span>
      <span><i style="background:var(--bad-bg);outline:1px solid var(--bad)"></i>${item.liveFlight ? t('Sin plazas o no vuela') : t('Completo')}</span>
      <span>★ ${t('Más barato')}</span>
    </div>
  </div>`;
}

function renderChart(item, ui, isFlight, title) {
  const cal = item.calendar;
  const n = cal.length;
  const prices = cal.filter((d) => d.price != null).map((d) => d.price);
  const max = prices.length ? Math.ceil(Math.max(...prices) / 20) * 20 : 100;
  const W = n * 10, H = 100, gap = 2;
  const free = cal.filter((d) => d.available);
  const cheap = free.length ? free.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const inSel = (iso) => ui.start && (isFlight ? iso === ui.start : ui.end ? iso >= ui.start && iso < ui.end : iso === ui.start);
  const hasSel = !!ui.start;
  let bars = '';
  cal.forEach((d, i) => {
    if (d.price == null) return; // aún sin precio, o completo sin tarifa
    const h = Math.max(2, (d.price / max) * H);
    const cls = ['bar'];
    if (!d.available) cls.push('full');
    if (hasSel && !inSel(d.date)) cls.push('dim');
    // Barras con extremo superior redondeado (4px) y anclado a la base.
    bars += `<rect class="${cls.join(' ')}" x="${i * 10 + gap / 2}" y="${H - h}" width="${10 - gap}" height="${h}" rx="1.5" data-i="${i}"/>`;
  });
  const grid = [0.5, 1].map((f) => `<line class="grid" x1="0" x2="${W}" y1="${H - f * H}" y2="${H - f * H}"/>`).join('');
  const ci = cheap ? cal.indexOf(cheap) : -1;
  const cheapLabel = cheap
    ? `<span class="cheap-label" style="left:${((ci + 0.5) / n) * 100}%;top:${100 - (cheap.price / max) * 100}%">▼ ${eur(cheap.price)}</span>`
    : '';
  return `<div class="chart-wrap">
    <div class="chart-title">
      <span><strong>${title || (isFlight ? t('Precio por billete') : t('Precio por noche'))}</strong> · ${t('{n} días', { n })}</span>
      <span class="legend"><span><i style="background:var(--series-1)"></i>${t('Libre')}</span><span><i style="background:var(--muted-bar)"></i>${t('Completo')}</span></span>
    </div>
    <div class="chart">
      <div class="yaxis"><span>${max} €</span><span>${max / 2} €</span><span></span></div>
      <div class="plot">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${cheap ? t('Gráfica de precios diarios. Mínimo {price} el {date}.', { price: eur(cheap.price), date: fmtShort.format(toDate(cheap.date)) }) : t('Gráfica de precios diarios. Sin días libres.')}">${grid}${bars}</svg>
        ${cheapLabel}
      </div>
      <div class="xaxis"><span>${fmtShort.format(toDate(cal[0].date))}</span><span>${fmtShort.format(toDate(cal[Math.floor(n / 2)].date))}</span><span>${fmtShort.format(toDate(cal[n - 1].date))}</span></div>
    </div>
  </div>`;
}

// ---------- Interacción ----------
function bindCard(el, item, isFlight) {
  const ui = state.ui.get(item.id);
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'prev' || act === 'next') { ui.month += act === 'next' ? 1 : -1; return rerender(item.id); }
    if (act === 'best') {
      const b = item.bestStay;
      Object.assign(ui, { start: b.checkIn, end: b.checkOut, picking: 'start', month: monthIndex(state.data.start, b.checkIn) });
      return rerender(item.id);
    }
    if (act === 'book') {
      // Ficha de hotel sin fechas elegidas: «Reservar por…» reserva la mejor opción.
      if (!isFlight && !canBook(ui, false) && item.bestStay) {
        const b = item.bestStay;
        Object.assign(ui, { start: b.checkIn, end: b.checkOut, picking: 'start', month: monthIndex(state.data.start, b.checkIn) });
        rerender(item.id);
      }
      return openBooking(item, ui, isFlight);
    }
    if (act === 'info') return openHotel(item);
    if (act === 'history') { ui.historyOpen = !ui.historyOpen; return rerender(item.id); }
    const day = e.target.closest('.day[data-date]');
    if (day) pickDay(item, ui, day.dataset.date, isFlight);
  });

  // Ficha de hotel: la gráfica solo se pinta al pulsar «Ver evolución de precios».
  if ($('.plot', el)) bindChart(el, item, isFlight, (d) => {
    ui.month = monthIndex(state.data.start, d.date);
    pickDay(item, ui, d.date, isFlight);
  });

  el.addEventListener('pointerover', (e) => {
    const day = e.target.closest('.day[data-date]');
    if (!day) return;
    const d = item.calendar.find((x) => x.date === day.dataset.date);
    const r = day.getBoundingClientRect();
    showTip(`<b>${fmtDay.format(toDate(d.date))}</b><br>${dayText(d, isFlight)}`, r.left + r.width / 2, r.top);
  });
  el.addEventListener('pointerout', (e) => { if (e.target.closest('.day[data-date]')) hideTip(); });
}

// Gráfica: el precio de cada día al pasar el ratón; al pulsar, onPick(día).
function bindChart(el, item, isFlight, onPick) {
  const plot = $('.plot', el);
  const svg = $('svg', el);
  const locate = (e) => {
    const r = svg.getBoundingClientRect();
    const i = Math.floor(((e.clientX - r.left) / r.width) * item.calendar.length);
    return Math.min(item.calendar.length - 1, Math.max(0, i));
  };
  let hovered = null;
  plot.addEventListener('pointermove', (e) => {
    const i = locate(e);
    const d = item.calendar[i];
    hovered?.classList.remove('hover');
    hovered = svg.querySelector(`[data-i="${i}"]`);
    hovered?.classList.add('hover');
    showTip(`<b>${fmtDay.format(toDate(d.date))}</b><br>${dayText(d, isFlight)}`, e.clientX, svg.getBoundingClientRect().top);
  });
  plot.addEventListener('pointerleave', () => { hovered?.classList.remove('hover'); hideTip(); });
  plot.addEventListener('click', (e) => {
    const d = item.calendar[locate(e)];
    hideTip();
    onPick(d);
  });
}

function dayText(d, isFlight) {
  if (d.pending) return t('Cargando precio…');
  if (d.error) return t('No se pudo consultar ese día');
  if (d.noFlight) return t('Sin plazas o no vuela ese día');
  if (!d.available) return d.price != null ? `${eur(d.price)} · ${t('completo')}` : t('Completo');
  return `${eur(d.price)} · ${d.left != null ? (isFlight ? t('quedan {n} plazas', { n: d.left }) : t('quedan {n} hab.', { n: d.left })) : t('disponible')}`;
}

function pickDay(item, ui, iso, isFlight) {
  const cal = item.calendar;
  const idx = diffDays(state.data.start, iso);
  const d = cal[idx];
  if (d.pending || (ui.picking === 'end' && ui.start && iso > ui.start && cal.slice(diffDays(state.data.start, ui.start), idx).some((x) => x.pending))) {
    return toast(t('Todavía estamos cargando los precios de esos días.'));
  }
  if (isFlight) {
    if (!d.available) return toast(d.error ? t('No se pudo consultar ese día. Búscalo con la fecha de ida.') : t('Ese día este vuelo no tiene plazas o no vuela.'));
    ui.start = iso;
    return rerender(item.id);
  }
  // Segundo clic: día de salida (puede ser un día completo, porque esa noche no se duerme).
  if (ui.picking === 'end' && ui.start && iso > ui.start) {
    const nights = cal.slice(diffDays(state.data.start, ui.start), idx);
    if (nights.length > 30) return toast(t('Máximo 30 noches por reserva.'));
    if (nights.every((x) => x.available)) {
      ui.end = iso;
      ui.picking = 'start';
      return rerender(item.id);
    }
    if (!d.available) return toast(t('Hay noches completas entre esas fechas.'));
  }
  if (!d.available) return toast(t('Ese día está completo. Elige un día verde.'));
  ui.start = iso;
  ui.picking = 'end';
  // Sugerimos la salida según las noches indicadas, si están libres.
  const n = state.data.nights;
  const slice = cal.slice(idx, idx + n);
  ui.end = slice.length === n && slice.every((x) => x.available) ? addDays(iso, n) : null;
  rerender(item.id);
}

// ---------- Ficha del hotel y de cada habitación ----------
const gallery = (photos) => (photos?.length ? `<div class="gallery">${photos.map((u) => `<img src="${esc(u)}" alt="" loading="lazy" />`).join('')}</div>` : '');
const paragraphs = (text) => String(text || '').split(/\n+/).filter((x) => x.trim()).map((x) => `<p>${esc(x)}</p>`).join('');
const chips = (list) => (list?.length ? `<div class="chips">${list.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : '');

function roomHtml(r) {
  const facts = [r.size, r.maxOccupancy ? tn(r.maxOccupancy, 'hasta {n} persona', 'hasta {n} personas') : '', r.beds].filter(Boolean).join(' · ');
  return `${gallery(r.photos)}<h3>${esc(r.name)}</h3>${facts ? `<p class="meta">${esc(facts)}</p>` : ''}${paragraphs(r.description)}${chips(r.amenities)}`;
}

async function openHotel(item) {
  const dlg = $('#hotelDialog');
  const body = $('#hotelBody');
  body.innerHTML = `<h2>${esc(item.name)}</h2><p class="meta">${t('Cargando…')}</p>`;
  $('#hotelDates').onclick = () => {
    dlg.close();
    document.getElementById('card-' + item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  dlg.showModal();
  try {
    const d = await hotelDetails(item.id);
    const times = [d.checkin ? t('Entrada desde las {time}', { time: d.checkin }) : '', d.checkout ? t('Salida hasta las {time}', { time: d.checkout }) : ''].filter(Boolean).join(' · ');
    body.innerHTML = `<h2>${esc(d.name)}</h2>
      <p class="meta">${STAY_LABEL[item.stay] ? esc(t(STAY_LABEL[item.stay])) + ' · ' : ''}${item.stars ? '★'.repeat(item.stars) + ' · ' : ''}${mapLink({ ...item, ...(d.location || {}) }, d.address || item.address || item.city)}${item.rating ? ` · ${item.rating.toLocaleString(LOCALE)}/10` : ''}</p>
      ${gallery(d.photos)}
      ${times ? `<p class="meta">🕑 ${esc(times)}</p>` : ''}
      ${paragraphs(d.description)}
      ${d.facilities?.length ? `<h3>${t('Servicios')}</h3>${chips(d.facilities)}` : ''}
      ${d.rooms?.length ? `<h3>${t('Habitaciones')}</h3>${d.rooms.map((r) => `<div class="room-card">${roomHtml(r)}</div>`).join('')}` : ''}
      ${d.important ? `<details><summary>${t('Información importante')}</summary>${paragraphs(d.important)}</details>` : ''}
      <p><a href="${esc(mapsUrl({ ...item, ...(d.location || {}) }, d.address || item.address))}" target="_blank" rel="noopener">📍 ${t('Ver en Google Maps')}</a></p>`;
  } catch (e) {
    body.innerHTML = `<h2>${esc(item.name)}</h2><p class="error">${esc(e.message)}</p>`;
  }
}

function openRoom(r) {
  $('#roomBody').innerHTML = roomHtml(r);
  $('#roomDialog').showModal();
}
for (const dlg of [$('#hotelDialog'), $('#roomDialog')]) {
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
}

// ---------- Reserva ----------
const dialog = $('#bookDialog');
const bookForm = $('#bookForm');

function bookingRequest() {
  const b = state.booking;
  const g = state.data.guests || {};
  const base = { type: b.isFlight ? 'flight' : 'hotel', itemId: b.item.id, units: bookForm.units.value, adults: g.adults, children: g.children, board: state.data.board || undefined, room: b.room || undefined };
  return b.isFlight ? { ...base, date: b.start } : { ...base, checkIn: b.start, checkOut: b.end };
}

async function refreshQuote() {
  const err = $('#bookError');
  const btn = $('#bookConfirm');
  try {
    let q;
    try {
      q = await api('/api/quote', { method: 'POST', body: JSON.stringify(bookingRequest()) });
    } catch (e) {
      // La habitación elegida ya no está (o no hay para tantas habitaciones): se vuelve a la más barata.
      if (!state.booking.room) throw e;
      state.booking.room = null;
      q = await api('/api/quote', { method: 'POST', body: JSON.stringify(bookingRequest()) });
    }
    state.booking.quote = q;
    state.booking.room = q.room || null;
    showOffer(q);
    renderRooms(q);
    err.hidden = true;
    btn.disabled = !!state.bookingBlocked;
  } catch (e) {
    $('#bookTotal').textContent = '—';
    $('#roomBox').hidden = true;
    err.textContent = e.message;
    err.hidden = false;
    btn.disabled = true;
  }
}

// Precio y condiciones de la habitación elegida.
function showOffer(q) {
  $('#bookTotal').textContent = eur2(q.total);
  state.booking.total = q.total;
  const extra = $('#bookExtra');
  extra.textContent = q.roomName
    ? `${q.roomName}${q.board ? ' · ' + t(q.board) : ''} · ${cancelText(q)}`
    : '';
  // Tasas que no van en el total y se pagan en el hotel (p. ej. tasa turística).
  if (q.payAtHotel?.length) extra.textContent += ' · ' + t('además, a pagar en el hotel: {list}', { list: payAtHotelText(q.payAtHotel) });
  extra.hidden = !q.roomName;
}
const cancelText = (o) => (o.refundable ? (o.freeCancellationUntil ? t('cancelación gratuita hasta el {day}', { day: fmtDay.format(new Date(o.freeCancellationUntil.replace(' ', 'T') + 'Z')) }) : t('cancelación gratuita')) : t('no reembolsable'));

// Ficha del hotel (se pide una vez por hotel).
const detailCache = new Map();
function hotelDetails(id) {
  if (!detailCache.has(id)) detailCache.set(id, api(`/api/live/hotel/${encodeURIComponent(id)}`).catch((e) => { detailCache.delete(id); throw e; }));
  return detailCache.get(id);
}

// Habitaciones disponibles para elegir, con su foto y sus datos.
async function renderRooms(q) {
  const box = $('#roomBox');
  const offers = q.offers || [];
  if (offers.length < 2 && !offers[0]?.roomId) { box.hidden = true; return; }
  const item = state.booking.item;
  const details = await hotelDetails(item.id).catch(() => null);
  if (state.booking?.quote !== q) return;
  const roomById = new Map((details?.rooms || []).map((r) => [r.id, r]));
  box.innerHTML = `<p class="room-title">${t('Elige la habitación')}</p>` + offers.map((o, i) => {
    const r = roomById.get(o.roomId);
    const photo = r?.photos?.[0];
    const facts = r ? [r.size, r.maxOccupancy ? tn(r.maxOccupancy, 'hasta {n} persona', 'hasta {n} personas') : '', r.beds].filter(Boolean).join(' · ') : '';
    return `<label class="room-opt">
      <input type="radio" name="room" value="${esc(o.key)}" ${o.key === q.room ? 'checked' : ''} />
      ${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" />` : '<span class="room-ph">🛏️</span>'}
      <span class="room-info"><b>${esc(o.roomName || t('Habitación'))}</b>
        <span class="meta">${[o.board ? t(o.board) : '', cancelText(o)].filter(Boolean).map(esc).join(' · ')}</span>
        ${facts ? `<span class="meta">${esc(facts)}</span>` : ''}
        ${r ? `<button type="button" class="link-title small" data-room="${i}">${t('Ver fotos y detalles')}</button>` : ''}
      </span>
      <span class="room-price">${eur2(o.total)}</span>
    </label>`;
  }).join('');
  box.hidden = false;
  box.onchange = (e) => {
    const o = offers.find((x) => x.key === e.target.value);
    if (!o) return;
    state.booking.room = o.key;
    showOffer({ ...o, room: o.key });
  };
  box.onclick = (e) => {
    const b = e.target.closest('[data-room]');
    if (!b) return;
    e.preventDefault();
    const r = roomById.get(offers[Number(b.dataset.room)].roomId);
    if (r) openRoom(r);
  };
}

function openBooking(item, ui, isFlight) {
  state.booking = { item, isFlight, start: ui.start, end: ui.end, room: null };
  $('#roomBox').hidden = true;
  $('#bookTitle').textContent = isFlight ? t('Reservar vuelo') : t('Reservar hotel');
  $('#unitsLabel').textContent = isFlight ? t('Pasajeros') : t('Habitaciones');
  $('#bookSummary').innerHTML = isFlight
    ? `<b>${esc(item.airline)}</b> ${esc(item.originCity)} → ${esc(item.destinationCity)}<br>${fmtDay.format(toDate(ui.start))} · ${t('sale {time}', { time: esc(item.departure) })}`
    : `<b>${esc(item.name)}</b> · ${esc(item.city)}<br>${fmtDay.format(toDate(ui.start))} → ${fmtDay.format(toDate(ui.end))} (${tn(diffDays(ui.start, ui.end), '{n} noche', '{n} noches')})${item.origin === 'liteapi' && state.data.guests ? `<br>${t('{guests} por habitación', { guests: guestsText(state.data.guests) })}` : ''}`;
  bookForm.units.value = '1';
  bookForm.terms.checked = false;
  bookForm.email.value ||= store.get('dl-email') || '';
  $('#bookError').hidden = true;
  $('#bookTotal').textContent = '…';
  $('#bookExtra').hidden = true;
  state.bookingBlocked = !isFlight && item.origin === 'liteapi' && state.data.live?.bookingEnabled === false;
  state.booking.pays = !isFlight && item.origin === 'liteapi' && state.data.live?.payment === 'customer';
  $('#bookConfirm').hidden = state.bookingBlocked;
  $('#bookConfirm').textContent = state.booking.pays ? t('Pagar y reservar') : t('Confirmar reserva');
  $('#bookNote').textContent = item.origin !== 'liteapi'
    ? t('Reserva de prueba: no se envía al hotel ni a la aerolínea.')
    : state.data.live?.sandbox
      ? t('Entorno de pruebas: la reserva es de prueba y no se cobra nada.')
      : t('Pago seguro con tarjeta. La reserva se confirma al completar el pago.');
  showPayForm(false);
  if (state.bookingBlocked) {
    $('#bookSummary').insertAdjacentHTML('beforeend', `<br><span class="meta">${t('Precio real de hoy. En esta demostración no se puede reservar.')}</span>`);
  }
  dialog.showModal();
  refreshQuote();
}
bookForm.units.addEventListener('change', refreshQuote);

$('#bookCancel').addEventListener('click', () => dialog.close());
// ---------- Pago con tarjeta (pasarela de LiteAPI) ----------
const PAYMENT_SDK = 'https://payment-wrapper.liteapi.travel/dist/liteAPIPayment.js?v=a1';
let sdkPromise;
function loadPaymentSdk() {
  sdkPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PAYMENT_SDK;
    s.onload = () => (window.LiteAPIPayment ? resolve() : reject(new Error('sdk')));
    s.onerror = () => reject(new Error('sdk'));
    document.head.append(s);
  }).catch((e) => { sdkPromise = null; throw e; });
  return sdkPromise;
}

// Oculta los datos del cliente y muestra el formulario de tarjeta (o al revés).
function showPayForm(on) {
  for (const el of bookForm.querySelectorAll('label, #bookNote')) el.hidden = on;
  if (on) $('#roomBox').hidden = true;
  $('#payBox').hidden = !on;
  $('#bookConfirm').hidden = on || state.bookingBlocked;
  if (!on) $('#paymentElement').innerHTML = '';
}

async function startPayment() {
  const co = await api('/api/checkout', {
    method: 'POST',
    body: JSON.stringify({ ...bookingRequest(), expectedTotal: state.booking.total, name: bookForm.name.value, email: bookForm.email.value }),
  });
  store.set('dl-email', bookForm.email.value.trim());
  $('#payHint').innerHTML = t('Total a pagar: <b>{total}</b>', { total: eur2(co.total) }) + ' · ' + t('código {code}', { code: esc(co.code) }) +
    (co.publicKey === 'sandbox' ? '<br>' + t('Entorno de pruebas: usa la tarjeta <b>4242 4242 4242 4242</b>, cualquier fecha futura y cualquier CVC.') : '');
  showPayForm(true);
  try {
    await loadPaymentSdk();
  } catch {
    showPayForm(false);
    throw new Error(t('No se pudo cargar el formulario de pago. Revisa tu conexión e inténtalo de nuevo.'));
  }
  // La pasarela muestra el formulario de tarjeta y, al pagar, vuelve a returnUrl.
  new window.LiteAPIPayment({
    publicKey: co.publicKey,
    appearance: { theme: 'flat' },
    options: { business: { name: 'DíasLibres' } },
    targetElement: '#paymentElement',
    secretKey: co.secretKey,
    returnUrl: co.returnUrl,
  }).handlePayment();
}

// Al volver de pagar: /?pago=<id> → confirmar la reserva.
async function finishPayment(id) {
  history.replaceState(null, '', location.pathname);
  toast(t('Confirmando tu reserva…'));
  try {
    const b = await api(`/api/checkout/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: '{}' });
    toast(`✅ ${t('Pago recibido.')} ${b.sandbox ? t('Reserva de prueba confirmada') : t('Reserva confirmada')} · ${t('código {code}', { code: b.code })} · ${eur2(b.total)}`);
    rememberBooking(b);
    setView('mine');
  } catch (err) {
    toast(err.message);
  }
}

onSend(bookForm, async () => {
  const btn = $('#bookConfirm');
  btn.disabled = true;
  btn.textContent = state.booking.pays ? t('Preparando el pago…') : t('Reservando…');
  if (state.booking.pays) {
    try {
      await startPayment();
    } catch (err) {
      if (err.body?.newTotal != null) await refreshQuote();
      $('#bookError').textContent = err.message;
      $('#bookError').hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = t('Pagar y reservar');
    }
    return;
  }
  try {
    const booking = await api('/api/bookings', {
      method: 'POST',
      body: JSON.stringify({ ...bookingRequest(), expectedTotal: state.booking.total, name: bookForm.name.value, email: bookForm.email.value }),
    });
    store.set('dl-email', booking.email);
    dialog.close();
    toast(`✅ ${booking.sandbox ? t('Reserva de prueba confirmada') : t('Reserva confirmada')} · ${t('código {code}', { code: booking.code })} · ${eur(booking.total)}`);
    rememberBooking(booking);
    await search();
  } catch (err) {
    if (err.body?.newTotal != null) await refreshQuote(); // muestra el total nuevo
    const box = $('#bookError');
    box.textContent = err.message;
    box.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = t('Confirmar reserva');
  }
});

const payAtHotelText = (list) =>
  list.map((t) => `${t.description} ${Number(t.amount).toLocaleString(LOCALE, { style: 'currency', currency: t.currency || 'EUR' })}`).join(', ');

// Cancelar ya no devuelve el dinero: tarifa no reembolsable o pasado el plazo gratuito.
const noRefund = (b) =>
  b.provider === 'liteapi' &&
  (!b.refundable || (b.freeCancellationUntil && Date.now() > Date.parse(b.freeCancellationUntil.replace(' ', 'T') + 'Z')));

// ---------- Vuelos reales (LiteAPI) ----------
const hhmm = (iso) => String(iso || '').slice(11, 16);
const dur = (m) => (m == null ? '' : `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`);
const stopsText = (n) => (n === 0 ? t('directo') : tn(n, '{n} escala', '{n} escalas'));
function legText(leg) {
  if (!leg) return '';
  return `${hhmm(leg.departure)} ${esc(leg.from)} → ${hhmm(leg.arrival)} ${esc(leg.to)}${leg.dayChange ? ` (+${leg.dayChange})` : ''} · ${stopsText(leg.stops)}`;
}

async function searchLiveFlights(token) {
  results.classList.add('loading');
  const origin = filters.origin.value.trim();
  const destination = filters.destination.value.trim();
  if (origin && destination) results.innerHTML = `<p class="count">${t('Buscando vuelos de {from} a {to}…', { from: esc(origin), to: esc(destination) })}</p>`;
  try {
    const p = new URLSearchParams({ origin, destination, adults: filters.passengers.value });
    for (const k of ['date', 'returnDate', 'maxPrice', 'stops']) if (filters[k].value) p.set(k, filters[k].value);
    const data = await api(`/api/flights?${p}`);
    if (token !== searchToken) return;
    state.data = data;
    if (!filters.date.value && !data.needRoute) filters.date.value = data.date;
    renderFlightResults(data, token);
  } catch (err) {
    if (token === searchToken) results.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
  } finally {
    results.classList.remove('loading');
  }
}

// ---------- Vuelo + hotel ----------
// Al buscar o reservar un vuelo se proponen hoteles en el destino para esas fechas.
// Son dos reservas independientes, cada una con su pago (no es un viaje combinado).
function tripHotelBox({ city, checkIn, checkOut, adults }) {
  if (!city || !checkIn) return null;
  const nights = Math.max(1, Math.min(30, checkOut && checkOut > checkIn ? diffDays(checkIn, checkOut) : 3));
  const el = document.createElement('div');
  el.className = 'trip-hotel';
  el.style.cssText = 'display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:12px 16px;margin:12px 0;border:1px solid rgba(127,127,127,.35);border-radius:12px';
  el.innerHTML = `<span>🏨 <b>${esc(t('¿Necesitas hotel en {city}?', { city }))}</b> <span class="meta">${esc(fmtDay.format(toDate(checkIn)))} · ${esc(tn(nights, '{n} noche', '{n} noches'))}</span></span><button class="btn primary" type="button">${esc(t('Ver hoteles'))}</button>`;
  $('button', el).addEventListener('click', () => hotelsForTrip({ city, checkIn, nights, adults }));
  return el;
}
function hotelsForTrip({ city, checkIn, nights, adults }) {
  filters.destination.value = city;
  filters.checkIn.value = checkIn;
  filters.nights.value = String(nights);
  if (adults) filters.adults.value = String(Math.min(6, Math.max(1, Number(adults) || 2)));
  setView('hotels');
  search();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
// Datos del viaje para proponer hotel al volver del pago del vuelo.
function tripFromFlight(trip, data) {
  return {
    city: data.destination?.name,
    checkIn: (trip?.outbound?.arrival || trip?.outbound?.departure || data.date || '').slice(0, 10),
    checkOut: (trip?.inbound?.departure || data.returnDate || '').slice(0, 10) || undefined,
    adults: data.adults,
  };
}

function renderFlightResults(data, token) {
  setFooter(true);
  if (data.needRoute) return loadDeals(token);
  const route = `${esc(data.origin.name)} (${esc(data.origin.code)}) → ${esc(data.destination.name)} (${esc(data.destination.code)})`;
  const when = `${fmtDay.format(toDate(data.date))}${data.returnDate ? ' → ' + fmtDay.format(toDate(data.returnDate)) : ' · ' + t('solo ida')}`;
  const note = data.live.sandbox ? ' · ' + t('entorno de pruebas (precios no reales)') : '';
  const stopsNote = data.stops in STOPS_NOTE ? ' · ' + t(STOPS_NOTE[data.stops]) : '';
  if (!data.results.length) {
    results.innerHTML = `<p class="count">${route} · ${when}${stopsNote}</p><p class="empty">${data.stops ? t('No hay vuelos con esas escalas para esas fechas. Prueba otro día o quita el filtro de escalas.') : t('No hay vuelos para esas fechas. Prueba otro día u otro aeropuerto.')}</p>`;
    return;
  }
  // Calendario de cada vuelo: unos días antes y después de la fecha elegida.
  const tomorrow = addDays(new Date().toISOString().slice(0, 10), 1);
  const back = addDays(data.date, -3);
  data.start = back > tomorrow ? back : tomorrow;
  data.days = FLIGHT_CAL_DAYS;
  data.loaded = new Map([[data.date, data.results]]); // fecha -> vuelos (null si falló)
  state.items = new Map();
  state.ui = new Map();
  for (const trip of data.results) {
    const id = 'fl-' + (trip.flightKey || trip.journeyKey).replace(/[^\w-]/g, '');
    if (state.items.has(id)) continue;
    const item = {
      id, liveFlight: true, flightKey: trip.flightKey, base: trip,
      calendar: Array.from({ length: data.days }, (_, i) => ({ date: addDays(data.start, i), price: null, available: null, pending: true })),
    };
    fillFlightDay(item, data.date, data.results);
    state.items.set(id, item);
    state.ui.set(id, { month: monthIndex(data.start, data.date), start: data.date });
  }
  results.innerHTML = `<p class="count">${tn(state.items.size, '{n} vuelo', '{n} vuelos')} · ${route} · ${when} · ${tn(data.adults, '{n} pasajero', '{n} pasajeros')}${stopsNote}${note}</p><div id="routeChart"></div><p class="count" id="livePending"></p>`;
  renderRouteChart();
  const hotelBox = tripHotelBox(tripFromFlight(data.results[0], data));
  if (hotelBox) results.append(hotelBox);
  for (const item of state.items.values()) results.append(liveFlightCard(item));
  loadFlightDays(token);
  railHint(data, token);
}

// ---------- Trenes ----------
// Duración del tren entre dos ciudades y comparación puerta a puerta con el avión.
// La reserva se hace de momento en Rail Europe (enlace con origen, destino, fecha y pasajeros).
const durText = (m) => (m == null ? '' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}`);
const trainIcon = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l1.5-4m4.5 4-1.5-4"/></svg>';

async function searchTrains(token) {
  setFooter(true);
  const origin = filters.origin.value.trim();
  const destination = filters.destination.value.trim();
  if (!origin) {
    results.innerHTML = `<p class="empty">${t('Escribe de dónde sales y a dónde vas, y te comparamos el tren con el avión puerta a puerta.')}</p>`;
    return;
  }
  results.classList.add('loading');
  results.innerHTML = `<p class="count">${destination ? t('Buscando trenes de {from} a {to}…', { from: esc(origin), to: esc(destination) }) : t('Buscando trenes desde {city}…', { city: esc(origin) })}</p>`;
  try {
    const p = new URLSearchParams({ origin, destination, adults: filters.passengers.value });
    if (filters.date.value) p.set('date', filters.date.value);
    const data = await api(`/api/trains?${p}`);
    if (token !== searchToken) return;
    state.data = data;
    if (!data.to) return renderRailNearby(data);
    const html = [];
    html.push(`<p class="count">${trainIcon} ${esc(data.from)} → ${esc(data.to)}${data.date ? ' · ' + fmtDay.format(toDate(data.date)) : ''} · ${tn(data.adults, '{n} pasajero', '{n} pasajeros')}</p>`);
    html.push('<p class="rail-verdict" id="railVerdict"></p><div class="rail-compare" id="railCompare"></div>');
    if (!data.train) html.push(`<p class="count">${t('No conocemos un buen tren entre estas dos ciudades. Te enseñamos los vuelos.')}</p>`);
    if (data.nearby.length) html.push(`<p class="count">${t('Otros trenes desde {city}:', { city: esc(data.from) })}</p>${railChips(data.nearby)}`);
    results.innerHTML = html.join('');
    bindRailChips();
    const box = $('#railCompare');
    if (data.train) box.append(trainCard(data));
    const wait = document.createElement('p');
    wait.className = 'count';
    if (data.fromIata && data.toIata) { wait.textContent = '✈️ ' + t('Comparando con los vuelos…'); box.append(wait); }
    const flight = await railFlights(data);
    if (token !== searchToken) return;
    wait.remove();
    if (flight) box.append(flightCompareCard(data, flight));
    // Lo más rápido puerta a puerta.
    const door = { train: data.train?.doorMinutes, plane: flight ? flight.minutes + data.doorFlight : null };
    const win = door.train && door.plane ? (door.train <= door.plane ? 'train' : 'plane') : null;
    if (win) {
      box.querySelector(`[data-mode="${win}"]`)?.classList.add('win');
      box.querySelector(`[data-mode="${win}"] .tags`)?.insertAdjacentHTML('afterbegin', `<span class="tag">⚡ ${t('Más rápido puerta a puerta')}</span>`);
      const diff = Math.abs(door.train - door.plane);
      $('#railVerdict').textContent = diff < 20 ? t('Tren y avión tardan casi lo mismo puerta a puerta.')
        : win === 'train' ? t('En tren llegas antes: unos {time} menos puerta a puerta.', { time: durText(diff) })
        : t('En avión llegas antes: unos {time} menos puerta a puerta.', { time: durText(diff) });
    }
    if (!data.train && !flight) box.innerHTML = `<p class="empty">${t('No hemos encontrado trenes ni vuelos para este trayecto.')}</p>`;
  } catch (err) {
    if (token === searchToken) results.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
  } finally {
    if (token === searchToken) results.classList.remove('loading');
  }
}

function railChips(list) {
  return `<div class="rail-chips">${list.map((r) => `<button type="button" data-rail-to="${esc(r.to)}">${esc(r.to)} · ${durText(r.minutes)}</button>`).join('')}</div>`;
}
function bindRailChips() {
  results.querySelectorAll('[data-rail-to]').forEach((b) => b.addEventListener('click', () => {
    filters.destination.value = b.dataset.railTo;
    search();
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}
function renderRailNearby(data) {
  results.innerHTML = data.nearby.length
    ? `<p class="count">${t('Trenes directos desde {city}. Elige destino:', { city: esc(data.from) })}</p>${railChips(data.nearby)}`
    : `<p class="empty">${t('No conocemos trenes directos desde {city}. Prueba otra ciudad o busca vuelos.', { city: esc(data.from) })}</p>`;
  bindRailChips();
}

function trainCard(data) {
  const tr = data.train;
  const el = document.createElement('article');
  el.className = 'card rail-card';
  el.dataset.mode = 'train';
  el.innerHTML = `
    <h3>${trainIcon} ${t('Tren')}</h3>
    <div class="big">${durText(tr.minutes)}</div>
    <div class="meta">${tr.direct ? t('Directo, de centro a centro') : t('Con transbordo en {city}', { city: esc(tr.via) })} · ${esc(tr.operators)}</div>
    <div class="meta">${t('Puerta a puerta: unas {time}', { time: durText(tr.doorMinutes) })}</div>
    <div class="tags"><span class="tag">${t('sin controles de aeropuerto')}</span><span class="tag">${t('maleta sin coste extra')}</span></div>
    <a class="btn primary" href="${esc(tr.bookUrl)}" target="_blank" rel="noopener">${t('Ver horarios y reservar')}</a>
    <div class="meta">${t('La reserva del tren se hace en Rail Europe, nuestro socio ferroviario.')}</div>`;
  return el;
}

// El vuelo más rápido del trayecto (y su precio), si las dos ciudades tienen aeropuerto.
async function railFlights(data) {
  await configReady;
  if (!data.fromIata || !data.toIata || data.fromIata === data.toIata || !state.config.liveFlights) return null;
  try {
    const p = new URLSearchParams({ origin: data.fromIata, destination: data.toIata, adults: String(data.adults) });
    if (data.date) p.set('date', data.date);
    const f = await api(`/api/flights?${p}`);
    const trips = (f.results || []).filter((x) => x.outbound?.minutes);
    if (!trips.length) return null;
    const fastest = trips.reduce((a, b) => (b.outbound.minutes < a.outbound.minutes ? b : a));
    const cheapest = trips.reduce((a, b) => (b.total < a.total ? b : a));
    return { minutes: fastest.outbound.minutes, stops: fastest.outbound.stops, from: Math.round(cheapest.total), date: f.date, count: trips.length };
  } catch { return null; }
}

function flightCompareCard(data, f) {
  const el = document.createElement('article');
  el.className = 'card rail-card';
  el.dataset.mode = 'plane';
  el.innerHTML = `
    <h3>✈️ ${t('Avión')}</h3>
    <div class="big">${durText(f.minutes)}</div>
    <div class="meta">${t('Vuelo más rápido')} · ${stopsText(f.stops)} · ${t('desde {price}', { price: eur(f.from) })}</div>
    <div class="meta">${t('Puerta a puerta: unas {time}', { time: durText(f.minutes + data.doorFlight) })}</div>
    <div class="tags"><span class="tag">${tn(f.count, '{n} vuelo', '{n} vuelos')}</span></div>
    <button class="btn" type="button">${t('Ver vuelos')}</button>`;
  el.querySelector('button').addEventListener('click', () => {
    filters.origin.value = data.fromIata;
    filters.destination.value = data.toIata;
    if (f.date && !filters.date.value) filters.date.value = f.date;
    setView('flights');
    search();
  });
  return el;
}

// En los resultados de vuelos: aviso si el trayecto también se hace bien en tren.
async function railHint(data, token) {
  try {
    const p = new URLSearchParams({ origin: data.origin.name, destination: data.destination.name });
    const r = await api(`/api/trains?${p}`);
    if (token !== searchToken || !r.train) return;
    const hint = document.createElement('p');
    hint.className = 'count rail-hint';
    hint.innerHTML = `${trainIcon} ${t('También en tren: {time}', { time: durText(r.train.minutes) })} <button class="btn" type="button">${t('Comparar tren y avión')}</button>`;
    hint.querySelector('button').addEventListener('click', () => {
      filters.origin.value = r.from;
      filters.destination.value = r.to;
      setView('trains');
      search();
    });
    results.querySelector('.count')?.after(hint);
  } catch { /* sin tren */ }
}

const FLIGHT_CAL_DAYS = 14;
const STOPS_NOTE = { 0: 'solo directos', 1: 'hasta 1 escala', many: 'con escalas' };

// El día `date` de un vuelo: su tarifa ese día, o sin plazas / no vuela.
function fillFlightDay(item, date, trips) {
  const i = diffDays(state.data.start, date);
  if (i < 0 || i >= item.calendar.length) return;
  if (!trips) { item.calendar[i] = { date, price: null, available: false, error: true }; return; }
  const t = trips.find((x) => (x.flightKey || x.journeyKey) === (item.flightKey || item.base.journeyKey));
  item.calendar[i] = t
    ? { date, price: Math.round(t.total), available: true, left: t.seatsRemaining || null, trip: t }
    : { date, price: null, available: false, noFlight: true };
}

// Gráfica de la ruta: el vuelo más barato de cada día. Al pulsar un día, se busca esa fecha.
function routeCalendar() {
  const data = state.data;
  return Array.from({ length: data.days }, (_, i) => {
    const date = addDays(data.start, i);
    if (!data.loaded.has(date)) return { date, price: null, available: null, pending: true };
    const trips = data.loaded.get(date);
    if (!trips) return { date, price: null, available: false, error: true };
    if (!trips.length) return { date, price: null, available: false, noFlight: true };
    const min = Math.min(...trips.map((t) => t.total));
    return { date, price: Math.round(min), available: true, left: null };
  });
}

function renderRouteChart() {
  const box = $('#routeChart');
  if (!box) return;
  const item = { id: 'route', liveFlight: true, calendar: routeCalendar() };
  box.className = 'card route-chart';
  box.innerHTML = renderChart(item, { start: state.data.date }, true, t('Vuelo más barato de cada día')) +
    `<p class="meta">${t('Pulsa un día de la gráfica para ver los vuelos de esa fecha.')}</p>`;
  bindChart(box, item, true, (d) => {
    if (!d.available) return toast(d.pending ? t('Todavía estamos cargando ese día.') : t('Ese día no hay vuelos en esta ruta.'));
    const data = state.data;
    if (data.returnDate) filters.returnDate.value = addDays(d.date, diffDays(data.date, data.returnDate));
    filters.date.value = d.date;
    search();
  });
}

// Carga el resto de días del calendario (de 3 en 3, los más cercanos a la fecha elegida primero).
async function loadFlightDays(token) {
  const data = state.data;
  const dates = Array.from({ length: data.days }, (_, i) => addDays(data.start, i)).filter((d) => !data.loaded.has(d));
  dates.sort((a, b) => Math.abs(diffDays(data.date, a)) - Math.abs(diffDays(data.date, b)) || (a < b ? -1 : 1));
  const stay = data.returnDate ? diffDays(data.date, data.returnDate) : '';
  const note = () => {
    const el = $('#livePending');
    if (el) el.textContent = data.loaded.size < data.days ? t('Cargando precios de otros días… {loaded}/{days}', { loaded: data.loaded.size, days: data.days }) : '';
  };
  note();
  for (let k = 0; k < dates.length; k += 3) {
    const chunk = dates.slice(k, k + 3);
    let res;
    try {
      res = await api(`/api/flights/days?origin=${data.origin.code}&destination=${data.destination.code}&dates=${chunk.join(',')}&stay=${stay}&adults=${data.adults}${data.stops ? '&stops=' + data.stops : ''}`);
    } catch {
      res = { days: chunk.map((date) => ({ date, error: true })) };
    }
    if (token !== searchToken || state.data !== data) return; // hay una búsqueda más nueva
    for (const d of res.days) {
      data.loaded.set(d.date, d.error ? null : d.trips);
      for (const item of state.items.values()) fillFlightDay(item, d.date, data.loaded.get(d.date));
    }
    renderRouteChart();
    for (const id of state.items.keys()) rerender(id);
    note();
  }
}

// Ofertas: el vuelo más barato de rutas populares, al abrir «Vuelos» sin ruta.
async function loadDeals(token) {
  results.innerHTML = `<p class="count">${t('Buscando las ofertas de vuelos más baratas…')}</p>`;
  for (let tries = 0; tries < 40; tries++) {
    let d;
    try {
      d = await api('/api/flights/deals');
    } catch (err) {
      if (token === searchToken) results.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
      return;
    }
    if (token !== searchToken) return;
    renderDeals(d);
    if (!d.pending) return;
    await new Promise((r) => setTimeout(r, 5000));
    if (token !== searchToken) return;
  }
}

function renderDeals(d) {
  const plain = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const from = plain(filters.origin.value.trim());
  const mine = from ? d.deals.filter((x) => plain(x.origin.code) === from || plain(x.origin.name).startsWith(from)) : [];
  const list = mine.length ? mine : d.deals;
  const sandbox = state.config.sandbox ? ' · ' + t('entorno de pruebas (precios no reales)') : '';
  const head = `<p class="count">${d.date ? t('Ofertas de vuelos para el {day}', { day: fmtDay.format(toDate(d.date)) }) : t('Ofertas de vuelos')} · ${t('solo ida')} · ${tn(1, '{n} pasajero', '{n} pasajeros')}${sandbox}</p>
    <p class="count">${t('Pulsa una oferta para ver todos sus vuelos con el calendario de precios, o escribe tu origen y destino arriba.')}</p>`;
  if (!list.length) {
    results.innerHTML = head + `<p class="empty">${d.pending ? t('Buscando las ofertas más baratas…') : t('Ahora mismo no hay ofertas. Escribe el origen y el destino para buscar vuelos.')}</p>`;
    return;
  }
  results.innerHTML = head + `<div class="deals">${list.map((x) => `
    <button type="button" class="deal" data-o="${esc(x.origin.name)}" data-d="${esc(x.destination.name)}" data-date="${esc(x.date)}">
      <span class="deal-route">${esc(x.origin.name)} → ${esc(x.destination.name)}</span>
      <span class="meta">${esc(x.airlines.join(', '))} · ${stopsText(x.stops)} · ${t('sale {time}', { time: hhmm(x.departure) })}</span>
      <span class="deal-price">${t('desde <b>{price}</b>', { price: eur2(x.total) })}</span>
    </button>`).join('')}</div>${d.pending ? `<p class="count">${t('Cargando más ofertas…')}</p>` : ''}`;
  for (const b of results.querySelectorAll('.deal')) {
    b.addEventListener('click', () => {
      filters.origin.value = b.dataset.o;
      filters.destination.value = b.dataset.d;
      filters.date.value = b.dataset.date;
      filters.returnDate.value = '';
      search();
    });
  }
}

// Tarjeta de un vuelo real con su calendario: muestra la tarifa del día elegido.
function liveFlightCard(item) {
  const data = state.data;
  const ui = state.ui.get(item.id);
  const day = item.calendar.find((d) => d.date === ui.start);
  const trip = day?.trip || item.base;
  const el = document.createElement('article');
  el.className = 'card flight-card live';
  el.id = 'card-' + item.id;
  const tags = [
    trip.checkedBag ? '🧳 ' + t('maleta facturada') : trip.carryOn ? '🎒 ' + t('equipaje de mano') : t('sin maleta incluida'),
    trip.refundable ? t('reembolsable') : t('no reembolsable'),
    trip.fare,
    trip.seatsRemaining > 0 && trip.seatsRemaining <= 5 ? t('quedan {n} plazas', { n: trip.seatsRemaining }) : '',
  ].filter(Boolean);
  el.innerHTML = `
    <div>
      <div class="fl-top">
        <div>${flightLegHtml(trip.outbound, trip.segments, 'OUTBOUND')}${flightLegHtml(trip.inbound, trip.segments, 'INBOUND')}</div>
        <div class="fl-side">
          <div><div class="price">${eur2(trip.total)}</div><div class="meta">${fmtDay.format(toDate(trip.outbound.departure.slice(0, 10)))}${data.adults > 1 ? ' · ' + tn(data.adults, '{n} pasajero', '{n} pasajeros') : ''}</div></div>
          <div class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          <button class="btn primary" type="button" data-live-book>${t('Reservar')}</button>
        </div>
      </div>
      ${renderChart(item, ui, true, t('Precio de este vuelo'))}
    </div>
    <div>${renderCalendar(item, ui)}</div>`;
  bindCard(el, item, true);
  $('[data-live-book]', el).addEventListener('click', () => bookLiveFlight(item, trip));
  return el;
}

// Las tarifas de LiteAPI caducan a los pocos minutos: si falta poco, se vuelve a buscar ese día.
async function bookLiveFlight(item, trip) {
  const data = state.data;
  if (trip.expiration && Date.parse(trip.expiration) - Date.now() < 60_000) {
    const date = trip.outbound.departure.slice(0, 10);
    toast(t('Actualizando el precio de ese día…'));
    try {
      const p = new URLSearchParams({ origin: data.origin.code, destination: data.destination.code, date, adults: data.adults });
      if (data.returnDate) p.set('returnDate', addDays(date, diffDays(data.date, data.returnDate)));
      const fresh = await api(`/api/flights?${p}`);
      const fresh1 = fresh.results.find((x) => (x.flightKey || x.journeyKey) === (item.flightKey || item.base.journeyKey));
      if (!fresh1) return toast(t('Ese vuelo ya no tiene plazas ese día. Elige otro.'));
      trip = fresh1;
    } catch (err) {
      return toast(err.message);
    }
  }
  openFlightBooking(trip, data);
}

function flightLegHtml(leg, segments, dir) {
  if (!leg) return '';
  const seg = segments.find((x) => x.direction === dir);
  return `<div class="fl-leg">
      <div class="fl-time">${hhmm(leg.departure)}<small>${esc(leg.from)}</small></div>
      <div class="fl-mid">${dur(leg.minutes)}<div class="line"></div>${stopsText(leg.stops)}</div>
      <div class="fl-time">${hhmm(leg.arrival)}<small>${esc(leg.to)}${leg.dayChange ? ` +${leg.dayChange}` : ''}</small></div>
    </div>
    <div class="fl-air">${seg?.logo ? `<img src="${esc(seg.logo)}" alt="" loading="lazy" onerror="this.remove()">` : '✈️'} ${dir === 'INBOUND' ? t('Vuelta') + ' · ' : ''}${esc(leg.airlines.join(', '))}${seg ? ' · ' + esc(seg.flight) : ''}</div>`;
}

// Nacionalidades más habituales; el resto se escribe con su código (FR, US…).
const COUNTRIES = ['ES', 'PT', 'FR', 'IT', 'DE', 'GB', 'IE', 'NL', 'BE', 'CH', 'AT', 'PL', 'RO', 'SE', 'NO', 'DK', 'FI', 'GR', 'US', 'CA', 'MX', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'BR', 'UY', 'MA', 'CN', 'JP'];
const countryName = (() => { try { const dn = new Intl.DisplayNames([LANG], { type: 'region' }); return (c) => dn.of(c); } catch { return (c) => c; } })();
// Primero el país del idioma de la página; el resto, por orden alfabético.
const HOME_COUNTRY = { es: 'ES', en: 'GB', fr: 'FR', de: 'DE', it: 'IT', pt: 'PT', nl: 'NL' }[LANG] || 'ES';
const countryOptions = COUNTRIES.map((c) => [c, countryName(c)]).sort((a, b) => (a[0] === HOME_COUNTRY ? -1 : b[0] === HOME_COUNTRY ? 1 : a[1].localeCompare(b[1], LANG)))
  .map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join('');

function paxFieldset(i) {
  return `<fieldset data-pax="${i}">
    <legend>${t('Pasajero {n}', { n: i + 1 })}${i === 0 ? ' ' + t('(titular)') : ''}</legend>
    <div class="row">
      <label>${t('Nombre')} <input name="firstName" required autocomplete="${i === 0 ? 'given-name' : 'off'}" /></label>
      <label>${t('Apellidos')} <input name="lastName" required minlength="2" autocomplete="${i === 0 ? 'family-name' : 'off'}" /></label>
    </div>
    <div class="row">
      <label>${t('Fecha de nacimiento')} <input name="birthday" type="date" required /></label>
      <label>${t('Sexo (como en el documento)')} <select name="gender" required><option value="">—</option><option value="F">${t('Mujer')}</option><option value="M">${t('Hombre')}</option></select></label>
    </div>
    <div class="row">
      <label>${t('Nacionalidad')} <select name="nationality" required>${countryOptions}</select></label>
      <label>${t('Documento')} <select name="documentType" required><option value="passport">${t('Pasaporte')}</option><option value="id">${t('DNI / documento de identidad')}</option></select></label>
    </div>
    <div class="row">
      <label>${t('Número de documento')} <input name="documentNumber" required minlength="5" autocomplete="off" /></label>
      <label>${t('Caduca el')} <input name="documentExpiry" type="date" required /></label>
    </div>
  </fieldset>`;
}

const flightDialog = $('#flightDialog');
const flightForm = $('#flightForm');
function flightError(msg) {
  $('#flightError').textContent = msg || '';
  $('#flightError').hidden = !msg;
}
function showFlightPay(on) {
  $('#flightFields').hidden = on;
  $('#flightPayBox').hidden = !on;
  if (!on) $('#flightPayment').innerHTML = '';
}

// Total a pagar, gastos de emisión y quién hace el cargo.
function flightPayHint(co, sandbox) {
  const fee = co.total - co.searchTotal;
  return t('Total a pagar: <b>{total}</b>', { total: eur2(co.total) }) +
    (Math.abs(fee) > 0.01 ? ' ' + t('(incluye {fee} de gastos de emisión del billete)', { fee: eur2(fee) }) : '') +
    ' · ' + t('código {code}', { code: esc(co.code) }) +
    '<br>' + t('El cargo lo hace Nuitée, el proveedor de los billetes, y aparecerá a su nombre en tu tarjeta.') +
    (sandbox ? '<br>' + t('Entorno de pruebas: usa la tarjeta <b>4242 4242 4242 4242</b>, cualquier fecha futura y cualquier CVC.') : '');
}

// Sin clave de Stripe en el prebook: la pasarela de LiteAPI (la de los hoteles) muestra la tarjeta y su propio botón de pagar.
async function payFlightWithWrapper(co) {
  state.flight.checkout = co;
  await loadPaymentSdk().catch(() => { throw new Error(t('No se pudo cargar el formulario de pago. Revisa tu conexión e inténtalo de nuevo.')); });
  showFlightPay(true);
  $('#flightConfirm').hidden = true;
  $('#flightTotal').textContent = eur2(co.total);
  $('#flightPayHint').innerHTML = flightPayHint(co, co.publicKey === 'sandbox');
  new window.LiteAPIPayment({
    publicKey: co.publicKey,
    appearance: { theme: 'flat' },
    options: { business: { name: 'DíasLibres' } },
    targetElement: '#flightPayment',
    secretKey: co.secretKey,
    returnUrl: co.returnUrl,
  }).handlePayment();
}

async function openFlightBooking(trip, data) {
  state.flight = { trip, adults: data.adults, stripe: null, elements: null, checkout: null };
  store.set('dl-trip', JSON.stringify(tripFromFlight(trip, data)));
  $('#flightSummary').innerHTML = `<b>${esc(data.origin.name)} → ${esc(data.destination.name)}</b><br>${t('Ida')} ${fmtDay.format(toDate(trip.outbound.departure.slice(0, 10)))} · ${legText(trip.outbound)}${trip.inbound ? `<br>${t('Vuelta')} ${fmtDay.format(toDate(trip.inbound.departure.slice(0, 10)))} · ${legText(trip.inbound)}` : ''}<br>${tn(data.adults, '{n} pasajero', '{n} pasajeros')} · ${esc(trip.outbound.airlines.join(', '))}`;
  $('#paxList').innerHTML = Array.from({ length: data.adults }, (_, i) => paxFieldset(i)).join('');
  for (const d of flightForm.querySelectorAll('[name="birthday"]')) d.max = new Date().toISOString().slice(0, 10);
  for (const d of flightForm.querySelectorAll('[name="documentExpiry"]')) d.min = trip.outbound.departure.slice(0, 10);
  flightForm.email.value ||= store.get('dl-email') || '';
  flightForm.terms.checked = false;
  $('#flightTotal').textContent = '…';
  $('#flightExtra').hidden = true;
  flightError('');
  showFlightPay(false);
  const btn = $('#flightConfirm');
  btn.hidden = false;
  btn.disabled = true;
  btn.textContent = t('Continuar al pago');
  flightDialog.showModal();
  try {
    const v = await api('/api/flights/quote', { method: 'POST', body: JSON.stringify({ offerId: trip.offerId }) });
    state.flight.total = v.total;
    $('#flightTotal').textContent = eur2(v.total);
    const extra = [
      v.changed ? t('El precio ha cambiado desde la búsqueda (antes {price}).', { price: eur2(trip.total) }) : '',
      trip.refundable ? t('Tarifa reembolsable según las condiciones de la aerolínea.') : t('Tarifa no reembolsable.'),
      trip.checkedBag ? t('Incluye maleta facturada.') : trip.carryOn ? t('Incluye equipaje de mano; maleta facturada no incluida.') : t('No incluye maleta.'),
      data.live.sandbox ? t('Entorno de pruebas: no es un billete real.') : '',
    ].filter(Boolean).join(' ');
    $('#flightExtra').textContent = extra;
    $('#flightExtra').hidden = !extra;
    btn.disabled = false;
  } catch (err) {
    $('#flightTotal').textContent = '—';
    flightError(err.message);
  }
}
$('#flightCancel').addEventListener('click', () => flightDialog.close());

function flightCustomer() {
  const passengers = [...flightForm.querySelectorAll('[data-pax]')].map((fs) => {
    const v = (n) => fs.querySelector(`[name="${n}"]`).value.trim();
    return { firstName: v('firstName'), lastName: v('lastName'), birthday: v('birthday'), gender: v('gender'), nationality: v('nationality'), documentType: v('documentType'), documentNumber: v('documentNumber'), documentExpiry: v('documentExpiry') };
  });
  return { email: flightForm.email.value.trim(), phoneCountryCode: flightForm.phoneCountryCode.value, phoneNumber: flightForm.phoneNumber.value, passengers };
}

let stripePromise;
function loadStripe() {
  stripePromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3/';
    s.onload = () => (window.Stripe ? resolve() : reject(new Error('stripe')));
    s.onerror = () => reject(new Error('stripe'));
    document.head.append(s);
  }).catch((e) => { stripePromise = null; throw e; });
  return stripePromise;
}

onSend(flightForm, async () => {
  const f = state.flight;
  const btn = $('#flightConfirm');
  flightError('');
  btn.disabled = true;
  // Paso 2: pagar con la tarjeta (Stripe lleva al cliente de vuelta a /?vuelo=<id>).
  if (f.checkout) {
    btn.textContent = t('Procesando el pago…');
    const { error } = await f.stripe.confirmPayment({ elements: f.elements, confirmParams: { return_url: f.checkout.returnUrl } });
    flightError(error?.message || t('No se pudo completar el pago.'));
    btn.disabled = false;
    btn.textContent = t('Pagar {total}', { total: eur2(f.checkout.total) });
    return;
  }
  // Paso 1: bloquear la tarifa con los datos de los pasajeros y preparar el pago.
  btn.textContent = t('Reservando la tarifa…');
  try {
    const co = await api('/api/flights/checkout', { method: 'POST', body: JSON.stringify({ offerId: f.trip.offerId, adults: f.adults, ...flightCustomer() }) });
    store.set('dl-email', flightForm.email.value.trim());
    if (!co.publishableKey) return await payFlightWithWrapper(co);
    await loadStripe().catch(() => { throw new Error(t('No se pudo cargar el formulario de pago. Revisa tu conexión e inténtalo de nuevo.')); });
    f.checkout = co;
    f.stripe = window.Stripe(co.publishableKey);
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    f.elements = f.stripe.elements({ clientSecret: co.secretKey, appearance: { theme: dark ? 'night' : 'stripe' }, locale: LANG });
    showFlightPay(true);
    f.elements.create('payment').mount('#flightPayment');
    $('#flightTotal').textContent = eur2(co.total);
    $('#flightPayHint').innerHTML = flightPayHint(co, !!state.data?.live?.sandbox);
    btn.textContent = t('Pagar {total}', { total: eur2(co.total) });
  } catch (err) {
    flightError(err.message);
    btn.textContent = t('Continuar al pago');
  } finally {
    btn.disabled = false;
  }
});

// Al volver de pagar: /?vuelo=<id> → confirmar el billete con la aerolínea.
async function finishFlightPayment(id, redirectStatus) {
  history.replaceState(null, '', location.pathname);
  setView('mine');
  if (redirectStatus === 'failed') { toast(t('El pago no se ha completado. No se ha hecho ningún cargo.')); return; }
  toast(t('Confirmando tu billete con la aerolínea…'));
  try {
    const b = await api(`/api/flights/checkout/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: '{}' });
    toast(`✅ ${b.sandbox ? t('Reserva de prueba confirmada') : t('Vuelo reservado')} · ${t('código {code}', { code: b.code })}${b.pnr ? ' · ' + t('localizador {pnr}', { pnr: b.pnr }) : ''}`, 8000);
    rememberBooking(b);
    await loadMine(b.email);
    let trip = null;
    try { trip = JSON.parse(store.get('dl-trip') || 'null'); } catch { /* sin datos */ }
    const box = trip && tripHotelBox(trip);
    if (box) $('#mine').prepend(box);
  } catch (err) {
    toast(err.message, 15000);
  }
}

// ---------- Mis reservas ----------
// Tras reservar: email y código quedan puestos para ver la reserva sin escribir nada.
function rememberBooking(b) {
  $('#mineForm').email.value = b.email;
  $('#mineForm').code.value = b.code;
  store.set('dl-email', b.email);
  store.set('dl-code', b.code);
}
async function loadMine(email) {
  const list = $('#mineList');
  const code = $('#mineForm').code.value.trim();
  const own = state.user && (!email || email.toLowerCase() === state.user.email);
  if (!own && !code) { list.innerHTML = `<p class="empty">${t('Escribe el código de una de tus reservas (DL-…), que te enviamos por email, o entra con tu cuenta.')}</p>`; return; }
  try {
    const items = await api(own ? '/api/bookings' : `/api/bookings?email=${encodeURIComponent(email)}&code=${encodeURIComponent(code)}`);
    if (!items.length) { list.innerHTML = `<p class="empty">${t('No hay reservas con ese email.')}</p>`; return; }
    list.innerHTML = items.map((b) => `
      <div class="booking">
        <div>
          <div><b>${esc(b.itemName)}</b></div>
          <div class="meta">${b.type === 'hotel' ? `${fmtDay.format(toDate(b.checkIn))} → ${fmtDay.format(toDate(b.checkOut))} · ${t('{n} hab.', { n: b.units })}` : `${fmtDay.format(toDate(b.date))}${b.returnDate ? ' → ' + fmtDay.format(toDate(b.returnDate)) : ''} · ${tn(b.units, '{n} pasajero', '{n} pasajeros')}`} · ${eur(b.total)}</div>
          ${b.type === 'flight' && b.flight ? `<div class="meta">${legText(b.flight.outbound)}${b.flight.inbound ? ' · ' + t('vuelta') + ' ' + legText(b.flight.inbound) : ''}</div>` : ''}
          ${b.passengers?.length ? `<div class="meta">${esc(b.passengers.join(', '))}</div>` : ''}
          ${b.guests ? `<div class="meta">${t('{guests} por habitación', { guests: guestsText(b.guests) })}</div>` : ''}
          ${b.provider === 'liteapi' ? `<div class="meta">${b.sandbox ? t('Prueba') + ' · ' : ''}${t('Ref.')} ${esc(b.bookingRef || b.providerBookingId)}${b.pnr ? ' · ' + t('localizador {pnr}', { pnr: esc(b.pnr) }) : ''}${b.roomName ? ' · ' + esc(b.roomName) : ''} · ${b.type === 'flight' ? (b.refundable ? t('tarifa reembolsable') : t('no reembolsable')) : b.refundable ? t('cancelación gratuita') : t('no reembolsable')}${b.cancellation ? ' · ' + t('reembolso {amount}', { amount: eur(b.cancellation.refund ?? 0) }) : ''}</div>` : ''}
          ${b.payAtHotel?.length ? `<div class="meta">${t('A pagar en el hotel: {list}', { list: esc(payAtHotelText(b.payAtHotel)) })}</div>` : ''}
          <div class="meta">${t('Código')} <b>${esc(b.code)}</b> · <span class="status ${b.status === 'confirmada' ? 'ok' : 'ko'}">${b.status === 'confirmada' ? '✔' : b.status === 'cancelacion_solicitada' ? '…' : '✖'} ${esc(b.status === 'cancelacion_solicitada' ? t('cancelación solicitada') : t(b.status))}</span></div>
        </div>
        ${b.status === 'confirmada' ? `<button class="btn" data-cancel="${esc(b.code)}"${b.type === 'flight' && b.provider === 'liteapi' ? ' data-flight="1"' : noRefund(b) ? ' data-norefund="1"' : ''}>${t('Cancelar')}</button>` : ''}
      </div>`).join('');
  } catch (err) {
    list.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
  }
}
onSend($('#mineForm'), () => {
  const email = $('#mineForm').email.value.trim();
  store.set('dl-email', email);
  store.set('dl-code', $('#mineForm').code.value.trim());
  loadMine(email);
});
$('#mineList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-cancel]');
  if (!btn) return;
  const code = btn.dataset.cancel;
  // Confirmación en dos pasos dentro de la página (sin diálogos del navegador).
  if (!btn.dataset.armed && btn.dataset.flight) {
    // Vuelos: antes de cancelar se pide a la aerolínea cuánto se devolvería.
    btn.disabled = true;
    btn.textContent = t('Consultando el reembolso…');
    try {
      const q = await api(`/api/bookings/${encodeURIComponent(code)}/cancel-quote?email=${encodeURIComponent($('#mineForm').email.value.trim())}`);
      btn.textContent = q.refund > 0 ? t('Reembolso estimado {amount} (no garantizado). ¿Cancelar?', { amount: eur2(q.refund) }) : t('Sin reembolso. ¿Cancelar igualmente?');
      btn.dataset.armed = '1';
      setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = t('Cancelar'); } }, 15000);
    } catch (err) {
      btn.textContent = t('Cancelar');
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
    return;
  }
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = btn.dataset.norefund ? t('Sin reembolso. ¿Cancelar igualmente?') : t('¿Seguro? Pulsa otra vez');
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = t('Cancelar'); } }, btn.dataset.norefund ? 8000 : 4000);
    return;
  }
  const email = $('#mineForm').email.value.trim();
  try {
    const done = await api(`/api/bookings/${encodeURIComponent(code)}/cancel`, { method: 'POST', body: JSON.stringify({ email }) });
    toast(done.status === 'cancelacion_solicitada' ? t('Cancelación solicitada. La aerolínea la confirmará en breve.') : t('Reserva cancelada.'));
    loadMine(email);
  } catch (err) {
    toast(err.message);
  }
});

// ---------- Inicio ----------
// Se pide antes que nada: si alguien pulsa «Vuelos» mientras carga, la búsqueda espera a saber si los vuelos son reales.
const configReady = api('/api/config').then((config) => {
  state.config = config;
  if (config.liveFlights) document.body.dataset.liveFlights = '1';
  if (config.facilities) renderFacilityList();
  // Sin vuelos (datos reales de hoteles y vuelos apagados): fuera la pestaña y el ejemplo de vuelos.
  if (config.flights === false) {
    $('.tabs [data-view="flights"]').hidden = true;
    for (const b of document.querySelectorAll('#examples [data-kind="flight"]')) b.hidden = true;
  }
  filters.date.min = filters.returnDate.min = addDays(new Date().toISOString().slice(0, 10), 1);
}).catch(() => { /* sin vuelos reales */ });
filters.checkIn.min = new Date().toISOString().slice(0, 10);
filters.checkIn.max = addDays(filters.checkIn.min, 330);
(async () => {
  try {
    const airports = await api('/api/airports');
    const cities = new Set(Object.values(airports));
    $('#destList').innerHTML = [...cities].sort().map((c) => `<option value="${esc(c)}">`).join('');
  } catch { /* datalist opcional */ }
  await configReady;
  const params = new URLSearchParams(location.search);
  if (params.get('pago')) return finishPayment(params.get('pago'));
  if (params.get('vuelo')) return finishFlightPayment(params.get('vuelo'), params.get('redirect_status'));
  // Si ya se pulsó una pestaña mientras cargaba, no se le cambia.
  // Las páginas /vuelos/<ruta> abren directamente la búsqueda de vuelos.
  const start = document.body.dataset.startView === 'flights' && state.config.flights !== false ? 'flights' : 'hotels';
  // Páginas por filtro (/hoteles/<ciudad>/con-piscina…): la búsqueda empieza con el filtro puesto.
  try {
    const f = JSON.parse(document.body.dataset.startFilters || 'null');
    if (f) {
      const fac = new Set(f.fac || []);
      filters.querySelectorAll('[name="fac"]').forEach((c) => { c.checked = fac.has(c.value); });
      if (f.board) filters.board.value = f.board;
      if (f.stay) filters.stay.value = f.stay;
      if (f.minStars) filters.minStars.value = f.minStars;
      if (f.sort) filters.sort.value = f.sort;
      if (fac.size || f.board || f.minStars || f.stay) { $('#moreFilters').hidden = false; $('#moreFiltersBtn').setAttribute('aria-expanded', 'true'); }
      updateMoreCount();
    }
  } catch { /* sin filtros */ }
  // Páginas generales (/hoteles, /vuelos, /escapadas, /donde-viajar): se dejan sus enlaces a la vista
  // sin lanzar una búsqueda; en «¿Dónde viajar?» el cursor va a la caja de la IA.
  const hub = document.body.dataset.hub;
  if (state.view === 'hotels') {
    setView(start);
    if (!hub) search();
    else if (hub === 'whereTo') $('#aiQuery')?.focus({ preventScroll: true });
  }
})();

// Si el navegador está en otro idioma de la web, se ofrece la página en ese idioma.
(() => {
  const HINT = {
    es: 'Esta página también está en español', en: 'This page is also available in English', fr: 'Cette page existe aussi en français',
    de: 'Diese Seite gibt es auch auf Deutsch', it: 'Questa pagina è disponibile anche in italiano', pt: 'Esta página também está disponível em português',
    nl: 'Deze pagina is ook beschikbaar in het Nederlands',
  };
  const want = (navigator.languages || [navigator.language]).map((l) => String(l).slice(0, 2).toLowerCase()).find((l) => HINT[l]);
  if (!want || want === LANG || store.get('dl-lang-hint') === want) return;
  const href = document.querySelector(`link[rel="alternate"][hreflang="${want}"]`)?.getAttribute('href') || (want === 'es' ? '/' : `/${want}/`);
  const bar = document.createElement('p');
  bar.className = 'lang-hint';
  bar.lang = want;
  bar.innerHTML = `🌐 <a href="${esc(href)}" hreflang="${want}">${esc(HINT[want])} →</a> <button type="button" class="btn ghost" aria-label="×">×</button>`;
  bar.querySelector('button').addEventListener('click', () => { store.set('dl-lang-hint', want); bar.remove(); });
  $('#searchSection').before(bar);
})();

// ---------- Cuenta (enlace por email o Google) y «Para ti» ----------
// Las últimas búsquedas se guardan en el dispositivo; con cuenta, también en el servidor,
// y de ahí salen las propuestas de «Para ti».
const HISTORY_KEY = 'dl-history';
const isGuest = () => !state.user && store.get('dl-guest') === '1';
const readHistory = () => { try { const h = JSON.parse(store.get(HISTORY_KEY) || '[]'); return Array.isArray(h) ? h : []; } catch { return []; } };
function recordSearch() {
  if (isGuest()) return;
  const kind = state.view === 'flights' ? 'flight' : 'hotel';
  const city = filters.destination.value.trim();
  if (!city || state.view === 'mine' || state.view === 'trains') return;
  const s = { kind, city, origin: kind === 'flight' ? filters.origin.value.trim() : '', at: new Date().toISOString() };
  if (kind === 'hotel') {
    Object.assign(s, {
      stay: filters.stay.value, board: filters.board.value, maxPrice: Number(filters.maxPrice.value) || null,
      nights: Number(filters.nights.value) || null, adults: Number(filters.adults.value) || null,
      fac: [...filters.querySelectorAll('[name="fac"]:checked')].map((c) => c.value),
    });
  }
  const key = (x) => [x.kind, String(x.city).toLowerCase(), String(x.origin || '').toLowerCase(), x.stay || '', x.board || '', x.maxPrice || ''].join('|');
  store.set(HISTORY_KEY, JSON.stringify([s, ...readHistory().filter((x) => key(x) !== key(s))].slice(0, 30)));
  clearTimeout(state.forYouTimer);
  state.forYouTimer = setTimeout(loadForYou, 1500);
}

const TYPE_IMG = { beach: 'playa', island: 'playa', mountain: 'montana', city: 'romantica' };
const STAY_PLURAL = { hotel: 'Hoteles', apartment: 'Apartamentos', house: 'Casas y villas', hostel: 'Hostales y pensiones' };
async function loadForYou() {
  if (isGuest()) { $('#forYou').hidden = true; return; }
  const history = readHistory();
  if (!history.length && !state.user?.historyCount) { $('#forYou').hidden = true; return; }
  try {
    state.forYou = (await api('/api/recommendations', { method: 'POST', body: JSON.stringify({ history }) })).items;
    renderForYou();
  } catch { /* sin propuestas */ }
}
function renderForYou() {
  const items = (state.forYou || []).filter((r) => r.kind !== 'flight' || state.config.flights !== false);
  $('#forYou').hidden = !items.length;
  $('#forYouList').innerHTML = items.map((r, i) => {
    const q = r.query || {};
    const sub = r.kind === 'flight'
      ? []
      : [q.stay ? t(STAY_PLURAL[q.stay]) : '', q.board && state.config.boards?.[q.board] ? t(state.config.boards[q.board]) : '', q.maxPrice ? t('hasta {price}/noche', { price: eur(q.maxPrice) }) : ''].filter(Boolean);
    const img = r.kind === 'flight' ? 'vuelos' : TYPE_IMG[r.type] || 'romantica';
    return `<button type="button" class="ex-card rec" data-i="${i}"><img src="${esc(r.photo || `/img/ex-${img}.jpg`)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/img/ex-${img}.jpg'" /><span><small>${esc(t(r.reason.key, { city: r.reason.city || '' }))}</small>${esc(r.city)}${sub.length ? `<em>${esc(sub.join(' · '))}</em>` : ''}</span></button>`;
  }).join('');
}
$('#forYouList').addEventListener('click', (e) => {
  const r = state.forYou?.[e.target.closest('[data-i]')?.dataset.i];
  if (!r) return;
  const q = r.query || {};
  filters.reset();
  renderKidAges();
  filters.destination.value = q.destination || '';
  filters.origin.value = q.origin || '';
  filters.stay.value = q.stay || '';
  filters.board.value = q.board || '';
  filters.maxPrice.value = q.maxPrice || '';
  if (q.nights) filters.nights.value = q.nights;
  if (q.adults) filters.adults.value = String(q.adults);
  updateMoreCount();
  $('#aiExplain').hidden = true;
  setView(r.kind === 'flight' ? 'flights' : 'hotels');
  search();
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

async function loadMe() {
  try { state.user = (await api('/api/me')).user; } catch { state.user = null; }
  paintAccount();
}
function paintAccount() {
  const u = state.user;
  const btn = $('#accountBtn');
  btn.classList.toggle('signed', !!u);
  $('#accountInitial').hidden = !u;
  $('#accountInitial').textContent = u ? (u.name || u.email).trim()[0].toUpperCase() : '';
  btn.setAttribute('aria-label', u ? `${t('Mi cuenta')}: ${u.email}` : t('Entrar'));
  if (u) store.set('dl-email', u.email);
}
function signedIn(user) {
  store.set('dl-guest', '');
  state.user = user;
  paintAccount();
  $('#accountDialog').close();
  toast(t('Has entrado como {email}', { email: user.email }));
  loadForYou();
}

let googleScript = null;
function googleButton(box) {
  const id = state.config.googleClientId;
  if (!id || !box) return;
  googleScript ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
  googleScript.then(() => {
    google.accounts.id.initialize({
      client_id: id,
      callback: async ({ credential }) => {
        try { signedIn((await api('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential }) })).user); } catch (err) { toast(err.message); }
      },
    });
    google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: Math.min(360, box.clientWidth || 300), locale: LANG });
  }).catch(() => { box.hidden = true; });
}

// «Continuar con Apple» (ventana emergente de Apple; el servidor comprueba el token).
let appleScript = null;
async function appleSignIn() {
  const id = state.config.appleClientId;
  if (!id) return;
  try {
    appleScript ??= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.append(s);
    });
    await appleScript;
    AppleID.auth.init({ clientId: id, scope: 'name email', redirectURI: location.origin + '/', usePopup: true });
    const r = await AppleID.auth.signIn();
    const name = r.user?.name?.firstName || '';
    signedIn((await api('/api/auth/apple', { method: 'POST', body: JSON.stringify({ idToken: r.authorization?.id_token, name }) })).user);
  } catch (err) {
    if (err?.error === 'popup_closed_by_user') return;
    toast(err?.message || t('No se pudo comprobar tu cuenta de Apple.'));
  }
}

// «Continuar con Microsoft»: ventana emergente de Microsoft que vuelve a /auth-callback.html
// con un id_token; el servidor lo comprueba (firma, cuenta personal y nonce).
let msLogin = null; // intento en curso: { popup, onMessage, timer }
function stopMicrosoft() {
  if (!msLogin) return;
  window.removeEventListener('message', msLogin.onMessage);
  clearInterval(msLogin.timer);
  msLogin = null;
}
function microsoftSignIn() {
  const id = state.config.microsoftClientId;
  if (!id) return;
  stopMicrosoft();
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const q = new URLSearchParams({
    client_id: id, response_type: 'id_token', response_mode: 'fragment', scope: 'openid email profile',
    redirect_uri: location.origin + '/auth-callback.html', nonce, prompt: 'select_account', ui_locales: LANG,
  });
  const popup = window.open('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?' + q, 'ms-login', 'width=480,height=640');
  if (!popup) return toast(t('Permite las ventanas emergentes para entrar con Microsoft.'));
  const onMessage = async (e) => {
    if (e.origin !== location.origin || e.source !== popup || typeof e.data?.authHash !== 'string') return;
    stopMicrosoft();
    const r = new URLSearchParams(e.data.authHash.replace(/^#/, ''));
    if (!r.get('id_token')) {
      if (r.get('error') === 'access_denied') return;
      // Se enseña el motivo que da Microsoft (p. ej. la app no admite cuentas personales).
      const why = (r.get('error_description') || r.get('error') || '').split(/\r?\n/)[0].slice(0, 160);
      return toast(t('No se pudo comprobar tu cuenta de Microsoft.') + (why ? ` (${why})` : ''), why ? 15000 : 3500);
    }
    try {
      const res = await api('/api/auth/microsoft', { method: 'POST', body: JSON.stringify({ idToken: r.get('id_token'), nonce }) });
      if (res.pending) {
        // Email que no es de Microsoft: hay que confirmarlo una vez con el enlace del correo.
        $('#accountBody').innerHTML = `<h2>${t('Revisa tu correo')}</h2><p>${t('Para unir tu cuenta de Microsoft, confirma que este email es tuyo.')}</p><p>${t('Te hemos enviado un enlace a {email}. Ábrelo en este dispositivo para entrar.', { email: `<b>${esc(res.pending)}</b>` })}</p><p class="meta">${t('Si no lo ves, mira en la carpeta de spam.')}</p><div class="actions"><button type="button" class="btn primary" data-close>${t('Entendido')}</button></div>`;
        if (!$('#accountDialog').open) $('#accountDialog').showModal();
        return;
      }
      signedIn(res.user);
    } catch (err) { toast(err.message); }
  };
  // Si se cierra la ventana sin terminar, se deja de escuchar (un nuevo intento empieza limpio).
  const timer = setInterval(() => { if (popup.closed) setTimeout(() => msLogin?.popup === popup && stopMicrosoft(), 1000); }, 800);
  msLogin = { popup, onMessage, timer };
  window.addEventListener('message', onMessage);
}

// «Continuar con Facebook» (SDK de Meta; se carga al abrir el diálogo para que la
// ventana emergente salga directamente del clic y el navegador no la bloquee).
let facebookScript = null;
function loadFacebook() {
  const id = state.config.facebookAppId;
  if (!id) return null;
  facebookScript ??= new Promise((resolve, reject) => {
    window.fbAsyncInit = () => { FB.init({ appId: id, version: 'v21.0', cookie: false, xfbml: false }); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/' + ({ es: 'es_ES', en: 'en_GB', fr: 'fr_FR', de: 'de_DE', it: 'it_IT', pt: 'pt_PT', nl: 'nl_NL' }[LANG] || 'es_ES') + '/sdk.js';
    s.async = true;
    s.onerror = reject;
    document.head.append(s);
  });
  return facebookScript;
}
function facebookSignIn() {
  if (!window.FB) return toast(t('Cargando Facebook… vuelve a pulsar en un momento.'));
  FB.login(async (r) => {
    const accessToken = r?.authResponse?.accessToken;
    if (!accessToken) return;
    try { signedIn((await api('/api/auth/facebook', { method: 'POST', body: JSON.stringify({ accessToken }) })).user); } catch (err) { toast(err.message); }
  }, { scope: 'email' });
}

function openAccount() {
  const body = $('#accountBody');
  const u = state.user;
  if (u) {
    body.innerHTML = `<h2>${t('Mi cuenta')}</h2>
      <p><b>${esc(u.email)}</b></p>
      <p class="meta">${t('Usamos tus últimas búsquedas para proponerte destinos en «Para ti».')}</p>
      <div class="actions"><button type="button" class="btn" data-act="mine">${t('Mis reservas')}</button><button type="button" class="btn" data-act="logout">${t('Cerrar sesión')}</button></div>
      <p><button type="button" class="link-danger" data-act="delete">${t('Borrar mi cuenta y mis búsquedas')}</button></p>
      <div class="actions"><button type="button" class="btn ghost" data-close>${t('Cerrar')}</button></div>`;
  } else {
    body.innerHTML = `<h2>${t('Entrar o crear cuenta')}</h2>
      <p class="meta">${t('Guarda tus búsquedas en todos tus dispositivos y recibe propuestas que te puedan gustar. Sin contraseñas.')}</p>
      ${state.config.googleClientId ? `<div class="google-box" id="googleBtn"></div>` : ''}
      ${state.config.appleClientId ? `<button type="button" class="apple-btn" data-act="apple"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.5-1-2.5-3.9zM14 5.4c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.1-.6 2.8-1.4z" fill="currentColor"/></svg> ${t('Continuar con Apple')}</button>` : ''}
      ${state.config.microsoftClientId ? `<button type="button" class="social-btn" data-act="microsoft"><svg viewBox="0 0 21 21" aria-hidden="true"><path fill="#f25022" d="M1 1h9v9H1z"/><path fill="#7fba00" d="M11 1h9v9h-9z"/><path fill="#00a4ef" d="M1 11h9v9H1z"/><path fill="#ffb900" d="M11 11h9v9h-9z"/></svg> ${t('Continuar con Microsoft')}</button>` : ''}
      ${state.config.facebookAppId ? `<button type="button" class="social-btn facebook" data-act="facebook"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z"/></svg> ${t('Continuar con Facebook')}</button>` : ''}
      ${state.config.googleClientId || state.config.appleClientId || state.config.microsoftClientId || state.config.facebookAppId ? `<p class="or"><span>${t('o con tu email')}</span></p>` : ''}
      <form id="loginForm">
        <label>${t('Email')}<input name="email" type="email" required autocomplete="email" value="${esc(store.get('dl-email') || '')}" /></label>
        <button class="btn primary" type="submit">${t('Recibir enlace para entrar')}</button>
      </form>
      <p class="meta">${t('Te enviamos un enlace al correo y entras al pulsarlo.')} <a href="/legal.html#privacidad" target="_blank" rel="noopener">${t('Privacidad')}</a></p>
      <button type="button" class="btn ghost guest-btn" data-act="guest">${t('Entrar como invitado')}</button>
      <p class="meta guest-note">${t('Como invitado puedes buscar y reservar, pero no guardamos tus búsquedas ni te proponemos destinos.')}</p>`;
    googleButton($('#googleBtn'));
    loadFacebook()?.catch(() => { const b = $('[data-act="facebook"]'); if (b) b.hidden = true; });
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = e.target.email.value.trim();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        await api('/api/auth/email', { method: 'POST', body: JSON.stringify({ email }) });
        store.set('dl-email', email);
        body.innerHTML = `<h2>${t('Revisa tu correo')}</h2><p>${t('Te hemos enviado un enlace a {email}. Ábrelo en este dispositivo para entrar.', { email: `<b>${esc(email)}</b>` })}</p><p class="meta">${t('Si no lo ves, mira en la carpeta de spam.')}</p><div class="actions"><button type="button" class="btn primary" data-close>${t('Entendido')}</button></div>`;
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
      }
    });
  }
  $('#accountDialog').showModal();
}
$('#accountBtn').addEventListener('click', openAccount);
$('#accountDialog').addEventListener('click', async (e) => {
  const dlg = $('#accountDialog');
  if (e.target === dlg || e.target.closest('[data-close]')) return dlg.close();
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'guest') {
    // Invitado: no se guarda nada de lo que busca y no hay «Para ti».
    store.set('dl-guest', '1');
    store.set(HISTORY_KEY, '[]');
    state.forYou = [];
    renderForYou();
    return dlg.close();
  }
  if (act === 'apple') return appleSignIn();
  if (act === 'microsoft') return microsoftSignIn();
  if (act === 'facebook') return facebookSignIn();
  if (act === 'mine') { dlg.close(); setView('mine'); }
  if (act === 'logout') {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    state.user = null;
    paintAccount();
    dlg.close();
    toast(t('Has cerrado la sesión.'));
  }
  if (act === 'delete' && confirm(t('¿Borrar tu cuenta y tus búsquedas guardadas? Tus reservas no se borran.'))) {
    try {
      await api('/api/me', { method: 'DELETE' });
      store.set(HISTORY_KEY, '[]');
      state.user = null;
      state.forYou = [];
      paintAccount();
      renderForYou();
      dlg.close();
      toast(t('Cuenta borrada.'));
    } catch (err) { toast(err.message); }
  }
});

// Al abrir el enlace del email (?login=…) se entra y se quita el token de la dirección.
(async () => {
  const params = new URLSearchParams(location.search);
  const token = params.get('login');
  if (token) {
    params.delete('login');
    history.replaceState(null, '', location.pathname + (params.size ? '?' + params : '') + location.hash);
    await configReady.catch(() => {});
    try {
      const { user } = await api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ token }) });
      return signedIn(user);
    } catch (err) {
      toast(err.message, 6000);
    }
  }
  await loadMe();
  await configReady.catch(() => {});
  loadForYou();
  // Primera visita: pantalla de acceso (cuenta o invitado). No se repite una vez elegido,
  // ni al volver de un pago.
  if (!state.user && !store.get('dl-guest') && !store.get('dl-welcomed') && !params.get('pago') && !params.get('vuelo')) {
    store.set('dl-welcomed', '1');
    openAccount();
  }
})();

// App instalable (Android, escritorio): funciona sin conexión con la última versión vista.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
