import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { BookingStore } from '../src/store.js';
import { PaymentPendingError } from '../src/liteapi.js';

delete process.env.ANTHROPIC_API_KEY;
const MIN = 60 * 1000;
const NOW = Date.parse('2026-10-08T12:00:00Z');
const ago = (minutes) => new Date(NOW - minutes * MIN).toISOString();

// Cada prerreserva responde como se le diga: pagada, sin pagar o con un fallo del hotel.
function setup(outcomes) {
  const store = new BookingStore(null);
  const calls = [];
  const live = {
    sandbox: true,
    flightOffer: () => null,
    confirm: async ({ prebookId }) => {
      calls.push(prebookId);
      const outcome = outcomes[prebookId];
      if (outcome === 'paid') return { bookingId: 'BK-' + prebookId, total: 100 };
      if (outcome === 'unpaid') throw new PaymentPendingError();
      throw new Error('supplier rejected');
    },
  };
  const mails = [];
  const mailer = { bookingConfirmed: async (b) => mails.push(['ok', b.code]), paymentWithoutBooking: async (b) => mails.push(['alarma', b.code]) };
  const app = createApp({ store, osm: null, live, mailer, reconcileEveryMs: 0 });
  const add = (code, prebookId, minutes, extra = {}) => store.add({ code, checkoutId: 'chk-' + code, prebookId, transactionId: 'tr', status: 'pendiente_pago', type: 'hotel', provider: 'liteapi', email: 'ana@test.com', name: 'Ana', units: 1, total: 100, createdAt: ago(minutes), ...extra });
  return { store, app, calls, mails, add };
}
const flush = () => new Promise((r) => setTimeout(r, 20));

test('un pago que el cliente no volvió a confirmar se confirma solo y le llega el correo', async () => {
  const { store, app, calls, mails, add } = setup({ PB1: 'paid' });
  await add('DL-PAGADA22', 'PB1', 30);
  assert.deepEqual(await app.locals.reconcilePending(NOW), { confirmed: 1, expired: 0, alerted: 0 });
  await flush();
  const b = await store.get('DL-PAGADA22');
  assert.equal(b.status, 'confirmada');
  assert.equal(b.providerBookingId, 'BK-PB1');
  assert.deepEqual(calls, ['PB1']);
  assert.deepEqual(mails, [['ok', 'DL-PAGADA22']]);
});

test('los recientes se dejan en paz: el cliente puede estar aún en la pasarela', async () => {
  const { app, calls, add } = setup({ PB1: 'paid' });
  await add('DL-RECIENTE', 'PB1', 5);
  assert.deepEqual(await app.locals.reconcilePending(NOW), { confirmed: 0, expired: 0, alerted: 0 });
  assert.deepEqual(calls, []);
});

test('sin pagar: se espera hasta 24 h y después caduca, sin avisos', async () => {
  const { store, app, mails, add } = setup({ PB1: 'unpaid', PB2: 'unpaid' });
  await add('DL-ESPERAR2', 'PB1', 60);
  await add('DL-CADUCADA', 'PB2', 25 * 60);
  assert.deepEqual(await app.locals.reconcilePending(NOW), { confirmed: 0, expired: 1, alerted: 0 });
  await flush();
  assert.equal((await store.get('DL-ESPERAR2')).status, 'pendiente_pago');
  assert.equal((await store.get('DL-CADUCADA')).status, 'caducada');
  assert.deepEqual(mails, []);
});

test('si el hotel falla se avisa al titular una sola vez, aunque la revisión se repita', async () => {
  const { store, app, mails, add } = setup({ PB1: 'error' });
  await add('DL-FALLO222', 'PB1', 30);
  assert.equal((await app.locals.reconcilePending(NOW)).alerted, 1);
  assert.equal((await app.locals.reconcilePending(NOW + 15 * MIN)).alerted, 0);
  await flush();
  assert.deepEqual(mails, [['alarma', 'DL-FALLO222']]);
  assert.equal((await store.get('DL-FALLO222')).status, 'pendiente_pago');
});

test('las reservas caducadas no salen en «Mis reservas»', async () => {
  const { app, add } = setup({});
  await add('DL-CADUCA22', 'PB9', 30, { status: 'caducada' });
  await add('DL-BUENA222', 'PB8', 30, { status: 'confirmada' });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const list = await (await fetch(`http://localhost:${server.address().port}/api/bookings?email=ana@test.com&code=DL-BUENA222`)).json();
    assert.deepEqual(list.map((b) => b.code), ['DL-BUENA222']);
  } finally {
    server.close();
  }
});
