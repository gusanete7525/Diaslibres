// SEO: portada, páginas generales (/hoteles, /vuelos, /escapadas, /donde-viajar), ciudades,
// filtros, rutas, sitemaps, robots, llms.txt y datos estructurados, en todos los idiomas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { BookingStore } from '../src/store.js';
import { hubPage, homePage, cityPage, cityUrl, HUBS, hubUrl, CITIES } from '../src/seo.js';
import { LANGS, LANG_CODES } from '../src/i18n.js';

delete process.env.ANTHROPIC_API_KEY;
let server, base;

before(async () => {
  const app = createApp({ store: new BookingStore(null), osm: null, live: null });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const html = async (p) => {
  const r = await fetch(base + p, { redirect: 'manual' });
  return { status: r.status, body: r.status === 200 ? await r.text() : '', location: r.headers.get('location') };
};
const pick = (body, re) => body.match(re)?.[1];
const title = (b) => pick(b, /<title>([^<]*)<\/title>/);
const canonical = (b) => pick(b, /<link rel="canonical" href="([^"]+)"/);
const h1 = (b) => pick(b, /<h1[^>]*>([\s\S]*?)<\/h1>/);
const ld = (b) => JSON.parse(pick(b, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/).replace(/\\u003c/g, '<'));
const hreflangs = (b) => Object.fromEntries([...b.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]));

test('portada: título y descripción nuevos, H1 con IA y traducidos', async () => {
  const es = await html('/');
  assert.equal(es.status, 200);
  assert.equal(title(es.body), 'DíasLibres · Vuelos y hoteles baratos con calendario e IA');
  assert.match(es.body, /<meta name="description" content="Busca vuelos y hoteles, mira en un calendario/);
  assert.match(h1(es.body), /inteligencia artificial/);
  assert.equal(canonical(es.body), base + '/');
  const en = await html('/en/');
  assert.match(title(en.body), /Cheap flights and hotels/);
  assert.match(h1(en.body), /artificial intelligence/);
  assert.match(en.body, /<html lang="en">/);
  for (const l of LANG_CODES) assert.ok(title((await html(LANGS[l].prefix + '/')).body).length <= 70, `título largo en ${l}`);
});

test('portada con parámetros (vuelta del pago): noindex y sin hreflang', async () => {
  const { body } = await html('/?pago=abc');
  assert.match(body, /<meta name="robots" content="noindex" \/>/);
  assert.deepEqual(hreflangs(body), {});
  assert.equal(homePage('es', true).noindex, true);
});

test('páginas generales en los 7 idiomas: 200, canonical, hreflang, H1 propio y enlaces', async () => {
  for (const l of LANG_CODES) {
    for (const k of HUBS) {
      const path = hubUrl(l, k);
      const { status, body } = await html(path);
      assert.equal(status, 200, path);
      assert.equal(canonical(body), base + path, path);
      const alt = hreflangs(body);
      assert.equal(Object.keys(alt).length, LANG_CODES.length + 1, path);
      for (const o of LANG_CODES) assert.equal(alt[o], base + hubUrl(o, k), `${path} → ${o}`);
      assert.equal(alt['x-default'], base + hubUrl('es', k));
      assert.doesNotMatch(body, /name="robots" content="noindex"/, path);
      assert.match(body, new RegExp(`data-hub="${k}"`), path);
      assert.match(body, /<section class="seo-intro">/, path);
      assert.ok((body.match(/<ul class="seo-links">/g) || []).length >= 2, `${path}: pocos enlaces`);
      assert.doesNotMatch(body, /undefined|\{n\}|\{city\}/, path);
    }
  }
});

test('páginas generales traducidas: sin frases en español fuera de /es', async () => {
  const spanish = ['Elige un destino', 'Elige una ruta', 'Ideas para una escapada', 'Escribe en el buscador', 'Más ideas', 'Hoteles en España'];
  for (const l of LANG_CODES.slice(1)) {
    for (const k of HUBS) {
      const p = hubPage(l, k);
      for (const s of spanish) assert.ok(!p.html.includes(s), `${l}/${k}: «${s}» sin traducir`);
      assert.notEqual(p.title, hubPage('es', k).title, `${l}/${k}: título sin traducir`);
      assert.notEqual(p.h1, hubPage('es', k).h1, `${l}/${k}: H1 sin traducir`);
    }
  }
});

test('/hoteles enlaza a todas las ciudades y /vuelos a las rutas', async () => {
  const hotels = hubPage('es', 'hotels');
  for (const c of CITIES) assert.ok(hotels.html.includes(`href="${cityUrl('es', c)}"`), c.es);
  assert.match(hotels.html, /href="\/hoteles\/madrid"/);
  assert.match(hotels.html, /href="\/hoteles\/valencia"/);
  assert.match(hotels.description, /\d+ destinos/);
  const flights = hubPage('es', 'flights');
  assert.match(flights.html, /href="\/vuelos\/madrid-barcelona"/);
  assert.match(flights.html, /Vuelos desde Madrid/);
  assert.equal(flights.view, 'flights');
  assert.match(hubPage('es', 'escapes').html, /href="\/hoteles\/[a-z-]+\/con-spa"/);
  assert.equal(hubPage('es', 'nada'), null);
});

test('datos estructurados: WebSite, TravelAgency con Gusansoft y migas en las páginas generales', async () => {
  const { body } = await html('/escapadas');
  const data = ld(body);
  const types = data.map((x) => x['@type']);
  assert.ok(types.includes('WebSite') && types.includes('TravelAgency') && types.includes('BreadcrumbList'));
  assert.equal(data.find((x) => x['@type'] === 'TravelAgency').parentOrganization.name, 'Gusansoft');
  const crumb = data.find((x) => x['@type'] === 'BreadcrumbList');
  assert.equal(crumb.itemListElement[1].item, base + '/escapadas');
  assert.equal(crumb.itemListElement[1].name, 'Escapadas');
  assert.ok(!types.includes('FAQPage'), 'sin FAQ inventadas');
});

test('ciudades, filtros y rutas siguen igual', async () => {
  const city = await html('/hoteles/madrid');
  assert.equal(city.status, 200);
  assert.equal(canonical(city.body), base + '/hoteles/madrid');
  assert.match(city.body, /href="\/escapadas"/, 'el pie enlaza a las páginas generales');
  const filter = await html('/en/hotels/madrid/with-pool');
  assert.equal(filter.status, 200);
  assert.equal(canonical(filter.body), base + '/en/hotels/madrid/with-pool');
  const route = await html('/vuelos/madrid-barcelona');
  assert.equal(route.status, 200);
  assert.match(route.body, /data-start-view="flights"/);
  assert.doesNotMatch(route.body, /data-hub=/);
  assert.equal((await html('/hoteles/madrid/filtro-que-no-existe')).status, 301);
  // Un filtro sin hoteles no se indexa.
  const madrid = CITIES.find((c) => c.es === 'Madrid');
  const empty = cityPage('es', madrid, { id: 'spa', fac: ['spa'], title: 'Hoteles con spa en {city}', slug: { es: 'con-spa' } }, { total: 10, stars: [0, 0, 0, 0, 0], fac: {}, stay: {}, top: [], filters: { spa: { count: 0, top: [] } } });
  assert.equal(empty.noindex, true);
});

test('sitemaps: índice por idioma y páginas generales dentro', async () => {
  const index = await (await fetch(base + '/sitemap.xml')).text();
  for (const l of LANG_CODES) assert.match(index, new RegExp(`/sitemap-${l}\\.xml`));
  for (const l of LANG_CODES) {
    const xml = await (await fetch(`${base}/sitemap-${l}.xml`)).text();
    for (const k of HUBS) assert.ok(xml.includes(`<loc>${base}${hubUrl(l, k)}</loc>`), `${l}: falta ${hubUrl(l, k)}`);
    assert.ok(xml.includes(`<loc>${base}${LANGS[l].prefix}/</loc>`));
  }
  assert.equal((await fetch(base + '/sitemap-xx.xml')).status, 404);
});

test('robots.txt y llms.txt', async () => {
  const robots = await (await fetch(base + '/robots.txt')).text();
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, new RegExp(`Sitemap: ${base}/sitemap\\.xml`));
  const llms = await (await fetch(base + '/llms.txt')).text();
  assert.match(llms, /vuelos, hoteles y trenes/);
  assert.match(llms, /\/donde-viajar/);
  assert.match(llms, /Gusansoft/);
});
