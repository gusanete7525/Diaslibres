// Builds an isolated staging copy. Does not modify DNS, stop the VPS or enable bookings.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {cf,ACCOUNT} from './cloudflare-api.mjs';
const run=(command,args)=>{
  const result=spawnSync(command,args,{stdio:'inherit'});
  if(result.error) throw result.error;
  if(result.status!==0) throw new Error('Paso detenido: '+command+' '+args.join(' '));
};
const wrangler=(...args)=>run('npx',['--yes','wrangler@4.153.0',...args,'--config','cloudflare/wrangler.local.json']);
// Fail before provisioning if credentials needed to preserve production behavior are missing.
for(const key of ['DATABASE_URL','LITEAPI_KEY','RESEND_API_KEY']) if(!process.env[key]?.trim()) throw new Error('Falta '+key+' en el entorno del VPS.');
run('npm',['test']);
run(process.execPath,['scripts/prepare-cloudflare.mjs']);
const stateFile='cloudflare/.migration-state.json';
const state=JSON.parse(readFileSync(stateFile,'utf8'));
state.snapshot ||= '/opt/backups/diaslibres-cloudflare/snapshot-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sql';
writeFileSync(stateFile,JSON.stringify(state,null,2)+'\n',{mode:0o600});
if(!existsSync(state.snapshot+'.json')) run(process.execPath,['scripts/export-cloudflare.mjs',state.snapshot]);
wrangler('d1','execute','diaslibres-migracion','--remote','--file','cloudflare/schema.sql');
const results=await cf(`accounts/${ACCOUNT}/d1/database/${state.database}/query`,{sql:'SELECT (SELECT count(*) FROM bookings)+(SELECT count(*) FROM kv)+(SELECT count(*) FROM metric_counts) AS n'});
if(!results[0]?.success) throw new Error('No se pudo comprobar la base D1.');
if(results[0].results[0].n===0) wrangler('d1','execute','diaslibres-migracion','--remote','--file',resolve(state.snapshot));
// If resuming a partial import, stop on a content mismatch instead of deleting or overwriting records.
run(process.execPath,['scripts/verify-cloudflare.mjs',state.snapshot+'.json']);
wrangler('deploy');
run(process.execPath,['scripts/cloudflare-secrets.mjs']);
const config=JSON.parse(readFileSync('cloudflare/wrangler.local.json','utf8'));
const base=config.vars.SITE_URL;
const health=await fetch(base+'/api/health').then(r=>{if(!r.ok) throw new Error('El Worker no está disponible: '+r.status);return r.json();});
console.log('Estado del Worker:',health);
if(!health.ok || !health.live || health.storage!=='d1' || !health.mail.enabled) throw new Error('La configuración aún no coincide con producción.');
const expectedSandbox=process.env.LITEAPI_KEY.trim().replace(/^["']|["']$/g,'').startsWith('sand_');
if(health.sandbox!==expectedSandbox) throw new Error('El modo de pruebas no coincide con el VPS.');
const blocked=await fetch(base+'/api/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
if(blocked.status!==503) throw new Error('El bloqueo temporal de reservas no está activo.');
const response=await fetch(base+'/api/ai-search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'Busco hotel en Madrid para dos adultos'})});
const ai=await response.json();
console.log('IA:',{status:response.status,source:ai.source});
if(!response.ok || ai.source!=='workers-ai') throw new Error('Workers AI no respondió correctamente; hay que revisarlo antes de migrar el dominio.');
console.log('STAGING PREPARADO:',base);
console.log('El dominio, el servicio VPS y los pagos de producción no se han modificado.');
