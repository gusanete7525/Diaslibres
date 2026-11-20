import {readFileSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
export const ACCOUNT='99622b5aac09c9cac4c89e04df32916f';
export function oauthToken() {
  // Linux/macOS: ~/.config/.wrangler; Windows: %APPDATA%/xdg.config/.wrangler.
  const file=[join(homedir(),'.config/.wrangler/config/default.toml'),process.env.APPDATA&&join(process.env.APPDATA,'xdg.config/.wrangler/config/default.toml')].find(f=>f&&existsSync(f));
  if(!file) throw new Error('No se encontró la sesión de Wrangler.');
  const text=readFileSync(file,'utf8');
  const match=text.match(/^oauth_token\s*=\s*("(?:[^"\\]|\\.)*")/m);
  if(!match) throw new Error('No se encontró la sesión de Wrangler.');
  return JSON.parse(match[1]);
}
export async function cf(path,body) {
  const r=await fetch('https://api.cloudflare.com/client/v4/'+path,{method:body?'POST':'GET',
    headers:{Authorization:'Bearer '+oauthToken(),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=await r.json();
  if(!r.ok || !data.success) throw new Error(`Cloudflare ${r.status}: `+(data.errors||[]).map(e=>e.message).join('; '));
  return data.result;
}
export {canonical} from '../cloudflare/snapshot.js';
