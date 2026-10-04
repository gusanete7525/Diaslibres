import express from 'express';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { BookingStore, PgBookingStore, createStore } from './src/store.js';
import { searchHotels, searchFlights, quote, todayISO, addDays, isISODate } from './src/availability.js';
import { aiSearch } from './src/ai.js';
import { AIRPORTS } from './src/catalog.js';
import { OsmHotels } from './src/osm.js';
import { Mailer } from './src/mail.js';
import { LiteApi, PriceChangedError, PaymentPendingError, occupancy } from './src/liteapi.js';

const root = dirname(fileURLToPath(import.meta.url));

export function createApp({
  store = new BookingStore(join(root, 'data', 'bookings.json')),
  osm = process.env.DIASLIBRES_OSM === 'off' ? null : new OsmHotels({ file: join(root, 'data', 'osm-cache.json') }),
  live = process.env.LITEAPI_KEY?.trim() ? new LiteApi({ key: process.env.LITEAPI_KEY }) : null,
  // 'customer': paga el cliente con su tarjeta (pasarela de LiteAPI). 'account': se
  // carga a la cuenta de LiteAPI del titular de la clave.
  livePayment = process.env.LITEAPI_PAYMENT === 'account' ? 'account' : 'customer',
  mailer = new Mailer(),
} = {}) {
  // Los emails se envían en segundo plano: nunca retrasan ni deshacen una reserva.
  const notify = (fn, b) => { if (b && mailer?.[fn]) Promise.resolve().then(() => mailer[fn](b)).catch(() => {}); };
  const app = express();
  app.set('trust proxy', true); // https correcto detrás del proxy de Render
  app.use(express.json({ limit: '20kb' }));
  app.use(express.static(join(root, 'public')));

  const list = (v) => (Array.isArray(v) ? v : v ? String(v).split(',') : []);

  // Con destino, se añaden hoteles reales de OpenStreetMap (si responde a tiempo).
  async function osmHotels(destination) {
    if (!osm || !destination || String(destination).trim().length < 2) return { hotels: [], error: null };
    let timer;
    try {
      const timeout = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('OpenStreetMap tarda demasiado')), 20000)));
      return { hotels: await Promise.race([osm.hotelsFor(String(destination)), timeout]), error: null };
    } catch (err) {
      console.error('[osm]', err.message);
      return { hotels: [], error: 'No se pudo consultar OpenStreetMap; se muestran solo los hoteles del catálogo.' };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- Hoteles con datos reales de LiteAPI (si hay LITEAPI_KEY) ----------
  const LIVE_DAYS = 30;
  // Si paga el cliente, se puede reservar siempre. Si se carga a la cuenta del titular,
  // con la clave real solo con ALLOW_REAL_BOOKINGS=1 (si no, cualquiera reservaría a su costa).
  const liveFlights = !!live && process.env.LITEAPI_FLIGHTS !== 'off';
  const liveBookingEnabled = !!live && (livePayment === 'customer' || live.sandbox || process.env.ALLOW_REAL_BOOKINGS === '1');
  // Datos internos de la reserva que no salen al navegador.
  const publicBooking = (b) => {
    if (!b) return b;
    const { prebookId, transactionId, checkoutId, ...rest } = b;
    return rest;
  };
  const validCustomer = (body) => {
    const name = String(body.name || '').trim().slice(0, 80);
    const email = String(body.email || '').trim().slice(0, 120);
    if (name.length < 2) return { error: 'Indica tu nombre.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Email no válido.' };
    return { name, email };
  };
  const isLive = (id) => !!live && String(id || '').startsWith('lite-');

  async function liveHotels(q, res) {
    const city = String(q.destination || '').trim() || 'Madrid';
    try {
      let hotels = await live.hotels(city);
      if (q.minStars) hotels = hotels.filter((h) => (h.stars || 0) >= Number(q.minStars));
      hotels = [...hotels].sort((a, b) => (b.stars || 0) - (a.stars || 0) || (b.rating || 0) - (a.rating || 0));
      const start = todayISO();
      // Las fichas llegan al momento; los precios de cada noche se piden después por tandas.
      const results = hotels.map((h) => ({
        ...h,
        calendar: Array.from({ length: LIVE_DAYS }, (_, i) => ({ date: addDays(start, i), price: null, available: null, left: null, pending: true })),
        summary: { freeDays: 0, minPrice: null, maxPrice: null, avgPrice: null },
        bestStay: null,
      }));
      res.json({ start, days: LIVE_DAYS, nights: Math.max(1, Math.min(30, Number(q.nights) || 3)), results, live: { sandbox: live.sandbox, city, bookingEnabled: liveBookingEnabled, payment: livePayment }, guests: occupancy({ adults: q.adults, children: q.children }) });
    } catch (err) {
      console.error('[liteapi]', err.message);
      res.status(502).json({ error: 'No se pudo consultar LiteAPI ahora mismo. Inténtalo de nuevo en unos segundos.' });
    }
  }

  app.get('/api/live/prices', async (req, res) => {
    if (!live) return res.status(404).json({ error: 'Precios reales no disponibles.' });
    const ids = list(req.query.ids).filter((id) => id.startsWith('lite-')).slice(0, 20);
    const start = isISODate(req.query.start) && req.query.start >= todayISO() ? req.query.start : todayISO();
    const days = Math.max(1, Math.min(7, Number(req.query.days) || 7));
    try {
      res.json({ start, days, prices: await live.nightlyPrices(ids, start, days, { adults: req.query.adults, children: req.query.children }) });
    } catch (err) {
      console.error('[liteapi]', err.message);
      res.status(502).json({ error: 'LiteAPI no ha devuelto precios. Inténtalo de nuevo.' });
    }
  });

  app.get('/api/hotels', async (req, res) => {
    const q = req.query;
    if (live) return liveHotels(q, res);
    const extra = await osmHotels(q.destination);
    const data = searchHotels(await store.all(), { ...q, tags: list(q.tags) }, extra.hotels);
    data.osm = { count: data.results.filter((h) => h.origin === 'osm').length, error: extra.error };
    res.json(data);
  });

  app.get('/api/flights', async (req, res) => {
    if (liveFlights) return liveFlightSearch(req.query, res);
    res.json(searchFlights(await store.all(), req.query));
  });

  // ---------- Vuelos reales con LiteAPI (si hay LITEAPI_KEY y no LITEAPI_FLIGHTS=off) ----------
  const norm = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  // «MAD», «Madrid» o cualquier ciudad con aeropuerto → código IATA.
  async function airportCode(q) {
    const text = String(q || '').trim();
    if (/^[a-z]{3}$/i.test(text)) return { code: text.toUpperCase(), name: AIRPORTS[text.toUpperCase()] || text.toUpperCase() };
    const known = Object.entries(AIRPORTS).find(([, city]) => norm(city) === norm(text));
    if (known) return { code: known[0], name: known[1] };
    if (text.length < 2) return null;
    const [first] = await live.airports(text);
    return first ? { code: first.code, name: first.city || first.name } : null;
  }

  async function liveFlightSearch(q, res) {
    const adults = Math.max(1, Math.min(6, Number(q.adults) || 1));
    const date = isISODate(q.date) && q.date > todayISO() ? q.date : addDays(todayISO(), 14);
    const returnDate = isISODate(q.returnDate) && q.returnDate >= date ? q.returnDate : null;
    const base = { live: { sandbox: live.sandbox, flights: true }, date, returnDate, adults, results: [] };
    if (!String(q.origin || '').trim() || !String(q.destination || '').trim()) {
      return res.json({ ...base, needRoute: true });
    }
    try {
      const [from, to] = await Promise.all([airportCode(q.origin), airportCode(q.destination)]);
      if (!from || !to) return res.status(400).json({ error: `No encontramos el aeropuerto de ${!from ? q.origin : q.destination}. Prueba con su código, por ejemplo MAD.` });
      if (from.code === to.code) return res.status(400).json({ error: 'El origen y el destino son el mismo aeropuerto.' });
      let trips = await live.flightSearch({ origin: from.code, destination: to.code, date, returnDate, adults });
      if (q.maxPrice) trips = trips.filter((t) => t.total <= Number(q.maxPrice));
      res.json({ ...base, origin: from, destination: to, results: trips });
    } catch (err) {
      console.error('[liteapi vuelos]', err.message);
      res.status(502).json({ error: 'No se pudieron consultar los vuelos ahora mismo. Inténtalo de nuevo en unos segundos.' });
    }
  }

  // Precio actual de una oferta antes de pedir los datos de los pasajeros.
  // ---------- Calendario de vuelos: una búsqueda por día, en segundo plano ----------
  const iata = (x) => (/^[A-Z]{3}$/.test(String(x || '').toUpperCase()) ? String(x).toUpperCase() : null);
  app.get('/api/flights/days', async (req, res) => {
    if (!liveFlights) return res.status(404).json({ error: 'Los vuelos reales no están activados.' });
    const q = req.query;
    const origin = iata(q.origin);
    const destination = iata(q.destination);
    if (!origin || !destination || origin === destination) return res.status(400).json({ error: 'Ruta no válida.' });
    const tomorrow = addDays(todayISO(), 1);
    const dates = [...new Set(list(q.dates))].filter((d) => isISODate(d) && d >= tomorrow).slice(0, 7);
    if (!dates.length) return res.status(400).json({ error: 'Fechas no válidas.' });
    const stay = q.stay != null && q.stay !== '' ? Math.max(0, Math.min(30, Number(q.stay) || 0)) : null; // null = solo ida
    const adults = Math.max(1, Math.min(6, Number(q.adults) || 1));
    const out = await Promise.all(dates.map(async (date) => {
      try {
        const trips = await live.flightSearch({ origin, destination, date, returnDate: stay == null ? null : addDays(date, stay), adults }, { priority: false });
        return { date, trips };
      } catch (err) {
        console.error('[liteapi vuelos]', date, err.message);
        return { date, error: true };
      }
    }));
    res.json({ days: out });
  });

  // ---------- Ofertas: el vuelo más barato de rutas populares (se renuevan cada 2 h) ----------
  const DEAL_ROUTES = [['MAD', 'BCN'], ['MAD', 'LIS'], ['MAD', 'CDG'], ['MAD', 'FCO'], ['MAD', 'TFN'], ['BCN', 'AGP'], ['BCN', 'LHR'], ['VLC', 'PMI'], ['VLC', 'AMS']];
  const DEALS_TTL = 2 * 60 * 60 * 1000;
  const deals = { at: 0, date: null, list: [], running: null };
  function refreshDeals() {
    if (!liveFlights || deals.running) return deals.running;
    const date = addDays(todayISO(), 14);
    const fresh = [];
    const place = (code) => ({ code, name: AIRPORTS[code] || code });
    deals.running = Promise.all(DEAL_ROUTES.map(async ([o, d]) => {
      try {
        const [t] = await live.flightSearch({ origin: o, destination: d, date, adults: 1 }, { priority: false });
        if (t) fresh.push({ origin: place(o), destination: place(d), date, total: t.total, currency: t.currency, airlines: t.outbound.airlines, departure: t.outbound.departure, stops: t.outbound.stops, minutes: t.outbound.minutes });
      } catch (err) {
        console.error('[liteapi ofertas]', o, d, err.message);
      }
      if (!deals.at) { deals.list = [...fresh]; deals.date = date; } // la primera vez se van enseñando según llegan
    })).then(() => {
      if (fresh.length) Object.assign(deals, { list: fresh, date, at: Date.now() });
    }).finally(() => { deals.running = null; });
    return deals.running;
  }
  app.locals.refreshDeals = refreshDeals;
  app.get('/api/flights/deals', (_req, res) => {
    if (!liveFlights) return res.status(404).json({ error: 'Los vuelos reales no están activados.' });
    if (Date.now() - deals.at > DEALS_TTL) refreshDeals();
    res.json({ date: deals.date, deals: [...deals.list].sort((a, b) => a.total - b.total), pending: !deals.at && !!deals.running });
  });

  app.post('/api/flights/quote', async (req, res) => {
    if (!liveFlights) return res.status(404).json({ error: 'Los vuelos reales no están activados.' });
    try {
      const v = await live.flightVerify(String(req.body?.offerId || ''));
      res.json(v);
    } catch (err) {
      console.error('[liteapi vuelos]', err.message);
      res.status(409).json({ error: err.message });
    }
  });

  const DOC_TYPES = ['passport', 'id']; // LiteAPI: pasaporte o DNI
  function validFlightCustomer(body, adults, flightDate) {
    const email = String(body.email || '').trim().slice(0, 120);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Email no válido.' };
    const phoneCountryCode = String(body.phoneCountryCode || '34').replace(/\D/g, '').slice(0, 4);
    const phoneNumber = String(body.phoneNumber || '').replace(/\D/g, '').slice(0, 15);
    if (!phoneCountryCode || phoneNumber.length < 6) return { error: 'Indica un teléfono de contacto.' };
    const list = Array.isArray(body.passengers) ? body.passengers.slice(0, 6) : [];
    if (list.length !== adults) return { error: `Faltan los datos de ${adults === 1 ? 'el pasajero' : 'los ' + adults + ' pasajeros'}.` };
    const passengers = [];
    for (const [i, p] of list.entries()) {
      const who = `Pasajero ${i + 1}`;
      const firstName = String(p.firstName || '').trim().slice(0, 40);
      const lastName = String(p.lastName || '').trim().slice(0, 60);
      if (firstName.length < 1 || lastName.length < 2) return { error: `${who}: escribe nombre y apellidos como en el documento.` };
      if (!isISODate(p.birthday)) return { error: `${who}: fecha de nacimiento no válida.` };
      const age = (Date.parse(flightDate) - Date.parse(p.birthday)) / (365.25 * 86400000);
      if (age < 12 || age > 120) return { error: `${who}: por ahora solo se pueden reservar pasajeros de 12 años o más.` };
      if (!['M', 'F'].includes(p.gender)) return { error: `${who}: indica el sexo que figura en el documento.` };
      const nationality = String(p.nationality || '').toUpperCase();
      if (!/^[A-Z]{2}$/.test(nationality)) return { error: `${who}: indica la nacionalidad.` };
      if (p.documentType === 'id_card') p.documentType = 'id'; // páginas antiguas
      if (!DOC_TYPES.includes(p.documentType)) return { error: `${who}: elige el tipo de documento.` };
      const documentNumber = String(p.documentNumber || '').replace(/\s/g, '').toUpperCase().slice(0, 20);
      if (documentNumber.length < 5) return { error: `${who}: número de documento no válido.` };
      if (!isISODate(p.documentExpiry) || p.documentExpiry <= flightDate) return { error: `${who}: el documento debe estar en vigor el día del vuelo.` };
      const documentIssueCountry = /^[A-Z]{2}$/i.test(p.documentIssueCountry || '') ? p.documentIssueCountry.toUpperCase() : nationality;
      passengers.push({ firstName, lastName, birthday: p.birthday, gender: p.gender, nationality, documentType: p.documentType, documentNumber, documentExpiry: p.documentExpiry, documentIssueCountry, passengerType: 0 });
    }
    const contact = { email, firstName: passengers[0].firstName, lastName: passengers[0].lastName, phoneCountryCode, phoneNumber };
    return { email, contact, passengers };
  }

  // 1) Bloquea la tarifa y crea el pago; 2) el cliente paga con Stripe y vuelve a
  // /?vuelo=<id>; 3) se confirma la reserva con la aerolínea.
  app.post('/api/flights/checkout', async (req, res) => {
    if (!liveFlights) return res.status(404).json({ error: 'Los vuelos reales no están activados.' });
    const body = req.body || {};
    const trip = live.flightOffer(String(body.offerId || ''));
    if (!trip) return res.status(409).json({ error: 'Esa tarifa ha caducado. Vuelve a buscar el vuelo.' });
    const adults = trip.adults || Math.max(1, Math.min(6, Number(body.adults) || 1));
    const flightDate = trip.outbound.departure.slice(0, 10);
    const who = validFlightCustomer(body, adults, flightDate);
    if (who.error) return res.status(400).json({ error: who.error });
    try {
      const pre = await live.flightPrebook({ offerId: trip.offerId, contact: who.contact, passengers: who.passengers });
      const checkoutId = randomBytes(16).toString('hex');
      const booking = await store.add({
        code: 'DL-' + randomBytes(3).toString('hex').toUpperCase(),
        type: 'flight',
        itemId: 'lite-flight',
        itemName: `${trip.outbound.from} → ${trip.outbound.to}${trip.inbound ? ' (ida y vuelta)' : ''} · ${trip.outbound.airlines.join(', ')}`,
        date: flightDate,
        returnDate: trip.inbound ? trip.inbound.departure.slice(0, 10) : undefined,
        flight: { outbound: trip.outbound, inbound: trip.inbound, fare: trip.fare },
        units: adults,
        total: pre.price ?? trip.total,
        name: `${who.contact.firstName} ${who.contact.lastName}`,
        email: who.email,
        passengers: who.passengers.map((p) => `${p.firstName} ${p.lastName}`),
        status: 'pendiente_pago',
        provider: 'liteapi',
        sandbox: live.sandbox,
        refundable: trip.refundable,
        checkoutId,
        prebookId: pre.prebookId,
        transactionId: pre.transactionId,
        createdAt: new Date().toISOString(),
      });
      const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
      res.status(201).json({
        checkoutId,
        code: booking.code,
        total: booking.total,
        currency: pre.currency,
        searchTotal: trip.total,
        secretKey: pre.secretKey,
        publishableKey: pre.publishableKey,
        publicKey: live.sandbox ? 'sandbox' : 'live',
        returnUrl: `${base}/?vuelo=${checkoutId}`,
      });
    } catch (err) {
      console.error('[liteapi vuelos]', err.message);
      res.status(409).json({ error: err.message });
    }
  });

  const confirmingFlights = new Set();
  app.post('/api/flights/checkout/:id/confirm', async (req, res) => {
    const id = String(req.params.id);
    const b = await store.findByCheckout(id);
    if (!b || b.type !== 'flight') return res.status(404).json({ error: 'No encontramos ese pago.' });
    if (b.status !== 'pendiente_pago') return res.json(publicBooking(b));
    if (!liveFlights) return res.status(503).json({ error: 'No se puede confirmar ahora: falta la conexión con LiteAPI.' });
    if (confirmingFlights.has(id)) return res.status(409).json({ error: 'Estamos confirmando tu reserva. Espera unos segundos.' });
    confirmingFlights.add(id);
    try {
      const r = await live.flightBook({ prebookId: b.prebookId, transactionId: b.transactionId });
      const done = await store.update(b.code, {
        status: 'confirmada',
        providerBookingId: r.bookingId,
        bookingRef: r.bookingRef,
        pnr: r.pnr,
        total: r.total ?? b.total,
        paidAt: new Date().toISOString(),
      });
      notify('bookingConfirmed', done);
      res.json(publicBooking(done));
    } catch (err) {
      console.error('[liteapi vuelos]', err.message);
      if (err instanceof PaymentPendingError) return res.status(402).json({ error: 'El pago no se ha completado. No se ha hecho ningún cargo ni reserva.' });
      notify('paymentWithoutBooking', { ...b, error: err.message });
      res.status(502).json({ error: 'Hemos recibido el pago, pero la aerolínea aún no ha confirmado el billete. Lo revisamos y te escribimos; tu código es ' + b.code + '.' });
    } finally {
      confirmingFlights.delete(id);
    }
  });

  app.get('/api/airports', (_req, res) => res.json(AIRPORTS));
  app.get('/api/config', (_req, res) => res.json({ liveFlights, sandbox: live?.sandbox ?? null }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, live: !!live, sandbox: live?.sandbox ?? null, storage: store instanceof PgBookingStore ? 'postgres' : 'file', payment: live ? livePayment : null, flights: liveFlights, lastLiteApiError: live?.lastError ?? null, mail: mailer?.status ?? null }));

  app.post('/api/ai-search', async (req, res) => {
    try {
      res.json(await aiSearch(req.body?.query));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/quote', async (req, res) => {
    const body = req.body || {};
    if (isLive(body.itemId)) {
      try {
        const q = await live.quote(body);
        const { item, offerId, ...rest } = q;
        return res.json(rest);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }
    try {
      const q = quote(await store.all(), req.body || {}, osm?.known());
      res.json({ total: q.total, units: q.units, nights: q.nights, perNight: q.perNight });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---------- Pago del cliente (pasarela de LiteAPI) ----------
  // 1) /api/checkout bloquea la habitación al precio visto y devuelve la clave del pago.
  // 2) El navegador muestra el formulario de tarjeta; al pagar vuelve a /?pago=<id>.
  // 3) /api/checkout/:id/confirm confirma la reserva en LiteAPI con el pago hecho.
  app.post('/api/checkout', async (req, res) => {
    const body = req.body || {};
    if (!isLive(body.itemId) || livePayment !== 'customer') return res.status(400).json({ error: 'Este alojamiento no admite pago con tarjeta.' });
    const who = validCustomer(body);
    if (who.error) return res.status(400).json({ error: who.error });
    const seen = Number(body.expectedTotal);
    if (!Number.isFinite(seen) || seen <= 0) return res.status(400).json({ error: 'Falta el precio del presupuesto. Vuelve a abrir la reserva.' });
    try {
      const q = await live.quote(body);
      if (q.total > seen + 0.01) throw new PriceChangedError(q.total);
      const pre = await live.prebook({ offerId: q.offerId, maxTotal: seen, customerPays: true });
      const checkoutId = randomBytes(16).toString('hex');
      const booking = await store.add({
        code: 'DL-' + randomBytes(3).toString('hex').toUpperCase(),
        type: 'hotel',
        itemId: q.item.id,
        itemName: `${q.item.name} (${q.item.city})`,
        checkIn: body.checkIn,
        checkOut: body.checkOut,
        units: q.units,
        total: pre.price ?? q.total,
        name: who.name,
        email: who.email,
        guests: occupancy(body),
        status: 'pendiente_pago',
        provider: 'liteapi',
        sandbox: live.sandbox,
        refundable: q.refundable,
        freeCancellationUntil: q.freeCancellationUntil,
        payAtHotel: q.payAtHotel,
        roomName: q.roomName,
        checkoutId,
        prebookId: pre.prebookId,
        transactionId: pre.transactionId,
        createdAt: new Date().toISOString(),
      });
      const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
      res.status(201).json({
        checkoutId,
        code: booking.code,
        total: booking.total,
        secretKey: pre.secretKey,
        publicKey: live.sandbox ? 'sandbox' : 'live',
        returnUrl: `${base}/?pago=${checkoutId}`,
      });
    } catch (err) {
      console.error('[liteapi]', err.message);
      res.status(409).json({ error: err.message, ...(err instanceof PriceChangedError ? { newTotal: err.total } : {}) });
    }
  });

  const confirming = new Set(); // evita confirmar dos veces el mismo pago a la vez
  app.post('/api/checkout/:id/confirm', async (req, res) => {
    const id = String(req.params.id);
    const b = await store.findByCheckout(id);
    if (!b) return res.status(404).json({ error: 'No encontramos ese pago.' });
    if (b.status === 'confirmada' || b.status === 'cancelada') return res.json(publicBooking(b));
    if (b.status !== 'pendiente_pago') return res.status(409).json({ error: 'Esta reserva no se puede confirmar.' });
    if (confirming.has(id)) return res.status(409).json({ error: 'Estamos confirmando tu reserva. Espera unos segundos.' });
    confirming.add(id);
    try {
      const r = await live.confirm({ prebookId: b.prebookId, name: b.name, email: b.email, units: b.units, transactionId: b.transactionId });
      const done = await store.update(b.code, { status: 'confirmada', providerBookingId: r.bookingId, total: r.total ?? b.total, paidAt: new Date().toISOString() });
      notify('bookingConfirmed', done);
      res.json(publicBooking(done));
    } catch (err) {
      console.error('[liteapi]', err.message);
      if (err instanceof PaymentPendingError) return res.status(402).json({ error: 'El pago no se ha completado. No se ha hecho ningún cargo ni reserva.' });
      // El cliente ha pagado y no hay reserva: hay que avisar al titular para resolverlo.
      notify('paymentWithoutBooking', { ...b, error: err.message });
      res.status(502).json({ error: 'El pago se recibió, pero el hotel no confirmó la reserva: ' + err.message + ' Escríbenos con tu código ' + b.code + '.' });
    } finally {
      confirming.delete(id);
    }
  });

  app.post('/api/bookings', async (req, res) => {
    const body = req.body || {};
    const name = String(body.name || '').trim().slice(0, 80);
    const email = String(body.email || '').trim().slice(0, 120);
    if (name.length < 2) return res.status(400).json({ error: 'Indica tu nombre.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email no válido.' });
    if (isLive(body.itemId)) {
      if (livePayment === 'customer') return res.status(400).json({ error: 'Para reservar este hotel hay que pagar con tarjeta.' });
      if (!liveBookingEnabled) {
        return res.status(403).json({ error: 'En esta web de demostración las reservas reales están desactivadas: puedes ver precios y disponibilidad reales, pero no reservar.' });
      }
      try {
        // El precio que vio el cliente en el presupuesto; nunca se reserva por encima.
        const seen = Number(body.expectedTotal);
        if (!Number.isFinite(seen) || seen <= 0) return res.status(400).json({ error: 'Falta el precio del presupuesto. Vuelve a abrir la reserva.' });
        const q = await live.quote(body);
        if (q.total > seen + 0.01) throw new PriceChangedError(q.total);
        const b = await live.book({ offerId: q.offerId, name, email, units: q.units, maxTotal: seen });
        const booking = await store.add({
          code: 'DL-' + randomBytes(3).toString('hex').toUpperCase(),
          type: 'hotel',
          itemId: q.item.id,
          itemName: `${q.item.name} (${q.item.city})`,
          checkIn: body.checkIn,
          checkOut: body.checkOut,
          units: q.units,
          total: b.total ?? q.total,
          name,
          email,
          guests: occupancy(body),
          status: 'confirmada',
          provider: 'liteapi',
          providerBookingId: b.bookingId,
          sandbox: live.sandbox,
          refundable: q.refundable,
          freeCancellationUntil: q.freeCancellationUntil,
          payAtHotel: q.payAtHotel,
          roomName: q.roomName,
          createdAt: new Date().toISOString(),
        });
        notify('bookingConfirmed', booking);
        return res.status(201).json(publicBooking(booking));
      } catch (err) {
        console.error('[liteapi]', err.message);
        return res.status(409).json({ error: err.message, ...(err instanceof PriceChangedError ? { newTotal: err.total } : {}) });
      }
    }
    try {
      const q = quote(await store.all(), body, osm?.known());
      const booking = await store.add({
        code: 'DL-' + randomBytes(3).toString('hex').toUpperCase(),
        type: body.type,
        itemId: q.item.id,
        itemName: body.type === 'hotel' ? `${q.item.name} (${q.item.city})` : `${q.item.airline} ${q.item.origin}→${q.item.destination} ${q.item.departure}`,
        checkIn: body.type === 'hotel' ? body.checkIn : undefined,
        checkOut: body.type === 'hotel' ? body.checkOut : undefined,
        date: body.type === 'flight' ? body.date : undefined,
        units: q.units,
        total: q.total,
        name,
        email,
        status: 'confirmada',
        createdAt: new Date().toISOString(),
      });
      notify('bookingConfirmed', booking);
      res.status(201).json(publicBooking(booking));
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  });

  app.get('/api/bookings', async (req, res) => {
    const email = String(req.query.email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'Indica tu email.' });
    res.json((await store.listByEmail(email)).filter((b) => b.status !== 'pendiente_pago').map(publicBooking));
  });

  // Cuánto se devolvería al cancelar un vuelo (estimación de la aerolínea).
  app.get('/api/bookings/:code/cancel-quote', async (req, res) => {
    const email = String(req.query.email || '').toLowerCase();
    const found = await store.get(req.params.code);
    if (!found || found.email.toLowerCase() !== email || found.status !== 'confirmada') return res.status(404).json({ error: 'Reserva no encontrada.' });
    if (found.type !== 'flight' || found.provider !== 'liteapi' || !live) return res.json({ refundable: !!found.refundable, refund: null });
    try {
      res.json(await live.flightCancelQuote(found.providerBookingId));
    } catch (err) {
      console.error('[liteapi vuelos]', err.message);
      res.status(502).json({ error: 'No se pudo consultar el reembolso ahora mismo. Inténtalo de nuevo.' });
    }
  });

  app.post('/api/bookings/:code/cancel', async (req, res) => {
    const email = String(req.body?.email || '').toLowerCase();
    const found = await store.get(req.params.code);
    if (!found || found.email.toLowerCase() !== email || found.status !== 'confirmada') return res.status(404).json({ error: 'Reserva no encontrada.' });
    let cancellation;
    if (found.provider === 'liteapi') {
      if (!live) return res.status(503).json({ error: 'No se puede cancelar ahora: falta la conexión con LiteAPI.' });
      try {
        cancellation = found.type === 'flight' ? await live.flightCancel(found.providerBookingId) : await live.cancel(found.providerBookingId);
      } catch (err) {
        return res.status(502).json({ error: (found.type === 'flight' ? 'La aerolínea' : 'LiteAPI') + ' no ha aceptado la cancelación: ' + err.message });
      }
      // La aerolínea a veces confirma la cancelación más tarde.
      if (cancellation.pending) {
        const b = await store.update(found.code, { status: 'cancelacion_solicitada', cancellation });
        return res.json(publicBooking(b));
      }
    }
    const b = await store.cancel(req.params.code, req.body?.email);
    if (!b) return res.status(404).json({ error: 'Reserva no encontrada.' });
    const cancelled = cancellation ? await store.update(b.code, { cancellation }) : b;
    notify('bookingCancelled', cancelled);
    res.json(publicBooking(cancelled));
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const store = await createStore({ file: join(root, 'data', 'bookings.json') });
  const app = createApp({ store });
  app.listen(port, () => {
    console.log(process.env.DATABASE_URL ? 'Reservas en PostgreSQL.' : 'Reservas en data/bookings.json (se pierden si el disco no es permanente).');
    console.log(`DíasLibres en http://localhost:${port}`);
    if (!process.env.ANTHROPIC_API_KEY) console.log('Sin ANTHROPIC_API_KEY: la búsqueda con IA usa el intérprete local.');
    if (process.env.LITEAPI_KEY?.trim()) console.log(`Hoteles con datos reales de LiteAPI${process.env.LITEAPI_KEY.trim().replace(/^["']/, '').startsWith('sand_') ? ' (entorno de pruebas)' : ''}.`);
    else console.log('Sin LITEAPI_KEY: hoteles con precios y disponibilidad simulados.');
    app.locals.refreshDeals(); // las ofertas de vuelos ya preparadas para la primera visita
  });
}
