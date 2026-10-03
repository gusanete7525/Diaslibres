import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { BookingStore } from '../src/store.js';
import { OsmHotels } from '../src/osm.js';
import { localParse } from '../src/ai.js';

// Respuestas simuladas de Nominatim y Overpass (no se sale a la red).
function fakeFetch(calls) {
  return async (url, opts = {}) => {
    calls.push(String(url));
    if (String(url).includes('nominatim')) {
      return Response.json([{ lat: '39.47', lon: '-0.37', name: 'València', boundingbox: ['39.42', '39.52', '-0.43', '-0.30'], address: { city: 'València', country: 'España' } }]);
    }
    assert.match(decodeURIComponent(opts.body), /tourism"="hotel"/);
    return Response.json({
      elements: [
        { type: 'node', id: 1, tags: { tourism: 'hotel', name: 'Hotel Ejemplo Playa', stars: '4', 'addr:street': 'Carrer de la Mar', 'addr:housenumber': '5', 'addr:postcode': '46011', website: 'https://ejemplo.test', swimming_pool: 'yes' } },
        { type: 'way', id: 2, center: {}, tags: { tourism: 'hotel', name: 'Pensión Centro' } },
        { type: 'node', id: 3, tags: { tourism: 'hotel', name: 'Pensión Centro' } },
        { type: 'node', id: 4, tags: { tourism: 'hotel', website: 'javascript:alert(1)', name: 'Hostal Raro', stars: '9' } },
      ],
    });
  };
}

async function withApp(osm, fn) {
  const server = createApp({ store: new BookingStore(null), osm, live: null }).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    await fn(`http://localhost:${server.address().port}`);
  } finally {
    server.close();
  }
}

test('añade hoteles reales de OpenStreetMap para cualquier ciudad y permite reservarlos', async () => {
  const calls = [];
  const osm = new OsmHotels({ fetchImpl: fakeFetch(calls) });
  await withApp(osm, async (base) => {
    const data = await fetch(`${base}/api/hotels?destination=Valencia`).then((r) => r.json());
    assert.equal(data.osm.count, 3);
    const h = data.results.find((x) => x.name === 'Hotel Ejemplo Playa');
    assert.equal(h.stars, 4);
    assert.equal(h.address, 'Carrer de la Mar, 5, 46011 València');
    assert.ok(h.tags.includes('piscina'));
    assert.equal(h.source, 'https://www.openstreetmap.org/node/1');
    assert.equal(h.calendar.length, 60);
    const raro = data.results.find((x) => x.name === 'Hostal Raro');
    assert.equal(raro.stars, null, 'estrellas fuera de rango se descartan');
    assert.equal(raro.website, null, 'solo se aceptan enlaces http(s)');

    // Segunda búsqueda: sale de caché, sin nuevas peticiones.
    await fetch(`${base}/api/hotels?destination=valencia`);
    assert.equal(calls.length, 2);

    const { checkIn, checkOut } = h.bestStay;
    const res = await fetch(`${base}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'hotel', itemId: h.id, checkIn, checkOut, name: 'Eva', email: 'eva@test.com' }),
    });
    assert.equal(res.status, 201);
  });
});

test('si OpenStreetMap falla se muestran los hoteles del catálogo y un aviso', async () => {
  const osm = new OsmHotels({ fetchImpl: async () => new Response('busy', { status: 429 }) });
  await withApp(osm, async (base) => {
    const data = await fetch(`${base}/api/hotels?destination=Sevilla`).then((r) => r.json());
    assert.ok(data.results.length >= 2);
    assert.equal(data.osm.count, 0);
    assert.match(data.osm.error, /OpenStreetMap/);
  });
});

test('el intérprete local reconoce ciudades fuera del catálogo', () => {
  const f = localParse('Hotel barato en Santiago de Compostela para dos noches');
  assert.equal(f.destination, 'Santiago de Compostela');
  assert.equal(f.nights, 2);
});
