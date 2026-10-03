// DíasLibres — interfaz. Vanilla JS, sin dependencias.

const $ = (sel, el = document) => el.querySelector(sel);
const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const fmtDay = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtShort = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtMonth = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const eur = (n) => `${Math.round(n).toLocaleString('es-ES')} €`;
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
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
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
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Error de conexión');
  return body;
}

function setFooter(live) {
  const el = $('#footerNote');
  if (!el) return;
  el.textContent = live
    ? 'Hoteles, precios y disponibilidad de LiteAPI' + (state.data?.live?.sandbox ? ' (entorno de pruebas: las reservas son de prueba y no se cobran)' : '') + '. Los vuelos son simulados.'
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
  filters.destination.placeholder = view === 'flights' ? 'Ciudad o aeropuerto' : 'Escribe cualquier ciudad';
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
  for (const [k, v] of fd) if (v) p.set(k, v);
  if (state.view === 'flights') { p.delete('nights'); p.delete('sort'); p.delete('tags'); p.delete('minStars'); }
  else p.delete('origin');
  return p;
}

let searchToken = 0;
async function search() {
  const token = ++searchToken;
  results.classList.add('loading');
  if (state.view === 'hotels' && filters.destination.value.trim()) {
    results.innerHTML = `<p class="count">Buscando hoteles en ${esc(filters.destination.value.trim())}…</p>`;
  }
  try {
    const p = filterParams();
    const data = await api(`/api/${state.view === 'flights' ? 'flights' : 'hotels'}?${p}`);
    state.data = data;
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

// ---------- Precios reales (LiteAPI): se cargan por semanas y rellenan el calendario ----------
async function loadLivePrices(token) {
  const { start, days, results: list } = state.data;
  const ids = list.map((h) => h.id).join(',');
  for (let off = 0; off < days; off += 7) {
    if (token !== searchToken) return; // hay una búsqueda más nueva
    let res;
    try {
      res = await api(`/api/live/prices?ids=${encodeURIComponent(ids)}&start=${addDays(start, off)}&days=${Math.min(7, days - off)}`);
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
      rerender(id);
    }
    const loaded = Math.min(days, off + 7);
    const note = $('#livePending');
    if (note) note.textContent = loaded < days ? `Cargando precios reales… ${loaded}/${days} días` : '';
  }
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
  filters.tags.value = filters.minStars.value = filters.checkIn.value = '';
  $('#aiExplain').hidden = true;
  search();
});

async function aiSearchSubmit() {
  const query = $('#aiQuery').value.trim();
  if (!query) return;
  const btn = $('#aiForm button');
  btn.disabled = true;
  btn.textContent = 'Pensando…';
  try {
    const f = await api('/api/ai-search', { method: 'POST', body: JSON.stringify({ query }) });
    filters.reset();
    filters.destination.value = f.destination || '';
    filters.origin.value = f.origin || '';
    filters.maxPrice.value = f.maxPrice || '';
    filters.nights.value = f.nights || 3;
    filters.sort.value = f.sort || 'stars';
    filters.tags.value = (f.tags || []).join(',');
    filters.minStars.value = f.minStars || '';
    filters.checkIn.value = f.checkIn || '';
    const ex = $('#aiExplain');
    ex.textContent = `${f.source === 'claude' ? '✨' : '🔎'} ${f.explanation}`;
    ex.hidden = false;
    setView(f.kind === 'flight' ? 'flights' : 'hotels');
    await search();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buscar';
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
    results.innerHTML = warnings + '<p class="empty">No hay resultados con esos filtros. Prueba con otra ciudad o quita algún filtro.</p>';
    return;
  }
  const one = list.length === 1;
  const kind = state.view === 'flights' ? (one ? 'vuelo' : 'vuelos') : one ? 'hotel' : 'hoteles';
  const osmNote = (osm?.count ? ` · ${osm.count} de OpenStreetMap` : '') + (ai?.count ? ` · ${ai.count} sugerido${ai.count > 1 ? 's' : ''} por IA` : '');
  const live = state.data.live;
  const liveNote = live ? ` · precios y disponibilidad reales de LiteAPI${live.sandbox ? ' (entorno de pruebas)' : ''}` : '';
  const city = live && !filters.destination.value.trim() ? `<p class="count">Mostrando ${esc(live.city)}. Escribe otra ciudad para ver sus hoteles.</p>` : '';
  results.innerHTML = `<p class="count">${list.length} ${kind}${osmNote}${liveNote} · próximos ${state.data.days} días</p>${city}${live ? '<p class="count" id="livePending">Cargando precios reales…</p>' : ''}${warnings}`;
  setFooter(!!live);
  for (const item of list) results.append(renderCard(item));
}

function rerender(id) {
  const old = document.getElementById('card-' + id);
  if (old) old.replaceWith(renderCard(state.items.get(id)));
}

function renderCard(item) {
  const isFlight = state.view === 'flights';
  const ui = state.ui.get(item.id);
  const el = document.createElement('article');
  el.className = 'card';
  el.id = 'card-' + item.id;
  const s = item.summary;
  const head = isFlight
    ? `<div class="thumb">✈️</div><div>
        <h3>${esc(item.originCity)} → ${esc(item.destinationCity)}</h3>
        <div class="meta">${esc(item.airline)} · ${esc(item.origin)}–${esc(item.destination)} · sale ${esc(item.departure)} · ${Math.floor(item.duration / 60)} h ${item.duration % 60} min</div>
      </div>`
    : `${item.photo ? `<img class="thumb photo" src="${esc(item.photo)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;thumb&quot;>🏨</div>'">` : `<div class="thumb">${item.image}</div>`}<div>
        <h3>${esc(item.name)}</h3>
        <div class="meta">${item.stars ? `<span class="stars" aria-label="${item.stars} estrellas">${'★'.repeat(item.stars)}</span> · ` : ''}${esc(item.city)}, ${esc(item.country)}${item.rating ? ` · <span class="rating">${String(item.rating).replace('.', ',')}</span>${item.reviewCount ? ` <span class="meta">(${item.reviewCount.toLocaleString('es-ES')} opiniones)</span>` : ''}` : ''}</div>
        ${item.address ? `<div class="meta">📍 ${esc(item.address)}${item.website ? ` · <a href="${esc(item.website)}" target="_blank" rel="noopener noreferrer">Web oficial ↗</a>` : ''}</div>` : ''}
        <div class="tags">${item.origin === 'osm' ? `<a class="tag osm" href="${esc(item.source)}" target="_blank" rel="noopener noreferrer" title="Ficha en OpenStreetMap">🗺️ OpenStreetMap</a>` : ''}${item.origin === 'ai' ? '<span class="tag osm" title="Datos sugeridos por IA: compruébalos antes de viajar">✨ Sugerido por IA</span>' : ''}${item.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      </div>`;
  el.innerHTML = `
    <div>
      <div class="card-head">${head}</div>
      ${isFlight ? '' : `<p class="desc">${esc(item.description)}</p>`}
      <div class="stats">
        <span>Desde <b>${s.minPrice != null ? eur(s.minPrice) : '—'}</b></span>
        <span>Media <b>${s.avgPrice != null ? eur(s.avgPrice) : '—'}</b></span>
        <span>Días libres <b>${s.freeDays}/${item.calendar.length}</b></span>
      </div>
      ${renderChart(item, ui, isFlight)}
    </div>
    <div>
      ${renderCalendar(item, ui)}
      <div class="selection">${selectionText(item, ui, isFlight)}</div>
      <div class="card-actions">
        ${!isFlight && item.bestStay ? `<button class="btn" data-act="best">💡 Días más baratos (${state.data.nights} noches)</button>` : ''}
        <button class="btn primary" data-act="book" ${canBook(ui, isFlight) ? '' : 'disabled'}>Reservar</button>
      </div>
    </div>`;
  bindCard(el, item, isFlight);
  return el;
}

const canBook = (ui, isFlight) => (isFlight ? !!ui.start : !!(ui.start && ui.end));

function selectionText(item, ui, isFlight) {
  if (isFlight) {
    if (!ui.start) return 'Toca un día <b>verde</b> para elegir la fecha del vuelo.';
    const d = item.calendar.find((x) => x.date === ui.start);
    return `Vuelo el <b>${fmtDay.format(toDate(ui.start))}</b> · ${eur(d.price)} · quedan ${d.left} plazas`;
  }
  if (!ui.start) return 'Toca un día <b>verde</b> para la entrada; después, el día de salida.';
  if (!ui.end) return `Entrada <b>${fmtDay.format(toDate(ui.start))}</b>. Ahora elige el día de salida.`;
  const nights = diffDays(ui.start, ui.end);
  const total = stayDays(item, ui).reduce((a, d) => a + d.price, 0);
  return `<b>${fmtShort.format(toDate(ui.start))} → ${fmtShort.format(toDate(ui.end))}</b> · ${nights} noche${nights > 1 ? 's' : ''} · <b>${eur(total)}</b>`;
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
    const label = `${fmtDay.format(toDate(iso))}: ${d.pending ? 'cargando precio' : d.available ? `libre, ${d.price} €` : 'completo'}`;
    cells += `<button class="${cls.join(' ')}" data-date="${iso}" aria-label="${label}"><span>${n}</span><small>${d.pending ? '…' : d.available ? d.price : '—'}</small></button>`;
  }
  return `<div class="cal">
    <div class="cal-head">
      <button data-act="prev" aria-label="Mes anterior" ${ui.month <= 0 ? 'disabled' : ''}>‹</button>
      <strong>${cap(fmtMonth.format(mDate))}</strong>
      <button data-act="next" aria-label="Mes siguiente" ${ui.month >= months - 1 ? 'disabled' : ''}>›</button>
    </div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-legend">
      <span><i style="background:var(--good-bg);outline:1px solid var(--good)"></i>Libre (precio €)</span>
      <span><i style="background:var(--bad-bg);outline:1px solid var(--bad)"></i>Completo</span>
      <span>★ Más barato</span>
    </div>
  </div>`;
}

function renderChart(item, ui, isFlight) {
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
      <span><strong>Precio por ${isFlight ? 'billete' : 'noche'}</strong> · próximos ${n} días</span>
      <span class="legend"><span><i style="background:var(--series-1)"></i>Libre</span><span><i style="background:var(--muted-bar)"></i>Completo</span></span>
    </div>
    <div class="chart">
      <div class="yaxis"><span>${max} €</span><span>${max / 2} €</span><span></span></div>
      <div class="plot">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Gráfica de precios diarios. Mínimo ${cheap ? eur(cheap.price) + ' el ' + fmtShort.format(toDate(cheap.date)) : 'sin días libres'}.">${grid}${bars}</svg>
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
    hovered.classList.add('hover');
    showTip(`<b>${fmtDay.format(toDate(d.date))}</b><br>${dayText(d, isFlight)}`, e.clientX, svg.getBoundingClientRect().top);
  });
  plot.addEventListener('pointerleave', () => { hovered?.classList.remove('hover'); hideTip(); });
  plot.addEventListener('click', (e) => {
    const d = item.calendar[locate(e)];
    ui.month = monthIndex(state.data.start, d.date);
    hideTip();
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

function dayText(d, isFlight) {
  if (d.pending) return 'Cargando precio…';
  if (!d.available) return d.price != null ? `${eur(d.price)} · completo` : 'Completo';
  return `${eur(d.price)} · ${d.left != null ? `quedan ${d.left} ${isFlight ? 'plazas' : 'hab.'}` : 'disponible'}`;
}

function pickDay(item, ui, iso, isFlight) {
  const cal = item.calendar;
  const idx = diffDays(state.data.start, iso);
  const d = cal[idx];
  if (d.pending || (ui.picking === 'end' && ui.start && iso > ui.start && cal.slice(diffDays(state.data.start, ui.start), idx).some((x) => x.pending))) {
    return toast('Todavía estamos cargando los precios de esos días.');
  }
  if (isFlight) {
    if (!d.available) return toast('Ese vuelo está completo ese día.');
    ui.start = iso;
    return rerender(item.id);
  }
  // Segundo clic: día de salida (puede ser un día completo, porque esa noche no se duerme).
  if (ui.picking === 'end' && ui.start && iso > ui.start) {
    const nights = cal.slice(diffDays(state.data.start, ui.start), idx);
    if (nights.length > 30) return toast('Máximo 30 noches por reserva.');
    if (nights.every((x) => x.available)) {
      ui.end = iso;
      ui.picking = 'start';
      return rerender(item.id);
    }
    if (!d.available) return toast('Hay noches completas entre esas fechas.');
  }
  if (!d.available) return toast('Ese día está completo. Elige un día verde.');
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
  const base = { type: b.isFlight ? 'flight' : 'hotel', itemId: b.item.id, units: bookForm.units.value };
  return b.isFlight ? { ...base, date: b.start } : { ...base, checkIn: b.start, checkOut: b.end };
}

async function refreshQuote() {
  const err = $('#bookError');
  const btn = $('#bookConfirm');
  try {
    const q = await api('/api/quote', { method: 'POST', body: JSON.stringify(bookingRequest()) });
    $('#bookTotal').textContent = eur(q.total);
    state.booking.total = q.total;
    const extra = $('#bookExtra');
    extra.textContent = q.roomName
      ? `${q.roomName}${q.board ? ' · ' + q.board : ''} · ${q.refundable ? `cancelación gratuita${q.freeCancellationUntil ? ' hasta el ' + fmtDay.format(new Date(q.freeCancellationUntil.replace(' ', 'T') + 'Z')) : ''}` : 'no reembolsable'}`
      : '';
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
  $('#bookTitle').textContent = isFlight ? 'Reservar vuelo' : 'Reservar hotel';
  $('#unitsLabel').textContent = isFlight ? 'Pasajeros' : 'Habitaciones';
  $('#bookSummary').innerHTML = isFlight
    ? `<b>${esc(item.airline)}</b> ${esc(item.originCity)} → ${esc(item.destinationCity)}<br>${fmtDay.format(toDate(ui.start))} · sale ${esc(item.departure)}`
    : `<b>${esc(item.name)}</b> · ${esc(item.city)}<br>${fmtDay.format(toDate(ui.start))} → ${fmtDay.format(toDate(ui.end))} (${diffDays(ui.start, ui.end)} noches)`;
  bookForm.units.value = '1';
  bookForm.email.value ||= store.get('dl-email') || '';
  $('#bookError').hidden = true;
  $('#bookTotal').textContent = '…';
  $('#bookExtra').hidden = true;
  state.bookingBlocked = !isFlight && item.origin === 'liteapi' && state.data.live?.bookingEnabled === false;
  $('#bookConfirm').hidden = state.bookingBlocked;
  if (state.bookingBlocked) {
    $('#bookSummary').insertAdjacentHTML('beforeend', '<br><span class="meta">Precio real de hoy. En esta demostración no se puede reservar.</span>');
  }
  dialog.showModal();
  refreshQuote();
}
bookForm.units.addEventListener('change', refreshQuote);

$('#bookCancel').addEventListener('click', () => dialog.close());
onSend(bookForm, async () => {
  const btn = $('#bookConfirm');
  btn.disabled = true;
  btn.textContent = 'Reservando…';
  try {
    const booking = await api('/api/bookings', {
      method: 'POST',
      body: JSON.stringify({ ...bookingRequest(), expectedTotal: state.booking.total, name: bookForm.name.value, email: bookForm.email.value }),
    });
    store.set('dl-email', booking.email);
    dialog.close();
    toast(`✅ ${booking.sandbox ? 'Reserva de prueba confirmada' : 'Reserva confirmada'} · código ${booking.code} · ${eur(booking.total)}`);
    await search();
  } catch (err) {
    if (/precio ha cambiado/.test(err.message)) await refreshQuote(); // muestra el total nuevo
    const box = $('#bookError');
    box.textContent = err.message;
    box.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmar reserva';
  }
});

// ---------- Mis reservas ----------
async function loadMine(email) {
  const list = $('#mineList');
  try {
    const items = await api(`/api/bookings?email=${encodeURIComponent(email)}`);
    if (!items.length) { list.innerHTML = '<p class="empty">No hay reservas con ese email.</p>'; return; }
    list.innerHTML = items.map((b) => `
      <div class="booking">
        <div>
          <div><b>${esc(b.itemName)}</b></div>
          <div class="meta">${b.type === 'hotel' ? `${fmtDay.format(toDate(b.checkIn))} → ${fmtDay.format(toDate(b.checkOut))} · ${b.units} hab.` : `${fmtDay.format(toDate(b.date))} · ${b.units} pasajero${b.units > 1 ? 's' : ''}`} · ${eur(b.total)}</div>
          ${b.provider === 'liteapi' ? `<div class="meta">LiteAPI${b.sandbox ? ' (prueba)' : ''} · ref. ${esc(b.providerBookingId)}${b.roomName ? ' · ' + esc(b.roomName) : ''} · ${b.refundable ? 'cancelación gratuita' : 'no reembolsable'}${b.cancellation ? ` · reembolso ${eur(b.cancellation.refund ?? 0)}` : ''}</div>` : ''}
          <div class="meta">Código <b>${esc(b.code)}</b> · <span class="status ${b.status === 'confirmada' ? 'ok' : 'ko'}">${b.status === 'confirmada' ? '✔' : '✖'} ${esc(b.status)}</span></div>
        </div>
        ${b.status === 'confirmada' ? `<button class="btn" data-cancel="${esc(b.code)}">Cancelar</button>` : ''}
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
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = '¿Seguro? Pulsa otra vez';
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Cancelar'; } }, 4000);
    return;
  }
  const email = $('#mineForm').email.value.trim();
  try {
    await api(`/api/bookings/${encodeURIComponent(code)}/cancel`, { method: 'POST', body: JSON.stringify({ email }) });
    toast('Reserva cancelada. Los días vuelven a estar libres.');
    loadMine(email);
  } catch (err) {
    toast(err.message);
  }
});

// ---------- Inicio ----------
(async () => {
  try {
    const airports = await api('/api/airports');
    const cities = new Set([...Object.values(airports), 'Benasque']);
    $('#destList').innerHTML = [...cities].sort().map((c) => `<option value="${esc(c)}">`).join('');
  } catch { /* datalist opcional */ }
  setView('hotels');
  search();
})();
