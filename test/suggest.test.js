import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSuggester, localMatches } from '../src/suggest.js';

test('sugerencias locales: sin tildes ni mayúsculas y en cada idioma', () => {
  assert.equal(localMatches('par', 'es')[0].name, 'París');
  assert.equal(localMatches('PAR', 'en')[0].name, 'Paris');
  assert.equal(localMatches('munich', 'es')[0].name, 'Múnich');
  assert.equal(localMatches('münch', 'de')[0].name, 'München');
  assert.equal(localMatches('lond', 'es')[0].name, 'Londres');
  assert.deepEqual(localMatches('p', 'es'), []);
});

test('sugerencias: añade LiteAPI, quita duplicados y descarta calles', async () => {
  const live = {
    placesRaw: async () => ({ data: [
      { displayName: 'Park Circle', formattedAddress: 'North Charleston, Carolina del Sur, EE. UU.', types: ['political', 'neighborhood'] },
      { displayName: 'París', formattedAddress: 'Francia', types: ['locality'] },
      { displayName: 'Parma', formattedAddress: 'Parma, Italia', types: ['locality'] },
      { displayName: 'Paros', formattedAddress: 'Grecia', types: ['natural_feature'] },
    ] }),
  };
  const names = (await createSuggester({ live })('par', 'es')).map((p) => p.name);
  assert.equal(names[0], 'París');
  assert.equal(names.filter((n) => n === 'París').length, 1);
  assert.ok(names.includes('Parma') && names.includes('Paros'));
  assert.ok(!names.includes('Park Circle'));
});

test('sugerencias: si LiteAPI falla o tarda, responde con la lista propia', async () => {
  const fails = createSuggester({ live: { placesRaw: async () => { throw new Error('caído'); } } });
  assert.equal((await fails('par', 'es'))[0].name, 'París');
  const slow = createSuggester({ live: { placesRaw: () => new Promise(() => {}) }, timeoutMs: 50 });
  assert.equal((await slow('tokio', 'es'))[0].name, 'Tokio');
});

test('sugerencias de aeropuerto: solo ciudades con aeropuerto', async () => {
  const live = { airports: async () => [{ code: 'ORY', name: 'Orly', city: 'Paris', country: 'FR' }, { code: 'PMO', name: 'Palermo', city: 'Palermo', country: 'IT' }] };
  const out = await createSuggester({ live })('par', 'es', 'airport');
  assert.equal(out[0].iata, 'CDG');
  assert.ok(out.every((p) => p.iata));
});
