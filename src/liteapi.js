// Conexión con LiteAPI (Nuitée): hoteles, precios por noche, reservas y cancelaciones.
// Se activa con la variable de entorno LITEAPI_KEY. Con una clave «sand_…» todo
// ocurre en el entorno de pruebas de LiteAPI: no se cobra nada.

const API = process.env.LITEAPI_URL || 'https://api.liteapi.travel/v3.0';
const BOOK = process.env.LITEAPI_BOOK_URL || 'https://book.liteapi.travel/v3.0';
const DAY = 86400000;
const PRICE_TTL = 3 * 3600 * 1000; // los precios caducan a las 3 h
const HOTELS_TTL = 24 * 3600 * 1000;
const MAX_HOTELS = 2000; // todos los de la ciudad (Madrid tiene ~1.300); se muestran por páginas
const MAX_FLIGHTS = 20;
const OFFER_TTL = 30 * 60 * 1000; // las ofertas de vuelo caducan pronto
const SEARCH_TTL = 8 * 60 * 1000; // las ofertas de LiteAPI caducan a los ~10 minutos
const CONCURRENCY = 3; // el entorno de pruebas responde 429 con más peticiones a la vez

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Nombre del país en el idioma de la web.
const regionNames = new Map();
const countryName = (code, lang = 'es') => {
  if (!code) return '';
  try {
    if (!regionNames.has(lang)) regionNames.set(lang, new Intl.DisplayNames([lang], { type: 'region' }));
    return regionNames.get(lang).of(String(code).toUpperCase());
  } catch {
    return code;
  }
};
// Listas de hoteles guardadas a la vez (cada una puede tener 2.000 hoteles).
const MAX_LISTS = 40;

// Primer párrafo del HTML de la descripción, en texto plano y corto.
function shortDescription(html) {
  const text = String(html || '')
    .replace(/<\/(p|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/gi, ' ')
    .split('\n')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const first = text.find((s) => s.length > 60) || text[0] || '';
  return first.length > 220 ? first.slice(0, 217).replace(/\s+\S*$/, '') + '…' : first;
}

// Ocupación de una habitación: adultos (1-6) y edades de los niños (0-17, máx. 4).
export function occupancy({ adults, children } = {}) {
  const a = Math.max(1, Math.min(6, Math.round(Number(adults) || 2)));
  const list = (Array.isArray(children) ? children : String(children ?? '').split(','))
    .filter((x) => String(x).trim() !== '')
    .map((x) => Math.max(0, Math.min(17, Math.round(Number(x)))))
    .filter((x) => Number.isFinite(x))
    .slice(0, 4);
  return list.length ? { adults: a, children: list } : { adults: a };
}
const occKey = (o) => `${o.adults}a${(o.children || []).join('-')}`;

// Servicios del hotel (ids de /data/facilities de LiteAPI) agrupados para los filtros.
export const FACILITIES = {
  mascotas: { label: 'Admite mascotas', icon: '🐾', ids: [4, 217, 218, 956] },
  aire: { label: 'Aire acondicionado', icon: '❄️', ids: [109] },
  calefaccion: { label: 'Calefacción', icon: '🔥', ids: [80] },
  piscina: { label: 'Piscina', icon: '🏊', ids: [301, 103, 104, 120, 122, 192, 193, 194, 195, 196, 258] },
  parking: { label: 'Parking', icon: '🅿️', ids: [2, 46, 52, 161, 181, 628, 674, 676] },
  wifi: { label: 'Wifi gratis', icon: '📶', ids: [107] },
  restaurante: { label: 'Restaurante', icon: '🍽️', ids: [3, 115, 116] },
  spa: { label: 'Spa', icon: '💆', ids: [10, 54, 63, 79, 241, 557] },
  gimnasio: { label: 'Gimnasio', icon: '🏋️', ids: [11, 492] },
  playa: { label: 'En la playa', icon: '🏖️', ids: [114, 146, 302, 547, 707] },
  ninos: { label: 'Para niños', icon: '🧸', ids: [28, 56, 144, 172, 173, 258] },
  adultos: { label: 'Solo adultos', icon: '🥂', ids: [149] },
  accesible: { label: 'Accesible', icon: '♿', ids: [25, 185] },
  traslado: { label: 'Traslado al aeropuerto', icon: '🚐', ids: [17, 139, 493, 689] },
};
// Régimen de comidas: código de LiteAPI → texto.
export const BOARDS = { BI: 'Desayuno incluido', HB: 'Media pensión', FB: 'Pensión completa', AI: 'Todo incluido' };
const boardOf = (b) => (b in BOARDS ? b : null);
// Nombre del régimen de una tarifa en español (el proveedor lo da en inglés).
const boardName = (rate) => ({ RO: 'Solo alojamiento', BB: 'Desayuno incluido', ...BOARDS })[rate.boardType] || rate.boardName || '';

// Tasas que no van en el precio y se pagan en el hotel (p. ej. tasa turística),
// sumadas por concepto y moneda de todas las habitaciones de la oferta.
export function payAtHotel(rates = []) {
  const sum = new Map();
  for (const r of rates) {
    for (const t of r?.retailRate?.taxesAndFees || []) {
      const amount = Number(t?.amount);
      if (t?.included !== false || !Number.isFinite(amount) || amount <= 0) continue;
      const currency = String(t.currency || 'EUR').toUpperCase();
      const description = String(t.description || 'Tasas').slice(0, 80);
      const k = `${description}|${currency}`;
      sum.set(k, { description, currency, amount: (sum.get(k)?.amount || 0) + amount });
    }
  }
  return [...sum.values()].map((t) => ({ ...t, amount: Math.round(t.amount * 100) / 100 }));
}

// Tipo de alojamiento (hotelTypeId del catálogo): hoteles, apartamentos, casas y villas, hostales.
// Lo que no encaja (campings, barcos…) cuenta como hotel.
export const STAY_TYPES = {
  hotel: [204, 205, 206, 209, 218, 225, 226, 227, 231, 233, 274, 276, 278],
  apartment: [201, 207, 219, 229],
  house: [210, 213, 220, 221, 223, 228, 230, 232, 243, 250, 252, 257, 268, 271],
  hostel: [203, 208, 216, 222, 235, 247, 251, 262, 264],
};
const STAY_OF = new Map(Object.entries(STAY_TYPES).flatMap(([k, ids]) => ids.map((id) => [id, k])));
// «no availability found»: ninguno de esos hoteles tiene sitio esa noche (todos en rojo), no es un fallo.
const noAvailability = (err) => {
  if (/no availability/i.test(err?.message || '')) return { data: [] };
  throw err;
};
const STAY_ICON = { apartment: '🏢', house: '🏡', hostel: '🛏️' };

export class LiteApiError extends Error {}

export class PaymentPendingError extends LiteApiError {
  constructor() {
    super('El pago todavía no se ha completado.');
  }
}

export class PriceChangedError extends LiteApiError {
  constructor(total) {
    super(`El precio ha cambiado a ${total.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}. Revisa el nuevo total y confirma otra vez.`);
    this.total = total;
  }
}

export class LiteApi {
  constructor({ key, fetchImpl = globalThis.fetch } = {}) {
    // Quita espacios, saltos de línea y comillas que suelen colarse al pegar la clave.
    key = String(key || '').trim().replace(/^["']|["']$/g, '').trim();
    if (!key) throw new Error('Falta LITEAPI_KEY');
    this.key = key;
    this.lastError = null; // último error de LiteAPI (sin la clave), para /api/health
    this.fetch = fetchImpl;
    this.sandbox = key.startsWith('sand_');
    this.active = 0;
    this.waiting = [];
    this.places = new Map(); // ciudad -> { at, value }
    this.hotelLists = new Map();
    this.details = new Map(); // fichas de hotel (fotos, habitaciones)
    this.hotelsById = new Map(); // id interno -> hotel
    this.prices = new Map(); // `${liteId}|${fecha}` -> { at, price }
    this.offers = new Map(); // offerId de vuelo -> { at, trip }
    this.flightSearches = new Map(); // ruta|fecha|vuelta|adultos -> { at, promise }
  }

  // ---------- Peticiones con límite de concurrencia y reintentos en 429 ----------

  // Las peticiones prioritarias (buscar hoteles, presupuesto, reserva) se cuelan
  // delante de los precios del calendario, que pueden ser decenas en cola.
  async #slot(priority) {
    if (this.active < CONCURRENCY) return void this.active++;
    await new Promise((r) => (priority ? this.waiting.unshift(r) : this.waiting.push(r)));
    this.active++;
  }

  #release() {
    this.active--;
    this.waiting.shift()?.();
  }

  async #request(method, url, body, { priority = true } = {}) {
    await this.#slot(priority);
    try {
      for (let attempt = 0; ; attempt++) {
        const res = await this.fetch(url, {
          method,
          headers: { 'X-API-Key': this.key, accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 429 && attempt < 3) {
          await sleep(800 * 2 ** attempt);
          continue;
        }
        if (!res.ok || data.error) {
          const msg = data.error?.description || data.error?.message || `El proveedor respondió ${res.status}`;
          this.lastError = { at: new Date().toISOString(), status: res.status, message: String(msg).slice(0, 200) };
          const err = new LiteApiError(msg);
          err.status = res.status;
          err.code = data.error?.code ?? null;
          throw err;
        }
        return data;
      }
    } finally {
      this.#release();
    }
  }

  // ---------- Hoteles de una ciudad ----------

  async #placeId(city, lang = 'es', priority = true) {
    const key = norm(city);
    const hit = this.places.get(key);
    if (hit && Date.now() - hit.at < HOTELS_TTL) return hit.value;
    const { data = [] } = await this.#request('GET', `${API}/data/places?textQuery=${encodeURIComponent(city)}&language=${lang}`, null, { priority });
    const place = data.find((p) => p.types?.includes('locality')) || data[0] || null;
    this.places.set(key, { at: Date.now(), value: place?.placeId || null });
    return place?.placeId || null;
  }

  // Todos los hoteles de una ciudad, con descripción y país en `lang`.
  // keep: false para consultas de fondo (datos para buscadores) que no deben llenar la memoria.
  async hotels(city, { lang = 'es', keep = true } = {}) {
    const key = `${lang}|${norm(city)}`;
    const hit = this.hotelLists.get(key);
    if (hit && Date.now() - hit.at < HOTELS_TTL) return hit.value;
    const placeId = await this.#placeId(city, lang, keep);
    if (!placeId) return [];
    const { data = [] } = await this.#request('GET', `${API}/data/hotels?placeId=${encodeURIComponent(placeId)}&limit=${MAX_HOTELS}&language=${lang}`, null, { priority: keep });
    const hotels = data.map((h) => this.#toHotel(h, lang, keep));
    if (keep) {
      this.hotelLists.delete(key);
      this.hotelLists.set(key, { at: Date.now(), value: hotels });
      // La más antigua fuera (el Map conserva el orden de inserción).
      while (this.hotelLists.size > MAX_LISTS) this.hotelLists.delete(this.hotelLists.keys().next().value);
    }
    return hotels;
  }

  #toHotel(h, lang = 'es', keep = true) {
    const stay = STAY_OF.get(h.hotelTypeId) || 'hotel';
    const stars = Number.isInteger(h.stars) && h.stars >= 1 && h.stars <= 5 ? h.stars : null;
    const ids = new Set(Array.isArray(h.facilityIds) ? h.facilityIds : []);
    const facilities = Object.keys(FACILITIES).filter((k) => FACILITIES[k].ids.some((id) => ids.has(id)));
    const tags = [];
    if (stars >= 5) tags.push('lujo');
    if (stars && stars <= 2) tags.push('económico');
    if (!facilities.includes('piscina') && /pool|piscina/i.test(h.hotelDescription || '')) facilities.push('piscina');
    if (!facilities.includes('spa') && /\bspa\b/i.test(h.hotelDescription || '')) facilities.push('spa');
    const hotel = {
      id: 'lite-' + h.id,
      liteId: h.id,
      name: h.name,
      city: h.city || '',
      country: countryName(h.country, lang),
      stars,
      address: [h.address, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null,
      website: null,
      photo: /^https:\/\//.test(h.thumbnail || h.main_photo || '') ? h.thumbnail || h.main_photo : null,
      rating: typeof h.rating === 'number' && h.rating > 0 ? h.rating : null,
      reviewCount: h.reviewCount || null,
      tags,
      facilities,
      stay,
      image: STAY_ICON[stay] || '🏨',
      description: shortDescription(h.hotelDescription),
      origin: 'liteapi',
    };
    if (keep) {
      this.hotelsById.delete(hotel.id);
      this.hotelsById.set(hotel.id, hotel);
      if (this.hotelsById.size > 60000) this.hotelsById.delete(this.hotelsById.keys().next().value);
    }
    return hotel;
  }

  hotel(id) {
    return this.hotelsById.get(id) || null;
  }

  // ---------- Precio de cada noche (estancia de 1 noche, 2 adultos) ----------

  // Devuelve { [idInterno]: [{ date, price|null, available }] } para `days` noches desde `start`.
  async nightlyPrices(ids, start, days, guests = {}, board = null) {
    const hotels = ids.map((id) => this.hotelsById.get(id)).filter(Boolean);
    const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
    const occ = occupancy(guests);
    board = boardOf(board);
    const k = occKey(occ) + (board ? '|' + board : '');
    await Promise.all(dates.map((d) => this.#pricesForNight(hotels, d, occ, board)));
    const out = {};
    for (const h of hotels) {
      out[h.id] = dates.map((date) => {
        const price = this.prices.get(`${h.liteId}|${date}|${k}`)?.price ?? null;
        return { date, price, available: price !== null, left: null };
      });
    }
    return out;
  }

  async #pricesForNight(hotels, date, occ, board = null) {
    const k = occKey(occ) + (board ? '|' + board : '');
    const now = Date.now();
    const missing = hotels.filter((h) => {
      const hit = this.prices.get(`${h.liteId}|${date}|${k}`);
      return !hit || now - hit.at > PRICE_TTL;
    });
    if (!missing.length) return;
    const body = {
      hotelIds: missing.map((h) => h.liteId),
      checkin: date,
      checkout: addDays(date, 1),
      occupancies: [occ],
      currency: 'EUR',
      guestNationality: 'ES',
      timeout: 6,
    };
    let found;
    if (board) {
      // min-rates no filtra por régimen: con régimen se piden las tarifas y se toma la más barata.
      const { data = [] } = await this.#request('POST', `${API}/hotels/rates`, { ...body, boardType: board }, { priority: false }).catch(noAvailability);
      found = new Map(data.map((r) => {
        const prices = (r.roomTypes || []).map((o) => o.offerRetailRate?.amount).filter((x) => typeof x === 'number');
        return [r.hotelId, prices.length ? Math.min(...prices) : null];
      }));
    } else {
      const { data = [] } = await this.#request('POST', `${API}/hotels/min-rates`, body, { priority: false }).catch(noAvailability);
      found = new Map(data.map((r) => [r.hotelId, r.price]));
    }
    for (const h of missing) {
      const p = found.get(h.liteId);
      // Sin tarifa esa noche = no hay disponibilidad (día en rojo).
      this.prices.set(`${h.liteId}|${date}|${k}`, { at: now, price: typeof p === 'number' ? Math.round(p) : null });
    }
  }

  // ---------- Presupuesto, reserva y cancelación ----------

  // Presupuesto de una estancia: todas las habitaciones disponibles (la más barata de cada
  // tipo, régimen y cancelación) y la elegida (room = su clave; si no, la más barata).
  async quote({ itemId, checkIn, checkOut, units = 1, adults, children, board, room }) {
    const hotel = this.hotelsById.get(itemId);
    if (!hotel) throw new LiteApiError('Hotel no encontrado. Vuelve a buscar la ciudad.');
    const rooms = Math.max(1, Math.min(4, Number(units) || 1));
    const body = {
      hotelIds: [hotel.liteId],
      checkin: checkIn,
      checkout: checkOut,
      occupancies: Array.from({ length: rooms }, () => occupancy({ adults, children })),
      currency: 'EUR',
      guestNationality: 'ES',
      timeout: 8,
      ...(boardOf(board) ? { boardType: boardOf(board) } : {}),
    };
    // Con roomMapping cada tarifa dice a qué habitación del catálogo corresponde (fotos y datos);
    // sin ella llegan también las tarifas sin habitación conocida (a veces más baratas).
    const [mapped, all] = await Promise.all([
      this.#request('POST', `${API}/hotels/rates`, { ...body, roomMapping: true }).catch(noAvailability),
      this.#request('POST', `${API}/hotels/rates`, body).catch(noAvailability),
    ]);
    const roomOf = new Map();
    for (const o of mapped.data?.[0]?.roomTypes || []) {
      const r = o.rates?.[0];
      if (r?.mappedRoomId) roomOf.set(`${r.name}|${r.boardType}`, r.mappedRoomId);
    }
    const byKey = new Map();
    for (const o of [...(mapped.data?.[0]?.roomTypes || []), ...(all.data?.[0]?.roomTypes || [])]) {
      if (typeof o.offerRetailRate?.amount !== 'number') continue;
      const rate = o.rates?.[0] || {};
      const refundable = rate.cancellationPolicies?.refundableTag === 'RFN';
      const key = [rate.name || '', rate.boardType || '', refundable ? 'R' : 'N'].join('|');
      const total = Math.round(o.offerRetailRate.amount * 100) / 100;
      if (byKey.has(key) && byKey.get(key).total <= total) continue;
      byKey.set(key, {
        key,
        offerId: o.offerId,
        roomName: rate.name || '',
        roomId: rate.mappedRoomId || roomOf.get(`${rate.name}|${rate.boardType}`) || null,
        board: boardName(rate),
        refundable,
        freeCancellationUntil: refundable ? rate.cancellationPolicies?.cancelPolicyInfos?.[0]?.cancelTime || null : null,
        total,
        payAtHotel: payAtHotel(o.rates),
      });
    }
    const offers = [...byKey.values()].sort((a, b) => a.total - b.total).slice(0, 25);
    if (!offers.length) {
      throw new LiteApiError(boardOf(board)
        ? `No quedan habitaciones con ${BOARDS[board].toLowerCase()} para esas fechas. Prueba otros días u otro régimen.`
        : 'Ya no quedan habitaciones para esas fechas. Elige otros días.');
    }
    const chosen = room ? offers.find((o) => o.key === room) : offers[0];
    if (!chosen) throw new LiteApiError('Esa habitación ya no está disponible. Elige otra.');
    return {
      item: hotel,
      offerId: chosen.offerId,
      units: rooms,
      nights: Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / DAY),
      total: chosen.total,
      room: chosen.key,
      roomName: chosen.roomName,
      board: chosen.board,
      refundable: chosen.refundable,
      freeCancellationUntil: chosen.freeCancellationUntil,
      payAtHotel: chosen.payAtHotel,
      offers: offers.map(({ offerId, ...o }) => o),
    };
  }

  // Ficha del hotel: fotos, descripción completa, servicios, horarios y habitaciones (con fotos).
  async hotelDetails(itemId, lang = 'es') {
    const hotel = this.hotelsById.get(itemId);
    if (!hotel) throw new LiteApiError('Hotel no encontrado. Vuelve a buscar la ciudad.');
    const key = `${lang}|${hotel.liteId}`;
    const hit = this.details.get(key);
    if (hit && Date.now() - hit.at < HOTELS_TTL) return hit.value;
    const { data: d = {} } = await this.#request('GET', `${API}/data/hotel?hotelId=${encodeURIComponent(hotel.liteId)}&language=${lang}`);
    const https = (u) => (/^https:\/\//.test(u || '') ? u : null);
    const text = (html) => String(html || '').replace(/<\/(p|li|h\d)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n\s*\n+/g, '\n\n').trim();
    const value = {
      id: itemId,
      name: d.name || hotel.name,
      photos: (d.hotelImages || []).map((i) => https(i.urlHd || i.url)).filter(Boolean).slice(0, 40),
      description: text(d.hotelDescription).slice(0, 4000),
      important: text(d.hotelImportantInformation).slice(0, 1500),
      facilities: [...new Set((d.facilities || []).map((f) => f.name).filter(Boolean))].slice(0, 24),
      checkin: d.checkinCheckoutTimes?.checkin_start || null,
      checkout: d.checkinCheckoutTimes?.checkout || null,
      address: hotel.address,
      location: d.location?.latitude ? { lat: d.location.latitude, lng: d.location.longitude } : null,
      rooms: (d.rooms || []).map((r) => ({
        id: r.id,
        name: r.roomName,
        description: text(r.description).slice(0, 600),
        size: r.roomSizeSquare ? `${r.roomSizeSquare} m²` : null,
        maxOccupancy: r.maxOccupancy || null,
        beds: (r.bedTypes || []).map((b) => `${b.quantity} × ${b.bedType}`).join(', '),
        amenities: (r.roomAmenities || []).map((a) => a.name.replace(/\.$/, '')).slice(0, 14),
        photos: (r.photos || []).map((p) => https(p.hd_url || p.url)).filter(Boolean).slice(0, 10),
      })),
    };
    this.details.set(key, { at: Date.now(), value });
    while (this.details.size > 300) this.details.delete(this.details.keys().next().value);
    return value;
  }


  // Bloquea la habitación (prebook). Con `customerPays`, LiteAPI devuelve además
  // `secretKey` y `transactionId` para que el cliente pague con su tarjeta.
  // `maxTotal`: el precio que vio el cliente; si sale más caro no se sigue.
  async prebook({ offerId, maxTotal, customerPays = false }) {
    let pre;
    try {
      pre = await this.#request('POST', `${BOOK}/rates/prebook`, { offerId, usePaymentSdk: customerPays });
    } catch (err) {
      if (/availability|not available|sold out/i.test(err.message)) {
        throw new LiteApiError('Esa habitación se acaba de agotar. Elige otras fechas u otro hotel.');
      }
      throw err;
    }
    const d = pre.data || {};
    if (!d.prebookId) throw new LiteApiError('No se pudo bloquear la habitación. Inténtalo de nuevo.');
    const price = Number(d.price);
    if (maxTotal != null && Number.isFinite(price) && price > maxTotal + 0.01) {
      throw new PriceChangedError(price);
    }
    if (customerPays && (!d.secretKey || !d.transactionId)) throw new LiteApiError('No se pudo preparar el pago. Inténtalo de nuevo.');
    return { prebookId: d.prebookId, price: Number.isFinite(price) ? price : null, secretKey: d.secretKey || null, transactionId: d.transactionId || null };
  }

  // Confirma la reserva. `transactionId`: pago hecho por el cliente; sin él se
  // carga a la cuenta de LiteAPI del titular de la clave (ACC_CREDIT_CARD).
  async confirm({ prebookId, name, email, units, transactionId = null }) {
    const [firstName, ...rest] = String(name).trim().split(/\s+/);
    const lastName = rest.join(' ') || firstName;
    const guests = Array.from({ length: Math.max(1, Number(units) || 1) }, (_, i) => ({ occupancyNumber: i + 1, firstName, lastName, email }));
    let res;
    try {
      res = await this.#request('POST', `${BOOK}/rates/book`, {
        prebookId,
        holder: { firstName, lastName, email },
        payment: transactionId ? { method: 'TRANSACTION_ID', transactionId } : { method: 'ACC_CREDIT_CARD' },
        guests,
      });
    } catch (err) {
      if (/payment not completed/i.test(err.message)) throw new PaymentPendingError();
      throw err;
    }
    const b = res.data || {};
    if (b.status !== 'CONFIRMED') throw new LiteApiError('El hotel no ha confirmado la reserva.');
    return { bookingId: b.bookingId, total: b.price, hotelConfirmationCode: b.hotelConfirmationCode || null };
  }

  // Reserva pagada con la cuenta del titular (entorno de pruebas o ALLOW_REAL_BOOKINGS).
  async book({ offerId, name, email, units, maxTotal }) {
    const { prebookId } = await this.prebook({ offerId, maxTotal });
    return this.confirm({ prebookId, name, email, units });
  }

  async cancel(bookingId) {
    const res = await this.#request('PUT', `${BOOK}/bookings/${encodeURIComponent(bookingId)}`);
    const d = res.data || {};
    return { status: d.status, refund: d.refund_amount ?? null, fee: d.cancellation_fee ?? null };
  }

  // ---------- Vuelos ----------
  // Búsqueda → verificación del precio → prebook (crea el pago con Stripe) → el
  // cliente paga → booking. Nuitée cobra al cliente como comerciante (Merchant of Record).

  async airports(q) {
    const { data = [] } = await this.#request('GET', `${API}/data/flights/airports?q=${encodeURIComponent(q)}`);
    return data.flatMap((set) => set.airports || []).filter((a) => a.iata).map((a) => ({ code: a.iata, name: a.name, city: a.city, country: a.country }));
  }

  // Misma búsqueda en los últimos minutos (o en curso): se reutiliza. El calendario de
  // precios lanza una búsqueda por día y la de la fecha elegida ya está hecha.
  flightSearch(params, { priority = true } = {}) {
    const key = [params.origin, params.destination, params.date, params.returnDate || '', Number(params.adults) || 1].join('|');
    const now = Date.now();
    for (const [k, v] of this.flightSearches) if (now - v.at > SEARCH_TTL) this.flightSearches.delete(k);
    const hit = this.flightSearches.get(key);
    if (hit) return hit.promise;
    const promise = this.#flightSearch(params, priority);
    this.flightSearches.set(key, { at: now, promise });
    promise.catch(() => this.flightSearches.delete(key));
    return promise;
  }

  async #flightSearch({ origin, destination, date, returnDate, adults = 1 }, priority) {
    const legs = [{ origin, destination, date, direction: 'OUTBOUND' }];
    if (returnDate) legs.push({ origin: destination, destination: origin, date: returnDate, direction: 'INBOUND' });
    const body = {
      legs,
      adults: Math.max(1, Math.min(6, Number(adults) || 1)),
      currency: 'EUR',
      country: 'ES',
      sort: { sortBy: 'price', sortOrder: 'asc' },
    };
    // El buscador del proveedor falla a veces con 5xx («failed to search flights»): un reintento.
    const { data = [] } = await this.#request('POST', `${API}/flights/rates`, body, { priority }).catch(async (err) => {
      if (!(err.status >= 500)) throw err;
      await sleep(1500);
      return this.#request('POST', `${API}/flights/rates`, body, { priority });
    });
    const best = new Map(); // journeyKey -> viaje con su oferta más barata
    for (const set of data) {
      for (const j of set.journeys || []) {
        const trip = this.#toJourney(j);
        if (!trip) continue;
        const prev = best.get(trip.journeyKey);
        if (!prev || trip.total < prev.total) best.set(trip.journeyKey, trip);
      }
    }
    const trips = [...best.values()].sort((a, b) => a.total - b.total).slice(0, MAX_FLIGHTS);
    const now = Date.now();
    for (const [id, o] of this.offers) if (now - o.at > OFFER_TTL) this.offers.delete(id);
    for (const t of trips) this.offers.set(t.offerId, { at: now, trip: t });
    return trips;
  }

  #toJourney(j) {
    const offer = [...(j.offers || [])].filter((o) => typeof o.pricing?.display?.total === 'number').sort((a, b) => a.pricing.display.total - b.pricing.display.total)[0];
    if (!offer || !j.segments?.length) return null;
    const segments = j.segments.map((s) => ({
      direction: s.direction === 'INBOUND' ? 'INBOUND' : 'OUTBOUND',
      from: s.originCode,
      fromName: s.originName || s.originCode,
      to: s.destinationCode,
      toName: s.destinationName || s.destinationCode,
      departure: s.departureTime,
      arrival: s.arrivalTime,
      airline: s.carrier?.marketingName || s.carrier?.marketingCode || '',
      airlineCode: s.carrier?.marketingCode || '',
      logo: /^https:\/\//.test(s.carrier?.marketingLogo || '') ? s.carrier.marketingLogo : null,
      flight: `${s.carrier?.marketingCode || ''}${s.flight?.marketingNumber || ''}`,
      minutes: s.duration?.minutes ?? null,
    }));
    const leg = (dir) => {
      const segs = segments.filter((s) => s.direction === dir);
      if (!segs.length) return null;
      const dur = (j.legDurations || []).find((d) => d.direction === dir);
      return {
        from: segs[0].from,
        to: segs.at(-1).to,
        departure: segs[0].departure,
        arrival: segs.at(-1).arrival,
        stops: segs.length - 1,
        minutes: dur?.duration?.minutes ?? segs.reduce((n, s) => n + (s.minutes || 0), 0),
        dayChange: dur?.dayChange || 0,
        airlines: [...new Set(segs.map((s) => s.airline).filter(Boolean))],
      };
    };
    const p = offer.pricing.display;
    return {
      journeyKey: j.journeyKey || offer.offerId,
      // El mismo vuelo en otros días (mismos números de vuelo), para su calendario.
      flightKey: segments.map((s) => s.flight).join('-'),
      offerId: offer.offerId,
      expiration: offer.expiration || null,
      total: Math.round(p.total * 100) / 100,
      currency: p.currency || 'EUR',
      outbound: leg('OUTBOUND'),
      inbound: leg('INBOUND'),
      segments,
      fare: offer.fare?.family || '',
      seatsRemaining: offer.fare?.seatsRemaining ?? null,
      refundable: !!offer.terms?.refundable,
      changeable: !!offer.terms?.changeable,
      carryOn: !!offer.baggage?.hasCarryOnBag,
      checkedBag: !!offer.baggage?.hasCheckedBag,
      baggage: (offer.baggage?.included || []).map((b) => b.description).filter(Boolean).slice(0, 3),
      adults: j.parameters?.adults ?? null,
    };
  }

  // Datos del viaje guardados en la búsqueda (para el resumen y la reserva).
  flightOffer(offerId) {
    const hit = this.offers.get(offerId);
    return hit && Date.now() - hit.at < OFFER_TTL ? hit.trip : null;
  }

  // Comprueba que la oferta sigue disponible y su precio actual.
  async flightVerify(offerId) {
    let res;
    for (let attempt = 0; !res; attempt++) {
      try {
        res = await this.#request('POST', `${API}/flights/verify`, { offerId });
      } catch (err) {
        if (err.status === 404) throw new LiteApiError('Esa tarifa ya no está disponible. Vuelve a buscar el vuelo.');
        if (err.status >= 500 && attempt < 1) { await sleep(1500); continue; }
        // Si el proveedor sigue fallando se deja seguir con el precio de la búsqueda:
        // el prebook vuelve a comprobarlo y el cliente ve el total final antes de pagar.
        const trip = err.status >= 500 && this.flightOffer(offerId);
        if (trip) return { total: trip.total, changed: false, messages: [], unverified: true };
        throw err;
      }
    }
    const d = (Array.isArray(res.data) ? res.data[0] : res.data) || {};
    const total = Number(d.journey?.pricing?.display?.total);
    if (!Number.isFinite(total)) throw new LiteApiError('No se pudo comprobar el precio del vuelo. Inténtalo de nuevo.');
    return { total: Math.round(total * 100) / 100, changed: !!d.changes?.priceChanged, messages: d.changes?.messages || [] };
  }

  // Reserva la tarifa con la aerolínea y crea el pago (Stripe) que hará el cliente.
  async flightPrebook({ offerId, contact, passengers }) {
    let res;
    for (let attempt = 0; !res; attempt++) {
      try {
        res = await this.#request('POST', `${API}/flights/prebooks`, { offerId, usePaymentSdk: true, contact, passengers });
      } catch (err) {
        if (err.status === 404 || [45029, 45063].includes(err.code)) throw new LiteApiError('Esa tarifa ya no está disponible. Vuelve a buscar el vuelo.');
        // Fallos internos del proveedor (p. ej. «failed to create prebook»): se reintenta una vez.
        if (err.status >= 500 && attempt < 1) { await sleep(1500); continue; }
        if (err.status >= 500) throw new LiteApiError('La aerolínea no ha podido reservar esta tarifa ahora mismo. Inténtalo de nuevo o elige otro vuelo.');
        throw err;
      }
    }
    const d = (Array.isArray(res.data) ? res.data[0] : res.data) || {};
    if (!d.prebookId || !d.secretKey || !d.transactionId) throw new LiteApiError('No se pudo preparar el pago del vuelo. Inténtalo de nuevo.');
    return {
      prebookId: d.prebookId,
      price: Number.isFinite(Number(d.price)) ? Math.round(Number(d.price) * 100) / 100 : null,
      currency: d.currency || 'EUR',
      transactionId: d.transactionId,
      secretKey: d.secretKey,
      publishableKey: d.publishableKey || null,
    };
  }

  // Confirma la reserva con el pago ya hecho. Es idempotente para el mismo prebook,
  // así que se reintenta si el proveedor falla (502/503).
  async flightBook({ prebookId, transactionId }) {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.#request('POST', `${API}/flights/bookings`, { prebookId, payment: { method: 'TRANSACTION_ID', transactionId } });
        const b = ((Array.isArray(res.data) ? res.data[0] : res.data) || {}).booking || {};
        if (!b.bookingId || !['CONFIRMED', 'PENDING_CONFIRMATION', 'CREATED'].includes(b.status)) {
          throw new LiteApiError('La aerolínea no ha confirmado la reserva.');
        }
        return {
          bookingId: b.bookingId,
          bookingRef: b.bookingRef || null,
          status: b.status,
          pnr: (b.airlineLocators || []).map((l) => `${l.airlineCode} ${l.airlinePnr}`).join(', ') || null,
          total: Number.isFinite(Number(b.pricing?.totalAmount)) ? Number(b.pricing.totalAmount) : null,
        };
      } catch (err) {
        if (/payment/i.test(err.message) && /not|pending|incomplete|requires|unpaid/i.test(err.message)) throw new PaymentPendingError();
        if (err.code === 45035) throw new LiteApiError('Estamos confirmando tu reserva. Espera unos segundos.');
        if ([502, 503].includes(err.status) && attempt < 2) {
          await sleep(1500 * (attempt + 1));
          continue;
        }
        throw err;
      }
    }
  }

  // Lo que se devolvería al cancelar (estimación máxima, no garantizada).
  async flightCancelQuote(bookingId) {
    const res = await this.#request('GET', `${API}/flights/bookings/${encodeURIComponent(bookingId)}/cancellations`);
    const d = (Array.isArray(res.data) ? res.data[0] : res.data) || {};
    return {
      refundable: !!d.isRefundable || !!d.isVoidable,
      voidable: !!d.isVoidable,
      refund: d.refund?.display?.amount ?? 0,
      penalty: d.penalty?.display?.amount ?? 0,
      currency: d.refund?.display?.currency || 'EUR',
      destination: d.destination || null,
    };
  }

  async flightCancel(bookingId) {
    const res = await this.#request('POST', `${API}/flights/bookings/${encodeURIComponent(bookingId)}/cancellations`);
    const d = res.data || {};
    // CONFIRMED = la aerolínea aún no ha confirmado la cancelación (pendiente).
    return { status: d.status, pending: !/^CANCELLED/.test(d.status || ''), refund: d.refund_amount ?? null, fee: d.cancellation_fee ?? null };
  }
}
