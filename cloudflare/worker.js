import { DurableObject } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { createApp, rateLimit } from '../server.js';
import { LiteApi } from '../src/liteapi.js';
import { Accounts } from '../src/accounts.js';
import { Mailer } from '../src/mail.js';
import { OsmHotels } from '../src/osm.js';
import { D1BookingStore } from './d1-store.js';
import {makeWorkersAiSearch} from './ai-search.js';
import { SqliteMap } from './sqlite-map.js';
import indexHtml from '../public/index.html';

// One stateful coordinator keeps provider concurrency limits and payment locks in one place.
// Durable caches persist hotel IDs/offers; D1 persists bookings, accounts and sessions.
export class DiasLibresApp extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    const store=new D1BookingStore(env.DB);
    const sql=ctx.storage.sql;
    if(env.MIGRATION_READ_ONLY === '0' && !env.LITEAPI_KEY) throw new Error('Falta la conexión con el proveedor.');
    const live=env.LITEAPI_KEY ? new LiteApi({key:env.LITEAPI_KEY}) : null;
    if(live) for(const name of ['places','details','hotelsById','prices','offers']) live[name]=new SqliteMap(sql,'liteapi:'+name);
    const mailer=new Mailer();
    const accounts=new Accounts({store,mailer});
    accounts.ipHits=new SqliteMap(sql,'login-ip',5000);
    const limiterFactory=options=>rateLimit({...options,storage:new SqliteMap(sql,'rate:'+JSON.stringify(options),5000)});
    const app=createApp({store,live,mailer,accounts,osm:env.DIASLIBRES_OSM === 'off' ? null : new OsmHotels(),indexHtml,serveStatic:false,reconcileEveryMs:0,
      backgroundTask:promise=>ctx.waitUntil(promise),searchAi:makeWorkersAiSearch(env.AI,{model:env.WORKERS_AI_MODEL}),limiterFactory,lookupFailures:new SqliteMap(sql,'lookup-fails',5000)});
    this.app=app;
    this.env=env;
    this.handler=httpServerHandler(app.listen(8080));
  }
  async fetch(request) {
    // Staging reads/cotizaciones work, but it must not create/cancel real reservations or send emails.
    if(this.env.MIGRATION_READ_ONLY !== '0' && !['GET','HEAD'].includes(request.method)) {
      const safe=new Set(['/api/ai-search','/api/quote','/api/flights/quote']);
      if(!safe.has(new URL(request.url).pathname)) return Response.json({error:'Las reservas aún no están habilitadas en esta dirección.'},{status:503});
    }
    return this.handler.fetch(request,this.env,this.ctx);
  }
  async maintenance() {
    // Reconciliation stays disabled until the source has been paused and the final snapshot imported.
    if(this.env.MIGRATION_READ_ONLY !== '0') return;
    await this.app.locals.reconcilePending();
    await this.app.locals.statsTick();
    await this.app.locals.submitIndexNow();
  }
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(['GET','HEAD'].includes(request.method) && /\.(?:css|js|png|jpe?g|svg|ico|webmanifest|woff2?|html)$/.test(url.pathname)) {
      const response=await env.ASSETS.fetch(request);
      if(response.status!==404) return response;
    }
    const headers=new Headers(request.headers);
    headers.set('X-Forwarded-For',request.headers.get('CF-Connecting-IP') || '127.0.0.1');
    headers.set('X-Forwarded-Proto',url.protocol.slice(0,-1));
    const response=await env.APP.getByName('diaslibres').fetch(new Request(request,{headers}));
    if(env.MIGRATION_READ_ONLY === '0') return response;
    const result=new Response(response.body,response);
    result.headers.set('X-Robots-Tag','noindex, nofollow');
    result.headers.set('Cache-Control','no-store');
    return result;
  },
  scheduled(_controller,env,ctx) { ctx.waitUntil(env.APP.getByName('diaslibres').maintenance()); }
};
