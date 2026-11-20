const labels = {
  page_view: 'Páginas vistas',
  search: 'Consultas realizadas',
  calendar_view: 'Calendarios consultados',
  booking_start: 'Inicios de reserva',
  checkout_start: 'Intentos de preparar el pago',
  checkout_error: 'Errores al preparar el pago',
  payment_form_mounted: 'Formularios de pago montados',
  payment_form_error: 'Errores de carga del formulario',
  payment_error: 'Errores al intentar pagar',
  payment_return: 'Regresos desde la pasarela',
  confirmation_view: 'Confirmaciones mostradas',
};
export const METRIC_EVENTS = Object.keys(labels);
const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function metricsHtml(data) {
  const totals = Object.fromEntries(METRIC_EVENTS.map(e => [e, data.rows.filter(r => r.event === e).reduce((n,r)=>n+Number(r.count),0)]));
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>Estadísticas · DíasLibres</title><link rel="stylesheet" href="/styles.css"><main style="max-width:960px;margin:40px auto;padding:24px"><a href="/">← DíasLibres</a><h1>Estadísticas de DíasLibres</h1><p>${esc(data.start)} — ${esc(data.end)} · Fechas UTC</p><p>Contadores agregados desde su activación. Las páginas vistas no son visitantes únicos. Las consultas incluyen filtros y búsquedas automáticas; las confirmaciones mostradas pueden repetirse. Volver desde la pasarela no acredita un cobro. Antes de esta actualización, el inicio de pago se registraba al cargar el SDK.</p><table style="width:100%;text-align:left;border-spacing:12px"><thead><tr><th>Acción</th><th>Total</th></tr></thead><tbody>${METRIC_EVENTS.map(e=>`<tr><td>${labels[e]}</td><td>${totals[e]}</td></tr>`).join('')}<tr><td>Reservas reales actualmente confirmadas, creadas en este periodo</td><td>${data.confirmedBookings}</td></tr></tbody></table><p>Solo se guardan el día, el tipo de acción y su contador. No se guardan identificadores de visitante, emails, textos de búsqueda ni direcciones IP en estas estadísticas.</p><h2>Visibilidad en Google</h2><p>Estos contadores no miden impresiones ni posiciones en Google. Consulta <a href="https://search.google.com/search-console">Search Console</a> para revisar búsquedas, clics e indexación.</p></main></html>`;
}
