import express from 'express';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { BookingStore, PgBookingStore, createStore } from './src/store.js';
import { searchHotels, searchFlights, quote, todayISO, addDays, isISODate } from './src/availability.js';
import { aiSearch } from './src/ai.js';
import { AIRPORTS } from './src/catalog.js';
import { OsmHotels } from './src/osm.js';
import { LiteApi, PriceChangedError, PaymentPendingError } from './src/liteapi.js';

const root = dirname(fileURLToPath(import.meta.url));

export function createApp({
  store = new BookingStore(join(root, 'data', 'bookings.json')),
  osm = process.env.DIASLIBRES_OSM === 'off' ? null : new OsmHotels({ file: join(root, 'data', 'osm-cache.json') }),
  live = process.env.LITEAPI_KEY?.trim() ? new LiteApi({ key: process.env.LITEAPI_KEY }) : null,
  // 'customer': paga el cliente con su tarjeta (pasarela de LiteAPI). 'account': se
  // carga a la cuenta de LiteAPI del titular de la clave.
  livePayment = process.env.LITEAPI_PAYMENT === 'account' ? 'account' : 'customer',
} = {}) {
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
      res.json({ start, days: LIVE_DAYS, nights: Math.max(1, Math.min(30, Number(q.nights) || 3)), results, live: { sandbox: live.sandbox, city, bookingEnabled: liveBookingEnabled, payment: livePayment } });
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
      res.json({ start, days, prices: await live.nightlyPrices(ids, start, days) });
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
    res.json(searchFlights(await store.all(), req.query));
  });

  app.get('/api/airports', (_req, res) => res.json(AIRPORTS));
  app.get('/api/health', (_req, res) => res.json({ ok: true, live: !!live, sandbox: live?.sandbox ?? null, storage: store instanceof PgBookingStore ? 'postgres' : 'file', payment: live ? livePayment : null, lastLiteApiError: live?.lastError ?? null }));

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
        status: 'pendiente_pago',
        provider: 'liteapi',
        sandbox: live.sandbox,
        refundable: q.refundable,
        freeCancellationUntil: q.freeCancellationUntil,
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
      res.json(publicBooking(done));
    } catch (err) {
      console.error('[liteapi]', err.message);
      if (err instanceof PaymentPendingError) return res.status(402).json({ error: 'El pago no se ha completado. No se ha hecho ningún cargo ni reserva.' });
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
          status: 'confirmada',
          provider: 'liteapi',
          providerBookingId: b.bookingId,
          sandbox: live.sandbox,
          refundable: q.refundable,
          freeCancellationUntil: q.freeCancellationUntil,
          roomName: q.roomName,
          createdAt: new Date().toISOString(),
        });
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
      res.status(201).json(booking);
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  });

  app.get('/api/bookings', async (req, res) => {
    const email = String(req.query.email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'Indica tu email.' });
    res.json((await store.listByEmail(email)).filter((b) => b.status !== 'pendiente_pago').map(publicBooking));
  });

  app.post('/api/bookings/:code/cancel', async (req, res) => {
    const email = String(req.body?.email || '').toLowerCase();
    const found = await store.get(req.params.code);
    if (!found || found.email.toLowerCase() !== email || found.status !== 'confirmada') return res.status(404).json({ error: 'Reserva no encontrada.' });
    let cancellation;
    if (found.provider === 'liteapi') {
      if (!live) return res.status(503).json({ error: 'No se puede cancelar ahora: falta la conexión con LiteAPI.' });
      try {
        cancellation = await live.cancel(found.providerBookingId);
      } catch (err) {
        return res.status(502).json({ error: 'LiteAPI no ha aceptado la cancelación: ' + err.message });
      }
    }
    const b = await store.cancel(req.params.code, req.body?.email);
    if (!b) return res.status(404).json({ error: 'Reserva no encontrada.' });
    res.json(publicBooking(cancellation ? await store.update(b.code, { cancellation }) : b));
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const store = await createStore({ file: join(root, 'data', 'bookings.json') });
  createApp({ store }).listen(port, () => {
    console.log(process.env.DATABASE_URL ? 'Reservas en PostgreSQL.' : 'Reservas en data/bookings.json (se pierden si el disco no es permanente).');
    console.log(`DíasLibres en http://localhost:${port}`);
    if (!process.env.ANTHROPIC_API_KEY) console.log('Sin ANTHROPIC_API_KEY: la búsqueda con IA usa el intérprete local.');
    if (process.env.LITEAPI_KEY?.trim()) console.log(`Hoteles con datos reales de LiteAPI${process.env.LITEAPI_KEY.trim().replace(/^["']/, '').startsWith('sand_') ? ' (entorno de pruebas)' : ''}.`);
    else console.log('Sin LITEAPI_KEY: hoteles con precios y disponibilidad simulados.');
  });
}
