// Run only in the isolated deployment worktree, never in the active VPS checkout.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cf,ACCOUNT} from './cloudflare-api.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const stateFile=join(root,'cloudflare/.migration-state.json');
const configFile=join(root,'cloudflare/wrangler.local.json');
const config=JSON.parse(readFileSync(join(root,'cloudflare/wrangler.jsonc'),'utf8'));
const previous=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):null;
if(previous && previous.account!==ACCOUNT) throw new Error('La cuenta no coincide con el despliegue anterior.');
const workers=await cf(`accounts/${ACCOUNT}/workers/scripts`);
if(workers.some(w=>w.id===config.name) && !previous) throw new Error('Ya existe ese Worker; detenido para evitar sobrescribirlo.');
const databases=await cf(`accounts/${ACCOUNT}/d1/database?per_page=100`);
let db=databases.find(d=>d.name===config.d1_databases[0].database_name);
if(db && db.uuid!==previous?.database) throw new Error('Ya existe esa base D1 y no pertenece a esta preparación.');
if(!db) {
  db=await cf(`accounts/${ACCOUNT}/d1/database`,{name:config.d1_databases[0].database_name});
  writeFileSync(stateFile,JSON.stringify({account:ACCOUNT,database:db.uuid,worker:config.name},null,2)+'\n',{mode:0o600});
}
const subdomain=await cf(`accounts/${ACCOUNT}/workers/subdomain`);
if(!subdomain.subdomain) throw new Error('La cuenta no tiene un subdominio workers.dev configurado.');
config.d1_databases[0].database_id=db.uuid;
config.vars.SITE_URL=`https://${config.name}.${subdomain.subdomain}.workers.dev`;
writeFileSync(configFile,JSON.stringify(config,null,2)+'\n',{mode:0o600});
console.log('Preparado:',config.vars.SITE_URL);
console.log('Base D1:',db.name,db.uuid);
const zones=await cf('zones?name=diaslibre.com');
console.log('Zona del dominio:',zones.map(z=>({name:z.name,status:z.status,id:z.id})));
console.log('El dominio y el servicio VPS no se han modificado.');
