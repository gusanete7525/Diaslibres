import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LiteApi} from '../src/liteapi.js';
test('Cuenca ES y Cuenca Ecuador usan países y cachés distintos, sin elegir la primera localidad',async()=>{
 const calls=[];
 const live=new LiteApi({key:'sand_test',fetchImpl:async url=>{
  const u=new URL(url); calls.push(u);
  assert.equal(u.pathname,'/v3.0/data/hotels');
  assert.equal(u.searchParams.get('cityName'),'Cuenca');
  return Response.json({data:[{id:'EC',name:'Hotel Ecuador',city:'Cuenca',country:'EC'},{id:'ES',name:'Hotel España',city:'Cuenca',country:'ES'}]});
 }});
 assert.deepEqual((await live.hotels('Cuenca')).map(h=>h.name),['Hotel España']);
 assert.deepEqual((await live.hotels('Cuenca, Ecuador')).map(h=>h.name),['Hotel Ecuador']);
 await live.hotels('Cuenca',{country:'ES'});
 assert.equal(calls.length,2);
 assert.deepEqual(calls.map(u=>u.searchParams.get('countryCode')),['ES','EC']);
});

test('destino sin ciudad de catálogo conserva búsqueda geográfica acotada al país',async()=>{
 const calls=[];const live=new LiteApi({key:'sand_test',fetchImpl:async url=>{
 const u=new URL(url);calls.push(u);
 if(u.pathname.endsWith('/places')) {assert.equal(u.searchParams.get('textQuery'),'Formentera, Spain');return Response.json({data:[{placeId:'isla',types:['locality']}]});}
 if(u.searchParams.has('cityName'))return Response.json({data:[]});
 assert.equal(u.searchParams.get('placeId'),'isla');assert.equal(u.searchParams.get('countryCode'),'ES');
 return Response.json({data:[{id:'isla1',name:'Hotel isla',country:'ES'}]});
 }});
 assert.equal((await live.hotels('Formentera',{country:'ES'}))[0].name,'Hotel isla');assert.equal(calls.length,3);
});
