import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { BookingStore } from '../src/store.js';
import { LiteApi } from '../src/liteapi.js';

// LiteAPI simulado con las mismas formas de respuesta que el entorno de pruebas real.
function fakeLiteApi(log) {
  let calls429 = 1;
  return async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    log.push(`${opts.method} ${u.replace(/^https:\/\/[^/]+\/v3\.0/, '')}`);
    assert.ok(['sand_test', 'prod_test'].includes(opts.headers['X-API-Key']));
    if (u.includes('/data/places')) return Response.json({ data: [{ placeId: 'P1', types: ['locality'] }] });
    if (u.includes('/data/hotels')) {
      return Response.json({ data: [
        { id: 'lpA', name: 'Hotel Real Uno', city: 'Granada', country: 'es', address: 'Calle A 1', zip: '18001', stars: 4, rating: 9.1, reviewCount: 1200, thumbnail: 'https://img.test/a.jpg', hotelDescription: '<p><strong>Título</strong><br>Un hotel con piscina en la azotea y vistas a la Alhambra desde todas sus habitaciones.</p>' },
        { id: 'lpB', name: 'Hotel Real Dos', city: 'Granada', country: 'es', stars: 2, rating: 0, thumbnail: 'javascript:x' },
      ] });
    }
    if (u.endsWith('/hotels/min-rates')) {
      if (calls429-- > 0) return Response.json({ error: { code: 4290 } }, { status: 429 });
      // lpB no tiene tarifa los domingos => día completo
      const sunday = new Date(body.checkin + 'T00:00:00Z').getUTCDay() === 0;
      return Response.json({ data: body.hotelIds.filter((id) => id === 'lpA' || !sunday).map((id) => ({ hotelId: id, price: id === 'lpA' ? 120.4 : 60 })) });
    }
    if (u.endsWith('/hotels/rates')) {
      assert.equal(body.occupancies.length, 1);
      return Response.json({ data: [{ hotelId: 'lpA', roomTypes: [
        { offerId: 'caro', offerRetailRate: { amount: 500 }, rates: [{ name: 'Suite', boardName: 'Room Only', cancellationPolicies: { refundableTag: 'NRFN' } }] },
        { offerId: 'barato', offerRetailRate: { amount: 241.5 }, rates: [{ name: 'Doble', boardName: 'Desayuno', cancellationPolicies: { refundableTag: 'RFN', cancelPolicyInfos: [{ cancelTime: '2026-12-01 12:00:00' }] } }] },
      ] }] });
    }
    if (u.endsWith('/rates/prebook')) {
      assert.equal(body.offerId, 'barato');
      return Response.json({ data: { prebookId: 'PB1' } });
    }
    if (u.endsWith('/rates/book')) {
      assert.equal(body.prebookId, 'PB1');
      assert.deepEqual(body.holder, { firstName: 'Ana', lastName: 'García López', email: 'ana@test.com' });
      return Response.json({ data: { bookingId: 'BK1', status: 'CONFIRMED', price: 241.5 } });
    }
    if (u.includes('/bookings/BK1') && opts.method === 'PUT') return Response.json({ data: { status: 'CANCELLED', refund_amount: 241.5, cancellation_fee: 0 } });
    return Response.json({ error: { description: 'no esperado ' + u } }, { status: 400 });
  };
}

test('hoteles, precios por noche, reserva y cancelación con LiteAPI', async () => {
  const log = [];
  const live = new LiteApi({ key: 'sand_test', fetchImpl: fakeLiteApi(log) });
  const server = createApp({ store: new BookingStore(null), osm: null, live }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const data = await fetch(`${base}/api/hotels?destination=Granada`).then((r) => r.json());
    assert.equal(data.live.sandbox, true);
    assert.deepEqual(data.results.map((h) => h.name), ['Hotel Real Uno', 'Hotel Real Dos']);
    const [a, bHotel] = data.results;
    assert.equal(a.country, 'España');
    assert.equal(a.address, 'Calle A 1, 18001 Granada');
    assert.equal(a.photo, 'https://img.test/a.jpg');
    assert.equal(bHotel.photo, null, 'solo fotos https');
    assert.ok(a.tags.includes('piscina'));
    assert.match(a.description, /piscina en la azotea/);
    assert.ok(a.calendar.every((d) => d.pending));

    const prices = await fetch(`${base}/api/live/prices?ids=${a.id},${bHotel.id}&start=${data.start}&days=7`).then((r) => r.json());
    assert.equal(prices.prices[a.id].length, 7);
    assert.ok(prices.prices[a.id].every((d) => d.price === 120 && d.available));
    assert.ok(prices.prices[bHotel.id].some((d) => d.available === false && d.price === null), 'sin tarifa = completo');
    // La segunda petición sale de la caché.
    const before = log.filter((l) => l.includes('min-rates')).length;
    await fetch(`${base}/api/live/prices?ids=${a.id}&start=${data.start}&days=7`);
    assert.equal(log.filter((l) => l.includes('min-rates')).length, before);

    const quote = await post('/api/quote', { type: 'hotel', itemId: a.id, checkIn: '2026-11-10', checkOut: '2026-11-12', units: 1 }).then((r) => r.json());
    assert.equal(quote.total, 241.5);
    assert.equal(quote.roomName, 'Doble');
    assert.equal(quote.refundable, true);
    assert.equal(quote.freeCancellationUntil, '2026-12-01 12:00:00');
    assert.equal(quote.offerId, undefined, 'el offerId no sale al navegador');

    const res = await post('/api/bookings', { type: 'hotel', itemId: a.id, checkIn: '2026-11-10', checkOut: '2026-11-12', units: 1, name: 'Ana García López', email: 'ana@test.com' });
    assert.equal(res.status, 201);
    const booking = await res.json();
    assert.equal(booking.providerBookingId, 'BK1');
    assert.equal(booking.total, 241.5);
    assert.equal(booking.sandbox, true);

    const cancel = await post(`/api/bookings/${booking.code}/cancel`, { email: 'ana@test.com' }).then((r) => r.json());
    assert.equal(cancel.status, 'cancelada');
    assert.equal(cancel.cancellation.refund, 241.5);
    assert.ok(log.some((l) => l.startsWith('PUT /bookings/BK1')));
  } finally {
    server.close();
  }
});

test('con la clave real, sin ALLOW_REAL_BOOKINGS se ven precios pero no se reserva', async () => {
  delete process.env.ALLOW_REAL_BOOKINGS;
  const live = new LiteApi({ key: 'prod_test', fetchImpl: fakeLiteApi([]) });
  const server = createApp({ store: new BookingStore(null), osm: null, live }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;
  try {
    const data = await fetch(`${base}/api/hotels?destination=Granada`).then((r) => r.json());
    assert.equal(data.live.sandbox, false);
    assert.equal(data.live.bookingEnabled, false);
    const body = JSON.stringify({ type: 'hotel', itemId: data.results[0].id, checkIn: '2026-11-10', checkOut: '2026-11-12', units: 1, name: 'Ana López', email: 'ana@test.com' });
    const headers = { 'Content-Type': 'application/json' };
    assert.equal((await fetch(`${base}/api/quote`, { method: 'POST', headers, body })).status, 200);
    const res = await fetch(`${base}/api/bookings`, { method: 'POST', headers, body });
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /reservas reales están desactivadas/);
  } finally {
    server.close();
  }
});

test('la clave se limpia de espacios y comillas al pegarla', () => {
  const live = new LiteApi({ key: '  "sand_abc"\n', fetchImpl: async () => Response.json({}) });
  assert.equal(live.key, 'sand_abc');
  assert.equal(live.sandbox, true);
});

test('/api/health muestra el último error de LiteAPI sin la clave', async () => {
  const live = new LiteApi({ key: 'sand_secreta', fetchImpl: async () => Response.json({ error: { description: 'invalid api key' } }, { status: 401 }) });
  const server = createApp({ store: new BookingStore(null), osm: null, live }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/hotels?destination=Roma`)).status, 502);
    const h = await fetch(`${base}/api/health`).then((r) => r.text());
    assert.match(h, /invalid api key/);
    assert.match(h, /"status":401/);
    assert.doesNotMatch(h, /secreta/);
  } finally {
    server.close();
  }
});
