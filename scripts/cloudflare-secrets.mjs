// Whitelist runtime keys; PostgreSQL credentials and unrelated VPS secrets never leave the server.
import {spawnSync} from 'node:child_process';
const allowed=['LITEAPI_KEY','LITEAPI_URL','LITEAPI_BOOK_URL','LITEAPI_FLIGHTS','LITEAPI_PAYMENT',
 'ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','DIASLIBRES_MODEL',
 'RESEND_API_KEY','MAIL_FROM','ADMIN_EMAIL','GOOGLE_CLIENT_ID','APPLE_CLIENT_ID','MICROSOFT_CLIENT_ID','FACEBOOK_APP_ID',
 'DIASLIBRES_OSM','NOMINATIM_URL','OVERPASS_URL','OSM_USER_AGENT',
 'GOOGLE_SITE_VERIFICATION','INDEXNOW_KEY','ANDROID_PACKAGE','ANDROID_SHA256','RAILEUROPE_URL'];
if(!process.env.LITEAPI_KEY?.trim()) throw new Error('Falta la clave del proveedor.');
if(!process.env.ANTHROPIC_API_KEY?.trim() && !process.env.ANTHROPIC_AUTH_TOKEN?.trim()) throw new Error('Falta la credencial de Claude; no se publicará una IA degradada.');
if(!process.env.RESEND_API_KEY?.trim()) throw new Error('Falta la credencial del correo de reservas.');
const payload=Object.fromEntries(allowed.filter(k=>process.env[k]?.trim()).map(k=>[k,process.env[k]]));
const result=spawnSync('npx',['--yes','wrangler@4.153.0','secret','bulk','--config','cloudflare/wrangler.local.json'],{input:JSON.stringify(payload),stdio:['pipe','inherit','inherit']});
if(result.error) throw result.error;
if(result.status!==0) process.exit(result.status||1);
