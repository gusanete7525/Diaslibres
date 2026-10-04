import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mailer } from '../src/mail.js';
import { createApp } from '../server.js';
import { BookingStore } from '../src/store.js';

test('email de confirmación con Resend: datos, escape de HTML y aviso de prueba', async () => {
  const sent = [];
  const m = new Mailer({ apiKey: 're_test', from: 'DíasLibres <reservas@diaslibres.es>', fetchImpl: async (url, opts) => { sent.push({ url, opts, body: JSON.parse(opts.body) }); return new Response('{}'); } });
  const r = await m.bookingConfirmed({ code: 'DL-ABC123', email: 'ana@test.com', name: '<Ana>', itemName: 'Hotel & Spa', checkIn: '2026-11-10', checkOut: '2026-11-12', total: 241.5, provider: 'liteapi', sandbox: true, refundable: true, freeCancellationUntil: '2026-11-08 12:00:00', providerBookingId: 'BK1' });
  assert.equal(r.sent, true);
  const { url, opts, body } = sent[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(opts.headers.Authorization, 'Bearer re_test');
  assert.deepEqual(body.to, ['ana@test.com']);
  assert.equal(body.from, 'DíasLibres <reservas@diaslibres.es>');
  assert.match(body.subject, /^\[Prueba\] Reserva confirmada DL-ABC123/);
  assert.match(body.html, /&lt;Ana&gt;/);
  assert.match(body.html, /Hotel &amp; Spa/);
  assert.match(body.html, /241,50/);
  assert.match(body.html, /Gratuita hasta 2026-11-08/);
  assert.doesNotMatch(body.html, /<Ana>/);
});

test('sin clave no se envía nada, y un fallo de Resend no rompe nada', async () => {
  let calls = 0;
  const off = new Mailer({ apiKey: '', fetchImpl: async () => { calls++; return new Response('{}'); } });
  assert.equal(off.enabled, false);
  assert.deepEqual(await off.bookingConfirmed({ email: 'a@b.c', total: 1 }), { sent: false });
  assert.equal(calls, 0);
  const failing = new Mailer({ apiKey: 're_x', fetchImpl: async () => new Response('nope', { status: 500 }) });
  const r = await failing.bookingCancelled({ code: 'DL-1', email: 'a@b.c', name: 'A', itemName: 'X' });
  assert.equal(r.sent, false);
  assert.match(r.error, /500/);
});

test('la web envía el email al reservar y al cancelar', async () => {
  const events = [];
  const mailer = { enabled: true, bookingConfirmed: async (b) => events.push(['ok', b.code]), bookingCancelled: async (b) => events.push(['cancel', b.code]) };
  const server = createApp({ store: new BookingStore(null), osm: null, live: null, mailer }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const h = (await fetch(`${base}/api/hotels?destination=malaga&nights=2`).then((r) => r.json())).results[0];
    const b = await post('/api/bookings', { type: 'hotel', itemId: h.id, checkIn: h.bestStay.checkIn, checkOut: h.bestStay.checkOut, name: 'Eva', email: 'eva@test.com' }).then((r) => r.json());
    await post(`/api/bookings/${b.code}/cancel`, { email: 'eva@test.com' });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(events, [['ok', b.code], ['cancel', b.code]]);
  } finally {
    server.close();
  }
});
