CREATE TABLE IF NOT EXISTS bookings (
  code TEXT PRIMARY KEY, email TEXT NOT NULL, status TEXT NOT NULL,
  checkout_id TEXT, created_at TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE INDEX IF NOT EXISTS bookings_email ON bookings(lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS bookings_checkout ON bookings(checkout_id) WHERE checkout_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(json_valid(value)));
CREATE TABLE IF NOT EXISTS metric_counts (
  day TEXT NOT NULL, event TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day,event)
);
