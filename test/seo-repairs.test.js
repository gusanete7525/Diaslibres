import {test} from 'node:test';
import {request} from 'node:http';
import assert from 'node:assert/strict';
import {createApp} from '../server.js';
import {BookingStore} from '../src/store.js';
import {CITIES,cityKey,cityStats} from '../src/seo.js';
test('HTTP del dominio canónico redirige a HTTPS conservando ruta y query',async()=>{
 const previous=process.env.SITE_URL;process.env.SITE_URL='https://diaslibre.com';
 const server=createApp({store:new BookingStore(null),osm:null,live:null}).listen(0);
 await new Promise(r=>server.once('listening',r));
 try{
  const url=`http://127.0.0.1:${server.address().port}/legal.html?from=footer`;
  const r=await new Promise((resolve,reject)=>{const req=request(url,{headers:{Host:'diaslibre.com'}},res=>{res.resume();resolve(res);});req.on('error',reject);req.end();});
  assert.equal(r.statusCode,301);assert.equal(r.headers.location,'https://diaslibre.com/legal.html?from=footer');
 }finally{if(previous===undefined)delete process.env.SITE_URL;else process.env.SITE_URL=previous;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('estadísticas geográficas antiguas no vuelven a mostrar hoteles del país erróneo',async()=>{
 const store=new BookingStore(null),city=CITIES.find(c=>c.es==='Cuenca');
 const hotel={id:'test',name:'Hotel verificado España',stars:4,rating:9,reviewCount:10,facilities:[],tags:[],stay:'hotel',photo:null};
 await store.kvSet('seo:'+cityKey(city),{...cityStats([{...hotel,name:'HOTEL ECUADOR ERRONEO'}]),geoVersion:1});
 const live={sandbox:true,hotels:async(name,options)=>{assert.equal(name,'Cuenca');assert.equal(options.country,'ES');return [hotel];}};
 const app=createApp({store,osm:null,live}),server=app.listen(0);await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.doesNotMatch(await fetch(base+'/hoteles/cuenca').then(r=>r.text()),/HOTEL ECUADOR ERRONEO/);
  await app.locals.statsTick();
  assert.match(await fetch(base+'/hoteles/cuenca').then(r=>r.text()),/Hotel verificado España/);
  assert.equal((await store.kvGet('seo:'+cityKey(city))).geoVersion,2);
  const route=await fetch(base+'/vuelos/madrid-barcelona').then(r=>r.text());
  assert.match(route,/MAD/);assert.match(route,/BCN/);assert.match(route,/Alternativa en tren/);assert.match(route,/150 min/);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
