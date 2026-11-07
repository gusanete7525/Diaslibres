import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { BookingStore } from '../src/store.js';

delete process.env.ANTHROPIC_API_KEY;
let server;
after(() => server?.close());

test('muchas reservas a la vez de las últimas plazas no pasan de la capacidad', async () => {
  // Un almacén lento, como una base de datos: entre leer y guardar pasa tiempo y las peticiones se cruzan.
  const store = new BookingStore(null);
  const wait = () => new Promise((r) => setTimeout(r, 5));
  const all = store.all.bind(store);
  const add = store.add.bind(store);
  store.all = async () => { await wait(); return all(); };
  store.add = async (b) => { await wait(); return add(b); };
  const app = createApp({ store, osm: null, live: null, limits: { aiSearch: 100, checkout: 100, demoBooking: 1000, windowMs: 60_000 } });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;

  const hotel = (await (await fetch(`${base}/api/hotels?destination=granada&nights=2`)).json()).results[0];
  const { checkIn, checkOut } = hotel.bestStay;
  const i = hotel.calendar.findIndex((d) => d.date === checkIn);
  const left = Math.min(hotel.calendar[i].left, hotel.calendar[i + 1].left);
  assert.ok(left > 0);

  const book = () => fetch(`${base}/api/bookings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'hotel', itemId: hotel.id, checkIn, checkOut, units: 1, name: 'Ana', email: 'ana@test.com' }),
  }).then((r) => r.status);
  const statuses = await Promise.all(Array.from({ length: left + 5 }, book));
  assert.equal(statuses.filter((s) => s === 201).length, left, JSON.stringify(statuses));
  assert.equal(statuses.filter((s) => s === 409).length, 5);
});
