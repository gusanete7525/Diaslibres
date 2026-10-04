// Páginas para buscadores: /hoteles/<ciudad> y /vuelos/<origen>-<destino> sirven la
// misma web con título, descripción y texto propios, para que Google las indexe.
import { AIRPORTS } from './catalog.js';

export const SEO_CITIES = [
  'Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Málaga', 'Granada', 'Córdoba', 'Cádiz', 'Bilbao', 'San Sebastián',
  'Santander', 'Oviedo', 'Gijón', 'A Coruña', 'Santiago de Compostela', 'Vigo', 'Salamanca', 'Toledo', 'Segovia', 'Zaragoza',
  'Alicante', 'Benidorm', 'Gandía', 'Peñíscola', 'Torrevieja', 'Murcia', 'Almería', 'Marbella', 'Nerja', 'Ronda',
  'Salou', 'Sitges', 'Lloret de Mar', 'Tarragona', 'Girona', 'Benasque', 'Jaca', 'Palma de Mallorca', 'Ibiza', 'Menorca',
  'Tenerife', 'Gran Canaria', 'Lanzarote', 'Fuerteventura', 'Lisboa', 'Oporto', 'París', 'Roma', 'Florencia', 'Venecia',
  'Milán', 'Londres', 'Ámsterdam', 'Berlín', 'Praga', 'Viena', 'Budapest', 'Atenas', 'Dubái', 'Marrakech',
  'Nueva York', 'Cancún', 'Punta Cana', 'Tokio',
];

export const SEO_ROUTES = [
  ['MAD', 'BCN'], ['BCN', 'MAD'], ['MAD', 'LIS'], ['MAD', 'CDG'], ['MAD', 'FCO'], ['MAD', 'TFN'], ['MAD', 'PMI'], ['MAD', 'AGP'],
  ['MAD', 'LHR'], ['MAD', 'AMS'], ['BCN', 'AGP'], ['BCN', 'LHR'], ['BCN', 'SVQ'], ['VLC', 'PMI'], ['VLC', 'AMS'], ['BIO', 'MAD'],
];

const norm = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
export const slug = (x) => norm(x).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// «gandia» → «Gandía» si es conocida; si no, «villajoyosa» → «Villajoyosa».
export function cityFromSlug(s) {
  const known = SEO_CITIES.find((c) => slug(c) === s);
  if (known) return known;
  const words = String(s).split('-').filter(Boolean).slice(0, 6);
  if (!words.length || words.some((w) => !/^[a-z0-9]+$/.test(w))) return null;
  return words.map((w, i) => (i && ['de', 'del', 'la', 'el', 'las', 'los'].includes(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
}

const airportBySlug = (s) => Object.entries(AIRPORTS).find(([code, city]) => slug(city) === s || code.toLowerCase() === s);

export function routeFromSlug(s) {
  for (const [o, d] of SEO_ROUTES) {
    if (`${slug(AIRPORTS[o])}-${slug(AIRPORTS[d])}` === s) return { origin: AIRPORTS[o], destination: AIRPORTS[d] };
  }
  // Cualquier otra pareja de ciudades del catálogo.
  const parts = String(s).split('-');
  for (let i = 1; i < parts.length; i++) {
    const a = airportBySlug(parts.slice(0, i).join('-'));
    const b = airportBySlug(parts.slice(i).join('-'));
    if (a && b && a[0] !== b[0]) return { origin: a[1], destination: b[1] };
  }
  return null;
}

// Inserta en index.html los datos de la página. `page`: { path, title, description, h1, sub,
// view, destination, origin, list: [texto], noindex }.
export function renderPage(html, page, { site, verification } = {}) {
  const url = site + page.path;
  const ld = [{
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'DíasLibres',
    url: site + '/',
    inLanguage: 'es',
    potentialAction: { '@type': 'SearchAction', target: `${site}/hoteles/{ciudad}`, 'query-input': 'required name=ciudad' },
  }, {
    '@context': 'https://schema.org',
    '@type': 'TravelAgency',
    name: 'DíasLibres',
    url: site + '/',
    email: 'contact@gusansoft.com',
    logo: site + '/icon-512.png',
  }];
  if (page.crumb) {
    ld.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'DíasLibres', item: site + '/' },
        { '@type': 'ListItem', position: 2, name: page.crumb, item: url },
      ],
    });
  }
  const head = [
    `<link rel="canonical" href="${esc(url)}" />`,
    page.noindex ? '<meta name="robots" content="noindex" />' : '',
    verification ? `<meta name="google-site-verification" content="${esc(verification)}" />` : '',
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="DíasLibres" />`,
    `<meta property="og:locale" content="es_ES" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(site)}/og.png" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`,
  ].filter(Boolean).join('\n  ');
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(page.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(page.description)}" />\n  ${head}`);
  if (page.h1) out = out.replace(/<h1>[\s\S]*?<\/h1>/, `<h1>${esc(page.h1)}</h1>`);
  if (page.view) out = out.replace('<body>', `<body data-start-view="${esc(page.view)}">`);
  if (page.destination) out = out.replace('<input name="destination" ', `<input name="destination" value="${esc(page.destination)}" `);
  if (page.origin) out = out.replace('<input name="origin" ', `<input name="origin" value="${esc(page.origin)}" `);
  // Texto visible para buscadores (y para quien entra antes de que cargue la web);
  // la búsqueda lo sustituye en cuanto llegan los resultados.
  if (page.sub || page.list?.length) {
    const block = `<main id="results" class="results" aria-live="polite"><section class="seo-intro">${page.sub ? `<p>${esc(page.sub)}</p>` : ''}${page.list?.length ? `<ul>${page.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</section></main>`;
    out = out.replace('<main id="results" class="results" aria-live="polite"></main>', block);
  }
  return out;
}

export function sitemap(site) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    ['/', 'daily', '1.0'],
    ...SEO_CITIES.map((c) => [`/hoteles/${slug(c)}`, 'daily', '0.8']),
    ...SEO_ROUTES.map(([o, d]) => [`/vuelos/${slug(AIRPORTS[o])}-${slug(AIRPORTS[d])}`, 'daily', '0.7']),
    ['/legal.html', 'yearly', '0.2'],
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(([p, f, pr]) => `  <url><loc>${esc(site + p)}</loc><lastmod>${today}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`)
    .join('\n')}\n</urlset>\n`;
}
