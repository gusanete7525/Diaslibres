import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { BookingStore } from '../src/store.js';
import { LiteApiError } from '../src/liteapi.js';

delete process.env.ANTHROPIC_API_KEY;
const servers = [];
after(() => servers.forEach((s) => s.close()));

// Un LiteAPI simulado cuyo presupuesto falla como se le pida: en crudo (como llega del proveedor) o con un mensaje propio.
async function start(error) {
  const live = { sandbox: true, quote: async () => { throw error; }, flightOffer: () => null };
  const app = createApp({ store: new BookingStore(null), osm: null, live });
  const server = app.listen(0);
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  return `http://localhost:${server.address().port}`;
}
const quote = (base) => fetch(base + '/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'hotel', itemId: 'lite-lpA', checkIn: '2030-01-10', checkOut: '2030-01-12' }) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

test('un error en crudo del proveedor no llega al cliente: se enseña uno propio en español', async () => {
  const raw = Object.assign(new LiteApiError('upstream supplier timeout (code 5021) at node lpx-3'), { provider: true, status: 500 });
  const r = await quote(await start(raw));
  assert.equal(r.status, 400);
  assert.doesNotMatch(r.body.error, /supplier|5021|lpx/);
  assert.match(r.body.error, /No se pudo comprobar la habitación/);
});

test('los mensajes propios de LiteAPI (ya pensados para el cliente) se enseñan tal cual', async () => {
  const own = new LiteApiError('Esa habitación ya no está disponible. Elige otra.');
  const r = await quote(await start(own));
  assert.equal(r.body.error, 'Esa habitación ya no está disponible. Elige otra.');
});

test('un fallo interno (no de LiteAPI) tampoco se enseña', async () => {
  const r = await quote(await start(new TypeError("Cannot read properties of undefined (reading 'rates')")));
  assert.doesNotMatch(r.body.error, /Cannot read|undefined/);
});
