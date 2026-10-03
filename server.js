import express from 'express';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { BookingStore } from './src/store.js';
import { searchHotels, searchFlights, quote } from './src/availability.js';
import { aiSearch } from './src/ai.js';
import { AIRPORTS } from './src/catalog.js';

const root = dirname(fileURLToPath(import.meta.url));

export function createApp({ store = new BookingStore(join(root, 'data', 'bookings.json')) } = {}) {
  const app = express();
  app.use(express.json({ limit: '20kb' }));
  app.use(express.static(join(root, 'public')));

  const list = (v) => (Array.isArray(v) ? v : v ? String(v).split(',') : []);

  app.get('/api/hotels', (req, res) => {
    const q = req.query;
    res.json(searchHotels(store.all(), { ...q, tags: list(q.tags) }));
  });

  app.get('/api/flights', (req, res) => {
    res.json(searchFlights(store.all(), req.query));
  });

  app.get('/api/airports', (_req, res) => res.json(AIRPORTS));

  app.post('/api/ai-search', async (req, res) => {
    try {
      res.json(await aiSearch(req.body?.query));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/quote', (req, res) => {
    try {
      const q = quote(store.all(), req.body || {});
      res.json({ total: q.total, units: q.units, nights: q.nights, perNight: q.perNight });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/bookings', (req, res) => {
    const body = req.body || {};
    const name = String(body.name || '').trim().slice(0, 80);
    const email = String(body.email || '').trim().slice(0, 120);
    if (name.length < 2) return res.status(400).json({ error: 'Indica tu nombre.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email no válido.' });
    try {
      const q = quote(store.all(), body);
      const booking = store.add({
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

  app.get('/api/bookings', (req, res) => {
    const email = String(req.query.email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'Indica tu email.' });
    res.json(store.all().filter((b) => b.email.toLowerCase() === email).reverse());
  });

  app.post('/api/bookings/:code/cancel', (req, res) => {
    const b = store.cancel(req.params.code, req.body?.email);
    if (!b) return res.status(404).json({ error: 'Reserva no encontrada.' });
    res.json(b);
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`DíasLibres en http://localhost:${port}`);
    if (!process.env.ANTHROPIC_API_KEY) console.log('Sin ANTHROPIC_API_KEY: la búsqueda con IA usa el intérprete local.');
  });
}
