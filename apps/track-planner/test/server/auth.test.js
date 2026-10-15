// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Log-in through the planner's own routes, against a real accounts
// (tools/test-env.js): the BFF routes, /auth/me, the headers of cookie
// routes, the same-origin check on logout, and accounts being down.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClub } from '../../../accounts/server/workspaces.js';
import { openStore } from '../../server/store.js';
import { startPlanner, startServer } from './helpers.js';

/** @type {Awaited<ReturnType<typeof startPlanner>>} */
let planner;

before(async () => {
  planner = await startPlanner();
});
after(() => planner.close());

const me = (jar, base = planner.base) => fetch(`${base}/auth/me`, { headers: jar ? { cookie: jar.header() } : {} });

test('the session store keeps rows, the cached name across a rewrite, and forgets users', async () => {
  const { sessions } = openStore(':memory:');
  const row = { userId: 'u1', sealedTokens: 'sealed', createdAt: 1, expiresAt: 2 };
  await sessions.set('a', row);
  await sessions.set('b', { ...row, userId: 'u2' });
  assert.deepEqual(await sessions.get('a'), row);
  sessions.setName('a', 'Ayrton');
  await sessions.set('a', { ...row, sealedTokens: 'rotated', expiresAt: 3 });
  assert.deepEqual(await sessions.get('a'), { ...row, sealedTokens: 'rotated', expiresAt: 3 });
  assert.equal(sessions.getName('a'), 'Ayrton');
  await sessions.deleteUser('u1');
  assert.equal(await sessions.get('a'), null);
  assert.ok(await sessions.get('b'));
  await sessions.delete('b');
  assert.equal(await sessions.get('b'), null);
});

test('logging in through the planner gives /auth/me with the user, their name and workspaces', async () => {
  const anonymous = await (await me()).json();
  assert.deepEqual(anonymous, { loggedIn: false, available: true });

  const { user } = await planner.suite.signInUser(undefined, 'Michèle');
  const club = createClub(planner.suite.accounts.db, user.id, 'Kart Club');
  const { jar, callback } = await planner.login('/?layout=abc', user);
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), `${planner.base}/?layout=abc`);

  const res = await me(jar);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.loggedIn, true);
  assert.deepEqual(body.user, { id: user.id, name: 'Michèle' });
  assert.deepEqual(body.workspaces, [{ id: club.id, role: 'owner', name: 'Kart Club' }]);
  assert.equal(body.accountUrl, `${planner.suite.issuer}/account`);
});

test('the name is fetched from userinfo once and cached in the session', async () => {
  const { jar } = await planner.login('/', 'Jackie');
  assert.equal((await (await me(jar)).json()).user.name, 'Jackie');
  planner.suite.accounts.db.prepare('UPDATE "user" SET name = ? WHERE name = ?').run('Sir Jackie', 'Jackie');
  assert.equal((await (await me(jar)).json()).user.name, 'Jackie', 'the cached name, no second userinfo call');
});

test('auth routes send no Access-Control-Allow-Origin and do send Vary: Cookie', async () => {
  const { jar } = await planner.login();
  const responses = [
    await fetch(`${planner.base}/auth/login?returnTo=/`, { redirect: 'manual' }),
    await fetch(`${planner.base}/auth/callback?code=x&state=y`, { redirect: 'manual' }),
    await me(),
    await me(jar),
    await fetch(`${planner.base}/auth/me`, { method: 'OPTIONS', headers: { origin: 'https://evil.test', 'access-control-request-method': 'GET' } }),
    await fetch(`${planner.base}/auth/nope`),
    await fetch(`${planner.base}/auth/logout`, { method: 'POST', redirect: 'manual', headers: { origin: 'https://evil.test', cookie: jar.header() } }),
    await fetch(`${planner.base}/auth/logout`, { method: 'POST', redirect: 'manual', headers: { origin: planner.base, cookie: jar.header() } }),
  ];
  for (const res of responses) {
    assert.equal(res.headers.get('access-control-allow-origin'), null, `${res.url} ${res.status}`);
    assert.match(res.headers.get('vary') ?? '', /\bCookie\b/, `${res.url} ${res.status}`);
  }
  // The public API keeps its CORS.
  assert.equal((await fetch(`${planner.base}/openapi.json`)).headers.get('access-control-allow-origin'), '*');
});

test("the planner page lets its logout form end at accounts", async () => {
  const csp = (await fetch(`${planner.base}/`)).headers.get('content-security-policy') ?? '';
  assert.match(csp, new RegExp(`form-action 'self' ${new URL(planner.suite.issuer).origin.replace(/[.]/g, '\\.')}(;|$)`));
});

test('/auth/me is never cached', async () => {
  const res = await me();
  assert.match(res.headers.get('cache-control') ?? '', /no-store/);
});

test('POST /auth/logout from a foreign origin is 403 forbidden and keeps the session', async () => {
  const { jar } = await planner.login();
  for (const headers of [{ origin: 'https://evil.test' }, { 'sec-fetch-site': 'cross-site' }, {}]) {
    const res = await fetch(`${planner.base}/auth/logout`, { method: 'POST', redirect: 'manual', headers: { ...headers, cookie: jar.header() } });
    assert.equal(res.status, 403, JSON.stringify(headers));
    assert.equal(res.headers.get('content-type'), 'application/problem+json');
    assert.equal((await res.json()).type, `${planner.base}/problems/forbidden`);
  }
  assert.equal((await (await me(jar)).json()).loggedIn, true);
});

test('a same-origin logout clears the session and goes through accounts end-session', async () => {
  const { jar } = await planner.login();
  const res = await fetch(`${planner.base}/auth/logout`, { method: 'POST', redirect: 'manual', headers: { origin: planner.base, cookie: jar.header() } });
  assert.equal(res.status, 302);
  assert.ok(res.headers.get('location')?.startsWith(`${planner.suite.issuer}/`), res.headers.get('location'));
  const old = jar.header();
  jar.store(res);
  assert.equal(jar.cookies.has('__Host-tinylap-session'), false);
  assert.equal((await (await fetch(`${planner.base}/auth/me`, { headers: { cookie: old } })).json()).loggedIn, false, 'the old cookie is forgotten');
});

test('a failed callback is a page for a browser and a problem for anything else, and spends the login cookie', async () => {
  const start = await fetch(`${planner.base}/auth/login?returnTo=/`, { redirect: 'manual' });
  const cookie = start.headers.getSetCookie().map((l) => l.split(';')[0]).join('; ');
  const page = await fetch(`${planner.base}/auth/callback?code=x&state=forged`, { redirect: 'manual', headers: { cookie, accept: 'text/html' } });
  assert.equal(page.status, 400);
  assert.match(page.headers.get('content-type') ?? '', /^text\/html/);
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  const text = await page.text();
  assert.match(text, /log in again/i);
  assert.match(text, /href="\/auth\/login"/);
  assert.ok(page.headers.getSetCookie().some((l) => l.startsWith('__Host-tinylap-login=') && /Max-Age=0/.test(l)), 'the login cookie is spent');

  const data = await fetch(`${planner.base}/auth/callback`, { redirect: 'manual' });
  assert.equal(data.status, 400);
  assert.equal(data.headers.get('content-type'), 'application/problem+json');
  assert.equal((await data.json()).type, `${planner.base}/problems/login-failed`);
});

test('without TINYLAP_ISSUER, log-in is off: /auth/me says so and the other routes are 404', async () => {
  const off = await startServer();
  try {
    const res = await fetch(`${off.base}/auth/me`);
    assert.deepEqual(await res.json(), { loggedIn: false, available: false });
    for (const [method, path] of [['GET', '/auth/login'], ['GET', '/auth/callback'], ['POST', '/auth/logout']]) {
      const r = await fetch(`${off.base}${path}`, { method, redirect: 'manual', headers: { origin: off.base } });
      assert.equal(r.status, 404, path);
      assert.equal(r.headers.get('access-control-allow-origin'), null);
    }
  } finally {
    await off.close();
  }
});

// Last: it stops accounts.
test('with accounts stopped, a logged-in /auth/me is 503 unavailable and anonymous use still works', async () => {
  const { jar } = await planner.login('/', 'Graham');
  await (await me(jar)).json(); // caches the name
  await planner.suite.close();
  await expireSoon(jar);
  const res = await me(jar);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.type, `${planner.base}/problems/unavailable`);
  assert.equal(body.detail, 'Log-in is unavailable right now.');
  assert.equal(res.headers.get('access-control-allow-origin'), null);

  assert.deepEqual(await (await me()).json(), { loggedIn: false, available: true });
  assert.equal((await fetch(`${planner.base}/`)).status, 200);
});

/** Makes the stored access token look as if it had seconds left, so the next request refreshes. */
async function expireSoon(jar) {
  const { open, seal } = await import('@tinylap/auth');
  const id = planner.auth.bff.sessionId({ headers: { cookie: jar.header() } });
  const row = await planner.store.sessions.get(id);
  const tokens = JSON.parse(open(planner.keys, row.sealedTokens, 'tokens'));
  await planner.store.sessions.set(id, { ...row, sealedTokens: seal(planner.keys, JSON.stringify({ ...tokens, expiresAt: Date.now() + 10_000 }), 'tokens') });
}
