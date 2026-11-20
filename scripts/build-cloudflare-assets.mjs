import {cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {minify} from 'terser';
const source=new URL('../public/',import.meta.url);
const target=new URL('../cloudflare/.assets/',import.meta.url);
mkdirSync(target,{recursive:true});
cpSync(source,target,{recursive:true});
const {code}=await minify(readFileSync(new URL('app.js',source),'utf8'),{module:true,compress:{passes:2},mangle:{toplevel:true},format:{comments:false}});
writeFileSync(new URL('app.js',target),code);
