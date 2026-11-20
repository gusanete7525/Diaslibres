// Synchronous Map interface backed by a Durable Object's SQLite storage.
// Hotel IDs, flight offers and rate limits survive eviction of the Worker instance.
export class SqliteMap {
  constructor(sql,namespace,limit=60000) {
    this.sql=sql; this.namespace=namespace; this.limit=limit;
    sql.exec('CREATE TABLE IF NOT EXISTS cache_entries(seq INTEGER PRIMARY KEY AUTOINCREMENT,namespace TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,UNIQUE(namespace,key))');
  }
  get size() { return this.sql.exec('SELECT count(*) AS n FROM cache_entries WHERE namespace=?',this.namespace).toArray()[0].n; }
  get(key) { const r=this.sql.exec('SELECT value FROM cache_entries WHERE namespace=? AND key=?',this.namespace,String(key)).toArray()[0]; return r ? JSON.parse(r.value) : undefined; }
  has(key) { return this.get(key) !== undefined; }
  set(key,value) {
    this.sql.exec('INSERT INTO cache_entries(namespace,key,value) VALUES(?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value',this.namespace,String(key),JSON.stringify(value));
    const extra=this.size-this.limit;
    if(extra>0) this.sql.exec('DELETE FROM cache_entries WHERE seq IN (SELECT seq FROM cache_entries WHERE namespace=? ORDER BY seq LIMIT ?)',this.namespace,extra);
    return this;
  }
  delete(key) { const had=this.has(key); this.sql.exec('DELETE FROM cache_entries WHERE namespace=? AND key=?',this.namespace,String(key)); return had; }
  clear() { this.sql.exec('DELETE FROM cache_entries WHERE namespace=?',this.namespace); }
  *entries() { for(const r of this.sql.exec('SELECT key,value FROM cache_entries WHERE namespace=? ORDER BY seq',this.namespace)) yield [r.key,JSON.parse(r.value)]; }
  *keys() { for(const r of this.sql.exec('SELECT key FROM cache_entries WHERE namespace=? ORDER BY seq',this.namespace)) yield r.key; }
  *values() { for(const [,value] of this.entries()) yield value; }
  [Symbol.iterator]() { return this.entries(); }
}
