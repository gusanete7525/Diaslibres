import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { BookingStore } from '../src/store.js';
import { localParse } from '../src/ai.js';

delete process.env.ANTHROPIC_API_KEY;
let server, base, app;

before(async () => {
  app = createApp({ store: new BookingStore(null), osm: null, live: null });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const get = (p) => fetch(base + p).then((r) => r.json());
const post = (p, body) =>
  fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('los hoteles traen calendario y resumen de precios', async () => {
  const data = await get('/api/hotels?days=30');
  assert.ok(data.results.length > 0);
  const h = data.results[0];
  assert.equal(h.calendar.length, 30);
  assert.ok(h.calendar.some((d) => d.available));
  assert.ok(h.summary.minPrice <= h.summary.maxPrice);
});

test('filtra por destino y etiquetas', async () => {
  const data = await get('/api/hotels?destination=malaga');
  assert.ok(data.results.length > 0 && data.results.every((h) => h.city === 'Málaga'));
  const beach = await get('/api/hotels?tags=montaña');
  assert.ok(beach.results.every((h) => h.tags.includes('montaña')));
});

test('reservar un hotel ocupa los días y no permite sobre-reservar', async () => {
  const data = await get('/api/hotels?destination=granada&nights=2');
  const h = data.results[0];
  const { checkIn, checkOut } = h.bestStay;
  const nightIdx = h.calendar.findIndex((d) => d.date === checkIn);
  const leftBefore = Math.min(h.calendar[nightIdx].left, h.calendar[nightIdx + 1].left);

  let last;
  for (let i = 0; i < leftBefore; i++) {
    last = await post('/api/bookings', { type: 'hotel', itemId: h.id, checkIn, checkOut, units: 1, name: 'Ana', email: 'ana@test.com' });
    assert.equal(last.status, 201, JSON.stringify(last.body));
  }
  assert.match(last.body.code, /^DL-/);

  const after = await get('/api/hotels?destination=granada');
  const stay = after.results[0].calendar.slice(nightIdx, nightIdx + 2);
  assert.ok(stay.some((d) => !d.available), 'al menos una noche queda completa');

  const extra = await post('/api/bookings', { type: 'hotel', itemId: h.id, checkIn, checkOut, units: 1, name: 'Ana', email: 'ana@test.com' });
  assert.equal(extra.status, 409);

  const mine = await get('/api/bookings?email=ANA@test.com');
  assert.equal(mine.length, leftBefore);
  const cancel = await post(`/api/bookings/${mine[0].code}/cancel`, { email: 'ana@test.com' });
  assert.equal(cancel.body.status, 'cancelada');
  const freed = await get('/api/hotels?destination=granada');
  assert.ok(freed.results[0].calendar.slice(nightIdx, nightIdx + 2).every((d) => d.available));
});

test('reserva de vuelo y validaciones', async () => {
  const data = await get('/api/flights?origin=MAD&destination=lisboa');
  assert.equal(data.results.length, 1);
  const f = data.results[0];
  const day = f.calendar.find((d) => d.left >= 2);
  const ok = await post('/api/bookings', { type: 'flight', itemId: f.id, date: day.date, units: 2, name: 'Luis', email: 'luis@test.com' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.total, day.price * 2);
  const bad = await post('/api/bookings', { type: 'flight', itemId: f.id, date: day.date, name: 'L', email: 'nope' });
  assert.equal(bad.status, 400);
});

test('búsqueda IA (intérprete local) entiende frases en español', async () => {
  const r = await post('/api/ai-search', { query: 'Hotel de playa barato en Málaga para una semana en diciembre' });
  assert.equal(r.body.source, 'local');
  assert.equal(r.body.kind, 'hotel');
  assert.equal(r.body.destination, 'Málaga');
  assert.equal(r.body.nights, 7);
  assert.equal(r.body.sort, 'price');
  assert.ok(r.body.tags.includes('playa'));
  assert.match(r.body.checkIn, /-12-01$/);

  const fl = localParse('vuelos de Madrid a Roma por menos de 120 euros');
  assert.equal(fl.kind, 'flight');
  assert.equal(fl.origin, 'MAD');
  assert.equal(fl.destination, 'FCO');
  assert.equal(fl.maxPrice, 120);

  assert.equal(localParse('algo en gandía este finde').destination, 'Gandía');
  assert.equal(localParse('hoteles en santiago de compostela').destination, 'Santiago de Compostela');
  assert.equal(localParse('escapada a la playa en julio').destination ?? null, null);
});

test('páginas para buscadores: ciudad, ruta, sitemap y robots', async () => {
  const html = await fetch(base + '/hoteles/gandia').then((r) => r.text());
  assert.match(html, /<title>Hoteles en Gandía/);
  assert.match(html, /<link rel="canonical" href="http:\/\/localhost:\d+\/hoteles\/gandia"/);
  assert.match(html, /<input name="destination" value="Gandía"/);
  assert.match(html, /application\/ld\+json/);
  const route = await fetch(base + '/vuelos/madrid-barcelona').then((r) => r.text());
  assert.match(route, /Vuelos baratos de Madrid a Barcelona/);
  assert.match(route, /data-start-view="flights"/);
  const bad = await fetch(base + '/vuelos/madrid-madrid', { redirect: 'manual' });
  assert.equal(bad.status, 301);
  const index = await fetch(base + '/sitemap.xml').then((r) => r.text());
  assert.match(index, /<sitemapindex/);
  assert.match(index, /\/sitemap-de\.xml</);
  const map = await fetch(base + '/sitemap-es.xml').then((r) => r.text());
  assert.match(map, /\/hoteles\/santiago-de-compostela</);
  assert.match(map, /\/vuelos\/londres-malaga</);
  const en = await fetch(base + '/sitemap-en.xml').then((r) => r.text());
  assert.match(en, /\/en\/hotels\/seville</);
  assert.match(en, /\/en\/flights\/london-malaga</);
  assert.match(await fetch(base + '/robots.txt').then((r) => r.text()), /Sitemap: .*\/sitemap\.xml/);
  const home = await fetch(base + '/').then((r) => r.text());
  assert.match(home, /rel="manifest"/);
  assert.doesNotMatch(home, /noindex/);
  assert.match(await fetch(base + '/?pago=X').then((r) => r.text()), /noindex/);
});

test('con SITE_URL, las otras direcciones redirigen al dominio propio', async () => {
  // fetch no deja cambiar la cabecera Host: se usa http.request.
  const { request } = await import('node:http');
  const hit = (path) => new Promise((resolve, reject) => {
    const { port } = new URL(base);
    request({ port, path, headers: { host: 'diaslibres.onrender.com' } }, (r) => { r.resume(); resolve(r); }).on('error', reject).end();
  });
  process.env.SITE_URL = 'https://diaslibre.com';
  try {
    const r = await hit('/hoteles/gandia?x=1');
    assert.equal(r.statusCode, 301);
    assert.equal(r.headers.location, 'https://diaslibre.com/hoteles/gandia?x=1');
    assert.equal((await hit('/api/config')).statusCode, 200);
    assert.equal((await hit('/google93b9b90670433b82.html')).statusCode, 200);
    const html = await fetch(base + '/').then((x) => x.text());
    assert.match(html, /<link rel="canonical" href="https:\/\/diaslibre\.com\/"/);
  } finally {
    delete process.env.SITE_URL;
  }
});

test('app.js se sirve minificado', async () => {
  const js = await fetch(base + '/app.js').then((r) => r.text());
  assert.ok(js.length > 1000);
  assert.doesNotMatch(js, /\/\/ ---------- /);
});

test('la IA entiende las escalas de los vuelos', () => {
  assert.equal(localParse('vuelos directos de Madrid a Lisboa').stops, '0');
  assert.equal(localParse('vuelo de Madrid a Roma sin escalas').stops, '0');
  assert.equal(localParse('vuelos de Madrid a Londres con una escala').stops, '1');
  assert.equal(localParse('vuelos baratos de Madrid a Tenerife con varios transbordos').stops, 'many');
  assert.equal(localParse('vuelos de Madrid a Lisboa').stops, null);
  assert.equal(localParse('hotel directo en la playa').stops, null);
});

test('la web en otros idiomas: páginas, enlaces entre idiomas y filtros', async () => {
  const de = await fetch(base + '/de/hotels/sevilla').then((r) => r.text());
  assert.match(de, /<html lang="de">/);
  assert.match(de, /<link rel="alternate" hreflang="en" href="http:\/\/localhost:\d+\/en\/hotels\/seville"/);
  assert.match(de, /<link rel="alternate" hreflang="es" href="http:\/\/localhost:\d+\/hoteles\/sevilla"/);
  assert.match(de, /<input name="destination" value="Sevilla"/);
  const en = await fetch(base + '/en/').then((r) => r.text());
  assert.match(en, /<html lang="en">/);
  assert.match(en, /href="\/en\/hotels\/seville"/);
  const filter = await fetch(base + '/hoteles/benidorm/con-piscina').then((r) => r.text());
  assert.match(filter, /<title>Hoteles con piscina en Benidorm/);
  assert.match(filter, /data-start-filters="[^"]*piscina/);
  const bad = await fetch(base + '/hoteles/benidorm/no-existe', { redirect: 'manual' });
  assert.equal(bad.status, 301);
  const fr = await fetch(base + '/fr/vols/paris-madrid').then((r) => r.text());
  assert.match(fr, /data-start-view="flights"/);
  assert.match(fr, /<input name="origin" value="Paris"/);
});

test('la IA entiende otros idiomas', () => {
  const en = localParse('cheap beach hotel with pool in Benidorm for a week in July', 'en');
  assert.equal(en.destination, 'Benidorm');
  assert.equal(en.nights, 7);
  assert.equal(en.sort, 'price');
  assert.ok(en.fac.includes('piscina'));
  const de = localParse('Direktflüge von London nach Málaga', 'de');
  assert.equal(de.kind, 'flight');
  assert.equal(de.origin, 'LHR');
  assert.equal(de.destination, 'AGP');
  assert.equal(de.stops, '0');
  const fr = localParse('hôtel tout compris à Tenerife', 'fr');
  assert.equal(fr.board, 'AI');
  assert.equal(fr.destination, 'Tenerife');
  assert.equal(localParse('hotel in Sevilla', 'en').destination, 'Seville');
  assert.equal(localParse('Romantic weekend getaway', 'en').destination ?? null, null);
  assert.equal(localParse('Strand mit Kindern auf den Kanaren, 5 Nächte', 'de').destination, 'Tenerife');
  assert.equal(localParse('Hotel de montanha por menos de 100 €', 'pt').destination ?? null, null);
});

test('IndexNow: clave publicada y envío de todas las páginas', async () => {
  assert.equal(await fetch(base + '/5f3c9e1a7b2d4c8e9a0f6b1d3e7c2a94.txt').then((r) => r.text()), '5f3c9e1a7b2d4c8e9a0f6b1d3e7c2a94');
  const sent = [];
  process.env.SITE_URL = 'https://diaslibre.com';
  try {
    const r = await app.locals.submitIndexNow(async (url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true, status: 200 }; });
    assert.ok(r.sent > 3000);
    assert.equal(sent[0].host, 'diaslibre.com');
    assert.ok(sent[0].urlList.includes('https://diaslibre.com/de/hotels/sevilla'));
    assert.equal((await app.locals.submitIndexNow(async () => { throw new Error('no debería enviar'); })).sent, 0);
  } finally {
    delete process.env.SITE_URL;
  }
});
