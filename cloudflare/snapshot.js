import {createHash} from 'node:crypto';
export function canonical(value) {
  if(Array.isArray(value)) return value.map(canonical);
  if(value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export const digest=rows=>createHash('sha256').update(JSON.stringify(canonical(rows))).digest('hex');
const literal=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
export function snapshotSql(schema,{bookings,kv,metrics}) {
  const lines=[schema];
  for(const b of bookings) lines.push(`INSERT INTO bookings(code,email,status,checkout_id,created_at,data) VALUES(${[b.code,b.email,b.status,b.checkoutId||null,b.createdAt||'1970-01-01T00:00:00.000Z',JSON.stringify(b)].map(literal).join(',')});`);
  for(const [k,v] of kv) lines.push(`INSERT INTO kv(key,value) VALUES(${literal(k)},${literal(JSON.stringify(v))});`);
  for(const r of metrics) {
    if(!Number.isSafeInteger(Number(r.count)) || Number(r.count)<0) throw new Error('Contador de métricas inválido.');
    lines.push(`INSERT INTO metric_counts(day,event,count) VALUES(${literal(r.day)},${literal(r.event)},${Number(r.count)});`);
  }
  return lines.join('\n')+'\n';
}
