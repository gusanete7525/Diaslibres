import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapePlan, makeEscapeSearch } from '../src/escapes.js';
import { todayISO, addDays } from '../src/availability.js';
import { createApp } from '../server.js';
import { BookingStore } from '../src/store.js';

test('fechas flexibles: límites de mes, duración y fines de semana', () => {
  const plan = escapePlan({ month: '2027-02', days: 3 }, '2027-01-15');
  assert.equal(plan.start, '2027-02-01');
  assert.equal(plan.end, '2027-02-28');
  assert.equal(plan.nights, 2);
  assert.equal(plan.dates.at(-1), '2027-02-26');
  const weekend = escapePlan({ month: '2027-02', kind: 'weekend', days: 3 }, '2027-01-15');
  assert.ok(weekend.dates.every(d => new Date(d + 'T00:00:00Z').getUTCDay() === 5));
  assert.throws(() => escapePlan({ days: 0 }, '2027-01-15'));
  assert.throws(() => escapePlan({ month: '2027-13' }, '2027-01-15'));
  assert.throws(() => escapePlan({ budget: '-1' }, '2027-01-15'));
  assert.throws(() => escapePlan({ kind: 'weekend', days: 7 }, '2027-01-15'));
  assert.throws(() => escapePlan({ from: '2027-02-30', to: '2027-03-05' }, '2027-01-15'));
  assert.throws(() => escapePlan({ from: '2027-02-01', to: '2027-07-01' }, '2027-01-15'));
  assert.throws(() => escapePlan({ from: '2027-02-01', to: '2027-02-02', days: 7 }, '2027-01-15'));
});

const query = () => ({ from: addDays(todayISO(), 5), to: addDays(todayISO(), 20), days: 3 });
const provider = (rate = {}) => {
  const calls = [];
  return {
    calls,
    sandbox: false,
    hotels: async city => [{ id: `lite-${city}`, name: 'Hotel real', city, rating: 9 }],
    quote: async data => { calls.push(data); return { total: 200.25, payAtHotel: [], ...rate }; },
  };
};
test('cotiza estancias completas, dos adultos y filtra el total con tasas, no el precio por noche', async () => {
  const live = provider({ payAtHotel: [{ currency: 'EUR', amount: 20 }] });
  const search = makeEscapeSearch(live);
  const data = await search({ ...query(), budget: 221 });
  assert.equal(data.results.length, 3);
  assert.equal(data.results[0].knownTotal, 220.25);
  assert.ok(live.calls.every(q => q.adults === 2 && q.units === 1 && q.checkOut === addDays(q.checkIn, 2)));
  assert.equal((await search({ ...query(), budget: 220 })).results.length, 0);
});
test('no compara tasas de otra moneda como si fueran euros', async () => {
  const search = makeEscapeSearch(provider({ payAtHotel: [{ currency: 'USD', amount: 20 }] }));
  assert.equal((await search({ ...query(), budget: 500 })).results.length, 0);
  assert.equal((await search(query())).results.length, 3);
});
test('reutiliza consultas simultáneas y precios comprobados, con aviso de sandbox', async () => {
  const live = provider(); live.sandbox = true;
  const search = makeEscapeSearch(live);
  const [a, b] = await Promise.all([search(query()), search(query())]);
  assert.deepEqual(a, b);
  assert.equal(live.calls.length, 9);
  assert.equal(a.sandbox, true);
  assert.ok(a.results.every(r => r.checkedAt && r.total === 200.25));
});
test('fallos del proveedor o falta de conexión nunca generan precios simulados', async () => {
  assert.equal((await makeEscapeSearch(null)(query())).unavailable, true);
  const live = provider();
  live.quote = async () => { throw new Error('offline'); };
  assert.deepEqual((await makeEscapeSearch(live)(query())).results, []);
});
test('API valida entradas, evita caché pública y solo expone tarifas comprobadas', async () => {
  const app = createApp({ store: new BookingStore(null), osm: null, live: provider(), reconcileEveryMs: 0 });
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/escapes?days=99')).status, 400);
    const res = await fetch(base + '/api/escapes?' + new URLSearchParams(query()));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal((await res.json()).results.length, 3);
    const html = await (await fetch(base + '/')).text();
    assert.match(html, /id="escapeForm"/);
    assert.match(html, /Transporte no incluido/);
    assert.match(html, /property="og:image:width" content="1200"/);
    assert.match(html, /type="module" src="\/escapes.js"/);
  } finally { server.close(); }
});
