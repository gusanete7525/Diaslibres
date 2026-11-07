import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import pg from 'pg';
import {digest,snapshotSql} from '../cloudflare/snapshot.js';
const output=process.argv[2];
if(!output || !process.env.DATABASE_URL) throw new Error('Indica archivo de salida y DATABASE_URL.');
if(existsSync(output) || existsSync(output+'.json')) throw new Error('El respaldo ya existe; usa otro nombre.');
if(resolve(output).startsWith(resolve('.')+'/')) throw new Error('Guarda el respaldo fuera del repositorio.');
const local=['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.DATABASE_URL).hostname);
const client=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:local?false:{rejectUnauthorized:true}});
await client.connect();
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const bookings=(await client.query('SELECT data FROM bookings ORDER BY code')).rows.map(r=>r.data);
  const kv=(await client.query('SELECT key,value FROM kv ORDER BY key')).rows.map(r=>[r.key,r.value]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  const metrics=(await client.query('SELECT day,event,count FROM metric_counts ORDER BY day,event')).rows;
  const sql=snapshotSql(readFileSync(new URL('../cloudflare/schema.sql',import.meta.url),'utf8'),{bookings,kv,metrics});
  await client.query('COMMIT');
  mkdirSync(dirname(output),{recursive:true,mode:0o700});
  const manifest={version:1,createdAt:new Date().toISOString(),source:'postgres',tables:{bookings:{count:bookings.length,sha256:digest(bookings)},kv:{count:kv.length,sha256:digest(kv)},metrics:{count:metrics.length,sha256:digest(metrics)}}};
  writeFileSync(output,sql,{mode:0o600,flag:'wx'});
  writeFileSync(output+'.json',JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log('Respaldo guardado:',output);console.log('Registros:',Object.fromEntries(Object.entries(manifest.tables).map(([k,v])=>[k,v.count])));
} finally { await client.end(); }
