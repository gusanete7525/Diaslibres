import { todayISO } from './availability.js';

// The selected language provides inspiration, not the visitor's location or nationality.
// Each language has a wider pool; a daily rotation keeps the home page varied while
// the same day always shows the same picks (so caches stay useful).
const MARKETS = {
  es: {
    hotels: [['Granada', 'ES'], ['Oaxaca', 'MX'], ['Cádiz', 'ES'], ['Cartagena', 'CO'], ['Santiago de Compostela', 'ES'], ['Cusco', 'PE'], ['Córdoba', 'ES'], ['Mérida', 'MX'], ['Salamanca', 'ES'], ['Medellín', 'CO'], ['Ronda', 'ES'], ['Buenos Aires', 'AR'], ['Toledo', 'ES'], ['Valparaíso', 'CL'], ['San Sebastián', 'ES'], ['Montevideo', 'UY']],
    routes: [['MAD', 'CUN'], ['MAD', 'PUJ'], ['MAD', 'HAV'], ['MAD', 'MEX'], ['MAD', 'BOG'], ['MAD', 'LIM'], ['MAD', 'EZE'], ['MAD', 'SDQ'], ['MAD', 'SCL'], ['MAD', 'MDE'], ['BCN', 'CUN'], ['MAD', 'MVD'], ['MAD', 'CTG'], ['BCN', 'BOG']],
    routesShown: 7,
  },
  fr: {
    hotels: [['Colmar', 'FR'], ['Annecy', 'FR'], ['Nîmes', 'FR'], ['Lyon', 'FR'], ['Bordeaux', 'FR'], ['Avignon', 'FR'], ['Strasbourg', 'FR'], ['Biarritz', 'FR'], ['Montpellier', 'FR'], ['Saint-Malo', 'FR']],
    routes: [['CDG', 'NCE'], ['CDG', 'TLS'], ['CDG', 'AGP'], ['ORY', 'BIQ'], ['CDG', 'LIS'], ['ORY', 'AJA'], ['CDG', 'FCO'], ['LYS', 'OPO']],
  },
  en: {
    hotels: [['York', 'GB'], ['Bath', 'GB'], ['Galway', 'IE'], ['Edinburgh', 'GB'], ['Cork', 'IE'], ['Brighton', 'GB'], ['Cambridge', 'GB'], ['Kilkenny', 'IE'], ['Liverpool', 'GB'], ['Oxford', 'GB']],
    routes: [['LHR', 'EDI'], ['LHR', 'DUB'], ['LHR', 'OPO'], ['LGW', 'AGP'], ['STN', 'BCN'], ['MAN', 'PMI'], ['LHR', 'LIS'], ['DUB', 'FAO']],
  },
  de: {
    hotels: [['Leipzig', 'DE'], ['Nuremberg', 'DE'], ['Salzburg', 'AT'], ['Dresden', 'DE'], ['Heidelberg', 'DE'], ['Innsbruck', 'AT'], ['Bamberg', 'DE'], ['Graz', 'AT'], ['Lübeck', 'DE'], ['Freiburg im Breisgau', 'DE']],
    routes: [['FRA', 'BER'], ['FRA', 'VIE'], ['FRA', 'PMI'], ['MUC', 'HAM'], ['FRA', 'LIS'], ['MUC', 'FCO'], ['DUS', 'TFS'], ['BER', 'BCN']],
  },
  it: {
    hotels: [['Bologna', 'IT'], ['Turin', 'IT'], ['Palermo', 'IT'], ['Verona', 'IT'], ['Lecce', 'IT'], ['Trieste', 'IT'], ['Matera', 'IT'], ['Perugia', 'IT'], ['Bergamo', 'IT'], ['Siracusa', 'IT']],
    routes: [['FCO', 'CTA'], ['FCO', 'BLQ'], ['MXP', 'NAP'], ['FCO', 'CAG'], ['MXP', 'PMO'], ['FCO', 'BCN'], ['LIN', 'BRI'], ['MXP', 'MAD']],
  },
  pt: {
    hotels: [['Braga', 'PT'], ['Coimbra', 'PT'], ['Rio de Janeiro', 'BR'], ['Évora', 'PT'], ['Salvador', 'BR'], ['Aveiro', 'PT'], ['Florianópolis', 'BR'], ['Guimarães', 'PT'], ['Ponta Delgada', 'PT'], ['Paraty', 'BR']],
    routes: [['LIS', 'OPO'], ['LIS', 'FNC'], ['LIS', 'GIG'], ['LIS', 'PDL'], ['OPO', 'FNC'], ['LIS', 'SSA'], ['LIS', 'MAD'], ['OPO', 'LHR']],
  },
  nl: {
    hotels: [['Delft', 'NL'], ['Utrecht', 'NL'], ['Ghent', 'BE'], ['Maastricht', 'NL'], ['Bruges', 'BE'], ['Leiden', 'NL'], ['Antwerp', 'BE'], ['Haarlem', 'NL'], ['Groningen', 'NL'], ['Leuven', 'BE']],
    routes: [['AMS', 'BCN'], ['AMS', 'OPO'], ['AMS', 'VLC'], ['AMS', 'AGP'], ['EIN', 'ALC'], ['AMS', 'LIS'], ['BRU', 'PMI'], ['AMS', 'FCO']],
  },
};
// When the visitor's country is known (from the IP, never stored), offers follow what
// travellers from that country usually book with us: mostly sun and city breaks in Spain
// and Portugal, flying from their own airports. Countries not listed use the language.
const LATAM_HOTELS = [['Madrid', 'ES'], ['Barcelona', 'ES'], ['Sevilla', 'ES'], ['Granada', 'ES'], ['Valencia', 'ES'], ['Lisboa', 'PT'], ['Málaga', 'ES'], ['Palma', 'ES']];
const latam = hub => ({ hotels: LATAM_HOTELS, routes: [[hub, 'MAD'], [hub, 'BCN'], [hub, 'LIS'], [hub, 'CUN'], [hub, 'PUJ'], [hub, 'MIA']].filter(([o, d]) => o !== d), routesShown: 4 });
const COUNTRY_MARKETS = {
  ES: { hotels: MARKETS.es.hotels, routes: MARKETS.es.routes, routesShown: 7 },
  GB: {
    hotels: [['Málaga', 'ES'], ['Benidorm', 'ES'], ['Adeje', 'ES'], ['Palma', 'ES'], ['Puerto del Carmen', 'ES'], ['Albufeira', 'PT'], ['Marbella', 'ES'], ['Ibiza', 'ES'], ['Alicante', 'ES'], ['Barcelona', 'ES']],
    routes: [['LGW', 'AGP'], ['MAN', 'TFS'], ['STN', 'ALC'], ['LHR', 'PMI'], ['LGW', 'ACE'], ['MAN', 'FAO'], ['LHR', 'BCN'], ['STN', 'IBZ'], ['BHX', 'AGP'], ['EDI', 'TFS']],
    routesShown: 5,
  },
  IE: {
    hotels: [['Málaga', 'ES'], ['Albufeira', 'PT'], ['Adeje', 'ES'], ['Alicante', 'ES'], ['Maspalomas', 'ES'], ['Barcelona', 'ES'], ['Palma', 'ES'], ['Lisboa', 'PT']],
    routes: [['DUB', 'AGP'], ['DUB', 'FAO'], ['DUB', 'TFS'], ['DUB', 'ALC'], ['DUB', 'LPA'], ['DUB', 'BCN'], ['DUB', 'PMI'], ['ORK', 'AGP']],
    routesShown: 5,
  },
  DE: {
    hotels: [['Palma', 'ES'], ['Adeje', 'ES'], ['Maspalomas', 'ES'], ['Corralejo', 'ES'], ['Barcelona', 'ES'], ['Málaga', 'ES'], ['Albufeira', 'PT'], ['Lisboa', 'PT'], ['Cala Millor', 'ES'], ['Sevilla', 'ES']],
    routes: [['FRA', 'PMI'], ['DUS', 'TFS'], ['MUC', 'LPA'], ['HAM', 'FUE'], ['BER', 'BCN'], ['FRA', 'AGP'], ['DUS', 'FAO'], ['MUC', 'LIS'], ['CGN', 'PMI'], ['STR', 'ACE']],
    routesShown: 5,
  },
  FR: {
    hotels: [['Barcelona', 'ES'], ['Madrid', 'ES'], ['Sevilla', 'ES'], ['Lisboa', 'PT'], ['Porto', 'PT'], ['Palma', 'ES'], ['Valencia', 'ES'], ['San Sebastián', 'ES'], ['Málaga', 'ES'], ['Funchal', 'PT']],
    routes: [['ORY', 'BCN'], ['CDG', 'MAD'], ['ORY', 'SVQ'], ['CDG', 'LIS'], ['LYS', 'OPO'], ['MRS', 'PMI'], ['NTE', 'VLC'], ['ORY', 'FNC'], ['CDG', 'AGP'], ['BOD', 'TFS']],
    routesShown: 5,
  },
  NL: {
    hotels: [['Málaga', 'ES'], ['Alicante', 'ES'], ['Barcelona', 'ES'], ['Palma', 'ES'], ['Adeje', 'ES'], ['Albufeira', 'PT'], ['Lisboa', 'PT'], ['Maspalomas', 'ES'], ['Valencia', 'ES']],
    routes: [['AMS', 'AGP'], ['EIN', 'ALC'], ['AMS', 'BCN'], ['AMS', 'PMI'], ['AMS', 'TFS'], ['EIN', 'FAO'], ['AMS', 'LIS'], ['AMS', 'LPA'], ['RTM', 'VLC']],
    routesShown: 5,
  },
  BE: {
    hotels: [['Málaga', 'ES'], ['Alicante', 'ES'], ['Barcelona', 'ES'], ['Palma', 'ES'], ['Adeje', 'ES'], ['Albufeira', 'PT'], ['Lisboa', 'PT'], ['Sevilla', 'ES']],
    routes: [['BRU', 'AGP'], ['CRL', 'ALC'], ['BRU', 'BCN'], ['BRU', 'PMI'], ['BRU', 'TFS'], ['CRL', 'FAO'], ['BRU', 'LIS'], ['CRL', 'SVQ']],
    routesShown: 5,
  },
  IT: {
    hotels: [['Barcelona', 'ES'], ['Madrid', 'ES'], ['Valencia', 'ES'], ['Lisboa', 'PT'], ['Ibiza', 'ES'], ['Adeje', 'ES'], ['Sevilla', 'ES'], ['Porto', 'PT'], ['Málaga', 'ES']],
    routes: [['FCO', 'BCN'], ['MXP', 'MAD'], ['BGY', 'VLC'], ['FCO', 'LIS'], ['MXP', 'IBZ'], ['MXP', 'TFS'], ['BGY', 'SVQ'], ['NAP', 'BCN'], ['FCO', 'OPO']],
    routesShown: 5,
  },
  PT: {
    hotels: [['Madrid', 'ES'], ['Barcelona', 'ES'], ['Sevilla', 'ES'], ['Funchal', 'PT'], ['Ponta Delgada', 'PT'], ['Granada', 'ES'], ['Palma', 'ES'], ['Valencia', 'ES']],
    routes: [['LIS', 'MAD'], ['OPO', 'BCN'], ['LIS', 'SVQ'], ['LIS', 'FNC'], ['OPO', 'PDL'], ['LIS', 'PMI'], ['OPO', 'MAD'], ['LIS', 'BCN']],
    routesShown: 5,
  },
  BR: { hotels: [['Lisboa', 'PT'], ['Porto', 'PT'], ['Madrid', 'ES'], ['Barcelona', 'ES'], ['Sevilla', 'ES'], ['Funchal', 'PT']], routes: [['GRU', 'LIS'], ['GIG', 'LIS'], ['GRU', 'MAD'], ['GRU', 'OPO'], ['GRU', 'BCN']], routesShown: 4 },
  US: { hotels: [['Madrid', 'ES'], ['Barcelona', 'ES'], ['Sevilla', 'ES'], ['Lisboa', 'PT'], ['Palma', 'ES'], ['Granada', 'ES'], ['Porto', 'PT'], ['San Sebastián', 'ES']], routes: [['JFK', 'MAD'], ['EWR', 'BCN'], ['MIA', 'MAD'], ['JFK', 'LIS'], ['BOS', 'BCN'], ['ORD', 'MAD'], ['LAX', 'BCN']], routesShown: 4 },
  MX: latam('MEX'), CO: latam('BOG'), AR: latam('EZE'), PE: latam('LIM'), CL: latam('SCL'), UY: latam('MVD'), EC: latam('UIO'), DO: latam('SDQ'), CR: latam('SJO'), PA: latam('PTY'),
};
COUNTRY_MARKETS.AT = COUNTRY_MARKETS.CH = { ...COUNTRY_MARKETS.DE, routes: [['VIE', 'PMI'], ['ZRH', 'BCN'], ['VIE', 'BCN'], ['ZRH', 'PMI'], ['GVA', 'LIS'], ['VIE', 'TFS'], ['ZRH', 'AGP']] };
const HOTELS_SHOWN = 3;
const ROUTES_SHOWN = 3;

// Day number since the epoch for a YYYY-MM-DD date.
export const dayIndex = (day = todayISO()) => Math.floor(Date.parse(day + 'T00:00:00Z') / 86400000);

// Picks `count` items spread across the pool, shifting by one every day.
export function rotate(pool, count, day = todayISO()) {
  if (pool.length <= count) return pool.map(x => x);
  const step = Math.floor(pool.length / count);
  const start = ((dayIndex(day) % pool.length) + pool.length) % pool.length;
  return Array.from({ length: count }, (_, i) => pool[(start + i * step) % pool.length]);
}

export function promotionMarket(language = 'es', day = todayISO(), country = null) {
  const lang = Object.hasOwn(MARKETS, language) ? language : 'es';
  const origin = typeof country === 'string' && Object.hasOwn(COUNTRY_MARKETS, country) ? country : null;
  const m = origin ? COUNTRY_MARKETS[origin] : MARKETS[lang];
  const cities = rotate(m.hotels, HOTELS_SHOWN, day);
  const routes = rotate(m.routes, m.routesShown || ROUTES_SHOWN, day);
  return {
    language: lang,
    origin,
    id: origin ? 'country:' + origin : 'lang:' + lang,
    day,
    countries: [...new Set(cities.map(([, cc]) => cc))],
    hotels: cities.map(([city, cc]) => `${city}, ${cc}`),
    routes: routes.map(r => [...r]),
  };
}
export function marketInfo(language, day = todayISO(), country = null) {
  const { language: lang, countries, origin, routes } = promotionMarket(language, day, country);
  return origin
    ? { language: lang, countries, basedOn: 'country', origin, shown: routes.length }
    : { language: lang, countries, basedOn: 'language', shown: routes.length };
}

// Names for promotion airports missing from the main catalogue (Spanish; seo.placeName
// translates the ones it knows). Several London airports keep their name to tell them apart.
export const DEAL_AIRPORTS = {
  LGW: 'Londres-Gatwick', STN: 'Londres-Stansted', MAN: 'Mánchester', BHX: 'Birmingham', EDI: 'Edimburgo',
  DUB: 'Dublín', ORK: 'Cork', FRA: 'Fráncfort', MUC: 'Múnich', DUS: 'Düsseldorf', HAM: 'Hamburgo', BER: 'Berlín',
  CGN: 'Colonia', STR: 'Stuttgart', VIE: 'Viena', ZRH: 'Zúrich', GVA: 'Ginebra', ORY: 'París-Orly', LYS: 'Lyon',
  MRS: 'Marsella', NTE: 'Nantes', BOD: 'Burdeos', NCE: 'Niza', TLS: 'Toulouse', BIQ: 'Biarritz', AJA: 'Ajaccio',
  EIN: 'Eindhoven', RTM: 'Róterdam', BRU: 'Bruselas', CRL: 'Bruselas-Charleroi', MXP: 'Milán', BGY: 'Bérgamo',
  LIN: 'Milán-Linate', NAP: 'Nápoles', CTA: 'Catania', BLQ: 'Bolonia', CAG: 'Cagliari', PMO: 'Palermo', BRI: 'Bari',
  OPO: 'Oporto', FAO: 'Faro', FNC: 'Funchal', PDL: 'Ponta Delgada', GRU: 'São Paulo', GIG: 'Río de Janeiro', SSA: 'Salvador',
  JFK: 'Nueva York', EWR: 'Nueva York-Newark', MIA: 'Miami', BOS: 'Boston', ORD: 'Chicago', LAX: 'Los Ángeles',
  MEX: 'Ciudad de México', CUN: 'Cancún', BOG: 'Bogotá', MDE: 'Medellín', CTG: 'Cartagena de Indias', EZE: 'Buenos Aires',
  LIM: 'Lima', SCL: 'Santiago de Chile', MVD: 'Montevideo', UIO: 'Quito', SDQ: 'Santo Domingo', PUJ: 'Punta Cana',
  HAV: 'La Habana', SJO: 'San José', PTY: 'Ciudad de Panamá', TFS: 'Tenerife Sur', LPA: 'Gran Canaria',
  ACE: 'Lanzarote', FUE: 'Fuerteventura', ALC: 'Alicante',
};
