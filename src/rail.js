import { cityByName, cityName } from './seo.js';

// Trenes de Europa: trayectos con buen tren directo y su duración típica (el más rápido, en minutos).
// Sirve para la pestaña «Trenes», para que la IA proponga tren o avión y para comparar puerta a puerta.
// Las reservas van a Rail Europe (RAILEUROPE_URL); cuando haya API, se reservará dentro de la web.
const R = (a, b, min, ops) => [a, b, min, ops];
const TABLE = [
  // España
  R('Madrid', 'Barcelona', 150, 'Renfe AVE · Ouigo · Iryo'), R('Madrid', 'Zaragoza', 80, 'Renfe AVE · Ouigo · Iryo'), R('Barcelona', 'Zaragoza', 90, 'Renfe AVE · Ouigo · Iryo'),
  R('Madrid', 'Valencia', 100, 'Renfe AVE · Ouigo · Iryo'), R('Madrid', 'Alicante', 135, 'Renfe AVE · Ouigo · Iryo'), R('Madrid', 'Córdoba', 105, 'Renfe AVE · Iryo'),
  R('Madrid', 'Sevilla', 150, 'Renfe AVE · Ouigo · Iryo'), R('Madrid', 'Málaga', 165, 'Renfe AVE · Ouigo · Iryo'), R('Madrid', 'Granada', 195, 'Renfe AVE · Iryo'),
  R('Madrid', 'Toledo', 33, 'Renfe Avant'), R('Madrid', 'Segovia', 28, 'Renfe Avant'), R('Madrid', 'Valladolid', 60, 'Renfe AVE · Ouigo'),
  R('Madrid', 'Salamanca', 95, 'Renfe Alvia'), R('Madrid', 'León', 125, 'Renfe AVE · Alvia'), R('Madrid', 'Oviedo', 200, 'Renfe Alvia'),
  R('Madrid', 'Gijón', 225, 'Renfe Alvia'), R('Madrid', 'Santiago de Compostela', 195, 'Renfe AVE · Alvia'), R('Madrid', 'A Coruña', 215, 'Renfe AVE · Alvia'),
  R('Madrid', 'Vigo', 255, 'Renfe AVE · Alvia'), R('Madrid', 'Ourense', 140, 'Renfe AVE · Alvia'), R('Madrid', 'Murcia', 165, 'Renfe AVE · Ouigo · Iryo'),
  R('Madrid', 'Elche', 140, 'Renfe AVE'), R('Madrid', 'Cuenca', 55, 'Renfe AVE'), R('Madrid', 'Albacete', 85, 'Renfe AVE · Alvia'),
  R('Madrid', 'Bilbao', 290, 'Renfe Alvia'), R('Madrid', 'Burgos', 95, 'Renfe Alvia'), R('Madrid', 'Zamora', 95, 'Renfe AVE'),
  R('Madrid', 'Huesca', 140, 'Renfe AVE'), R('Madrid', 'Lleida', 110, 'Renfe AVE'), R('Madrid', 'Tarragona', 150, 'Renfe AVE'),
  R('Madrid', 'Ciudad Real', 50, 'Renfe AVE'), R('Madrid', 'Guadalajara', 25, 'Renfe AVE'), R('Madrid', 'Pamplona', 180, 'Renfe Alvia'),
  R('Madrid', 'Logroño', 200, 'Renfe Alvia'), R('Madrid', 'Cádiz', 260, 'Renfe Alvia'), R('Madrid', 'Huelva', 220, 'Renfe Alvia'),
  R('Madrid', 'Antequera', 140, 'Renfe AVE'), R('Madrid', 'Ávila', 85, 'Renfe'), R('Madrid', 'Palencia', 80, 'Renfe AVE · Alvia'),
  R('Madrid', 'Santander', 260, 'Renfe Alvia'), R('Madrid', 'Castellón de la Plana', 150, 'Renfe AVE'),
  R('Barcelona', 'Girona', 40, 'Renfe AVE · Avant'), R('Barcelona', 'Tarragona', 35, 'Renfe AVE · Avant'), R('Barcelona', 'Lleida', 60, 'Renfe AVE · Avant'),
  R('Barcelona', 'Valencia', 175, 'Renfe Euromed · Ouigo · Iryo'), R('Barcelona', 'Alicante', 280, 'Renfe Euromed'), R('Barcelona', 'Sevilla', 330, 'Renfe AVE'),
  R('Barcelona', 'Málaga', 340, 'Renfe AVE'), R('Barcelona', 'Córdoba', 290, 'Renfe AVE'), R('Barcelona', 'Huesca', 135, 'Renfe AVE'),
  R('Barcelona', 'Pamplona', 230, 'Renfe Alvia'), R('Barcelona', 'Bilbao', 380, 'Renfe Alvia'), R('Valencia', 'Alicante', 110, 'Renfe Euromed · Intercity'),
  R('Valencia', 'Castellón de la Plana', 50, 'Renfe Euromed · Media Distancia'), R('Sevilla', 'Córdoba', 42, 'Renfe AVE · Avant · Iryo'), R('Sevilla', 'Málaga', 115, 'Renfe Avant'),
  R('Sevilla', 'Cádiz', 85, 'Renfe Media Distancia'), R('Sevilla', 'Jerez de la Frontera', 60, 'Renfe Media Distancia'), R('Sevilla', 'Granada', 150, 'Renfe Avant'),
  R('Málaga', 'Córdoba', 55, 'Renfe AVE · Avant · Iryo'), R('Granada', 'Córdoba', 95, 'Renfe AVE'), R('Málaga', 'Antequera', 25, 'Renfe Avant'),
  R('Santiago de Compostela', 'A Coruña', 30, 'Renfe Avant · Media Distancia'), R('Santiago de Compostela', 'Vigo', 50, 'Renfe Media Distancia'), R('Santiago de Compostela', 'Ourense', 40, 'Renfe AVE · Avant'),
  R('Vigo', 'Pontevedra', 20, 'Renfe Media Distancia'), R('Valladolid', 'León', 60, 'Renfe AVE · Alvia'), R('Valladolid', 'Burgos', 60, 'Renfe Alvia'),
  R('Zaragoza', 'Huesca', 50, 'Renfe'), R('Bilbao', 'San Sebastián', 160, 'Euskotren'), R('Valladolid', 'Segovia', 35, 'Renfe AVE · Avant'),
  // Portugal y España–Francia
  R('Lisboa', 'Oporto', 170, 'CP Alfa Pendular'), R('Lisboa', 'Coimbra', 100, 'CP Alfa Pendular'), R('Lisboa', 'Faro', 180, 'CP Alfa Pendular'),
  R('Oporto', 'Braga', 60, 'CP'), R('Oporto', 'Aveiro', 45, 'CP Alfa Pendular'), R('Oporto', 'Coimbra', 65, 'CP Alfa Pendular'), R('Lisboa', 'Sintra', 40, 'CP'),
  R('Lisboa', 'Cascais', 40, 'CP'), R('Lisboa', 'Évora', 90, 'CP Intercidades'), R('Oporto', 'Vigo', 140, 'CP · Renfe Celta'),
  R('Barcelona', 'París', 400, 'SNCF TGV inOui · Renfe AVE'), R('Barcelona', 'Lyon', 300, 'Renfe AVE · SNCF'), R('Barcelona', 'Marsella', 270, 'Renfe AVE · SNCF'),
  R('Barcelona', 'Montpellier', 180, 'Renfe AVE · SNCF'), R('Barcelona', 'Perpiñán', 85, 'Renfe AVE · SNCF'), R('Barcelona', 'Toulouse', 195, 'Renfe AVE · SNCF'),
  R('Madrid', 'Marsella', 470, 'Renfe AVE'), R('Madrid', 'Lyon', 500, 'Renfe AVE'), R('San Sebastián', 'Biarritz', 50, 'Euskotren · SNCF'),
  // Francia, Reino Unido y Benelux
  R('París', 'Londres', 136, 'Eurostar'), R('París', 'Bruselas', 82, 'Eurostar'), R('París', 'Ámsterdam', 200, 'Eurostar'),
  R('París', 'Róterdam', 160, 'Eurostar'), R('París', 'Lyon', 120, 'SNCF TGV inOui · Ouigo'), R('París', 'Marsella', 195, 'SNCF TGV inOui · Ouigo'),
  R('París', 'Burdeos', 125, 'SNCF TGV inOui · Ouigo'), R('París', 'Lille', 60, 'SNCF TGV inOui'), R('París', 'Estrasburgo', 110, 'SNCF TGV inOui'),
  R('París', 'Nantes', 125, 'SNCF TGV inOui · Ouigo'), R('París', 'Montpellier', 200, 'SNCF TGV inOui · Ouigo'), R('París', 'Aviñón', 160, 'SNCF TGV inOui'),
  R('París', 'Niza', 335, 'SNCF TGV inOui · Ouigo'), R('París', 'Toulouse', 255, 'SNCF TGV inOui'), R('París', 'Cannes', 310, 'SNCF TGV inOui'),
  R('París', 'Annecy', 225, 'SNCF TGV inOui'), R('París', 'Biarritz', 240, 'SNCF TGV inOui'), R('París', 'Perpiñán', 300, 'SNCF TGV inOui'),
  R('París', 'Fráncfort', 230, 'SNCF · DB ICE'), R('París', 'Stuttgart', 190, 'SNCF TGV · DB ICE'), R('París', 'Múnich', 340, 'SNCF TGV'),
  R('París', 'Colonia', 200, 'Eurostar'), R('París', 'Ginebra', 190, 'TGV Lyria'), R('París', 'Zúrich', 245, 'TGV Lyria'),
  R('París', 'Basilea', 185, 'TGV Lyria'), R('París', 'Milán', 430, 'SNCF TGV · Frecciarossa'), R('Lyon', 'Marsella', 100, 'SNCF TGV inOui · Ouigo'),
  R('Lyon', 'Ginebra', 110, 'SNCF TER'), R('Lyon', 'Annecy', 120, 'SNCF TER'), R('Lyon', 'Aviñón', 65, 'SNCF TGV inOui'), R('Lyon', 'Montpellier', 100, 'SNCF TGV inOui'),
  R('Marsella', 'Niza', 160, 'SNCF TER · TGV'), R('Marsella', 'Aviñón', 35, 'SNCF TGV inOui'), R('Marsella', 'Montpellier', 100, 'SNCF'), R('Niza', 'Cannes', 30, 'SNCF TER'),
  R('Burdeos', 'Toulouse', 130, 'SNCF Intercités'), R('Burdeos', 'Biarritz', 120, 'SNCF TGV inOui'), R('Montpellier', 'Toulouse', 130, 'SNCF'),
  R('Montpellier', 'Perpiñán', 95, 'SNCF'), R('Lille', 'Londres', 82, 'Eurostar'), R('Lille', 'Bruselas', 35, 'Eurostar · SNCF'),
  R('Londres', 'Bruselas', 120, 'Eurostar'), R('Londres', 'Ámsterdam', 235, 'Eurostar'), R('Londres', 'Edimburgo', 260, 'LNER'),
  R('Londres', 'Manchester', 125, 'Avanti West Coast'), R('Londres', 'Liverpool', 130, 'Avanti West Coast'), R('Londres', 'Birmingham', 80, 'Avanti West Coast'),
  R('Londres', 'Glasgow', 270, 'Avanti West Coast'), R('Londres', 'Bristol', 95, 'GWR'), R('Londres', 'Newcastle', 170, 'LNER'),
  R('Londres', 'Leeds', 135, 'LNER'), R('Londres', 'Oxford', 55, 'GWR'), R('Londres', 'Cambridge', 50, 'Great Northern'),
  R('Edimburgo', 'Glasgow', 50, 'ScotRail'), R('Manchester', 'Liverpool', 35, 'Northern · TransPennine'), R('Manchester', 'Leeds', 55, 'TransPennine Express'),
  R('Edimburgo', 'Newcastle', 90, 'LNER'), R('Dublín', 'Cork', 155, 'Irish Rail'),
  R('Bruselas', 'Ámsterdam', 110, 'Eurostar'), R('Bruselas', 'Brujas', 60, 'SNCB'), R('Bruselas', 'Gante', 30, 'SNCB'),
  R('Bruselas', 'Amberes', 40, 'SNCB'), R('Bruselas', 'Róterdam', 75, 'Eurostar'), R('Bruselas', 'Colonia', 110, 'DB ICE · Eurostar'),
  R('Ámsterdam', 'Róterdam', 40, 'NS Intercity Direct'), R('Ámsterdam', 'La Haya', 50, 'NS'), R('Ámsterdam', 'Eindhoven', 80, 'NS'),
  R('Ámsterdam', 'Berlín', 380, 'NS · DB InterCity'), R('Ámsterdam', 'Colonia', 160, 'DB ICE'), R('Ámsterdam', 'Fráncfort', 240, 'DB ICE'),
  R('Amberes', 'Róterdam', 35, 'Eurostar · NS'), R('Brujas', 'Gante', 25, 'SNCB'),
  // Alemania, Austria y Suiza
  R('Berlín', 'Hamburgo', 105, 'DB ICE'), R('Berlín', 'Múnich', 240, 'DB ICE Sprinter'), R('Berlín', 'Fráncfort', 240, 'DB ICE'),
  R('Berlín', 'Colonia', 260, 'DB ICE'), R('Berlín', 'Dresde', 115, 'DB EC'), R('Berlín', 'Düsseldorf', 255, 'DB ICE'),
  R('Berlín', 'Praga', 255, 'DB · ČD EC'), R('Berlín', 'Varsovia', 330, 'PKP · DB EC'), R('Berlín', 'Copenhague', 420, 'DB · DSB'),
  R('Hamburgo', 'Copenhague', 290, 'DB · DSB'), R('Hamburgo', 'Colonia', 240, 'DB ICE'), R('Hamburgo', 'Fráncfort', 220, 'DB ICE'), R('Hamburgo', 'Múnich', 345, 'DB ICE'),
  R('Fráncfort', 'Colonia', 65, 'DB ICE'), R('Fráncfort', 'Múnich', 195, 'DB ICE'), R('Fráncfort', 'Stuttgart', 75, 'DB ICE'),
  R('Fráncfort', 'Düsseldorf', 90, 'DB ICE'), R('Fráncfort', 'Bruselas', 180, 'DB ICE'), R('Fráncfort', 'Basilea', 175, 'DB ICE'),
  R('Colonia', 'Düsseldorf', 25, 'DB'), R('Múnich', 'Stuttgart', 135, 'DB ICE'), R('Múnich', 'Viena', 240, 'ÖBB Railjet'),
  R('Múnich', 'Salzburgo', 90, 'ÖBB Railjet · DB'), R('Múnich', 'Innsbruck', 105, 'ÖBB EC'), R('Múnich', 'Zúrich', 215, 'EC Múnich–Zúrich'),
  R('Múnich', 'Praga', 345, 'DB · ČD'), R('Múnich', 'Venecia', 420, 'ÖBB EC'), R('Múnich', 'Verona', 330, 'ÖBB · DB EC'),
  R('Stuttgart', 'Zúrich', 180, 'DB IC'), R('Dresde', 'Praga', 135, 'ČD · DB EC'), R('Viena', 'Salzburgo', 140, 'ÖBB Railjet · Westbahn'),
  R('Viena', 'Innsbruck', 255, 'ÖBB Railjet'), R('Viena', 'Praga', 240, 'ÖBB · ČD Railjet · RegioJet'), R('Viena', 'Budapest', 160, 'ÖBB Railjet'),
  R('Viena', 'Venecia', 450, 'ÖBB Railjet'), R('Viena', 'Zúrich', 470, 'ÖBB Railjet'), R('Viena', 'Varsovia', 420, 'PKP · ČD'),
  R('Viena', 'Cracovia', 420, 'PKP · ČD'), R('Praga', 'Budapest', 400, 'ČD · RegioJet'), R('Praga', 'Cracovia', 420, 'ČD · RegioJet'),
  R('Salzburgo', 'Innsbruck', 110, 'ÖBB Railjet'), R('Innsbruck', 'Zúrich', 215, 'ÖBB Railjet'), R('Innsbruck', 'Verona', 210, 'ÖBB · DB EC'),
  R('Zúrich', 'Ginebra', 165, 'SBB IC'), R('Zúrich', 'Basilea', 55, 'SBB IC'), R('Zúrich', 'Lucerna', 45, 'SBB'),
  R('Zúrich', 'Interlaken', 120, 'SBB'), R('Zúrich', 'Zermatt', 195, 'SBB · MGB'), R('Zúrich', 'Milán', 200, 'SBB · Trenitalia EC'),
  R('Ginebra', 'Basilea', 160, 'SBB IC'), R('Ginebra', 'Milán', 230, 'SBB · Trenitalia EC'), R('Ginebra', 'Interlaken', 165, 'SBB'),
  R('Ginebra', 'Zermatt', 210, 'SBB · MGB'), R('Basilea', 'Lucerna', 60, 'SBB'), R('Lucerna', 'Interlaken', 115, 'Zentralbahn'),
  R('Basilea', 'Interlaken', 115, 'SBB · DB'),
  // Italia
  R('Roma', 'Milán', 175, 'Frecciarossa · Italo'), R('Roma', 'Florencia', 90, 'Frecciarossa · Italo'), R('Roma', 'Nápoles', 70, 'Frecciarossa · Italo'),
  R('Roma', 'Venecia', 235, 'Frecciarossa · Italo'), R('Roma', 'Bolonia', 135, 'Frecciarossa · Italo'), R('Roma', 'Pisa', 170, 'Frecciarossa · Intercity'),
  R('Roma', 'Turín', 260, 'Frecciarossa · Italo'), R('Roma', 'Verona', 190, 'Frecciarossa · Italo'), R('Roma', 'Bari', 240, 'Frecciarossa'),
  R('Roma', 'Génova', 300, 'Frecciarossa · Intercity'), R('Roma', 'Siena', 180, 'Trenitalia'), R('Roma', 'Rímini', 210, 'Frecciarossa'),
  R('Milán', 'Venecia', 145, 'Frecciarossa · Italo'), R('Milán', 'Florencia', 115, 'Frecciarossa · Italo'), R('Milán', 'Turín', 50, 'Frecciarossa · Italo'),
  R('Milán', 'Bolonia', 65, 'Frecciarossa · Italo'), R('Milán', 'Verona', 75, 'Frecciarossa · Italo'), R('Milán', 'Génova', 95, 'Frecciabianca · Intercity'),
  R('Milán', 'Nápoles', 270, 'Frecciarossa · Italo'), R('Milán', 'Bérgamo', 50, 'Trenord'), R('Milán', 'Lago de Como', 40, 'Trenord'),
  R('Milán', 'Rímini', 140, 'Frecciarossa · Frecciabianca'), R('Milán', 'Bari', 420, 'Frecciarossa'), R('Florencia', 'Bolonia', 37, 'Frecciarossa · Italo'),
  R('Florencia', 'Venecia', 125, 'Frecciarossa · Italo'), R('Florencia', 'Pisa', 50, 'Trenitalia Regionale'), R('Florencia', 'Nápoles', 160, 'Frecciarossa · Italo'),
  R('Florencia', 'Siena', 90, 'Trenitalia Regionale'), R('Florencia', 'Verona', 95, 'Frecciarossa'), R('Venecia', 'Verona', 70, 'Frecciarossa · Italo'),
  R('Venecia', 'Bolonia', 85, 'Frecciarossa · Italo'), R('Nápoles', 'Sorrento', 70, 'Circumvesuviana'), R('Nápoles', 'Bari', 230, 'Frecciargento · Intercity'),
  R('Génova', 'Cinque Terre', 90, 'Trenitalia Regionale'), R('Pisa', 'Cinque Terre', 75, 'Trenitalia Regionale'), R('Génova', 'Turín', 110, 'Trenitalia'),
  R('Bolonia', 'Rímini', 55, 'Frecciarossa · Regionale'), R('Niza', 'Génova', 210, 'Trenitalia · SNCF'),
  // Centro y norte de Europa
  R('Budapest', 'Cracovia', 600, 'PKP · MÁV'), R('Varsovia', 'Cracovia', 140, 'PKP Intercity'), R('Varsovia', 'Gdansk', 175, 'PKP Intercity'),
  R('Cracovia', 'Gdansk', 330, 'PKP Intercity'), R('Copenhague', 'Estocolmo', 320, 'SJ'), R('Estocolmo', 'Oslo', 330, 'SJ · Vy'),
  R('Copenhague', 'Oslo', 470, 'SJ'),
];

// Del texto a las ciudades del catálogo (con todos sus nombres). Se ignoran las que no estén.
export const RAIL = TABLE.map(([a, b, minutes, operators]) => ({ a: cityByName(a), b: cityByName(b), minutes, operators }))
  .filter((r) => r.a && r.b && r.a !== r.b);

const key = (c) => c.es;
const BY_PAIR = new Map();
for (const r of RAIL) {
  BY_PAIR.set(`${key(r.a)}|${key(r.b)}`, r);
  BY_PAIR.set(`${key(r.b)}|${key(r.a)}`, r);
}

// Puerta a puerta: el tren sale del centro (llegar a la estación y embarcar, ~40 min en total);
// el avión suma llegar al aeropuerto, controles y embarque, y llegar luego a la ciudad (~2 h 30 min).
export const DOOR_TRAIN = 40;
export const DOOR_FLIGHT = 150;

// Trayecto directo entre dos ciudades del catálogo (objetos de CITIES), en cualquier sentido.
export function railBetween(a, b) {
  if (!a || !b) return null;
  return BY_PAIR.get(`${key(a)}|${key(b)}`) || null;
}

// Destinos con tren directo desde una ciudad, del más corto al más largo.
export function railFrom(a) {
  if (!a) return [];
  return RAIL.filter((r) => r.a === a || r.b === a).map((r) => ({ to: r.a === a ? r.b : r.a, minutes: r.minutes, operators: r.operators }))
    .sort((x, y) => x.minutes - y.minutes);
}

// Con una escala en una ciudad intermedia (p. ej. Sevilla → París por Madrid y Barcelona no; por Barcelona sí, si hay tramo).
export function railVia(a, b) {
  if (!a || !b) return null;
  let best = null;
  for (const first of railFrom(a)) {
    const second = railBetween(first.to, b);
    if (!second) continue;
    const minutes = first.minutes + 45 + second.minutes; // 45 min de transbordo
    if (!best || minutes < best.minutes) best = { via: first.to, minutes, legs: [first.minutes, second.minutes], operators: [first.operators, second.operators] };
  }
  return best;
}

// Enlace de reserva. RAILEUROPE_URL admite {from}, {to}, {date} y {adults} (para el enlace de afiliado o de búsqueda).
export function railBookUrl({ from, to, date, adults }, template = process.env.RAILEUROPE_URL) {
  const t = template || 'https://www.raileurope.com/';
  const fill = { from: from ? from.en : '', to: to ? to.en : '', date: date || '', adults: adults || 1 };
  return t.replace(/\{(from|to|date|adults)\}/g, (x, k) => encodeURIComponent(fill[k]));
}

// Opción de tren entre dos ciudades (directa o con un transbordo), en el idioma pedido.
export function railOption(from, to, lang = 'es') {
  const direct = railBetween(from, to);
  if (direct) return { direct: true, minutes: direct.minutes, doorMinutes: direct.minutes + DOOR_TRAIN, operators: direct.operators, via: null };
  const via = railVia(from, to);
  if (via && via.minutes <= 12 * 60) return { direct: false, minutes: via.minutes, doorMinutes: via.minutes + DOOR_TRAIN, operators: via.operators.join(' + '), via: cityName(via.via, lang) };
  return null;
}
