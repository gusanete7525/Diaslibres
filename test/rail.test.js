import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { BookingStore } from '../src/store.js';
import { localParse } from '../src/ai.js';
import { RAIL, railBetween, railFrom, railOption, railBookUrl } from '../src/rail.js';
import { cityByName } from '../src/seo.js';

let server;
let base;
before(async () => {
  server = createApp({ store: new BookingStore(null), osm: null, live: null }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());
const get = (p, lang) => fetch(base + p, { headers: lang ? { 'x-lang': lang } : {} }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('trayectos de tren: en los dos sentidos, directos o con transbordo', () => {
  assert.ok(RAIL.length > 200);
  const [mad, bcn, par, lon] = ['Madrid', 'Barcelona', 'París', 'London'].map(cityByName);
  assert.equal(railBetween(mad, bcn).minutes, 150);
  assert.equal(railBetween(bcn, mad).minutes, 150);
  assert.equal(railBetween(par, lon).operators, 'Eurostar');
  assert.equal(railBetween(mad, lon), null);
  const ml = railOption(mad, par);
  assert.equal(ml.direct, false);
  assert.equal(ml.via, 'Barcelona');
  assert.equal(ml.doorMinutes, ml.minutes + 40);
  assert.equal(railOption(mad, cityByName('Tenerife')), null);
  const from = railFrom(mad);
  assert.ok(from.length > 20 && from[0].minutes <= from.at(-1).minutes);
});

test('enlace de reserva con RAILEUROPE_URL', () => {
  const [mad, bcn] = ['Madrid', 'Barcelona'].map(cityByName);
  assert.equal(railBookUrl({ from: mad, to: bcn }, null), 'https://www.raileurope.com/');
  assert.equal(railBookUrl({ from: mad, to: bcn, date: '2026-11-02', adults: 2 }, 'https://x.test/?o={from}&d={to}&f={date}&p={adults}&aff=1'),
    'https://x.test/?o=Madrid&d=Barcelona&f=2026-11-02&p=2&aff=1');
});

test('/api/trains compara con el avión y propone destinos', async () => {
  const r = await get('/api/trains?origin=madrid&destination=Sevilla&adults=2');
  assert.equal(r.status, 200);
  assert.equal(r.body.train.minutes, 150);
  assert.equal(r.body.fromIata, 'MAD');
  assert.equal(r.body.toIata, 'SVQ');
  assert.equal(r.body.doorFlight, 150);
  assert.match(r.body.train.bookUrl, /^https:\/\//);
  const nearby = await get('/api/trains?origin=Paris');
  assert.equal(nearby.body.to, null);
  assert.ok(nearby.body.nearby.some((n) => n.to === 'Londres'));
  const en = await get('/api/trains?origin=Paris&destination=London', 'en');
  assert.equal(en.body.to, 'London');
  assert.equal((await get('/api/trains?origin=xx')).status, 400);
  assert.equal((await get('/api/trains?origin=Madrid&destination=madrid')).status, 400);
});

test('la IA entiende los trenes y «cómo ir de X a Y»', () => {
  const a = localParse('tren de madrid a barcelona el 20 para 2');
  assert.equal(a.kind, 'train');
  assert.equal(a.origin, 'Madrid');
  assert.equal(a.destination, 'Barcelona');
  assert.equal(a.adults, 2);
  const b = localParse('cómo ir de Sevilla a Madrid');
  assert.equal(b.kind, 'train');
  assert.equal(localParse('como ir de madrid a nueva york').kind, 'flight');
  const c = localParse('eurostar a londres desde paris');
  assert.deepEqual([c.kind, c.origin, c.destination], ['train', 'París', 'Londres']);
  assert.equal(localParse('vuelos de madrid a londres').kind, 'flight');
  const d = localParse('Zug von Berlin nach München', 'de');
  assert.equal(d.kind, 'train');
  assert.match(d.explanation, /Züge und Flüge/);
  assert.equal(localParse('hotel en roma con piscina').kind, 'hotel');
});
