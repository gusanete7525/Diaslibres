import { test, after } from 'node:test';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import { createApp, randomCode } from '../server.js';
import { BookingStore } from '../src/store.js';
import { isISODate, todayISO, searchHotels } from '../src/availability.js';

delete process.env.ANTHROPIC_API_KEY;
const servers = [];
after(() => servers.forEach((s) => s.close()));

async function start(options = {}) {
  const app = createApp({ store: new BookingStore(null), osm: null, live: null, ...options });
  const server = app.listen(0);
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  return `http://localhost:${server.address().port}`;
}

const post = (base, p, body, headers = {}) =>
  fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('la IP la pone el proxy de Render: inventar X-Forwarded-For no salta el límite de intentos', async () => {
  const base = await start();
  // Detrás de Render, el proxy añade la IP real al final; lo que escribe el cliente queda a la izquierda.
  const lookup = (i) => fetch(`${base}/api/bookings?email=ana@test.com&code=DL-NOEXISTE`, { headers: { 'X-Forwarded-For': `10.0.0.${i}, 203.0.113.9` } });
  for (let i = 0; i < 20; i++) assert.equal((await lookup(i)).status, 404);
  assert.equal((await lookup(99)).status, 429);
});

test('los códigos de reserva son largos, sin caracteres confusos, y no se repiten', async () => {
  for (let i = 0; i < 200; i++) assert.match(randomCode(), /^DL-[A-HJ-NP-Z2-9]{8}$/);
  // Un almacén en el que los dos primeros códigos generados «ya existen».
  const store = new BookingStore(null);
  const taken = [];
  const get = store.get.bind(store);
  store.get = async (code) => (taken.length < 2 ? (taken.push(code), { code }) : get(code));
  const base = await start({ store });
  const hotel = (await (await fetch(`${base}/api/hotels?destination=granada&nights=2`)).json()).results[0];
  const res = await post(base, '/api/bookings', { type: 'hotel', itemId: hotel.id, checkIn: hotel.bestStay.checkIn, checkOut: hotel.bestStay.checkOut, units: 1, name: 'Ana', email: 'ana@test.com' });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(taken.length, 2);
  assert.ok(!taken.includes(body.code), 'no reutiliza un código ocupado');
});

test('el enlace para entrar sale de la dirección oficial, no de la cabecera Host', async () => {
  const sites = [];
  const accounts = { sendLoginLink: async ({ site }) => { sites.push(site); }, userFor: async () => null };
  const base = await start({ accounts });
  process.env.RENDER_EXTERNAL_URL = 'https://diaslibres.onrender.com';
  try {
    // fetch no deja cambiar Host: se envía a mano, como lo haría un atacante.
    const status = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ email: 'ana@test.com' });
      const req = request(base + '/api/auth/email', { method: 'POST', headers: { Host: 'evil.example', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end(body);
    });
    assert.ok(status < 300, String(status));
    assert.deepEqual(sites, ['https://diaslibres.onrender.com']);
  } finally {
    delete process.env.RENDER_EXTERNAL_URL;
  }
});

test('una fecha mal escrita no tumba la búsqueda y el 31 de febrero no existe', async () => {
  const base = await start();
  for (const p of ['/api/hotels?start=9', '/api/hotels?start=2026-02-31', '/api/flights?start=zzz']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p);
    assert.equal((await res.json()).start, todayISO(), p);
  }
  assert.equal(searchHotels([], { start: 'mañana' }).start, todayISO());
  assert.equal(isISODate('2026-02-31'), false);
  assert.equal(isISODate('2028-02-29'), true);
  assert.equal(isISODate('2026-13-01'), false);
});

test('«hoy» es el día en España: a las 00:30 de Madrid ya es el día siguiente', () => {
  assert.equal(todayISO(new Date('2026-10-08T22:30:00Z')), '2026-10-09');
  assert.equal(todayISO(new Date('2026-01-15T22:30:00Z')), '2026-01-15');
});

test('la búsqueda con IA, los pagos y las reservas de prueba tienen límite por IP', async () => {
  const base = await start({ limits: { aiSearch: 2, checkout: 1, demoBooking: 1, windowMs: 60_000 } });
  for (let i = 0; i < 2; i++) assert.equal((await post(base, '/api/ai-search', { query: 'playa en Málaga' })).status, 200);
  const third = await post(base, '/api/ai-search', { query: 'playa en Málaga' });
  assert.equal(third.status, 429);
  assert.match((await third.json()).error, /muchas búsquedas/);
  assert.notEqual((await post(base, '/api/checkout', {})).status, 429);
  assert.equal((await post(base, '/api/checkout', {})).status, 429);
  assert.notEqual((await post(base, '/api/bookings', {})).status, 429);
  assert.equal((await post(base, '/api/bookings', {})).status, 429);
});

test('confirmar un pago de hotel sin LiteAPI no da la falsa alarma de «pago sin reserva»', async () => {
  const store = new BookingStore(null);
  await store.add({ code: 'DL-PRUEBA22', checkoutId: 'chk1', status: 'pendiente_pago', type: 'hotel', provider: 'liteapi', email: 'ana@test.com', name: 'Ana' });
  const alarms = [];
  const mailer = { paymentWithoutBooking: async (b) => { alarms.push(b); } };
  const base = await start({ store, mailer });
  const res = await post(base, '/api/checkout/chk1/confirm', {});
  assert.equal(res.status, 503);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(alarms.length, 0);
  assert.equal((await store.get('DL-PRUEBA22')).status, 'pendiente_pago');
});

test('cabeceras de seguridad y sin «X-Powered-By»', async () => {
  const base = await start();
  const res = await fetch(base + '/api/health');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(res.headers.get('x-powered-by'), null);
});
