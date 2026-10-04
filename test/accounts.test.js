import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { BookingStore } from '../src/store.js';
import { Accounts, mergeHistory } from '../src/accounts.js';
import { recommend } from '../src/recommend.js';

// Servidor con un «correo» falso que guarda el enlace enviado.
async function start(extra = {}) {
  const store = new BookingStore(null);
  const sent = [];
  const mailer = { loginLink: async (m) => { sent.push(m); return { sent: true }; } };
  const accounts = new Accounts({ store, mailer, ...extra });
  const app = createApp({ store, osm: null, live: null, mailer, accounts });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;
  let cookie = '';
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json(), set };
  };
  return { server, call, sent, store, accounts };
}

test('entrar con el enlace del email, guardar búsquedas, salir y borrar la cuenta', async () => {
  const { server, call, sent } = await start();
  try {
    assert.equal((await call('POST', '/api/auth/email', { email: 'no-es-email' })).status, 400);
    assert.equal((await call('POST', '/api/auth/email', { email: 'Ana@Example.com' })).status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].email, 'ana@example.com');
    // Un segundo enlace en menos de un minuto se rechaza.
    assert.equal((await call('POST', '/api/auth/email', { email: 'ana@example.com' })).status, 429);
    const token = new URL(sent[0].url).searchParams.get('login');
    assert.ok(token.length > 30);

    assert.equal((await call('GET', '/api/me')).body.user, null);
    const v = await call('POST', '/api/auth/verify', { token });
    assert.equal(v.status, 200);
    assert.match(v.set, /HttpOnly/i);
    assert.equal(v.body.user.email, 'ana@example.com');
    // El enlace solo sirve una vez.
    assert.equal((await call('POST', '/api/auth/verify', { token })).status, 400);
    assert.equal((await call('GET', '/api/me')).body.user.email, 'ana@example.com');

    const history = [{ kind: 'hotel', city: 'Benidorm', stay: 'apartment', maxPrice: 100, at: '2026-10-01T10:00:00Z' }];
    const r = await call('POST', '/api/recommendations', { history });
    assert.ok(r.body.items.length >= 3);
    // Sin mandar nada, la cuenta recuerda lo que buscó.
    const again = await call('POST', '/api/recommendations', { history: [] });
    assert.deepEqual(again.body.items, r.body.items);
    assert.equal((await call('GET', '/api/me')).body.user.historyCount, 1);

    assert.equal((await call('POST', '/api/auth/logout')).status, 200);
    assert.equal((await call('GET', '/api/me')).body.user, null);
    assert.equal((await call('DELETE', '/api/me')).status, 401);
  } finally {
    server.close();
  }
});

test('el enlace caduca a los 30 minutos', async () => {
  let now = Date.parse('2026-10-04T10:00:00Z');
  const { server, call, sent } = await start({ now: () => now });
  try {
    await call('POST', '/api/auth/email', { email: 'luis@example.com' });
    now += 31 * 60 * 1000;
    const token = new URL(sent[0].url).searchParams.get('login');
    const r = await call('POST', '/api/auth/verify', { token });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /caducado/);
  } finally {
    server.close();
  }
});

test('Google: solo con el ID de cliente y un token válido para esa web', async () => {
  const off = await start();
  try {
    assert.equal((await off.call('POST', '/api/auth/google', { credential: 'x' })).status, 404);
  } finally {
    off.server.close();
  }
  const info = { aud: 'web-id', iss: 'https://accounts.google.com', email: 'eva@gmail.com', email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 600), given_name: 'Eva' };
  const fetchImpl = async (url) => ({ ok: !url.includes('malo'), json: async () => info });
  const on = await start({ googleClientId: 'web-id', fetchImpl });
  try {
    assert.equal((await on.call('POST', '/api/auth/google', { credential: 'malo' })).status, 401);
    const r = await on.call('POST', '/api/auth/google', { credential: 'bueno' });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.name, 'Eva');
    assert.equal((await on.call('DELETE', '/api/me')).status, 200);
    assert.equal((await on.call('GET', '/api/me')).body.user, null);
  } finally {
    on.server.close();
  }
});

test('«Para ti» propone volver y destinos parecidos que aún no ha buscado', () => {
  const history = mergeHistory([
    { kind: 'hotel', city: 'Benidorm', stay: 'apartment', maxPrice: 100, at: '2026-10-03T10:00:00Z' },
    { kind: 'hotel', city: 'Alicante', at: '2026-10-02T10:00:00Z' },
    { kind: 'flight', city: 'Lisboa', origin: 'Madrid', at: '2026-10-01T10:00:00Z' },
  ]);
  const items = recommend(history, { lang: 'es', day: '2026-10-04' });
  assert.equal(items[0].city, 'Benidorm');
  assert.equal(items[0].query.stay, 'apartment');
  const similar = items.filter((r) => r.reason.key === 'Parecido a {city}');
  assert.ok(similar.length >= 2);
  for (const r of similar) {
    assert.ok(!['Benidorm', 'Alicante', 'Lisboa'].includes(r.city));
    assert.ok(['beach', 'island', 'city'].includes(r.type));
    assert.equal(r.query.stay, 'apartment'); // sus filtros favoritos
  }
  assert.ok(items.some((r) => r.kind === 'flight' && r.origin === 'Madrid'));
  // En inglés, los nombres van en inglés.
  assert.ok(recommend([{ kind: 'hotel', city: 'Sevilla', at: '2026-10-01T00:00:00Z' }], { lang: 'en' }).some((r) => r.city === 'Seville'));
  assert.deepEqual(recommend([], {}), []);
});

test('Apple: token firmado por Apple para esta web', async () => {
  const { generateKeyPairSync, sign } = await import('node:crypto');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = (claims, key = privateKey) => {
    const head = b64({ alg: 'RS256', kid: 'k1' }) + '.' + b64(claims);
    return head + '.' + sign('RSA-SHA256', Buffer.from(head), key).toString('base64url');
  };
  const claims = { iss: 'https://appleid.apple.com', aud: 'com.diaslibre.web', exp: Math.floor(Date.now() / 1000) + 600, email: 'abc@privaterelay.appleid.com', email_verified: 'true' };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
  const { server, call } = await start({ appleClientId: 'com.diaslibre.web', fetchImpl });
  try {
    assert.equal((await call('POST', '/api/auth/apple', { idToken: jwt({ ...claims, aud: 'otra.web' }) })).status, 401);
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    assert.equal((await call('POST', '/api/auth/apple', { idToken: jwt(claims, other) })).status, 401);
    const r = await call('POST', '/api/auth/apple', { idToken: jwt(claims), name: 'Marta' });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.email, 'abc@privaterelay.appleid.com');
    assert.equal(r.body.user.name, 'Marta');
  } finally {
    server.close();
  }
});

test('Microsoft: solo cuentas personales, para esta web y con el mismo nonce', async () => {
  const { generateKeyPairSync, sign } = await import('node:crypto');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'm1', use: 'sig', x5t: 'm1', issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0' };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = (claims) => {
    const head = b64({ alg: 'RS256', kid: 'm1', typ: 'JWT' }) + '.' + b64(claims);
    return head + '.' + sign('RSA-SHA256', Buffer.from(head), privateKey).toString('base64url');
  };
  const tid = '9188040d-6c67-4c5b-b112-36a304b66dad';
  const claims = { iss: `https://login.microsoftonline.com/${tid}/v2.0`, tid, aud: 'ms-app', nonce: 'n1', exp: Math.floor(Date.now() / 1000) + 600, email: 'Luis@Outlook.com', name: 'Luis Pérez' };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
  const off = await start();
  const { server, call } = await start({ microsoftClientId: 'ms-app', fetchImpl });
  try {
    assert.equal((await off.call('POST', '/api/auth/microsoft', { idToken: jwt(claims), nonce: 'n1' })).status, 404);
    assert.equal((await call('POST', '/api/auth/microsoft', { idToken: jwt(claims), nonce: 'otro' })).status, 401);
    const work = 'aaaaaaaa-0000-0000-0000-000000000000';
    assert.equal((await call('POST', '/api/auth/microsoft', { idToken: jwt({ ...claims, tid: work, iss: `https://login.microsoftonline.com/${work}/v2.0` }), nonce: 'n1' })).status, 401);
    assert.equal((await call('POST', '/api/auth/microsoft', { idToken: jwt({ ...claims, aud: 'otra' }), nonce: 'n1' })).status, 401);
    const r = await call('POST', '/api/auth/microsoft', { idToken: jwt(claims), nonce: 'n1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.email, 'luis@outlook.com');
    assert.equal(r.body.user.name, 'Luis');
    assert.equal((await call('GET', '/api/me')).body.user.email, 'luis@outlook.com');
  } finally {
    server.close();
    off.server.close();
  }
});

test('Facebook: el token tiene que ser de esta app y traer email', async () => {
  const users = { bueno: { id: '1', first_name: 'Eva', email: 'eva@example.com' }, sinmail: { id: '2', first_name: 'Ana' } };
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const tok = u.searchParams.get('access_token');
    if (u.pathname.endsWith('/app')) return { ok: true, json: async () => ({ id: tok === 'otraapp' ? '999' : '123' }) };
    return users[tok] ? { ok: true, json: async () => users[tok] } : { ok: false, json: async () => ({}) };
  };
  const { server, call } = await start({ facebookAppId: '123', fetchImpl });
  try {
    assert.equal((await call('POST', '/api/auth/facebook', { accessToken: 'otraapp' })).status, 401);
    const nomail = await call('POST', '/api/auth/facebook', { accessToken: 'sinmail' });
    assert.equal(nomail.status, 401);
    assert.match(nomail.body.error, /email/);
    const r = await call('POST', '/api/auth/facebook', { accessToken: 'bueno' });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.email, 'eva@example.com');
    assert.equal(r.body.user.name, 'Eva');
  } finally {
    server.close();
  }
});
