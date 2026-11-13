import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.js';
import {BookingStore} from '../src/store.js';
import {cityStats} from '../src/seo.js';
import {LiteApi} from '../src/liteapi.js';

async function withServer(fn){
 const server=createApp({store:new BookingStore(null),osm:null,live:null}).listen(0);
 await new Promise(r=>server.once('listening',r));
 try{await fn(`http://127.0.0.1:${server.address().port}`);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}

test('la marca DíasLibres no se traduce en ningún idioma',async()=>withServer(async base=>{
 for(const path of ['/','/en/','/de/']){
  const html=await fetch(base+path).then(r=>r.text());
  assert.match(html,/translate="no">Días<span>Libres<\/span>/,path);
  assert.match(html,/footer-brand" translate="no">DíasLibres</,path);
  assert.doesNotMatch(html,/DaysLibres|>Days<span>/,path);
 }
}));

test('una dirección que no existe da 404 con la marca y enlaces, en su idioma',async()=>withServer(async base=>{
 let r=await fetch(base+'/pagina-que-no-existe',{headers:{Accept:'text/html'}});
 assert.equal(r.status,404);
 let html=await r.text();
 assert.match(html,/<title>Página no encontrada · DíasLibres<\/title>/);
 assert.match(html,/href="\/hoteles"/);assert.match(html,/noindex/);
 r=await fetch(base+'/en/does-not-exist',{headers:{Accept:'text/html'}});
 assert.equal(r.status,404);
 html=await r.text();
 assert.match(html,/<html lang="en">/);assert.match(html,/Page not found/);assert.match(html,/href="\/en\/hotels"/);
 r=await fetch(base+'/api/no-existe');
 assert.equal(r.status,404);assert.equal(typeof (await r.json()).error,'string');
}));

test('los mejor valorados de una ciudad no incluyen alojamientos de otra ciudad',()=>{
 const h=(name,lat,lng,rating)=>({name,lat,lng,rating,reviewCount:500,stars:3,facilities:[],tags:[],stay:'hotel'});
 const madrid=[1,2,3,4,5,6].map(i=>h('Madrid '+i,40.42+i*0.01,-3.70,8));
 const s=cityStats([...madrid,h('T-Homes - Cuenca',40.07,-2.13,10)]);
 assert.equal(s.total,7);
 assert.ok(!s.top.some(x=>x.name.includes('Cuenca')));
 assert.equal(s.top.length,6);
});

test('las peticiones de fondo (escapadas) no dejan sin precios al calendario',async()=>{
 const order=[];let release;const gate=new Promise(r=>release=r);
 const fetchImpl=async(url,opts)=>{
  const u=String(url);
  if(u.includes('/data/hotels'))return Response.json({data:[{id:'h1',name:'Hotel',city:'Madrid',country:'es'}]});
  order.push(u.endsWith('/min-rates')?'calendario':JSON.parse(opts.body).checkin);
  if(order.length<=3)await gate;
  return Response.json({data:[]});
 };
 const live=new LiteApi({key:'sand_test',fetchImpl});
 const [hotel]=await live.hotels('Madrid');
 const quote=(checkIn,priority)=>live.quote({itemId:hotel.id,checkIn,checkOut:'2027-01-20',priority}).catch(()=>{});
 // Dos presupuestos normales llenan los 3 huecos (2 peticiones cada uno); luego llegan uno de fondo y el calendario.
 const busy=[quote('2027-01-10'),quote('2027-01-11')];
 await new Promise(r=>setTimeout(r,5));
 const bg=quote('2027-01-12','background');
 const cal=live.nightlyPrices([hotel.id],'2027-01-15',1);
 await new Promise(r=>setTimeout(r,5));
 release();
 await Promise.all([...busy,bg,cal]);
 const i=order.indexOf('calendario'),j=order.indexOf('2027-01-12');
 assert.ok(i>=0&&j>=0&&i<j,JSON.stringify(order));
});

test('una petición de fondo que lleva más de 3 s esperando pasa delante del calendario',async()=>{
 const order=[];let release;const gate=new Promise(r=>release=r);
 const fetchImpl=async(url,opts)=>{
  const u=String(url);
  if(u.includes('/data/hotels'))return Response.json({data:[{id:'h1',name:'Hotel',city:'Madrid',country:'es'}]});
  order.push(u.endsWith('/min-rates')?'calendario':JSON.parse(opts.body).checkin);
  if(order.length<=3)await gate;
  return Response.json({data:[]});
 };
 const live=new LiteApi({key:'sand_test',fetchImpl});
 const [hotel]=await live.hotels('Madrid');
 const quote=(checkIn,priority)=>live.quote({itemId:hotel.id,checkIn,checkOut:'2027-01-20',priority}).catch(()=>{});
 const busy=[quote('2027-01-10'),quote('2027-01-11')];
 await new Promise(r=>setTimeout(r,5));
 const bg=quote('2027-01-12','background');
 const cal=live.nightlyPrices([hotel.id],'2027-01-15',1);
 await new Promise(r=>setTimeout(r,5));
 const now=Date.now;Date.now=()=>now()+4000;
 try{release();await Promise.all([...busy,bg,cal]);}finally{Date.now=now;}
 const i=order.indexOf('calendario'),j=order.indexOf('2027-01-12');
 assert.ok(i>=0&&j>=0&&j<i,JSON.stringify(order));
});
