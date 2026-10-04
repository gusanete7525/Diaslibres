// Emails al cliente (confirmación y cancelación) con Resend (https://resend.com).
// Se activa con RESEND_API_KEY; MAIL_FROM fija el remitente (dominio verificado en
// Resend). Sin clave no se envía nada y la web funciona igual. ADMIN_EMAIL recibe
// los avisos internos (p. ej. un pago cobrado cuya reserva no confirmó el hotel).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n, currency = 'EUR') => Number(n).toLocaleString('es-ES', { style: 'currency', currency });
const day = (iso) =>
  iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';

export class Mailer {
  constructor({ apiKey = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM, admin = process.env.ADMIN_EMAIL, fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.admin = String(admin || '').trim();
    this.from = from || 'DíasLibres <onboarding@resend.dev>';
    this.fetch = fetchImpl;
    this.lastError = null; // último error de Resend (sin la clave), para /api/health
  }

  // Estado para /api/health: si está activo, con qué remitente y el último fallo.
  get status() {
    return { enabled: this.enabled, from: this.from, admin: !!this.admin, lastError: this.lastError };
  }

  get enabled() {
    return !!this.apiKey;
  }

  async #send(to, subject, html) {
    if (!this.enabled) {
      console.warn('[email] RESEND_API_KEY no está configurada: no se envía el email a', to);
      return { sent: false };
    }
    try {
      const res = await this.fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [to], subject, html }),
      });
      if (!res.ok) {
        let msg = `Resend respondió ${res.status}: ${(await res.text()).slice(0, 200)}`;
        // Con el remitente de pruebas de Resend solo se puede enviar al email de la
        // propia cuenta de Resend; para el resto hay que verificar un dominio.
        if (/resend\.dev/i.test(this.from) && (res.status === 403 || res.status === 422)) {
          msg += ' — Con el remitente onboarding@resend.dev solo se envía al email de tu cuenta de Resend: verifica un dominio en Resend y ponlo en MAIL_FROM.';
        }
        throw new Error(msg);
      }
      this.lastError = null;
      return { sent: true };
    } catch (err) {
      // Un fallo del email nunca deshace la reserva: se registra y sigue.
      console.error('[email]', err.message);
      this.lastError = { at: new Date().toISOString(), message: err.message.slice(0, 400) };
      return { sent: false, error: err.message };
    }
  }

  bookingConfirmed(b) {
    const rows = [
      ['Código', b.code],
      ['Alojamiento', b.itemName],
      b.checkIn ? ['Entrada', day(b.checkIn)] : b.date ? [b.type === 'flight' ? 'Ida' : 'Fecha', day(b.date) + flightTimes(b.flight?.outbound)] : null,
      b.checkOut ? ['Salida', day(b.checkOut)] : null,
      b.returnDate ? ['Vuelta', day(b.returnDate) + flightTimes(b.flight?.inbound)] : null,
      b.passengers?.length ? ['Pasajeros', b.passengers.join(', ')] : null,
      b.pnr ? ['Localizador de la aerolínea', b.pnr] : null,
      b.roomName ? ['Habitación', b.roomName] : null,
      ['Total pagado', money(b.total)],
      ...(b.payAtHotel || []).map((t) => [`A pagar en el hotel: ${t.description}`, money(t.amount, t.currency)]),
      b.provider === 'liteapi' && b.type === 'flight' ? ['Tarifa', b.refundable ? 'Reembolsable (con las condiciones de la aerolínea)' : 'No reembolsable'] : null,
      b.provider === 'liteapi' && b.type !== 'flight' ? ['Cancelación', b.refundable ? `Gratuita${b.freeCancellationUntil ? ' hasta ' + b.freeCancellationUntil + ' (GMT)' : ''}` : 'No reembolsable'] : null,
      b.providerBookingId ? ['Referencia del proveedor', b.providerBookingId] : null,
    ].filter(Boolean);
    const test = b.sandbox || b.provider !== 'liteapi';
    return this.#send(
      b.email,
      `${test ? '[Prueba] ' : ''}Reserva confirmada ${b.code} · DíasLibres`,
      layout(
        `Hola ${esc(b.name)}, tu reserva está confirmada.`,
        table(rows) +
          (test ? '<p style="color:#8c1f1f">Es una reserva de prueba: no se ha cobrado nada y no es válida para viajar ni en el hotel.</p>' : '') +
          '<p>Puedes consultarla o cancelarla en «Mis reservas» con este email.</p>',
      ),
    );
  }

  bookingCancelled(b) {
    const refund = b.cancellation?.refund;
    return this.#send(
      b.email,
      `Reserva cancelada ${b.code} · DíasLibres`,
      layout(
        `Hola ${esc(b.name)}, hemos cancelado tu reserva.`,
        table([
          ['Código', b.code],
          ['Alojamiento', b.itemName],
          refund != null ? ['Reembolso', Number(refund) > 0 ? money(refund) : 'Sin reembolso'] : null,
        ].filter(Boolean)),
      ),
    );
  }

  // Aviso interno: el cliente pagó, pero LiteAPI no confirmó la reserva.
  paymentWithoutBooking(b) {
    if (!this.admin) {
      console.error('[email] ADMIN_EMAIL no está configurado: nadie recibe el aviso de pago sin reserva', b.code);
      return { sent: false };
    }
    return this.#send(
      this.admin,
      `⚠️ Pago sin reserva ${b.code}${b.sandbox ? ' [Prueba]' : ''} · DíasLibres`,
      layout(
        'Un cliente ha pagado, pero el hotel no ha confirmado la reserva. Revísalo en el panel de LiteAPI y devuelve el pago o rehaz la reserva.',
        table([
          ['Código', b.code],
          ['Cliente', `${b.name} <${b.email}>`],
          ['Alojamiento', b.itemName],
          ['Fechas', b.checkIn ? `${b.checkIn} → ${b.checkOut}` : `${b.date}${b.returnDate ? ' → ' + b.returnDate : ''}`],
          ['Importe', money(b.total)],
          ['Transacción', b.transactionId || '—'],
          ['Prebook', b.prebookId || '—'],
          ['Error', b.error || '—'],
        ]),
      ),
    );
  }
}

// « · 08:15 MAD → 10:30 LIS» con las horas locales del vuelo.
function flightTimes(leg) {
  if (!leg?.departure) return '';
  const t = (iso) => String(iso).slice(11, 16);
  return ` · ${t(leg.departure)} ${leg.from} → ${t(leg.arrival)} ${leg.to}`;
}

function table(rows) {
  return `<table style="border-collapse:collapse;margin:12px 0">${rows
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#52514e">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`)
    .join('')}</table>`;
}

function layout(title, body) {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0b0b0b;max-width:560px">
  <p style="font-size:22px;font-weight:800;margin:0 0 12px">Días<span style="color:#2a78d6">Libres</span></p>
  <p style="font-size:16px">${title}</p>${body}
  <p style="color:#75746f;font-size:12px;margin-top:24px">DíasLibres · Este email se ha enviado porque se hizo una reserva con esta dirección.</p>
</div>`;
}
