import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {testEnvironment} from '../scripts/test-environment.mjs';
test('el preparador excluye las credenciales y la configuración de producción de los procesos de pruebas',()=>{
  const source={...process.env,SITE_URL:'https://diaslibre.com',PUBLIC_URL:'https://other.example',DATABASE_URL:'postgres://test.invalid/db',LITEAPI_KEY:'fake-not-a-real-key',ANTHROPIC_AUTH_TOKEN:'fake-not-a-real-token',RESEND_API_KEY:'fake-not-a-real-key',NODE_OPTIONS:'--env-file=production.env',NODE_ENV:'production',UNKNOWN_SECRET:'fake'};
  const env=testEnvironment(source);
  for(const key of ['SITE_URL','PUBLIC_URL','DATABASE_URL','LITEAPI_KEY','ANTHROPIC_AUTH_TOKEN','RESEND_API_KEY','NODE_OPTIONS','UNKNOWN_SECRET']) assert.equal(Object.hasOwn(env,key),false,key);
  assert.equal(env.NODE_ENV,'test');assert.equal(env.PATH,source.PATH);
  assert.equal(source.NODE_ENV,'production','el entorno del despliegue no se modifica');
});
test('las comprobaciones SEO pasan aunque el preparador se ejecute con SITE_URL de producción',()=>{
  const result=spawnSync(process.execPath,['--test','test/seo.test.js'],{
    cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:20000,
    env:testEnvironment({...process.env,SITE_URL:'https://diaslibre.com',PUBLIC_URL:'https://other.example',LITEAPI_FLIGHTS:'off'})
  });
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
