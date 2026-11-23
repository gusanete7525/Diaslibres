export const CHRISTMAS_TRIP = { checkIn: '2026-12-18', checkOut: '2026-12-21', nights: 3, adults: 2, origin: 'MAD' };

export const CHRISTMAS_CITIES = [
  { slug: 'rovaniemi', name: 'Rovaniemi', country: 'FI', airport: 'RVN', airportName: 'Rovaniemi', description: 'Cabañas iluminadas y nieve en la Laponia finlandesa.' },
  { slug: 'valkenburg', name: 'Valkenburg', country: 'NL', airport: 'EIN', airportName: 'Eindhoven', transfer: 'Traslado por tierra hasta Valkenburg aparte.', description: 'Mercadillos navideños bajo tierra en el sur de Países Bajos.' },
  { slug: 'colmar', name: 'Colmar', country: 'FR', airport: 'BSL', airportName: 'Basilea–Mulhouse', transfer: 'Traslado por tierra hasta Colmar aparte.', description: 'Canales y casas alsacianas iluminadas en Petite Venise.' },
  { slug: 'estrasburgo', name: 'Estrasburgo', country: 'FR', airport: 'SXB', airportName: 'Estrasburgo', aliases: ['Strasbourg'], description: 'Calles alsacianas, luces y mercados en el casco histórico.' },
  { slug: 'viena', name: 'Viena', country: 'AT', airport: 'VIE', airportName: 'Viena', aliases: ['Vienna', 'Wien'], description: 'Puestos navideños frente al Ayuntamiento y paseos por Viena.' },
  { slug: 'praga', name: 'Praga', country: 'CZ', airport: 'PRG', airportName: 'Praga', aliases: ['Prague', 'Praha'], description: 'Luces de Navidad en la Plaza de la Ciudad Vieja.' },
  { slug: 'brujas', name: 'Brujas', country: 'BE', airport: 'BRU', airportName: 'Bruselas', transfer: 'Tren o traslado hasta Brujas aparte.', aliases: ['Bruges', 'Brugge'], description: 'Canales y fachadas flamencas alrededor del Markt.' },
  { slug: 'tallin', name: 'Tallin', country: 'EE', airport: 'TLL', airportName: 'Tallin', aliases: ['Tallinn'], description: 'Navidad en la plaza medieval del Ayuntamiento.' },
  { slug: 'nueva-york', name: 'Nueva York', country: 'US', airport: 'JFK', airportName: 'Nueva York–JFK', aliases: ['New York', 'New York City', 'Manhattan'], description: 'El árbol del Rockefeller Center y las luces de Manhattan.' },
];

const normalize = (s = '') => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

export function makeChristmasSearch(live, flightsEnabled) {
  const cache = new Map();
  const trip = CHRISTMAS_TRIP;

  async function hotelFor(city) {
    const names = new Set([city.name, ...(city.aliases || [])].map(normalize));
    const hotels = (await live.hotels(`${city.name}, ${city.country}`, { lang: 'es', priority: 'background' }))
      .filter(hotel => names.has(normalize(hotel.city || '')));
    const candidates = [...hotels.filter(hotel => hotel.stars > 0 && hotel.stars <= 3),
      ...hotels.filter(hotel => !(hotel.stars > 0 && hotel.stars <= 3))].slice(0, 3);
    const offers = await Promise.allSettled(candidates.map(async hotel => {
      const rate = await live.quote({ itemId: hotel.id, checkIn: trip.checkIn, checkOut: trip.checkOut, units: 1, adults: trip.adults, children: [], priority: 'background' });
      return { id: hotel.id, name: hotel.name, city: hotel.city, total: rate.total, payAtHotel: rate.payAtHotel || [] };
    }));
    return offers.flatMap(result => result.status === 'fulfilled' && Number.isFinite(result.value.total) && result.value.total > 0 ? [result.value] : [])
      .sort((a, b) => a.total - b.total)[0] ?? null;
  }

  async function flightFor(city) {
    if (!flightsEnabled) return null;
    const flights = await live.flightSearch({ origin: trip.origin, destination: city.airport, date: trip.checkIn, returnDate: trip.checkOut, adults: trip.adults }, { priority: false });
    const fare = flights.filter(flight => flight.inbound && flight.outbound?.arrival?.slice(0, 10) === trip.checkIn
      && flight.currency === 'EUR' && Number.isFinite(flight.total) && flight.total > 0)
      .sort((a, b) => a.total - b.total)[0];
    return fare ? { total: fare.total } : null;
  }

  return function search(city) {
    if (!live) return Promise.resolve({ hotel: null, flight: null, sandbox: false });
    const now = Date.now();
    const existing = cache.get(city.slug);
    if (existing && now < existing.expires) return existing.promise;
    const entry = { expires: now + 30 * 60 * 1000 };
    entry.promise = Promise.allSettled([hotelFor(city), flightFor(city)]).then(([hotel, flight]) => {
      if (hotel.status === 'rejected' || flight.status === 'rejected') entry.expires = Date.now() + 60_000;
      return {
        hotel: hotel.status === 'fulfilled' ? hotel.value : null,
        flight: flight.status === 'fulfilled' ? flight.value : null,
        sandbox: !!live.sandbox,
        checkedAt: new Date().toISOString(),
      };
    });
    cache.set(city.slug, entry);
    return entry.promise;
  };
}
