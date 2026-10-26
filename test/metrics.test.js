import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newDb} from 'pg-mem';
import {BookingStore,PgBookingStore} from '../src/store.js';
import {createApp} from '../server.js';
for(const [name,make] of [['memoria',()=>new BookingStore(null)],['postgres',()=>{const {Pool}=newDb().adapters.createPg();return new PgBookingStore(new Pool());}]])test(`contadores ${name}: incremento concurrente y periodo acotado`,async()=>{
 const store=make();
 await Promise.all(Array.from({length:20},()=>store.recordMetric('2026-10-26','page_view')));
 await store.recordMetric('2026-10-01','search');
 const rows=await store.listMetrics('2026-10-26','2026-10-26');
 assert.equal(rows.length,1);assert.equal(rows[0].count,20);
});
test('medición sin datos personales y estadísticas privadas para el administrador',async()=>{
 const store=new BookingStore(null);
 const accounts={enabled:true,userFromRequest:async req=>req.get('x-test-user')?{email:req.get('x-test-user')}:null};
 const server=createApp({store,osm:null,live:null,accounts}).listen(0);
 await new Promise(r=>server.once('listening',r));const base=`http://localhost:${server.address().port}`;
 const send=body=>fetch(base+'/api/metrics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await send({event:'page_view'})).status,204);
  assert.equal((await send({event:'page_view',email:'private@test.com'})).status,400);
  assert.equal((await send({event:'not-allowed'})).status,400);
  assert.equal((await fetch(base+'/api/metrics',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://evil.test'},body:JSON.stringify({event:'search'})})).status,403);
  assert.equal((await fetch(base+'/api/admin/metrics')).status,401);
  assert.equal((await fetch(base+'/api/admin/metrics',{headers:{'x-test-user':'other@test.com'}})).status,403);
  const report=await fetch(base+'/api/admin/metrics',{headers:{'x-test-user':process.env.ADMIN_EMAIL||'contact@gusansoft.com'}}).then(r=>r.json());
  assert.equal(report.rows.length,1);assert.equal(report.rows[0].count,1);
  assert.equal(JSON.stringify(report).includes('private@test.com'),false);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
