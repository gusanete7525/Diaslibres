// Emails al cliente (confirmación y cancelación) con Resend (https://resend.com).
// Se activa con RESEND_API_KEY; MAIL_FROM fija el remitente (dominio verificado en
// Resend). Sin clave no se envía nada y la web funciona igual. ADMIN_EMAIL recibe
// los avisos internos (p. ej. un pago cobrado cuya reserva no confirmó el hotel).

import { LANGS, tr } from './i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// El email va en el idioma en que se hizo la reserva (b.lang).
const locale = (lang) => LANGS[lang]?.locale || 'es-ES';
const money = (n, currency = 'EUR', lang = 'es') => Number(n).toLocaleString(locale(lang), { style: 'currency', currency });
const day = (iso, lang = 'es') =>
  iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString(locale(lang), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';

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
    const l = b.lang || 'es';
    const t = (k, v) => tr(l, k, v);
    const d = (iso) => day(iso, l);
    const rows = [
      [t('Código'), b.code],
      [t('Alojamiento'), b.itemName],
      b.checkIn ? [t('Entrada'), d(b.checkIn)] : b.date ? [b.type === 'flight' ? t('Ida') : t('Fecha'), d(b.date) + flightTimes(b.flight?.outbound)] : null,
      b.checkOut ? [t('Salida'), d(b.checkOut)] : null,
      b.returnDate ? [t('Vuelta'), d(b.returnDate) + flightTimes(b.flight?.inbound)] : null,
      b.passengers?.length ? [t('Pasajeros'), b.passengers.join(', ')] : null,
      b.pnr ? [t('Localizador de la aerolínea'), b.pnr] : null,
      b.roomName ? [t('Habitación'), b.roomName] : null,
      [t('Total pagado'), money(b.total, 'EUR', l)],
      ...(b.payAtHotel || []).map((x) => [t('A pagar en el hotel: {list}', { list: x.description }), money(x.amount, x.currency, l)]),
      b.provider === 'liteapi' && b.type === 'flight' ? [t('Tarifa'), b.refundable ? t('Reembolsable (con las condiciones de la aerolínea)') : t('No reembolsable')] : null,
      b.provider === 'liteapi' && b.type !== 'flight' ? [t('Cancelación'), b.refundable ? (b.freeCancellationUntil ? t('Gratuita hasta {date} (GMT)', { date: b.freeCancellationUntil }) : t('Gratuita')) : t('No reembolsable')] : null,
      b.providerBookingId ? [t('Referencia del proveedor'), b.providerBookingId] : null,
    ].filter(Boolean);
    const test = b.sandbox || b.provider !== 'liteapi';
    return this.#send(
      b.email,
      `${test ? t('[Prueba]') + ' ' : ''}${t('Reserva confirmada {code} · DíasLibres', { code: b.code })}`,
      layout(
        esc(t('Hola {name}, tu reserva está confirmada.', { name: b.name })),
        table(rows) +
          (test ? `<p style="color:#8c1f1f">${esc(t('Es una reserva de prueba: no se ha cobrado nada y no es válida para viajar ni en el hotel.'))}</p>` : '') +
          `<p>${esc(t('Puedes consultarla o cancelarla en «Mis reservas» con este email.'))}</p>`,
        l,
      ),
    );
  }

  bookingCancelled(b) {
    const l = b.lang || 'es';
    const t = (k, v) => tr(l, k, v);
    const refund = b.cancellation?.refund;
    return this.#send(
      b.email,
      t('Reserva cancelada {code} · DíasLibres', { code: b.code }),
      layout(
        esc(t('Hola {name}, hemos cancelado tu reserva.', { name: b.name })),
        table([
          [t('Código'), b.code],
          [t('Alojamiento'), b.itemName],
          refund != null ? [t('Reembolso'), Number(refund) > 0 ? money(refund, 'EUR', l) : t('Sin reembolso')] : null,
        ].filter(Boolean)),
        l,
      ),
    );
  }

  // Enlace para entrar en la cuenta (sin contraseña). Caduca en 30 minutos.
  loginLink({ email, url, lang = 'es' }) {
    const t = (k, v) => tr(lang, k, v);
    return this.#send(
      email,
      t('Tu enlace para entrar en DíasLibres'),
      layout(
        esc(t('Pulsa el botón para entrar en tu cuenta. El enlace caduca en 30 minutos y solo sirve una vez.')),
        `<p style="margin:20px 0"><a href="${esc(url)}" style="background:#2a78d6;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;display:inline-block">${esc(t('Entrar en DíasLibres'))}</a></p>` +
          `<p style="color:#52514e;font-size:13px">${esc(t('Si no lo has pedido tú, ignora este email: nadie podrá entrar sin él.'))}</p>`,
        lang,
        t('Este email se ha enviado porque alguien pidió entrar en DíasLibres con esta dirección.'),
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

function layout(title, body, lang = 'es', footer = tr(lang, 'Este email se ha enviado porque se hizo una reserva con esta dirección.')) {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0b0b0b;max-width:560px">
  <p style="font-size:22px;font-weight:800;margin:0 0 12px">Días<span style="color:#2a78d6">Libres</span></p>
  <p style="font-size:16px">${title}</p>${body}
  <p style="color:#75746f;font-size:12px;margin-top:24px">DíasLibres · ${esc(footer)}</p>
</div>`;
}
