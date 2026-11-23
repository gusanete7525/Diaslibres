import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHRISTMAS_CITIES, CHRISTMAS_TRIP, makeChristmasSearch } from '../src/christmas-cities.js';

test('Colmar cotiza el alojamiento en la ciudad y el vuelo hasta su aeropuerto de acceso', async () => {
  const city = CHRISTMAS_CITIES.find(city => city.slug === 'colmar');
  const live = {
    async hotels(destination) {
      assert.equal(destination, 'Colmar, FR');
      return [{ id: 'wrong', city: 'Basel' }, { id: 'correct', city: 'Colmar', name: 'Hôtel Colmar', stars: 3 }];
    },
    async quote(query) {
      assert.equal(query.itemId, 'correct');
      assert.equal(query.adults, 2);
      assert.equal(query.checkOut, CHRISTMAS_TRIP.checkOut);
      return { total: 300 };
    },
    async flightSearch(query) {
      assert.deepEqual(query, { origin: 'MAD', destination: 'BSL', date: CHRISTMAS_TRIP.checkIn, returnDate: CHRISTMAS_TRIP.checkOut, adults: 2 });
      return [
        { outbound: { arrival: '2026-12-19T05:00:00' }, inbound: {}, total: 50, currency: 'EUR' },
        { outbound: { arrival: '2026-12-18T12:00:00' }, inbound: {}, total: 210, currency: 'EUR' },
      ];
    },
  };
  const search = makeChristmasSearch(live, true);
  const request = search(city);
  assert.equal(search(city), request);
  const result = await request;
  assert.equal(result.hotel.total, 300);
  assert.equal(result.flight.total, 210);
});

test('un fallo de vuelos no oculta la tarifa de hotel', async () => {
  const city = CHRISTMAS_CITIES.find(city => city.slug === 'praga');
  const live = {
    hotels: async () => [{ id: 'hotel', city: 'Praha', name: 'Hotel Praha', stars: 3 }],
    quote: async () => ({ total: 200 }),
    flightSearch: async () => { throw new Error('Proveedor temporalmente no disponible'); },
  };
  const result = await makeChristmasSearch(live, true)(city);
  assert.equal(result.hotel.total, 200);
  assert.equal(result.flight, null);
});
