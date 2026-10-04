// Conexión con LiteAPI (Nuitée): hoteles, precios por noche, reservas y cancelaciones.
// Se activa con la variable de entorno LITEAPI_KEY. Con una clave «sand_…» todo
// ocurre en el entorno de pruebas de LiteAPI: no se cobra nada.

const API = process.env.LITEAPI_URL || 'https://api.liteapi.travel/v3.0';
const BOOK = process.env.LITEAPI_BOOK_URL || 'https://book.liteapi.travel/v3.0';
const DAY = 86400000;
const PRICE_TTL = 3 * 3600 * 1000; // los precios caducan a las 3 h
const HOTELS_TTL = 24 * 3600 * 1000;
const MAX_HOTELS = 15;
const CONCURRENCY = 3; // el entorno de pruebas responde 429 con más peticiones a la vez

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const countryName = (() => {
  try {
    const dn = new Intl.DisplayNames(['es'], { type: 'region' });
    return (code) => (code ? dn.of(String(code).toUpperCase()) : '');
  } catch {
    return (code) => code || '';
  }
})();

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
    this.hotelsById = new Map(); // id interno -> hotel
    this.prices = new Map(); // `${liteId}|${fecha}` -> { at, price }
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
          const msg = data.error?.description || data.error?.message || `LiteAPI respondió ${res.status}`;
          this.lastError = { at: new Date().toISOString(), status: res.status, message: String(msg).slice(0, 200) };
          throw new LiteApiError(msg);
        }
        return data;
      }
    } finally {
      this.#release();
    }
  }

  // ---------- Hoteles de una ciudad ----------

  async #placeId(city) {
    const key = norm(city);
    const hit = this.places.get(key);
    if (hit && Date.now() - hit.at < HOTELS_TTL) return hit.value;
    const { data = [] } = await this.#request('GET', `${API}/data/places?textQuery=${encodeURIComponent(city)}&language=es`);
    const place = data.find((p) => p.types?.includes('locality')) || data[0] || null;
    this.places.set(key, { at: Date.now(), value: place?.placeId || null });
    return place?.placeId || null;
  }

  async hotels(city) {
    const key = norm(city);
    const hit = this.hotelLists.get(key);
    if (hit && Date.now() - hit.at < HOTELS_TTL) return hit.value;
    const placeId = await this.#placeId(city);
    if (!placeId) return [];
    const { data = [] } = await this.#request('GET', `${API}/data/hotels?placeId=${encodeURIComponent(placeId)}&limit=${MAX_HOTELS}&language=es`);
    const hotels = data.map((h) => this.#toHotel(h));
    this.hotelLists.set(key, { at: Date.now(), value: hotels });
    return hotels;
  }

  #toHotel(h) {
    const stars = Number.isInteger(h.stars) && h.stars >= 1 && h.stars <= 5 ? h.stars : null;
    const tags = [];
    if (stars >= 5) tags.push('lujo');
    if (stars && stars <= 2) tags.push('económico');
    if (/pool|piscina/i.test(h.hotelDescription || '')) tags.push('piscina');
    if (/\bspa\b/i.test(h.hotelDescription || '')) tags.push('spa');
    const hotel = {
      id: 'lite-' + h.id,
      liteId: h.id,
      name: h.name,
      city: h.city || '',
      country: countryName(h.country),
      stars,
      address: [h.address, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null,
      website: null,
      photo: /^https:\/\//.test(h.thumbnail || h.main_photo || '') ? h.thumbnail || h.main_photo : null,
      rating: typeof h.rating === 'number' && h.rating > 0 ? h.rating : null,
      reviewCount: h.reviewCount || null,
      tags,
      image: '🏨',
      description: shortDescription(h.hotelDescription),
      origin: 'liteapi',
    };
    this.hotelsById.set(hotel.id, hotel);
    return hotel;
  }

  hotel(id) {
    return this.hotelsById.get(id) || null;
  }

  // ---------- Precio de cada noche (estancia de 1 noche, 2 adultos) ----------

  // Devuelve { [idInterno]: [{ date, price|null, available }] } para `days` noches desde `start`.
  async nightlyPrices(ids, start, days) {
    const hotels = ids.map((id) => this.hotelsById.get(id)).filter(Boolean);
    const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
    await Promise.all(dates.map((d) => this.#pricesForNight(hotels, d)));
    const out = {};
    for (const h of hotels) {
      out[h.id] = dates.map((date) => {
        const price = this.prices.get(`${h.liteId}|${date}`)?.price ?? null;
        return { date, price, available: price !== null, left: null };
      });
    }
    return out;
  }

  async #pricesForNight(hotels, date) {
    const now = Date.now();
    const missing = hotels.filter((h) => {
      const hit = this.prices.get(`${h.liteId}|${date}`);
      return !hit || now - hit.at > PRICE_TTL;
    });
    if (!missing.length) return;
    const { data = [] } = await this.#request('POST', `${API}/hotels/min-rates`, {
      hotelIds: missing.map((h) => h.liteId),
      checkin: date,
      checkout: addDays(date, 1),
      occupancies: [{ adults: 2 }],
      currency: 'EUR',
      guestNationality: 'ES',
      timeout: 6,
    }, { priority: false });
    const found = new Map(data.map((r) => [r.hotelId, r.price]));
    for (const h of missing) {
      const p = found.get(h.liteId);
      // Sin tarifa esa noche = no hay disponibilidad (día en rojo).
      this.prices.set(`${h.liteId}|${date}`, { at: now, price: typeof p === 'number' ? Math.round(p) : null });
    }
  }

  // ---------- Presupuesto, reserva y cancelación ----------

  async quote({ itemId, checkIn, checkOut, units = 1 }) {
    const hotel = this.hotelsById.get(itemId);
    if (!hotel) throw new LiteApiError('Hotel no encontrado. Vuelve a buscar la ciudad.');
    const rooms = Math.max(1, Math.min(4, Number(units) || 1));
    const { data = [] } = await this.#request('POST', `${API}/hotels/rates`, {
      hotelIds: [hotel.liteId],
      checkin: checkIn,
      checkout: checkOut,
      occupancies: Array.from({ length: rooms }, () => ({ adults: 2 })),
      currency: 'EUR',
      guestNationality: 'ES',
      timeout: 8,
    });
    const offers = (data[0]?.roomTypes || []).filter((o) => typeof o.offerRetailRate?.amount === 'number');
    if (!offers.length) throw new LiteApiError('Ya no quedan habitaciones para esas fechas. Elige otros días.');
    offers.sort((a, b) => a.offerRetailRate.amount - b.offerRetailRate.amount);
    const best = offers[0];
    const rate = best.rates?.[0] || {};
    const refundable = rate.cancellationPolicies?.refundableTag === 'RFN';
    const deadline = rate.cancellationPolicies?.cancelPolicyInfos?.[0]?.cancelTime || null;
    return {
      item: hotel,
      offerId: best.offerId,
      units: rooms,
      nights: Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / DAY),
      total: Math.round(best.offerRetailRate.amount * 100) / 100,
      roomName: rate.name || '',
      board: rate.boardName || '',
      refundable,
      freeCancellationUntil: refundable ? deadline : null,
    };
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
}
