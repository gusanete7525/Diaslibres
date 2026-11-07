// Catálogo. Los precios y la ocupación diaria se generan de forma
// determinista (misma fecha + mismo hotel => mismo resultado) y después se
// combinan con las reservas hechas en la web.

// Hoteles reales (nombre, categoría, dirección y web verificados en fuentes
// públicas; `source` indica dónde). `basePrice` parte de un precio orientativo
// por noche para habitación doble; precio diario y ocupación siguen siendo
// simulados: no hay conexión con el inventario real del hotel.
export const HOTELS = [
  {"id": "h1", "name": "Gran Hotel Miramar", "city": "Málaga", "country": "España", "stars": 5, "address": "Paseo de Reding, 22-24, 29016 Málaga", "website": "https://www.granhotelmiramarmalaga.com/", "basePrice": 178, "rooms": 7, "tags": ["lujo", "playa", "spa", "cultura"], "image": "🏖️", "description": "Cinco estrellas frente a la bahía de Málaga, en La Caleta, en un edificio modernista de 1926 obra de Fernando Guerrero Strachan.", "source": "https://visita.malaga.eu/en/plan/where-to-sleep/hotels/gran-hotel-miramar-resort-spa-gl-p104033"},
  {"id": "h2", "name": "Hotel Sur Málaga", "city": "Málaga", "country": "España", "stars": 2, "address": "Calle Trinidad Grund, 13, 29001 Málaga", "website": null, "basePrice": 70, "rooms": 5, "tags": ["económico", "centro", "ciudad"], "image": "🏙️", "description": "Dos estrellas con 53 habitaciones en el centro, a poca distancia a pie del Museo Picasso y del Mercado de Atarazanas.", "source": "https://visita.malaga.eu/en/plan/where-to-sleep/hotels/sur-p103404"},
  {"id": "h3", "name": "Hotel Arts Barcelona", "city": "Barcelona", "country": "España", "stars": 5, "address": "Carrer de la Marina, 19-21, 08005 Barcelona", "website": "https://www.hotelartsbarcelona.com/", "basePrice": 152, "rooms": 8, "tags": ["lujo", "playa", "piscina", "spa"], "image": "🏙️", "description": "Rascacielos de 44 plantas junto al Port Olímpic y frente a la playa, con piscinas al aire libre y el spa 43 The Spa.", "source": "https://www.hrs.com/en/hotel/45786"},
  {"id": "h4", "name": "Hotel Lleó", "city": "Barcelona", "country": "España", "stars": 3, "address": "Carrer de Pelai, 22-24, 08001 Barcelona", "website": null, "basePrice": 98, "rooms": 6, "tags": ["centro", "ciudad", "piscina", "económico"], "image": "🏛️", "description": "Tres estrellas con 92 habitaciones junto a la Plaça de Catalunya y Las Ramblas, con pequeña piscina y solárium en la azotea.", "source": "https://www.centraldereservas.com/hoteles/espana/cataluna/barcelona/barcelona/hotel-lleo"},
  {"id": "h5", "name": "The Palace, a Luxury Collection Hotel, Madrid", "city": "Madrid", "country": "España", "stars": 5, "address": "Plaza de las Cortes, 7, 28014 Madrid", "website": "https://www.marriott.com/en-us/hotels/madcl-the-palace-a-luxury-collection-hotel-madrid/overview/", "basePrice": 391, "rooms": 4, "tags": ["lujo", "cultura", "centro", "gastronomía"], "image": "👑", "description": "Hotel histórico de 1912 en el Barrio de las Letras, cerca del Prado y del Thyssen, famoso por la cúpula de vidrio de su restaurante La Cúpula.", "source": "https://www.esmadrid.com/en/accommodation/palace-luxury-collection-hotel-madrid"},
  {"id": "h6", "name": "Hotel Mediodía", "city": "Madrid", "country": "España", "stars": 2, "address": "Plaza del Emperador Carlos V, 8, 28012 Madrid", "website": null, "basePrice": 74, "rooms": 7, "tags": ["económico", "centro", "cultura"], "image": "🌞", "description": "Dos estrellas en un edificio de 1914 frente a la estación de Atocha, a pocos metros del Reina Sofía y del Prado.", "source": "https://www.esmadrid.com/en/accommodation/mediodia"},
  {"id": "h7", "name": "Parador de Granada", "city": "Granada", "country": "España", "stars": 4, "address": "Calle Real de la Alhambra, s/n, 18009 Granada", "website": "https://paradores.es/en/parador-de-granada", "basePrice": 270, "rooms": 5, "tags": ["cultura", "romántico", "lujo"], "image": "🕌", "description": "Dentro del recinto de la Alhambra, en el antiguo convento de San Francisco levantado sobre un palacio nazarí del siglo XIV.", "source": "https://paradores.es/en/parador-de-granada"},
  {"id": "h8", "name": "Hotel Los Jerónimos", "city": "Granada", "country": "España", "stars": 2, "address": "Calle Gran Capitán, 1, 18002 Granada", "website": null, "basePrice": 65, "rooms": 8, "tags": ["económico", "centro", "cultura"], "image": "⛪", "description": "Pequeño hotel de 30 habitaciones con terraza, frente al Monasterio de San Jerónimo en el centro de Granada.", "source": "https://www.andalucia.org/listing/hotel-los-jer%c3%b3nimos/2161102/"},
  {"id": "h9", "name": "SOMMOS Hotel Aneto", "city": "Benasque", "country": "España", "stars": 4, "address": "Avenida de Francia, 4, 22440 Benasque (Huesca)", "website": "https://www.sommoshoteles.com/en/sommos-hotel-aneto/location", "basePrice": 74, "rooms": 6, "tags": ["montaña", "esquí", "piscina", "familias"], "image": "🏔️", "description": "En el centro de Benasque, con piscina cubierta climatizada y terraza solárium con vistas a las montañas.", "source": "https://www.benasque.com/es/todo-valle-de-benasque/sommos-hotel-aneto"},
  {"id": "h10", "name": "Hotel Ciria", "city": "Benasque", "country": "España", "stars": 3, "address": "Avenida de los Tilos, s/n, 22440 Benasque (Huesca)", "website": "https://www.hotelciria.com/", "basePrice": 78, "rooms": 4, "tags": ["montaña", "esquí", "naturaleza", "gastronomía"], "image": "⛷️", "description": "38 habitaciones a las puertas del Parque Natural Posets-Maladeta y a 6 km de Cerler, con el restaurante El Fogaril.", "source": "https://www.hrs.com/en/hotel/73179"},
  {"id": "h11", "name": "Pestana Palace Lisboa – Hotel & National Monument", "city": "Lisboa", "country": "Portugal", "stars": 5, "address": "Rua do Jau, 54, 1300-314 Lisboa", "website": "https://www.pestana.com/pt/hotel/pestana-palace", "basePrice": 174, "rooms": 7, "tags": ["lujo", "spa", "piscina", "cultura"], "image": "🏰", "description": "En el Palácio Valle-Flôr, declarado Monumento Nacional, en Alto de Santo Amaro (Alcântara), con piscina y spa.", "source": "https://www.visitlisboa.com/en/places/pestana-palace-lisboa-hotel-national-monument"},
  {"id": "h12", "name": "Hotel Borges Chiado", "city": "Lisboa", "country": "Portugal", "stars": 3, "address": "Rua Garrett, 108, 1200-205 Lisboa", "website": null, "basePrice": 96, "rooms": 5, "tags": ["centro", "cultura", "económico"], "image": "🚋", "description": "En el Chiado, abierto en 1884 como Grande Hotel Borges: el hotel más antiguo de Lisboa aún en funcionamiento.", "source": "https://www.visitlisboa.com/en/places/hotel-borges-chiado"},
  {"id": "h13", "name": "Le Meurice", "city": "París", "country": "Francia", "stars": 5, "address": "228 rue de Rivoli, 75001 París", "website": "https://www.dorchestercollection.com/paris/le-meurice", "basePrice": 1304, "rooms": 8, "tags": ["lujo", "gastronomía", "spa", "romántico"], "image": "🥐", "description": "Hotel palace abierto desde 1835 frente al Jardín de las Tullerías, a cinco minutos del Louvre, con spa y restaurante con estrellas Michelin.", "source": "https://www.dorchestercollection.com/paris/le-meurice"},
  {"id": "h14", "name": "Hôtel du Champ de Mars", "city": "París", "country": "Francia", "stars": 3, "address": "7 rue du Champ de Mars, 75007 París", "website": "https://www.hotelduchampdemars.com/", "basePrice": 148, "rooms": 6, "tags": ["romántico", "ciudad", "económico"], "image": "🗼", "description": "25 habitaciones en el distrito 7, junto a la calle peatonal Rue Cler y a unos 10 minutos a pie de la Torre Eiffel.", "source": "https://www.oyster.com/paris/hotels/hotel-du-champ-de-mars/"},
  {"id": "h15", "name": "Hotel Hassler Roma", "city": "Roma", "country": "Italia", "stars": 5, "address": "Piazza Trinità dei Monti, 6, 00187 Roma", "website": "https://www.hotelhasslerroma.com/", "basePrice": 783, "rooms": 4, "tags": ["lujo", "centro", "gastronomía", "spa"], "image": "🏛️", "description": "Hotel familiar de 1893 en lo alto de la Escalinata de la Plaza de España, con el restaurante Imàgo (estrella Michelin) en la azotea.", "source": "https://guide.michelin.com/us/en/hotels-stays/rome/hassler-roma-13240"},
  {"id": "h16", "name": "Hotel Santa Maria", "city": "Roma", "country": "Italia", "stars": 3, "address": "Vicolo del Piede, 2, 00153 Roma (Trastevere)", "website": "https://www.hotelsantamariatrastevere.it/", "basePrice": 165, "rooms": 7, "tags": ["romántico", "cultura", "centro"], "image": "🍊", "description": "En un antiguo claustro del Trastevere, junto a la Piazza di Santa Maria, con 19 habitaciones alrededor de un jardín de naranjos.", "source": "https://www.hotelsantamariatrastevere.it/"},
  {"id": "h17", "name": "Hotel Botánico & The Oriental Spa Garden", "city": "Tenerife", "country": "España", "stars": 5, "address": "Avenida Richard J. Yeoward, 1, 38400 Puerto de la Cruz, Tenerife", "website": "https://www.hotelbotanico.com/", "basePrice": 217, "rooms": 5, "tags": ["lujo", "spa", "piscina", "naturaleza"], "image": "🌴", "description": "En Puerto de la Cruz, con jardines subtropicales y The Oriental Spa Garden, a cinco minutos a pie del Jardín Botánico.", "source": "https://www.travelweekly.com/Hotels/Puerto-de-la-Cruz-Spain/Hotel-Botanico-p4049524"},
  {"id": "h18", "name": "Hotel Monopol", "city": "Tenerife", "country": "España", "stars": 3, "address": "Calle Quintana, 15, 38400 Puerto de la Cruz, Tenerife", "website": "https://monopoltf.com/", "basePrice": 52, "rooms": 8, "tags": ["económico", "centro", "playa", "familias"], "image": "🌺", "description": "Hotel familiar en el casco histórico de Puerto de la Cruz, con balcones de madera originales y patio canario con palmeras.", "source": "https://monopoltf.com/en/home-2/"},
  {"id": "h19", "name": "Gran Hotel Nagari Boutique & Spa", "city": "Vigo", "country": "España", "stars": 5, "address": "Plaza de Compostela, 21, 36201 Vigo", "website": null, "basePrice": 109, "rooms": 6, "tags": ["lujo", "spa", "piscina", "centro"], "image": "⚓", "description": "Hotel boutique en la Plaza de Compostela, cerca del puerto, con piscina climatizada en la azotea y spa de 750 m².", "source": "https://www.theprestigecollectionhotels.com/en/prestige-hotels/gran-hotel-nagari-boutique-spa"},
  {"id": "h20", "name": "Hotel Puerta Gamboa", "city": "Vigo", "country": "España", "stars": 2, "address": "Rúa Gamboa, 12, 36202 Vigo", "website": "https://www.hotelpuertagamboa.com/", "basePrice": 61, "rooms": 4, "tags": ["económico", "centro", "gastronomía"], "image": "🦪", "description": "11 habitaciones en el casco antiguo, a pocos metros del puerto deportivo y la estación marítima.", "source": "https://turismodevigo.org/en/puerta-gamboa"},
  {"id": "h21", "name": "Ushuaïa Ibiza Beach Hotel", "city": "Ibiza", "country": "España", "stars": 5, "address": "Carretera de Platja d'en Bossa, 10, 07817 Sant Jordi de ses Salines, Ibiza", "website": "https://www.theushuaiaexperience.com/en/hotels", "basePrice": 191, "rooms": 7, "tags": ["fiesta", "playa", "lujo", "piscina"], "image": "🎧", "description": "Solo adultos, en primera línea de Platja d'en Bossa, conocido por sus fiestas con DJ junto a la piscina.", "source": "https://www.palladiumhotelgroup.com/en/hotels/espana/ibiza/ibiza-playabossa/ushuaia-ibiza-beach-hotel"},
  {"id": "h22", "name": "Hostal Parque Ibiza", "city": "Ibiza", "country": "España", "stars": 3, "address": "Plaza del Parque, 4, 07800 Eivissa", "website": "https://www.hostalparqueibiza.com/", "basePrice": 109, "rooms": 5, "tags": ["centro", "económico", "ciudad"], "image": "🌅", "description": "33 habitaciones en la Plaza del Parque de Eivissa, junto al paseo de Vara de Rey, con restaurante y coctelería.", "source": "https://www.centraldereservas.com/hoteles/espana/islas-baleares/isla-de-ibiza/ibiza/hostal-parque-ibiza"},
  {"id": "h23", "name": "Hotel Alfonso XIII, a Luxury Collection Hotel, Seville", "city": "Sevilla", "country": "España", "stars": 5, "address": "Calle San Fernando, 2, 41004 Sevilla", "website": null, "basePrice": 348, "rooms": 8, "tags": ["lujo", "cultura", "piscina", "centro"], "image": "💃", "description": "De estilo neomudéjar, construido para la Exposición Iberoamericana de 1929 e inaugurado por Alfonso XIII.", "source": "https://en.wikipedia.org/wiki/Hotel_Alfonso_XIII"},
  {"id": "h24", "name": "Hotel Simón", "city": "Sevilla", "country": "España", "stars": 1, "address": "Calle García de Vinuesa, 19, 41001 Sevilla", "website": "https://www.hotelsimonsevilla.com/", "basePrice": 52, "rooms": 6, "tags": ["económico", "centro", "cultura"], "image": "⛲", "description": "Casa andaluza del siglo XVIII a unos 50 metros de la Catedral, con comedor decorado con azulejos sevillanos.", "source": "https://www.eurocheapo.com/seville/hotel/hotel-simon.html"},
];

export const AIRPORTS = {
  MAD: 'Madrid', BCN: 'Barcelona', AGP: 'Málaga', SVQ: 'Sevilla', GRX: 'Granada',
  TFN: 'Tenerife', IBZ: 'Ibiza', VGO: 'Vigo', LIS: 'Lisboa', CDG: 'París', FCO: 'Roma', BIO: 'Bilbao',
  VLC: 'Valencia', PMI: 'Palma de Mallorca', LHR: 'Londres', AMS: 'Ámsterdam',
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
