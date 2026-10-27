import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeWorkersAiSearch,WORKERS_AI_MODEL} from '../cloudflare/ai-search.js';
import {createApp} from '../server.js';
import {BookingStore} from '../src/store.js';
const filters=(patch={})=>({kind:'hotel',destination:'Madrid',origin:null,checkIn:null,nights:2,maxPrice:100,minStars:null,adults:2,tags:[],fac:[],board:null,stay:null,stops:null,sort:'price',explanation:'Busco hoteles para dos personas.',...patch});
test('Workers AI solicita JSON Schema en el idioma elegido y normaliza los filtros',async()=>{
  const calls=[];
  const search=makeWorkersAiSearch({run:async(model,input)=>{calls.push({model,input});return {response:filters({nights:90})};}});
  const result=await search('hôtel à Madrid','fr');
  assert.equal(result.source,'workers-ai');assert.equal(result.nights,30);assert.equal(result.destination,'Madrid');
  assert.equal(calls[0].model,WORKERS_AI_MODEL);assert.equal(calls[0].input.response_format.type,'json_schema');
  assert.match(calls[0].input.messages[0].content,/Français/);assert.equal(calls[0].input.messages[1].content,'hôtel à Madrid');
});
test('Workers AI también acepta el objeto codificado como JSON y acota la petición',async()=>{
  let content;
  const search=makeWorkersAiSearch({run:async(_model,input)=>{content=input.messages[1].content;return {response:JSON.stringify(filters({kind:'flight',origin:'MAD',destination:'HAV',stops:'0'}))};}});
  const result=await search('a'.repeat(700));assert.equal(content.length,500);assert.equal(result.kind,'flight');assert.equal(result.destination,'HAV');assert.equal(result.stops,'0');
});
test('salidas inválidas y errores del modelo usan la alternativa sin atribuirla a Workers AI',async()=>{
  for(const response of ['invalid',null,[],{kind:'hotel'},filters({destination:{bad:true}}),filters({fac:['__proto__']})]) {
    const result=await makeWorkersAiSearch({run:async()=>({response})},{fallback:async(query,lang)=>({source:'local',query,lang})})('hotel en Madrid','unknown');
    assert.equal(result.source,'local');assert.equal(result.lang,'es');
  }
  const failed=await makeWorkersAiSearch({run:async()=>{throw Error('unavailable');}},{fallback:async()=>({source:'local'})})('hotel');
  assert.equal(failed.source,'local');
  await assert.rejects(makeWorkersAiSearch({run:async()=>{throw Error('must not run');}})(''),/Escribe/);
});
test('la ruta existente de búsqueda integra Workers AI y conserva el límite por IP',async()=>{
  const searchAi=makeWorkersAiSearch({run:async()=>({response:filters()})});
  const app=createApp({store:new BookingStore(null),live:null,osm:null,searchAi,limits:{aiSearch:1,checkout:20,demoBooking:20,windowMs:60000}});
  const server=app.listen(0);await new Promise(r=>server.once('listening',r));
  const url=`http://localhost:${server.address().port}/api/ai-search`;
  const call=()=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'hotel en Madrid'})});
  try {const response=await call();assert.equal(response.status,200);assert.equal((await response.json()).source,'workers-ai');assert.equal((await call()).status,429);}finally{server.close();}
});
