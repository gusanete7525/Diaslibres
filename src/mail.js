// Emails al cliente (confirmación y cancelación) con Resend (https://resend.com).
// Se activa con RESEND_API_KEY; MAIL_FROM fija el remitente (dominio verificado en
// Resend). Sin clave no se envía nada y la web funciona igual.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => Number(n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const day = (iso) =>
  iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';

export class Mailer {
  constructor({ apiKey = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM, fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.from = from || 'DíasLibres <onboarding@resend.dev>';
    this.fetch = fetchImpl;
  }

  get enabled() {
    return !!this.apiKey;
  }

  async #send(to, subject, html) {
    if (!this.enabled) return { sent: false };
    try {
      const res = await this.fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [to], subject, html }),
      });
      if (!res.ok) throw new Error(`Resend respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return { sent: true };
    } catch (err) {
      // Un fallo del email nunca deshace la reserva: se registra y sigue.
      console.error('[email]', err.message);
      return { sent: false, error: err.message };
    }
  }

  bookingConfirmed(b) {
    const rows = [
      ['Código', b.code],
      ['Alojamiento', b.itemName],
      b.checkIn ? ['Entrada', day(b.checkIn)] : b.date ? ['Fecha', day(b.date)] : null,
      b.checkOut ? ['Salida', day(b.checkOut)] : null,
      b.roomName ? ['Habitación', b.roomName] : null,
      ['Total', money(b.total)],
      b.provider === 'liteapi' ? ['Cancelación', b.refundable ? `Gratuita${b.freeCancellationUntil ? ' hasta ' + b.freeCancellationUntil + ' (GMT)' : ''}` : 'No reembolsable'] : null,
      b.providerBookingId ? ['Referencia del proveedor', b.providerBookingId] : null,
    ].filter(Boolean);
    const test = b.sandbox || b.provider !== 'liteapi';
    return this.#send(
      b.email,
      `${test ? '[Prueba] ' : ''}Reserva confirmada ${b.code} · DíasLibres`,
      layout(
        `Hola ${esc(b.name)}, tu reserva está confirmada.`,
        table(rows) +
          (test ? '<p style="color:#8c1f1f">Es una reserva de prueba: no se ha cobrado nada y no es válida en el hotel.</p>' : '') +
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
          refund != null ? ['Reembolso', money(refund)] : null,
        ].filter(Boolean)),
      ),
    );
  }
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
