import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promotionMarket } from '../src/markets.js';
import { makeEscapeSearch } from '../src/escapes.js';
import { todayISO, addDays } from '../src/availability.js';
import { createApp } from '../server.js';
import { BookingStore } from '../src/store.js';
const query = () => ({ from: addDays(todayISO(), 5), to: addDays(todayISO(), 20), days: 3 });

test('el francés busca hoteles franceses y el español incluye España y países hispanohablantes', async () => {
  const cities = [];
  const live = { sandbox: false,
    hotels: async (city, { lang }) => { cities.push({ city, lang }); return [{ id: 'lite-' + city, name: city, city, rating: 8, stars: 3 }]; },
    quote: async () => ({ total: 120, payAtHotel: [] }),
  };
  const search = makeEscapeSearch(live);
  const fr = await search(query(), 'fr');
  assert.equal(cities.length, 3);
  assert.ok(cities.every(c => c.city.endsWith(', France') && c.lang === 'fr'));
  assert.deepEqual(fr.market.countries, ['FR']);
  cities.length = 0;
  const es = await search(query(), 'es');
  assert.ok(cities.some(c => c.city.endsWith(', Spain')));
  assert.ok(cities.some(c => c.city.endsWith(', Mexico')));
  assert.ok(cities.some(c => c.city.endsWith(', Colombia')));
  assert.equal(es.market.basedOn, 'language');
  assert.ok(es.results.every(r => !r.city.endsWith(', France')));
  const before = cities.length;
  await search(query(), 'fr');
  assert.equal(cities.length, before, 'la caché francesa se reutiliza sin mezclar resultados españoles');
});

test('compara precios completos de dos alojamientos modestos y conserva descuentos reales', async () => {
  const asked = [];
  const promotion = { percent: 20, originalTotal: 125, total: 100, savings: 25, currency: 'EUR' };
  const live = { sandbox: false,
    hotels: async city => [
      { id: 'lite-luxury-' + city, name: 'Luxury', city, rating: 9, stars: 5 },
      { id: 'lite-one-' + city, name: 'Modest one', city, rating: 8, stars: 3 },
      { id: 'lite-two-' + city, name: 'Modest two', city, rating: 8, stars: 2 },
    ],
    quote: async q => { asked.push(q.itemId); return { total: q.itemId.includes('-two-') ? 100 : 150, payAtHotel: [], promotion: q.itemId.includes('-two-') ? promotion : null }; },
  };
  const data = await makeEscapeSearch(live)({ ...query(), budget: 120 }, 'fr');
  assert.equal(asked.length, 18, 'muestra acotada: 3 ciudades, 2 hoteles y 3 fechas');
  assert.ok(asked.every(id => !id.includes('luxury')));
  assert.equal(data.results.length, 3);
  assert.ok(data.results.every(r => r.total === 100 && r.promotion.percent === 20));
});

test('todos los idiomas tienen un perfil independiente y un idioma desconocido usa español', () => {
  for (const lang of ['es', 'fr', 'en', 'de', 'it', 'pt', 'nl']) {
    const m = promotionMarket(lang);
    assert.equal(m.language, lang);
    assert.equal(m.hotels.length, 3);
    assert.equal(m.routes.length, 3);
    assert.ok(m.routes.every(([o, d]) => /^[A-Z]{3}$/.test(o) && /^[A-Z]{3}$/.test(d) && o !== d));
  }
  assert.equal(promotionMarket('unknown').language, 'es');
  const m = promotionMarket('fr'); m.hotels.length = 0;
  assert.equal(promotionMarket('fr').hotels.length, 3, 'un consumidor no modifica los perfiles compartidos');
});

test('API de vuelos usa París en francés y Madrid en español, sin compartir cachés ni conservar tarifas fallidas', async () => {
  const calls = [];
  let fail = false;
  const live = { sandbox: false, flightSearch: async q => {
    calls.push(q);
    if (fail) throw new Error('unavailable');
    return [300, 90].map(total => ({ total, currency: 'EUR', outbound: { airlines: ['Test airline'], departure: q.date + 'T10:00:00', stops: 0, minutes: 120 } }));
  } };
  const app = createApp({ live, osm: null, store: new BookingStore(null), reconcileEveryMs: 0 });
  const server = app.listen(0); await new Promise(r => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;
  const get = async lang => {
    const response = await fetch(base + '/api/flights/deals', { headers: { 'X-Lang': lang } });
    assert.equal(response.headers.get('cache-control'), 'no-store'); return response.json();
  };
  try {
    await app.locals.refreshDeals('fr');
    const fr = await get('fr');
    assert.equal(calls.length, 3);
    assert.ok(fr.deals.every(d => d.origin.code === 'CDG' && d.origin.name === 'Paris' && d.total === 90));
    assert.ok(fr.deals.some(d => d.destination.code === 'NCE'));
    assert.equal(fr.sandbox, false);
    assert.equal(fr.market.language, 'fr');
    await app.locals.refreshDeals('es');
    const es = await get('es');
    assert.equal(calls.length, 6);
    assert.ok(es.deals.every(d => d.origin.code === 'MAD'));
    assert.ok(es.deals.some(d => d.destination.code === 'MEX'));
    assert.ok(es.deals.some(d => d.destination.code === 'BOG'));
    await get('fr'); assert.equal(calls.length, 6);
    fail = true;
    await app.locals.refreshDeals('fr');
    assert.deepEqual((await get('fr')).deals, []);
    assert.equal((await get('es')).deals.length, 3, 'un fallo francés no elimina la caché española');
  } finally { server.close(); }
});
