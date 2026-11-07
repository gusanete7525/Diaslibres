import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { BookingStore } from '../src/store.js';

// LiteAPI falsa: 12 hoteles por ciudad, con puntuaciones distintas.
const fakeLive = (asked) => ({
  sandbox: true,
  hotels: async (city) => {
    asked.push(city);
    return Array.from({ length: 12 }, (_, i) => ({ id: `lite-${city}-${i}`, name: `${city} ${i}`, city, stars: 4, rating: 9 - i * 0.3, reviewCount: 200 }));
  },
});

async function search(qs) {
  const asked = [];
  const app = createApp({ store: new BookingStore(null), osm: null, live: fakeLive(asked) });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const data = await fetch(`http://localhost:${server.address().port}/api/hotels${qs}`).then((r) => r.json());
    return { data, asked };
  } finally { server.close(); }
}

test('sin destino, la portada mezcla hoteles de varias ciudades (no solo Madrid)', async () => {
  const { data, asked } = await search('');
  assert.equal(data.live.mixed, true);
  assert.ok(!asked.includes('Madrid'));
  const cities = new Set(data.results.map((h) => h.city));
  assert.ok(cities.size >= 5, `ciudades: ${[...cities]}`);
  // Intercalados: los primeros hoteles son de ciudades distintas.
  assert.equal(new Set(data.results.slice(0, 5).map((h) => h.city)).size, 5);
});

test('con destino escrito, solo esa ciudad', async () => {
  const { data, asked } = await search('?destination=Roma');
  assert.equal(data.live.mixed, false);
  assert.deepEqual(asked, ['Roma']);
  assert.ok(data.results.every((h) => h.city === 'Roma'));
});
