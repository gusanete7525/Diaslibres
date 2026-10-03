// Catálogo de demostración. Los precios y la ocupación diaria se generan de
// forma determinista (misma fecha + mismo hotel => mismo resultado) y después
// se combinan con las reservas reales hechas en la web.

export const HOTELS = [
  { id: 'h1', name: 'Hotel Mirador del Mar', city: 'Málaga', country: 'España', stars: 4, basePrice: 95, rooms: 6, rating: 8.7, tags: ['playa', 'piscina', 'familias'], image: '🏖️', description: 'Frente a la playa de la Malagueta, con piscina en la azotea.' },
  { id: 'h2', name: 'Casa Gótica Boutique', city: 'Barcelona', country: 'España', stars: 4, basePrice: 140, rooms: 5, rating: 9.1, tags: ['ciudad', 'romántico', 'centro'], image: '🏛️', description: 'Edificio del siglo XIX en pleno Barrio Gótico.' },
  { id: 'h3', name: 'Hostal Sol Madrid', city: 'Madrid', country: 'España', stars: 2, basePrice: 55, rooms: 8, rating: 8.0, tags: ['ciudad', 'económico', 'centro'], image: '🌞', description: 'Habitaciones sencillas a dos minutos de la Puerta del Sol.' },
  { id: 'h4', name: 'Gran Hotel Alhambra', city: 'Granada', country: 'España', stars: 5, basePrice: 180, rooms: 4, rating: 9.4, tags: ['lujo', 'cultura', 'spa', 'romántico'], image: '🕌', description: 'Vistas a la Alhambra, spa y restaurante gastronómico.' },
  { id: 'h5', name: 'Refugio Pirineo', city: 'Benasque', country: 'España', stars: 3, basePrice: 85, rooms: 5, rating: 8.9, tags: ['montaña', 'naturaleza', 'esquí'], image: '🏔️', description: 'Hotel de montaña con chimenea y rutas desde la puerta.' },
  { id: 'h6', name: 'Lisboa Alfama Suites', city: 'Lisboa', country: 'Portugal', stars: 4, basePrice: 110, rooms: 6, rating: 8.8, tags: ['ciudad', 'cultura', 'romántico'], image: '🚋', description: 'Suites con terraza en el barrio más castizo de Lisboa.' },
  { id: 'h7', name: 'Le Petit Montmartre', city: 'París', country: 'Francia', stars: 3, basePrice: 150, rooms: 5, rating: 8.5, tags: ['ciudad', 'romántico', 'cultura'], image: '🗼', description: 'Pequeño hotel con encanto junto al Sacré-Cœur.' },
  { id: 'h8', name: 'Roma Trastevere Inn', city: 'Roma', country: 'Italia', stars: 3, basePrice: 120, rooms: 6, rating: 8.6, tags: ['ciudad', 'cultura', 'gastronomía'], image: '🍝', description: 'En el corazón del Trastevere, rodeado de trattorias.' },
  { id: 'h9', name: 'Resort Palmeras Canarias', city: 'Tenerife', country: 'España', stars: 5, basePrice: 160, rooms: 7, rating: 9.0, tags: ['playa', 'lujo', 'piscina', 'familias', 'todo incluido'], image: '🌴', description: 'Todo incluido con tres piscinas y club infantil.' },
  { id: 'h10', name: 'Posada Ría de Vigo', city: 'Vigo', country: 'España', stars: 3, basePrice: 70, rooms: 6, rating: 8.4, tags: ['playa', 'gastronomía', 'económico'], image: '🦪', description: 'Marisco, rías y playas de las Cíes a un paso.' },
  { id: 'h11', name: 'Hotel Ibiza Calma', city: 'Ibiza', country: 'España', stars: 4, basePrice: 175, rooms: 5, rating: 8.6, tags: ['playa', 'fiesta', 'piscina'], image: '🌅', description: 'Calas tranquilas de día, el mejor ambiente de noche.' },
  { id: 'h12', name: 'Sevilla Patio Andaluz', city: 'Sevilla', country: 'España', stars: 3, basePrice: 90, rooms: 6, rating: 8.9, tags: ['ciudad', 'cultura', 'romántico'], image: '💃', description: 'Casa-palacio con patio de azulejos junto a la catedral.' },
];

export const AIRPORTS = {
  MAD: 'Madrid', BCN: 'Barcelona', AGP: 'Málaga', SVQ: 'Sevilla', GRX: 'Granada',
  TFN: 'Tenerife', IBZ: 'Ibiza', VGO: 'Vigo', LIS: 'Lisboa', CDG: 'París', FCO: 'Roma', BIO: 'Bilbao',
};

export const FLIGHTS = [
  { id: 'f1', origin: 'MAD', destination: 'BCN', airline: 'Iberia', departure: '08:15', duration: 75, basePrice: 60, seats: 9 },
  { id: 'f2', origin: 'BCN', destination: 'MAD', airline: 'Vueling', departure: '19:40', duration: 80, basePrice: 55, seats: 9 },
  { id: 'f3', origin: 'MAD', destination: 'AGP', airline: 'Air Europa', departure: '10:05', duration: 70, basePrice: 50, seats: 8 },
  { id: 'f4', origin: 'BCN', destination: 'IBZ', airline: 'Vueling', departure: '12:30', duration: 55, basePrice: 65, seats: 8 },
  { id: 'f5', origin: 'MAD', destination: 'TFN', airline: 'Binter', departure: '07:00', duration: 165, basePrice: 110, seats: 10 },
  { id: 'f6', origin: 'MAD', destination: 'LIS', airline: 'TAP', departure: '16:20', duration: 80, basePrice: 70, seats: 9 },
  { id: 'f7', origin: 'BCN', destination: 'CDG', airline: 'Air France', departure: '09:45', duration: 110, basePrice: 90, seats: 9 },
  { id: 'f8', origin: 'MAD', destination: 'FCO', airline: 'ITA Airways', departure: '13:10', duration: 150, basePrice: 95, seats: 9 },
  { id: 'f9', origin: 'BIO', destination: 'SVQ', airline: 'Vueling', departure: '18:00', duration: 85, basePrice: 60, seats: 8 },
  { id: 'f10', origin: 'MAD', destination: 'VGO', airline: 'Iberia', departure: '20:30', duration: 65, basePrice: 55, seats: 8 },
  { id: 'f11', origin: 'BCN', destination: 'GRX', airline: 'Vueling', departure: '11:15', duration: 90, basePrice: 58, seats: 8 },
  { id: 'f12', origin: 'AGP', destination: 'MAD', airline: 'Air Europa', departure: '17:50', duration: 70, basePrice: 50, seats: 8 },
];

// Hash determinista -> número en [0, 1).
export function seeded(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const SEASON = [0.8, 0.8, 0.9, 1.0, 1.05, 1.25, 1.5, 1.6, 1.15, 0.95, 0.85, 1.2];

// Factor de demanda para un día: temporada × fin de semana × ruido suave.
export function demand(id, isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  const season = SEASON[d.getUTCMonth()];
  const dow = d.getUTCDay();
  const weekend = dow === 5 || dow === 6 ? 1.22 : dow === 0 ? 1.05 : 1;
  const noise = 0.9 + seeded(id, isoDate, 'p') * 0.25;
  return season * weekend * noise;
}
