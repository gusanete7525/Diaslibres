import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { BookingStore, PgBookingStore } from '../src/store.js';
import { createApp } from '../server.js';

function pgStore() {
  const { Pool } = newDb().adapters.createPg();
  return new PgBookingStore(new Pool());
}

for (const [name, make] of [['fichero/memoria', () => new BookingStore(null)], ['PostgreSQL', pgStore]]) {
  test(`almacén ${name}: guardar, buscar, actualizar y cancelar`, async () => {
    const s = make();
    await s.add({ code: 'DL-1', email: 'Ana@Test.com', status: 'pendiente_pago', checkoutId: 'chk1', total: 100 });
    await s.add({ code: 'DL-2', email: 'luis@test.com', status: 'confirmada', total: 50 });
    assert.equal((await s.all()).length, 2);
    assert.equal((await s.get('DL-1')).total, 100);
    assert.equal((await s.findByCheckout('chk1')).code, 'DL-1');
    assert.equal(await s.findByCheckout('nada'), null);
    const up = await s.update('DL-1', { status: 'confirmada', providerBookingId: 'BK' });
    assert.equal(up.providerBookingId, 'BK');
    assert.equal((await s.get('DL-1')).status, 'confirmada');
    assert.deepEqual((await s.listByEmail('ana@test.com')).map((b) => b.code), ['DL-1']);
    assert.equal(await s.cancel('DL-1', 'otro@test.com'), null, 'otro email no cancela');
    assert.equal((await s.cancel('DL-1', 'ANA@test.com')).status, 'cancelada');
    assert.equal(await s.cancel('DL-1', 'ana@test.com'), null, 'no se cancela dos veces');
  });
}

test('la web funciona igual guardando en PostgreSQL', async () => {
  const store = pgStore();
  const server = createApp({ store, osm: null, live: null }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const data = await fetch(`${base}/api/hotels?destination=sevilla&nights=2`).then((r) => r.json());
    const h = data.results[0];
    const res = await post('/api/bookings', { type: 'hotel', itemId: h.id, checkIn: h.bestStay.checkIn, checkOut: h.bestStay.checkOut, name: 'Eva Ruiz', email: 'eva@test.com' });
    assert.equal(res.status, 201);
    const b = await res.json();
    const mine = await fetch(`${base}/api/bookings?email=eva@test.com`).then((r) => r.json());
    assert.equal(mine[0].code, b.code);
    assert.equal((await post(`/api/bookings/${b.code}/cancel`, { email: 'eva@test.com' }).then((r) => r.json())).status, 'cancelada');
  } finally {
    server.close();
  }
});
