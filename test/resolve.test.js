import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localParse } from '../src/ai.js';
import { makeResolver } from '../src/resolve.js';

// LiteAPI simulado: aeropuertos y lugares con el mismo nombre en varios países.
const norm = (x) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const AIRPORTS = {
  cordoba: [{ code: 'ODB', city: 'Córdoba', country: 'Spain' }, { code: 'COR', city: 'Córdoba', country: 'Argentina' }],
  cartagena: [{ code: 'CTG', city: 'Cartagena', country: 'Colombia' }],
  paris: [{ code: 'CDG', city: 'Paris', country: 'France' }, { code: 'PRX', city: 'Paris', country: 'United States' }],
  chiclayo: [{ code: 'CIX', city: 'Chiclayo', country: 'Peru' }],
};
const PLACES = {
  cordoba: [{ name: 'Córdoba', country: 'España' }, { name: 'Córdoba', country: 'Argentina' }],
  chiclyo: [{ name: 'Chiclayo', country: 'Perú' }],
};
const resolve = makeResolver({ airports: async (q) => AIRPORTS[norm(q)] || [], findPlaces: async (q) => PLACES[norm(q)] || [] });
const run = (q) => resolve(localParse(q), 'es', q);

test('la IA pregunta qué ciudad si hay varias con ese nombre', async () => {
  const cart = await run('vuelo de lima a cartagena');
  assert.equal(cart.ask.question, '¿Qué Cartagena?');
  assert.deepEqual(cart.ask.options.map((o) => o.value), ['RMU', 'CTG']);
  assert.equal(cart.ask.options[1].label, 'Cartagena de Indias (Colombia)');
  // Si el otro extremo del viaje está en uno de los países, no pregunta.
  assert.equal((await run('vuelo de madrid a cartagena')).destination, 'RMU');
  assert.equal((await run('vuelo de bogota a cartagena')).destination, 'CTG');
  assert.equal((await run('vuelo de buenos aires a cordoba')).destination, 'COR');
  assert.deepEqual((await run('vuelo de lima a cordoba')).ask.options.map((o) => o.value), ['ODB', 'COR']);
  // El país escrito decide.
  assert.equal((await run('vuelo de lima a cordoba argentina')).destination, 'COR');
  assert.equal((await run('hoteles en cordoba argentina')).destination, 'Córdoba, Argentina');
  // Nuestro destino conocido gana a uno pequeño con el mismo nombre (París, no Paris de Texas).
  const paris = await run('vuelo de lima a paris');
  assert.equal(paris.ask, undefined);
  assert.equal(paris.destination, 'CDG');
  // Hoteles.
  assert.deepEqual((await run('hoteles en cartagena')).ask.options.map((o) => o.value), ['Cartagena', 'Cartagena de Indias']);
});

test('la IA pregunta «¿Querías decir…?» si el nombre está mal escrito', async () => {
  const f = await run('vuelo de lima a chiclyo');
  assert.equal(f.ask.question, '¿Querías decir…?');
  assert.deepEqual(f.ask.options, [{ label: 'Chiclayo (Perú)', value: 'CIX' }]);
  assert.deepEqual((await run('hoteles en chiclyo')).ask.options, [{ label: 'Chiclayo (Perú)', value: 'Chiclayo, Perú' }]);
  assert.equal((await run('hoteles en granda')).ask.options[0].value, 'Granada');
  assert.equal((await run('hoteles en benidorm')).ask, undefined);
});
