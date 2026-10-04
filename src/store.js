import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

// Almacenes de reservas con la misma interfaz (todo asíncrono):
//   all(), add(b), get(code), findByCheckout(id), update(code, patch),
//   listByEmail(email), cancel(code, email)
// y, aparte, un pequeño almacén clave → valor: kvSet(key, value), kvGet(key), kvDelete(key), kvList(prefix)
// (p. ej. los datos de cada ciudad para las páginas de buscadores).
// - BookingStore: fichero JSON (o memoria si file es null). Para pruebas y demos.
// - PgBookingStore: PostgreSQL (DATABASE_URL). Las reservas sobreviven a reinicios.

const sameEmail = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

export class BookingStore {
  constructor(file) {
    this.file = file;
    try {
      this.bookings = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      this.bookings = [];
    }
    this.kv = new Map(); // solo en memoria
  }

  async kvSet(key, value) {
    this.kv.set(key, value);
  }

  async kvList(prefix) {
    return [...this.kv].filter(([k]) => k.startsWith(prefix));
  }

  async kvGet(key) {
    return this.kv.has(key) ? structuredClone(this.kv.get(key)) : null;
  }

  async kvDelete(key) {
    this.kv.delete(key);
  }

  async all() {
    return this.bookings;
  }

  async add(booking) {
    this.bookings.push(booking);
    this.#save();
    return booking;
  }

  async get(code) {
    return this.bookings.find((b) => b.code === code) || null;
  }

  async findByCheckout(checkoutId) {
    return this.bookings.find((b) => b.checkoutId && b.checkoutId === checkoutId) || null;
  }

  async update(code, patch) {
    const b = this.bookings.find((x) => x.code === code);
    if (!b) return null;
    Object.assign(b, patch);
    this.#save();
    return b;
  }

  async listByEmail(email) {
    return this.bookings.filter((b) => sameEmail(b.email, email)).reverse();
  }

  async cancel(code, email) {
    const b = this.bookings.find((x) => x.code === code && sameEmail(x.email, email) && x.status === 'confirmada');
    if (!b) return null;
    b.status = 'cancelada';
    this.#save();
    return b;
  }

  #save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.bookings, null, 2));
    renameSync(tmp, this.file);
  }
}

// Una fila por reserva: columnas para buscar y el resto en `data` (jsonb).
export class PgBookingStore {
  constructor(pool) {
    this.pool = pool;
    this.ready = null;
  }

  async #init() {
    this.ready ??= this.pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        code text PRIMARY KEY,
        email text NOT NULL,
        status text NOT NULL,
        checkout_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        data jsonb NOT NULL
      );
      CREATE INDEX IF NOT EXISTS bookings_email ON bookings (lower(email));
      CREATE INDEX IF NOT EXISTS bookings_checkout ON bookings (checkout_id);
      CREATE TABLE IF NOT EXISTS kv (
        key text PRIMARY KEY,
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await this.ready;
  }

  async #q(sql, params) {
    await this.#init();
    return (await this.pool.query(sql, params)).rows.map((r) => r.data);
  }

  async all() {
    return this.#q('SELECT data FROM bookings ORDER BY created_at');
  }

  async add(b) {
    await this.#q('INSERT INTO bookings (code, email, status, checkout_id, data) VALUES ($1, $2, $3, $4, $5) RETURNING data', [
      b.code,
      b.email,
      b.status,
      b.checkoutId || null,
      JSON.stringify(b),
    ]);
    return b;
  }

  async get(code) {
    return (await this.#q('SELECT data FROM bookings WHERE code = $1', [code]))[0] || null;
  }

  async findByCheckout(checkoutId) {
    return (await this.#q('SELECT data FROM bookings WHERE checkout_id = $1', [checkoutId]))[0] || null;
  }

  async update(code, patch) {
    const current = await this.get(code);
    if (!current) return null;
    const next = { ...current, ...patch };
    await this.#q('UPDATE bookings SET status = $2, data = $3 WHERE code = $1 RETURNING data', [code, next.status, JSON.stringify(next)]);
    return next;
  }

  async listByEmail(email) {
    return this.#q('SELECT data FROM bookings WHERE lower(email) = lower($1) ORDER BY created_at DESC', [email]);
  }

  async kvSet(key, value) {
    await this.#init();
    await this.pool.query('INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()', [key, JSON.stringify(value)]);
  }

  async kvGet(key) {
    await this.#init();
    const { rows } = await this.pool.query('SELECT value FROM kv WHERE key = $1', [key]);
    return rows[0]?.value ?? null;
  }

  async kvDelete(key) {
    await this.#init();
    await this.pool.query('DELETE FROM kv WHERE key = $1', [key]);
  }

  async kvList(prefix) {
    await this.#init();
    const { rows } = await this.pool.query("SELECT key, value FROM kv WHERE key LIKE $1 || '%'", [prefix]);
    return rows.map((r) => [r.key, r.value]);
  }

  async cancel(code, email) {
    const b = await this.get(code);
    if (!b || !sameEmail(b.email, email) || b.status !== 'confirmada') return null;
    return this.update(code, { status: 'cancelada' });
  }
}

// Elige el almacén: PostgreSQL si hay DATABASE_URL, si no el fichero.
export async function createStore({ databaseUrl = process.env.DATABASE_URL, file } = {}) {
  if (!databaseUrl) return new BookingStore(file);
  const { default: pg } = await import('pg');
  const local = /localhost|127\.0\.0\.1/.test(databaseUrl);
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
  return new PgBookingStore(pool);
}
