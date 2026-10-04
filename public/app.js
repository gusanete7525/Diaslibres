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
  filters.destination.placeholder = view === 'flights' ? t('Ciudad o aeropuerto') : t('Escribe cualquier ciudad');
  filters.origin.placeholder = state.config.liveFlights ? t('Ciudad o código (MAD)') : t('Cualquiera');
  if (view === 'mine') {
    const email = store.get('dl-email');
    if (email) { $('#mineForm').email.value = email; loadMine(email); }
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
  if (state.view === 'flights') await configReady;
  if (token !== searchToken) return;
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
    if (data.live && data.results.length) loadLivePrices(token);
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
      if (token === searchToken) toast(err.message);
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
  // Si con las fechas o el precio pedidos no queda ninguno, se buscan solos unos cuantos más.
  if (token === searchToken && state.view === 'hotels' && state.data.hasMore && !state.data.results.some(passesStay) && (state.autoMore = (state.autoMore || 0) + 1) <= 3) {
    $('#results .btn.more')?.click();
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

// Con fechas o precio máximo, se ocultan los alojamientos que no están libres esas noches
// o que cuestan más (precio medio por noche). Mientras llegan los precios, se enseñan.
function passesStay(item) {
  if (state.view !== 'hotels' || !state.data?.live) return true;
  const max = Number(filters.maxPrice.value) || 0;
  const checkIn = filters.checkIn.value;
  const n = state.data.nights;
  const cal = item.calendar;
  if (checkIn) {
    const i = diffDays(state.data.start, checkIn);
    const slice = i >= 0 ? cal.slice(i, i + n) : [];
    if (slice.length < n || slice.some((d) => d.pending)) return true;
    if (!slice.every((d) => d.available)) return false;
    return !max || slice.reduce((sum, d) => sum + d.price, 0) / n <= max;
  }
  if (!max || cal.some((d) => d.pending)) return true;
  return item.summary.minPrice != null && item.summary.minPrice <= max;
}
function updateHiddenNote() {
  const note = $('#hiddenNote');
  if (!note || state.view !== 'hotels') return;
  const hidden = state.data.results.filter((h) => !passesStay(h)).length;
  const max = Number(filters.maxPrice.value) || 0;
  const why = filters.checkIn.value
    ? (max ? t('sin plazas libres esas noches o más de {price} por noche', { price: eur(max) }) : t('sin plazas libres esas noches'))
    : t('más de {price} por noche', { price: eur(max) });
  note.hidden = !hidden;
  note.textContent = hidden ? tn(hidden, '{n} oculto ({why}).', '{n} ocultos ({why}).', { why })
    + (hidden === state.data.results.length && state.data.hasMore ? ' ' + t('Pulsa «Ver más hoteles» para buscar entre los demás.') : '') : '';
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
    filters.checkIn.value = f.kind === 'flight' ? '' : f.checkIn || '';
    if (f.kind === 'flight' && f.checkIn) filters.date.value = f.checkIn;
    if (f.adults) filters[f.kind === 'flight' ? 'passengers' : 'adults'].value = String(f.adults);
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
    setView(f.kind === 'flight' ? 'flights' : 'hotels');
    await search();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = t('Buscar');
  }
}
onSend($('#aiForm'), aiSearchSubmit);
$('#examples').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  $('#aiQuery').value = e.target.textContent;
  aiSearchSubmit();
});

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
  const city = live && !filters.destination.value.trim() ? `<p class="count">${t('Mostrando {city}. Escribe otra ciudad para ver sus hoteles.', { city: esc(live.city) })}</p>` : '';
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
      if (state.data.hasMore) btn.replaceWith(moreHotelsButton());
      else btn.remove();
      if (fresh.length) loadLivePrices(token, fresh);
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

function renderCard(item) {
  const isFlight = state.view === 'flights';
  const ui = state.ui.get(item.id);
  const el = document.createElement('article');
  el.className = 'card';
  el.id = 'card-' + item.id;
  el.hidden = !passesStay(item);
  const s = item.summary;
  const head = isFlight
    ? `<div class="thumb">✈️</div><div>
        <h3>${esc(item.originCity)} → ${esc(item.destinationCity)}</h3>
        <div class="meta">${esc(item.airline)} · ${esc(item.origin)}–${esc(item.destination)} · ${t('sale {time}', { time: esc(item.departure) })} · ${Math.floor(item.duration / 60)} h ${item.duration % 60} min</div>
      </div>`
    : `${item.photo ? `<img class="thumb photo" src="${esc(item.photo)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;thumb&quot;>🏨</div>'">` : `<div class="thumb">${item.image}</div>`}<div>
        <h3>${esc(item.name)}</h3>
        <div class="meta">${STAY_LABEL[item.stay] ? `<span class="stay-type">${t(STAY_LABEL[item.stay])}</span> · ` : ''}${item.stars ? `<span class="stars" aria-label="${t('{n} estrellas', { n: item.stars })}">${'★'.repeat(item.stars)}</span> · ` : ''}${esc(item.city)}, ${esc(item.country)}${item.rating ? ` · <span class="rating">${item.rating.toLocaleString(LOCALE)}</span>${item.reviewCount ? ` <span class="meta">(${tn(item.reviewCount, '{n} opinión', '{n} opiniones', { n: item.reviewCount.toLocaleString(LOCALE) })})</span>` : ''}` : ''}</div>
        ${item.address ? `<div class="meta">📍 ${esc(item.address)}${item.website ? ` · <a href="${esc(item.website)}" target="_blank" rel="noopener noreferrer">${t('Web oficial')} ↗</a>` : ''}</div>` : ''}
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
    if (act === 'book') return openBooking(item, ui, isFlight);
    const day = e.target.closest('.day[data-date]');
    if (day) pickDay(item, ui, day.dataset.date, isFlight);
  });

  bindChart(el, item, isFlight, (d) => {
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

// ---------- Reserva ----------
const dialog = $('#bookDialog');
const bookForm = $('#bookForm');

function bookingRequest() {
  const b = state.booking;
  const g = state.data.guests || {};
  const base = { type: b.isFlight ? 'flight' : 'hotel', itemId: b.item.id, units: bookForm.units.value, adults: g.adults, children: g.children, board: state.data.board || undefined };
  return b.isFlight ? { ...base, date: b.start } : { ...base, checkIn: b.start, checkOut: b.end };
}

async function refreshQuote() {
  const err = $('#bookError');
  const btn = $('#bookConfirm');
  try {
    const q = await api('/api/quote', { method: 'POST', body: JSON.stringify(bookingRequest()) });
    $('#bookTotal').textContent = eur2(q.total);
    state.booking.total = q.total;
    const extra = $('#bookExtra');
    extra.textContent = q.roomName
      ? `${q.roomName}${q.board ? ' · ' + t(q.board) : ''} · ${q.refundable ? (q.freeCancellationUntil ? t('cancelación gratuita hasta el {day}', { day: fmtDay.format(new Date(q.freeCancellationUntil.replace(' ', 'T') + 'Z')) }) : t('cancelación gratuita')) : t('no reembolsable')}`
      : '';
    // Tasas que no van en el total y se pagan en el hotel (p. ej. tasa turística).
    if (q.payAtHotel?.length) extra.textContent += ' · ' + t('además, a pagar en el hotel: {list}', { list: payAtHotelText(q.payAtHotel) });
    extra.hidden = !q.roomName;
    err.hidden = true;
    btn.disabled = !!state.bookingBlocked;
  } catch (e) {
    $('#bookTotal').textContent = '—';
    err.textContent = e.message;
    err.hidden = false;
    btn.disabled = true;
  }
}

function openBooking(item, ui, isFlight) {
  state.booking = { item, isFlight, start: ui.start, end: ui.end };
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
    setView('mine');
    $('#mineForm').email.value = b.email;
    loadMine(b.email);
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
  for (const item of state.items.values()) results.append(liveFlightCard(item));
  loadFlightDays(token);
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
    $('#mineForm').email.value = b.email;
    loadMine(b.email);
  } catch (err) {
    toast(err.message, 15000);
  }
}

// ---------- Mis reservas ----------
async function loadMine(email) {
  const list = $('#mineList');
  try {
    const items = await api(`/api/bookings?email=${encodeURIComponent(email)}`);
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
  if (state.view === 'hotels') { setView(start); search(); }
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

// App instalable (Android, escritorio): funciona sin conexión con la última versión vista.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
