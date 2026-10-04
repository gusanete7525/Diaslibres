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
      if (body.usePaymentSdk) return Response.json({ data: { prebookId: 'PB2', price: 241.5, secretKey: 'pi_123_secret_abc', transactionId: 'tr_1' } });
      return Response.json({ data: { prebookId: 'PB1', price: 241.5 } });
    }
    if (u.endsWith('/rates/book') && body.prebookId === 'PB2') {
      assert.deepEqual(body.payment, { method: 'TRANSACTION_ID', transactionId: 'tr_1' });
      if (!fakeLiteApi.paid) return Response.json({ error: { code: 2014, description: 'payment not completed' } }, { status: 400 });
      return Response.json({ data: { bookingId: 'BK2', status: 'CONFIRMED', price: 241.5 } });
    }
    if (u.endsWith('/rates/book')) {
      assert.equal(body.prebookId, 'PB1');
      assert.deepEqual(body.payment, { method: 'ACC_CREDIT_CARD' });
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
  const server = createApp({ store: new BookingStore(null), osm: null, live, livePayment: 'account' }).listen(0);
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

    const req = { type: 'hotel', itemId: a.id, checkIn: '2026-11-10', checkOut: '2026-11-12', units: 1, name: 'Ana García López', email: 'ana@test.com' };
    assert.equal((await post('/api/bookings', req)).status, 400, 'sin el precio visto no se reserva');
    const dearer = await post('/api/bookings', { ...req, expectedTotal: 230 });
    assert.equal(dearer.status, 409, 'si el precio subió no se reserva');
    const dearerBody = await dearer.json();
    assert.equal(dearerBody.newTotal, 241.5);
    assert.match(dearerBody.error, /precio ha cambiado/);
    assert.ok(!log.some((l) => l.includes('/rates/book')), 'no se llegó a reservar');
    const res = await post('/api/bookings', { ...req, expectedTotal: 241.5 });
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
  const server = createApp({ store: new BookingStore(null), osm: null, live, livePayment: 'account' }).listen(0);
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
  const server = createApp({ store: new BookingStore(null), osm: null, live, livePayment: 'account' }).listen(0);
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

test('buscar hoteles no espera detrás de los precios del calendario en cola', async () => {
  const order = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    if (u.endsWith('/hotels/min-rates')) {
      order.push('precio');
      await gate; // los precios tardan
      return Response.json({ data: [] });
    }
    order.push('hoteles');
    if (u.includes('/data/places')) return Response.json({ data: [{ placeId: 'P', types: ['locality'] }] });
    return Response.json({ data: [{ id: 'lpX', name: 'X', city: 'Roma', country: 'it' }] });
  };
  const live = new LiteApi({ key: 'sand_t', fetchImpl });
  await live.hotels('Roma');
  const id = 'lite-lpX';
  const prices = live.nightlyPrices([id], '2030-01-01', 10); // 10 noches: 3 en curso y 7 en cola
  await new Promise((r) => setTimeout(r, 20));
  const search = live.hotels('Milán'); // llega después, pero debe ir antes que los 7 precios en cola
  await new Promise((r) => setTimeout(r, 20));
  release();
  await Promise.all([prices, search]);
  const firstSearch = order.indexOf('hoteles', 2);
  assert.ok(firstSearch > 0 && firstSearch <= 6, `la búsqueda se atendió en el puesto ${firstSearch}: ${order.join(',')}`);
});

test('si al bloquear la habitación sale más cara que el presupuesto, no se reserva', async () => {
  const calls = [];
  const live = new LiteApi({ key: 'sand_t', fetchImpl: async (url) => {
    calls.push(String(url));
    return Response.json({ data: { prebookId: 'PB', price: 300 } });
  } });
  await assert.rejects(live.book({ offerId: 'o', name: 'Ana López', email: 'a@b.c', units: 1, maxTotal: 250 }), (e) => e.total === 300 && /300/.test(e.message));
  assert.ok(!calls.some((u) => u.endsWith('/rates/book')));
});

test('si la habitación se agota al bloquearla, el aviso sale en español', async () => {
  const live = new LiteApi({ key: 'sand_t', fetchImpl: async () => Response.json({ error: { description: 'no prebook availability' } }, { status: 400 }) });
  await assert.rejects(live.book({ offerId: 'o', name: 'Ana', email: 'a@b.c', units: 1, maxTotal: 100 }), /se acaba de agotar/);
});

test('pago del cliente: checkout, pago pendiente, confirmación y datos internos ocultos', async () => {
  fakeLiteApi.paid = false;
  const log = [];
  const live = new LiteApi({ key: 'prod_test', fetchImpl: fakeLiteApi(log) });
  const server = createApp({ store: new BookingStore(null), osm: null, live }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'diaslibres.test' }, body: JSON.stringify(body) });
  try {
    const data = await fetch(`${base}/api/hotels?destination=Granada`).then((r) => r.json());
    assert.equal(data.live.payment, 'customer');
    assert.equal(data.live.bookingEnabled, true, 'con la clave real se puede reservar porque paga el cliente');
    const req = { type: 'hotel', itemId: data.results[0].id, checkIn: '2026-11-10', checkOut: '2026-11-12', units: 1, name: 'Ana García López', email: 'ana@test.com', expectedTotal: 241.5 };

    assert.equal((await post('/api/bookings', req)).status, 400, 'sin pagar no se reserva');
    assert.equal((await post('/api/checkout', { ...req, expectedTotal: 200 })).status, 409, 'precio subido');

    const co = await post('/api/checkout', req).then((r) => r.json());
    assert.equal(co.secretKey, 'pi_123_secret_abc');
    assert.equal(co.publicKey, 'live');
    assert.match(co.returnUrl, /\/\?pago=[0-9a-f]{32}$/);
    assert.equal(co.total, 241.5);
    assert.equal(co.transactionId, undefined);

    // La reserva pendiente de pago no aparece en «Mis reservas».
    assert.deepEqual(await fetch(`${base}/api/bookings?email=ana@test.com`).then((r) => r.json()), []);

    // Sin pagar: 402 y sigue pendiente.
    const unpaid = await post(`/api/checkout/${co.checkoutId}/confirm`, {});
    assert.equal(unpaid.status, 402);
    assert.match((await unpaid.json()).error, /no se ha completado/);

    // Pagado: se confirma, y confirmar otra vez devuelve lo mismo sin reservar de nuevo.
    fakeLiteApi.paid = true;
    const ok = await post(`/api/checkout/${co.checkoutId}/confirm`, {}).then((r) => r.json());
    assert.equal(ok.status, 'confirmada');
    assert.equal(ok.providerBookingId, 'BK2');
    assert.equal(ok.prebookId, undefined);
    assert.equal(ok.transactionId, undefined);
    assert.equal(ok.checkoutId, undefined);
    const books = log.filter((l) => l.endsWith('/rates/book')).length;
    const again = await post(`/api/checkout/${co.checkoutId}/confirm`, {}).then((r) => r.json());
    assert.equal(again.code, ok.code);
    assert.equal(log.filter((l) => l.endsWith('/rates/book')).length, books, 'no se reserva dos veces');

    const mine = await fetch(`${base}/api/bookings?email=ana@test.com`).then((r) => r.json());
    assert.equal(mine.length, 1);
    assert.equal(mine[0].transactionId, undefined);
    assert.equal((await post('/api/checkout/noexiste/confirm', {})).status, 404);
  } finally {
    server.close();
  }
});

test('los huéspedes (adultos y edades de niños) llegan a LiteAPI y cada grupo tiene su precio', async () => {
  const bodies = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/data/places')) return Response.json({ data: [{ placeId: 'P', types: ['locality'] }] });
    if (u.includes('/data/hotels')) return Response.json({ data: [{ id: 'lpK', name: 'K', city: 'Roma', country: 'it' }] });
    const body = JSON.parse(opts.body);
    bodies.push(body);
    const people = body.occupancies[0].adults + (body.occupancies[0].children?.length || 0);
    if (u.endsWith('/hotels/min-rates')) return Response.json({ data: [{ hotelId: 'lpK', price: 50 * people }] });
    return Response.json({ data: [{ hotelId: 'lpK', roomTypes: [{ offerId: 'o', offerRetailRate: { amount: 99 }, rates: [{ name: 'Familiar' }] }] }] });
  };
  const live = new LiteApi({ key: 'sand_t', fetchImpl });
  const [h] = await live.hotels('Roma');
  const two = await live.nightlyPrices([h.id], '2030-03-01', 1, { adults: 2 });
  const family = await live.nightlyPrices([h.id], '2030-03-01', 1, { adults: '2', children: '5,9' });
  assert.equal(two[h.id][0].price, 100);
  assert.equal(family[h.id][0].price, 200, 'otro grupo, otro precio (no sale de la caché del primero)');
  assert.deepEqual(bodies[1].occupancies, [{ adults: 2, children: [5, 9] }]);
  await live.quote({ itemId: h.id, checkIn: '2030-03-01', checkOut: '2030-03-03', units: 2, adults: 1, children: [3] });
  assert.deepEqual(bodies.at(-1).occupancies, [{ adults: 1, children: [3] }, { adults: 1, children: [3] }]);
  // Valores fuera de rango se acotan.
  await live.nightlyPrices([h.id], '2030-03-02', 1, { adults: 40, children: '30,-1,4,5,6,7' });
  assert.deepEqual(bodies.at(-1).occupancies, [{ adults: 6, children: [17, 0, 4, 5] }]);
});
