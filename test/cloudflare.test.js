import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {D1BookingStore} from '../cloudflare/d1-store.js';
import {SqliteMap} from '../cloudflare/sqlite-map.js';
import {Accounts} from '../src/accounts.js';
import {rateLimit} from '../server.js';
function sqlite() {
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../cloudflare/schema.sql',import.meta.url),'utf8'));
  const d1={prepare(sql) { let args=[]; const statement=db.prepare(sql); return {
    bind(...v){args=v;return this;},
    async first(){return statement.get(...args)||null;},
    async all(){return {results:statement.all(...args)};},
    async run(){return statement.run(...args);}
  };}};
  const sql={exec(query,...args) { const s=db.prepare(query); const rows=s.columns().length ? s.all(...args) : (s.run(...args),[]); return {toArray:()=>rows,[Symbol.iterator]:()=>rows[Symbol.iterator]()}; }};
  return {db,d1,sql};
}
test('D1 conserva pagos, cambios parciales, cancelaciones, sesiones y métricas',async()=>{
  const {d1,db}=sqlite(); const store=new D1BookingStore(d1);
  await store.add({code:'DL-A',email:'Ana@Test.com',status:'pendiente_pago',checkoutId:'pay1',total:120});
  await assert.rejects(store.add({code:'DL-B',email:'b@test.com',status:'pendiente_pago',checkoutId:'pay1'}));
  assert.equal((await store.findByCheckout('pay1')).total,120);
  await Promise.all([store.update('DL-A',{status:'confirmada',providerBookingId:'bk1'}),store.update('DL-A',{note:null,preferences:{bed:'double'}})]);
  const saved=await store.get('DL-A'); assert.equal(saved.status,'confirmada');assert.equal(saved.providerBookingId,'bk1');assert.equal(saved.note,null);assert.deepEqual(saved.preferences,{bed:'double'});
  assert.equal((await store.listByEmail('ANA@test.com')).length,1);
  assert.equal(await store.cancel('DL-A','wrong@test.com'),null);
  assert.equal((await store.cancel('DL-A','ana@test.com')).status,'cancelada');
  assert.equal(await store.cancel('DL-A','ana@test.com'),null);
  await store.kvSet('user:a',{name:'Ana'});await store.kvSet('user_%:a',{name:'Literal'});
  assert.deepEqual(await store.kvList('user_%:'),[['user_%:a',{name:'Literal'}]]);
  await Promise.all(Array.from({length:10},()=>store.recordMetric('2026-10-27','search')));
  assert.equal((await store.listMetrics('2026-10-27','2026-10-27'))[0].count,10);
  assert.equal((await new D1BookingStore(d1).get('DL-A')).status,'cancelada'); db.close();
});
test('D1 canjea una sola vez el enlace de acceso aunque lleguen dos peticiones a la vez',async()=>{
  const {d1,db}=sqlite();const store=new D1BookingStore(d1);
  const accounts=new Accounts({store,mailer:{enabled:true,loginLink:async()=>({sent:true})}});
  const {url}=await accounts.sendLoginLink({email:'ana@test.com',site:'https://example.com'});
  const token=new URL(url).searchParams.get('login');
  const outcomes=await Promise.allSettled([accounts.verifyLoginLink(token),accounts.verifyLoginLink(token)]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);db.close();
});
test('los hoteles y las ofertas sobreviven a reconstruir las cachés, con orden y límite',()=>{
  const {sql,db}=sqlite();let offers=new SqliteMap(sql,'offers',2);
  offers.set('a',{at:1,trip:{total:90}}).set('b',{at:2,trip:{total:110}});
  offers=new SqliteMap(sql,'offers',2);assert.equal(offers.get('a').trip.total,90);
  offers.set('c',{at:3});assert.equal(offers.has('a'),false);assert.deepEqual([...offers.keys()],['b','c']);
  offers.delete('b');offers.set('b',{at:4});assert.deepEqual([...offers.keys()],['c','b']);
  assert.equal(new SqliteMap(sql,'hotels').size,0); db.close();
});
test('los límites por IP sobreviven a reiniciar la instancia',()=>{
  const {sql,db}=sqlite();const options={max:1,windowMs:60000};let status;
  const response={status(s){status=s;return this;},json(){}};
  const first=rateLimit({...options,storage:new SqliteMap(sql,'limit')});
  let allowed=0;first({ip:'1.2.3.4'},response,()=>allowed++);
  const restarted=rateLimit({...options,storage:new SqliteMap(sql,'limit')});
  restarted({ip:'1.2.3.4'},response,()=>allowed++);assert.equal(allowed,1);assert.equal(status,429);db.close();
});

test('la instantánea migra fielmente nombres, apóstrofes, cuentas y datos de pagos a SQLite',async()=>{
  const {snapshotSql,digest}=await import('../cloudflare/snapshot.js');
  const {db,d1}=sqlite();
  const bookings=[{code:'DL-QUOTE',email:'ana@example.com',name:"D'Ávila'; DROP TABLE kv; --",status:'pendiente_pago',checkoutId:'pending-1',transactionId:'keep-this',total:125.75,extra:null}];
  const kv=[['user:ana@example.com',{name:'Ana Ávila',history:[]}],['sess:hash',{email:'ana@example.com',exp:123}]];
  const metrics=[{day:'2026-10-27',event:'search',count:3}];
  db.exec(snapshotSql(readFileSync(new URL('../cloudflare/schema.sql',import.meta.url),'utf8'),{bookings,kv,metrics}));
  const store=new D1BookingStore(d1);
  assert.equal(digest(await store.all()),digest(bookings));
  assert.equal(digest((await store.kvList('')).sort((a,b)=>a[0]<b[0]?-1:1)),digest([...kv].sort((a,b)=>a[0]<b[0]?-1:1)));
  assert.equal((await store.findByCheckout('pending-1')).transactionId,'keep-this');
  assert.equal((await store.listMetrics('2026-10-27','2026-10-27'))[0].count,3);db.close();
});
