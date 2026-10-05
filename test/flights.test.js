import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { BookingStore } from '../src/store.js';
import { LiteApi } from '../src/liteapi.js';

// LiteAPI de vuelos simulado con las formas de respuesta de la documentación.
const seg = (key, from, to, dep, arr, dir = 'OUTBOUND', num = '1') => ({
  segmentKey: key, originCode: from, originName: from + ' Airport', destinationCode: to, destinationName: to + ' Airport',
  departureTime: dep, arrivalTime: arr, direction: dir, duration: { minutes: 80 },
  flight: { marketingNumber: num }, carrier: { marketingCode: 'TP', marketingName: 'TAP Air Portugal', marketingLogo: 'https://img.test/tp.png' },
});
const offer = (id, total, extra = {}) => ({
  offerId: id, expiration: '2030-01-01T00:00:00Z', pricing: { display: { total, currency: 'EUR' } },
  fare: { family: 'Economy', seatsRemaining: 3 }, terms: { refundable: false, changeable: true },
  baggage: { hasCarryOnBag: true, hasCheckedBag: false, included: [{ description: '1 carry-on bag up to 8 kg' }] }, ...extra,
});

function fakeFlights(state) {
  return async (url, opts = {}) => {
    const u = String(url).replace(/^https:\/\/[^/]+\/v3\.0/, '');
    const body = opts.body ? JSON.parse(opts.body) : null;
    state.log.push(`${opts.method} ${u}`);
    if (u.startsWith('/data/flights/airports')) return Response.json({ data: [{ airports: [{ iata: 'OPO', city: 'Oporto', name: 'Francisco Sá Carneiro' }] }] });
    if (u === '/flights/rates') {
      state.search = body;
      return Response.json({ data: [
        { journeys: [
          { journeyKey: 'J1', segments: [seg('s1', 'MAD', 'LIS', '2030-03-10T08:15:00', '2030-03-10T08:35:00')], legDurations: [{ direction: 'OUTBOUND', duration: { minutes: 80 } }], parameters: { adults: body.adults }, offers: [offer('caro', 300), offer('O1', 120.5)] },
        ] },
        { journeys: [
          { journeyKey: 'J1', segments: [seg('s1', 'MAD', 'LIS', '2030-03-10T08:15:00', '2030-03-10T08:35:00')], parameters: { adults: body.adults }, offers: [offer('O1b', 130)] },
          { journeyKey: 'J2', segments: [seg('a', 'MAD', 'OPO', '2030-03-10T10:00:00', '2030-03-10T11:00:00'), seg('b', 'OPO', 'LIS', '2030-03-10T12:00:00', '2030-03-10T13:00:00')], parameters: { adults: body.adults }, offers: [offer('O2', 99, { terms: { refundable: true } })] },
        ] },
      ] });
    }
    if (u === '/flights/verify') return Response.json({ data: [{ journey: { pricing: { display: { total: body.offerId === 'O1' ? 125 : 99 } } }, changes: { priceChanged: body.offerId === 'O1' } }] });
    if (u === '/flights/prebooks') {
      state.prebook = body;
      return Response.json({ data: [{ prebookId: 'PB1', price: 131.75, currency: 'EUR', transactionId: 'pi_1', secretKey: 'pi_1_secret', publishableKey: 'pk_test_1' }] });
    }
    if (u === '/flights/bookings') {
      assert.deepEqual(body, { prebookId: 'PB1', payment: { method: 'TRANSACTION_ID', transactionId: 'pi_1' } });
      if (state.book === 'unpaid') return Response.json({ error: { code: 45040, description: 'payment not completed' } }, { status: 400 });
      if (state.book === 'fail') return Response.json({ error: { description: 'provider error' } }, { status: 502 });
      return Response.json({ data: [{ booking: { bookingId: 'FB1', bookingRef: 'FH-26A-1', status: 'CONFIRMED', airlineLocators: [{ airlineCode: 'TP', airlinePnr: 'ABC123' }], pricing: { totalAmount: 131.75 } } }] }, { status: 201 });
    }
    if (u === '/flights/bookings/FB1/cancellations' && opts.method === 'GET') {
      return Response.json({ data: [{ isRefundable: true, isVoidable: false, refund: { display: { amount: 80, currency: 'EUR' } }, penalty: { display: { amount: 51.75 } } }] });
    }
    if (u === '/flights/bookings/FB1/cancellations' && opts.method === 'POST') {
      return Response.json({ data: { bookingId: 'FB1', status: state.cancel || 'CANCELLED_WITH_CHARGES', cancellation_fee: 51.75, refund_amount: 80, currency: 'EUR' } });
    }
    return Response.json({ error: { description: 'no esperado ' + u } }, { status: 400 });
  };
}

const pax = (over = {}) => ({ firstName: 'Ana', lastName: 'García López', birthday: '1990-05-01', gender: 'F', nationality: 'ES', documentType: 'passport', documentNumber: 'pae 123456', documentExpiry: '2032-01-01', ...over });

async function setup(state, mailer = null) {
  const live = new LiteApi({ key: 'sand_test', fetchImpl: fakeFlights(state) });
  const server = createApp({ store: new BookingStore(null), osm: null, live, mailer }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { server, base, post };
}

test('vuelos reales: búsqueda, precio, datos de pasajeros, pago y confirmación', async () => {
  const state = { log: [] };
  const sent = [];
  const { server, base, post } = await setup(state, { bookingConfirmed: async (b) => sent.push(b) });
  try {
    const { facilities, boards, ...config } = await fetch(`${base}/api/config`).then((r) => r.json());
    assert.deepEqual(config, { googleClientId: null, appleClientId: null, microsoftClientId: null, facebookAppId: null, liveFlights: true, flights: true, sandbox: true });
    assert.equal(facilities.mascotas.label, 'Admite mascotas');
    assert.equal(boards.HB, 'Media pensión');
    assert.equal((await fetch(`${base}/api/flights?origin=Madrid`).then((r) => r.json())).needRoute, true, 'sin destino no se busca');

    const data = await fetch(`${base}/api/flights?origin=Madrid&destination=lis&date=2030-03-10&adults=2`).then((r) => r.json());
    assert.deepEqual(state.search.legs, [{ origin: 'MAD', destination: 'LIS', date: '2030-03-10', direction: 'OUTBOUND' }]);
    assert.equal(state.search.adults, 2);
    assert.equal(state.search.currency, 'EUR');
    assert.deepEqual(data.results.map((t) => [t.offerId, t.total]), [['O2', 99], ['O1', 120.5]], 'un viaje por journeyKey con su oferta más barata, ordenados por precio');
    const [, direct] = data.results;
    assert.equal(data.results[0].outbound.stops, 1);
    assert.equal(direct.outbound.stops, 0);
    assert.equal(direct.outbound.from, 'MAD');
    assert.deepEqual(direct.outbound.airlines, ['TAP Air Portugal']);
    assert.equal(direct.segments[0].flight, 'TP1');

    const q = await post('/api/flights/quote', { offerId: 'O1' }).then((r) => r.json());
    assert.deepEqual(q, { total: 125, changed: true, messages: [] });

    const customer = { offerId: 'O1', email: 'ana@test.com', phoneCountryCode: '+34', phoneNumber: '600 111 222', passengers: [pax(), pax({ firstName: 'Luis', gender: 'M', documentType: 'id_card' })] };
    const bad = async (over, re) => {
      const r = await post('/api/flights/checkout', { ...customer, ...over });
      assert.equal(r.status, 400);
      assert.match((await r.json()).error, re);
    };
    await bad({ passengers: [pax()] }, /los 2 pasajeros/);
    await bad({ passengers: [pax(), pax({ birthday: '2025-01-01' })] }, /12 años/);
    await bad({ passengers: [pax(), pax({ documentExpiry: '2030-03-01' })] }, /en vigor/);
    await bad({ phoneNumber: '12' }, /teléfono/);
    assert.equal((await post('/api/flights/checkout', { ...customer, offerId: 'nada' })).status, 409, 'oferta desconocida o caducada');
    assert.ok(!state.prebook, 'con datos incorrectos no se bloquea la tarifa');

    const co = await post('/api/flights/checkout', customer).then((r) => r.json());
    assert.equal(co.total, 131.75);
    assert.equal(co.searchTotal, 120.5);
    assert.equal(co.secretKey, 'pi_1_secret');
    assert.equal(co.publishableKey, 'pk_test_1');
    assert.match(co.returnUrl, /\/\?vuelo=[0-9a-f]{32}$/);
    assert.equal(co.transactionId, undefined);
    assert.equal(state.prebook.usePaymentSdk, true);
    assert.deepEqual(state.prebook.contact, { email: 'ana@test.com', firstName: 'Ana', lastName: 'García López', phoneCountryCode: '34', phoneNumber: '600111222' });
    assert.equal(state.prebook.passengers[0].documentNumber, 'PAE123456');
    assert.equal(state.prebook.passengers[0].documentIssueCountry, 'ES');
    assert.equal(state.prebook.passengers[1].passengerType, 0);
    assert.equal(state.prebook.passengers[1].documentType, 'id', 'LiteAPI llama «id» al DNI');
    assert.ok(['sandbox', 'live'].includes(co.publicKey), 'clave de la pasarela de LiteAPI si no hay de Stripe');

    // Sin pagar: 402 y no aparece en «Mis reservas».
    state.book = 'unpaid';
    assert.equal((await post(`/api/flights/checkout/${co.checkoutId}/confirm`, {})).status, 402);
    assert.equal((await fetch(`${base}/api/bookings?email=ana@test.com`)).status, 401);

    state.book = 'ok';
    const ok = await post(`/api/flights/checkout/${co.checkoutId}/confirm`, {}).then((r) => r.json());
    assert.equal(ok.status, 'confirmada');
    assert.equal(ok.type, 'flight');
    assert.equal(ok.pnr, 'TP ABC123');
    assert.equal(ok.bookingRef, 'FH-26A-1');
    assert.equal(ok.date, '2030-03-10');
    assert.deepEqual(ok.passengers, ['Ana García López', 'Luis García López']);
    assert.equal(ok.prebookId, undefined);
    const mine = await fetch(`${base}/api/bookings?email=ana@test.com&code=${ok.code}`).then((r) => r.json());
    assert.equal(mine.length, 1);
    assert.ok(!JSON.stringify(mine).includes('PAE123456'), 'no se guarda el número de documento');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(sent.length, 1);
    const books = state.log.filter((l) => l === 'POST /flights/bookings').length;
    await post(`/api/flights/checkout/${co.checkoutId}/confirm`, {});
    assert.equal(state.log.filter((l) => l === 'POST /flights/bookings').length, books, 'no se reserva dos veces');

    // Cancelación: primero el reembolso estimado; la aerolínea puede dejarla pendiente.
    const quote = await fetch(`${base}/api/bookings/${ok.code}/cancel-quote?email=ana@test.com`).then((r) => r.json());
    assert.equal(quote.refund, 80);
    state.cancel = 'CONFIRMED';
    const pending = await post(`/api/bookings/${ok.code}/cancel`, { email: 'ana@test.com' }).then((r) => r.json());
    assert.equal(pending.status, 'cancelacion_solicitada');
    assert.equal((await post(`/api/bookings/${ok.code}/cancel`, { email: 'ana@test.com' })).status, 404, 'ya no se puede cancelar otra vez');

    const roundTrip = await fetch(`${base}/api/flights?origin=MAD&destination=Oporto&date=2030-03-10&returnDate=2030-03-15`).then((r) => r.json());
    assert.equal(roundTrip.destination.code, 'OPO', 'ciudades fuera de la lista: se buscan en LiteAPI');
    assert.deepEqual(state.search.legs[1], { origin: 'OPO', destination: 'MAD', date: '2030-03-15', direction: 'INBOUND' });
  } finally {
    server.close();
  }
});

test('vuelos: si la aerolínea no confirma tras el pago, se avisa al titular', async () => {
  const state = { log: [], book: 'fail' };
  const alerts = [];
  const { server, base, post } = await setup(state, { paymentWithoutBooking: async (b) => alerts.push(b) });
  try {
    await fetch(`${base}/api/flights?origin=MAD&destination=LIS&date=2030-03-10`);
    const co = await post('/api/flights/checkout', { offerId: 'O1', email: 'a@b.es', phoneNumber: '600111222', passengers: [pax()] }).then((r) => r.json());
    const r = await post(`/api/flights/checkout/${co.checkoutId}/confirm`, {});
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /Hemos recibido el pago/);
    assert.equal(state.log.filter((l) => l === 'POST /flights/bookings').length, 3, 'reintenta 2 veces si el proveedor falla');
    await new Promise((res) => setTimeout(res, 20));
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].transactionId, 'pi_1');
  } finally {
    server.close();
  }
});

test('vuelos: con LITEAPI_FLIGHTS=off y hoteles reales no se ofrecen vuelos (ni simulados)', async () => {
  process.env.LITEAPI_FLIGHTS = 'off';
  try {
    const { server, base, post } = await setup({ log: [] });
    try {
      const config = await fetch(`${base}/api/config`).then((r) => r.json());
      assert.equal(config.liveFlights, false);
      assert.equal(config.flights, false, 'la web oculta la pestaña de vuelos');
      assert.equal((await fetch(`${base}/api/flights`)).status, 404);
      const r = await post('/api/bookings', { type: 'flight', itemId: 'f1', date: '2030-03-10', units: 1, name: 'Ana', email: 'ana@test.com' });
      assert.equal(r.status, 403, 'no se puede reservar un vuelo simulado');
    } finally {
      server.close();
    }
  } finally {
    delete process.env.LITEAPI_FLIGHTS;
  }
});

test('vuelos reales: calendario por días (con caché) y ofertas de rutas populares', async () => {
  const state = { log: [] };
  const { server, base } = await setup(state);
  try {
    const get = (path) => fetch(base + path).then(async (r) => ({ status: r.status, body: await r.json() }));
    assert.equal((await get('/api/flights/days?origin=MAD&destination=MAD&dates=2030-03-10')).status, 400);
    assert.equal((await get('/api/flights/days?origin=MAD&destination=LIS&dates=2001-01-01')).status, 400, 'sin fechas futuras');

    const r = await get('/api/flights/days?origin=mad&destination=LIS&dates=2030-03-10,2030-03-11&stay=3');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.days.map((d) => d.date), ['2030-03-10', '2030-03-11']);
    assert.equal(r.body.days[0].trips[0].flightKey, 'TP1-TP1', 'el mismo vuelo se reconoce en otros días por sus números');
    assert.deepEqual(state.search.legs.map((l) => l.date), ['2030-03-11', '2030-03-14'], 'ida y vuelta con la misma estancia');
    const calls = state.log.filter((l) => l.endsWith('/flights/rates')).length;
    await get('/api/flights/days?origin=MAD&destination=LIS&dates=2030-03-10&stay=3');
    assert.equal(state.log.filter((l) => l.endsWith('/flights/rates')).length, calls, 'el mismo día se reutiliza unos minutos');

    let deals = await get('/api/flights/deals');
    for (let i = 0; deals.body.pending && i < 50; i++) {
      await new Promise((ok) => setTimeout(ok, 20));
      deals = await get('/api/flights/deals');
    }
    assert.ok(deals.body.deals.length > 0);
    assert.equal(deals.body.deals[0].total, 99, 'la oferta es el vuelo más barato de la ruta');
    assert.ok(deals.body.deals[0].origin.name && deals.body.deals[0].destination.code);
  } finally {
    server.close();
  }
});
