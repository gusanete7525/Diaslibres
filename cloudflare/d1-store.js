// D1 is the durable source of truth. Never fall back to an in-memory booking store.
const decode = row => row ? JSON.parse(row.data) : null;
export class D1BookingStore {
  kind = 'd1';
  constructor(db) {
    if (!db?.prepare) throw new Error('Falta el enlace D1 de reservas.');
    this.db = db;
  }
  async all() { return (await this.db.prepare('SELECT data FROM bookings ORDER BY created_at,code').all()).results.map(decode); }
  async add(b) {
    await this.db.prepare('INSERT INTO bookings(code,email,status,checkout_id,created_at,data) VALUES(?,?,?,?,?,?)')
      .bind(b.code,b.email,b.status,b.checkoutId || null,b.createdAt || new Date().toISOString(),JSON.stringify(b)).run();
    return structuredClone(b);
  }
  async get(code) { return decode(await this.db.prepare('SELECT data FROM bookings WHERE code=?').bind(code).first()); }
  async findByCheckout(id) { return decode(await this.db.prepare('SELECT data FROM bookings WHERE checkout_id=?').bind(id).first()); }
  async update(code, patch) {
    const pairs = Object.entries(patch).filter(([,v])=>v !== undefined);
    if (!pairs.length) return this.get(code);
    const expression = 'json_set(data,' + pairs.map(()=> '?,json(?)').join(',') + ')';
    const values = pairs.flatMap(([k,v])=>['$.'+JSON.stringify(k),JSON.stringify(v)]);
    // Patch in SQL: concurrent changes to different fields cannot overwrite one another.
    const set = ['data='+expression];
    if (Object.hasOwn(patch,'status')) { set.push('status=?'); values.push(patch.status); }
    if (Object.hasOwn(patch,'checkoutId')) { set.push('checkout_id=?'); values.push(patch.checkoutId); }
    return decode(await this.db.prepare(`UPDATE bookings SET ${set.join(',')} WHERE code=? RETURNING data`).bind(...values,code).first());
  }
  async listByEmail(email) {
    return (await this.db.prepare('SELECT data FROM bookings WHERE lower(email)=lower(?) ORDER BY created_at DESC,code DESC').bind(email).all()).results.map(decode);
  }
  async cancel(code,email) {
    return decode(await this.db.prepare(`UPDATE bookings SET status='cancelada',data=json_set(data,'$.status','cancelada') WHERE code=? AND lower(email)=lower(?) AND status='confirmada' RETURNING data`).bind(code,email).first());
  }
  async kvSet(key,value) { await this.db.prepare('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(value)).run(); }
  async kvGet(key) { const row=await this.db.prepare('SELECT value FROM kv WHERE key=?').bind(key).first(); return row ? JSON.parse(row.value) : null; }
  async kvDelete(key) { await this.db.prepare('DELETE FROM kv WHERE key=?').bind(key).run(); }
  async kvTake(key) { const row=await this.db.prepare('DELETE FROM kv WHERE key=? RETURNING value').bind(key).first(); return row ? JSON.parse(row.value) : null; }
  async kvList(prefix) {
    return (await this.db.prepare('SELECT key,value FROM kv WHERE substr(key,1,length(?))=? ORDER BY key').bind(prefix,prefix).all()).results.map(r=>[r.key,JSON.parse(r.value)]);
  }
  async recordMetric(day,event) { await this.db.prepare('INSERT INTO metric_counts(day,event,count) VALUES(?,?,1) ON CONFLICT(day,event) DO UPDATE SET count=count+1').bind(day,event).run(); }
  async listMetrics(start,end) { return (await this.db.prepare('SELECT day,event,count FROM metric_counts WHERE day>=? AND day<=? ORDER BY day,event').bind(start,end).all()).results; }
}
