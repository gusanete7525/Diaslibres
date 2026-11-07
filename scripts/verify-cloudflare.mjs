import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cf,ACCOUNT,canonical} from './cloudflare-api.mjs';
const config=JSON.parse(readFileSync(new URL('../cloudflare/wrangler.local.json',import.meta.url),'utf8'));
const manifest=JSON.parse(readFileSync(process.argv[2],'utf8'));
const db=config.d1_databases[0].database_id;
const query=async(sql,params=[])=>{
  const result=await cf(`accounts/${ACCOUNT}/d1/database/${db}/query`,{sql,params});
  if(!result.every(r=>r.success)) throw new Error('D1 no pudo consultar los datos.');
  return result[0].results;
};
async function pages(table,key,columns) {
  let after='',rows=[];
  while(true) {
    const page=await query(`SELECT ${columns} FROM ${table} WHERE ${key}>? ORDER BY ${key} LIMIT 200`,[after]);
    rows.push(...page);if(page.length<200) return rows;after=page.at(-1)[key];
  }
}
const data={
  bookings:(await pages('bookings','code','code,data')).map(r=>JSON.parse(r.data)),
  kv:(await pages('kv','key','key,value')).map(r=>[r.key,JSON.parse(r.value)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0),
  metrics:await query('SELECT day,event,count FROM metric_counts ORDER BY day,event')
};
for(const [table,rows] of Object.entries(data)) {
  const hash=createHash('sha256').update(JSON.stringify(canonical(rows))).digest('hex');
  if(rows.length!==manifest.tables[table].count || hash!==manifest.tables[table].sha256) throw new Error(`Los datos de ${table} no coinciden con el respaldo.`);
  console.log(table+': '+rows.length+' registros, contenido verificado.');
}
console.log('COPIA VERIFICADA. Las reservas siguen deshabilitadas en el Worker temporal.');
