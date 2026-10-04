// Conexión con LiteAPI (Nuitée): hoteles, precios por noche, reservas y cancelaciones.
// Se activa con la variable de entorno LITEAPI_KEY. Con una clave «sand_…» todo
// ocurre en el entorno de pruebas de LiteAPI: no se cobra nada.

const API = process.env.LITEAPI_URL || 'https://api.liteapi.travel/v3.0';
const BOOK = process.env.LITEAPI_BOOK_URL || 'https://book.liteapi.travel/v3.0';
const DAY = 86400000;
const PRICE_TTL = 3 * 3600 * 1000; // los precios caducan a las 3 h
const HOTELS_TTL = 24 * 3600 * 1000;
const MAX_HOTELS = 15;
const MAX_FLIGHTS = 20;
const OFFER_TTL = 30 * 60 * 1000; // las ofertas de vuelo caducan pronto
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
    this.offers = new Map(); // offerId de vuelo -> { at, trip }
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
  async nightlyPrices(ids, start, days, guests = {}) {
    const hotels = ids.map((id) => this.hotelsById.get(id)).filter(Boolean);
    const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
    const occ = occupancy(guests);
    const k = occKey(occ);
    await Promise.all(dates.map((d) => this.#pricesForNight(hotels, d, occ)));
    const out = {};
    for (const h of hotels) {
      out[h.id] = dates.map((date) => {
        const price = this.prices.get(`${h.liteId}|${date}|${k}`)?.price ?? null;
        return { date, price, available: price !== null, left: null };
      });
    }
    return out;
  }

  async #pricesForNight(hotels, date, occ) {
    const k = occKey(occ);
    const now = Date.now();
    const missing = hotels.filter((h) => {
      const hit = this.prices.get(`${h.liteId}|${date}|${k}`);
      return !hit || now - hit.at > PRICE_TTL;
    });
    if (!missing.length) return;
    const { data = [] } = await this.#request('POST', `${API}/hotels/min-rates`, {
      hotelIds: missing.map((h) => h.liteId),
      checkin: date,
      checkout: addDays(date, 1),
      occupancies: [occ],
      currency: 'EUR',
      guestNationality: 'ES',
      timeout: 6,
    }, { priority: false });
    const found = new Map(data.map((r) => [r.hotelId, r.price]));
    for (const h of missing) {
      const p = found.get(h.liteId);
      // Sin tarifa esa noche = no hay disponibilidad (día en rojo).
      this.prices.set(`${h.liteId}|${date}|${k}`, { at: now, price: typeof p === 'number' ? Math.round(p) : null });
    }
  }

  // ---------- Presupuesto, reserva y cancelación ----------

  async quote({ itemId, checkIn, checkOut, units = 1, adults, children }) {
    const hotel = this.hotelsById.get(itemId);
    if (!hotel) throw new LiteApiError('Hotel no encontrado. Vuelve a buscar la ciudad.');
    const rooms = Math.max(1, Math.min(4, Number(units) || 1));
    const { data = [] } = await this.#request('POST', `${API}/hotels/rates`, {
      hotelIds: [hotel.liteId],
      checkin: checkIn,
      checkout: checkOut,
      occupancies: Array.from({ length: rooms }, () => occupancy({ adults, children })),
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
      payAtHotel: payAtHotel(best.rates),
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

  // ---------- Vuelos ----------
  // Búsqueda → verificación del precio → prebook (crea el pago con Stripe) → el
  // cliente paga → booking. Nuitée cobra al cliente como comerciante (Merchant of Record).

  async airports(q) {
    const { data = [] } = await this.#request('GET', `${API}/data/flights/airports?q=${encodeURIComponent(q)}`);
    return data.flatMap((set) => set.airports || []).filter((a) => a.iata).map((a) => ({ code: a.iata, name: a.name, city: a.city, country: a.country }));
  }

  async flightSearch({ origin, destination, date, returnDate, adults = 1 }) {
    const legs = [{ origin, destination, date, direction: 'OUTBOUND' }];
    if (returnDate) legs.push({ origin: destination, destination: origin, date: returnDate, direction: 'INBOUND' });
    const { data = [] } = await this.#request('POST', `${API}/flights/rates`, {
      legs,
      adults: Math.max(1, Math.min(6, Number(adults) || 1)),
      currency: 'EUR',
      country: 'ES',
      sort: { sortBy: 'price', sortOrder: 'asc' },
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
    try {
      res = await this.#request('POST', `${API}/flights/verify`, { offerId });
    } catch (err) {
      if (err.status === 404) throw new LiteApiError('Esa tarifa ya no está disponible. Vuelve a buscar el vuelo.');
      throw err;
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
