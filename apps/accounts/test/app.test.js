// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The HTTP shell around Better Auth: headers, static styles, the database.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { servedPackages } from '../server/app.js';
import { createTestUser, driveAuthorize, Jar, navigate, startAccounts, testSession } from './helpers.js';
import { SPECULATION_HASH } from '@tinylap/design/html/speculation.js';

/** @type {Awaited<ReturnType<typeof startAccounts>>} */
let accounts;
before(async () => {
  accounts = await startAccounts();
});
after(() => accounts.close());

const CSP = `default-src 'self'; script-src 'self' '${SPECULATION_HASH}'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;

test('every response has the security headers and no Server header', async () => {
  for (const path of ['/.well-known/openid-configuration', '/jwks', '/sign-in', '/nope', '/pkg/design/design.css']) {
    const res = await fetch(`${accounts.issuer}${path}`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', path);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer', path);
    assert.equal(res.headers.get('server'), null, path);
  }
});

test('pages are HTML under the strict CSP', async () => {
  for (const path of ['/sign-in', '/consent']) {
    const res = await fetch(`${accounts.issuer}${path}`);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    assert.equal(res.headers.get('content-security-policy'), CSP);
  }
});

test('the error page carries the CSP and escapes what it shows', async () => {
  const res = await fetch(`${accounts.issuer}/error?error=x&error_description=${encodeURIComponent('<script>alert(1)</script>')}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  assert.equal(res.headers.get('content-security-policy'), CSP);
  const html = await res.text();
  assert.ok(!html.includes('<script>alert'), 'not injected');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('href="/sign-in"'));
  assert.ok(!/better-auth\.com/.test(html));
});

test("Better Auth's errors land on our error page", async () => {
  const url = `${accounts.issuer}/oauth2/authorize?client_id=nope&response_type=code&redirect_uri=x`;
  const res = await driveAuthorize(url, new Jar());
  const location = new URL(res.headers.get('location'));
  assert.equal(location.origin + location.pathname, `${accounts.issuer}/error`);
  assert.equal(location.searchParams.get('error'), 'invalid_request');
  const page = await (await fetch(location)).text();
  assert.match(page, /<h1>That request did not work<\/h1>/, 'the title says what happened');
});

test("Better Auth's own end-session pages are never shown: they become /signed-out", async () => {
  const res = await navigate(`${accounts.issuer}/oauth2/end-session?id_token_hint=garbage`);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/signed-out');
  assert.equal(res.headers.get('content-security-policy'), CSP);
  assert.equal((await navigate(`${accounts.issuer}/oauth2/end-session/confirm`)).status, 404, 'the confirm route is off');
});

test('every other response defaults to the page CSP', async () => {
  for (const path of ['/.well-known/openid-configuration', '/nope', '/pkg/design/design.css']) {
    assert.equal((await fetch(`${accounts.issuer}${path}`)).headers.get('content-security-policy'), CSP, path);
  }
});

test('palace-ui and @tinylap/design styles are served under /pkg/', async () => {
  for (const path of ['/pkg/palace-ui/palace.css', '/pkg/design/design.css']) {
    const res = await fetch(`${accounts.issuer}${path}`);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), /^text\/css/);
  }
  assert.equal((await fetch(`${accounts.issuer}/pkg/design/%2e%2e/package.json`)).status, 404);
  assert.equal((await fetch(`${accounts.issuer}/pkg/other/x.css`)).status, 404);
});

test('only palace-ui and @tinylap/design are served; server-only dependencies never are', async () => {
  assert.deepEqual([...servedPackages().keys()].sort(), ['design', 'palace-ui']);
  for (const path of ['/pkg/passkey/dist/index.mjs', '/pkg/passkey/package.json', '/pkg/better-auth/package.json', '/pkg/oauth-provider/dist/index.mjs', '/pkg/auth/index.js']) {
    assert.equal((await fetch(`${accounts.issuer}${path}`)).status, 404, path);
  }
});

/** Sends a raw request target, which fetch() would normalise. */
const rawGet = (target) => new Promise((resolve, reject) => {
  const { hostname, port } = new URL(accounts.issuer);
  const req = request({ hostname, port, path: target, method: 'GET', headers: { accept: 'application/json' } }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  });
  req.on('error', reject);
  req.end();
});

test('a request target that is not one plain /path is refused before routing', async () => {
  for (const target of ['//api/me', '//evil.test/sign-in', `${accounts.issuer}/api/me`, 'http://evil.test/api/me', '*']) {
    assert.equal(await rawGet(target), 400, target);
  }
  assert.equal(await rawGet('/api/me'), 401, 'a plain path still routes');
});

test('password sign-up and sign-in are switched off', async () => {
  for (const path of ['/sign-up/email', '/sign-in/email']) {
    const res = await fetch(`${accounts.issuer}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: accounts.issuer },
      body: JSON.stringify({ email: 'a@b.test', password: 'correct-horse-1', name: 'A' }),
    });
    assert.equal(res.status, 404, path);
  }
});

test("the JWT plugin's session-token endpoint is switched off", async () => {
  assert.equal((await fetch(`${accounts.issuer}/token`)).status, 404);
});

// Better Auth routes TinyLap does not use, called by a signed-in browser
// from accounts' own origin: every one is a 404, whatever its method.
/** @type {[string, string, object?][]} */
const UNUSED = [
  ['POST', '/update-user', { name: 'x'.repeat(200) }],
  ['GET', '/list-sessions'],
  ['POST', '/revoke-session', { token: 'x' }],
  ['POST', '/revoke-sessions', {}],
  ['POST', '/revoke-other-sessions', {}],
  ['POST', '/update-session', {}],
  ['GET', '/get-session'],
  ['GET', '/list-accounts'],
  ['POST', '/unlink-account', { providerId: 'x' }],
  ['POST', '/delete-user', {}],
  ['GET', '/delete-user/callback'],
  ['GET', '/ok'],
  ['GET', '/callback/x'],
  ['GET', '/passkey/list-user-passkeys'],
  ['POST', '/oauth2/consent', { accept: true }],
  ['GET', '/oauth2/get-consent?id=x'],
  ['GET', '/oauth2/get-consents'],
  ['POST', '/oauth2/update-consent', { id: 'x', update: { scopes: [] } }],
  ['POST', '/oauth2/delete-consent', { id: 'x' }],
  ['GET', '/oauth2/get-client?client_id=planner-test'],
  ['GET', '/oauth2/get-clients'],
  ['GET', '/oauth2/public-client?client_id=planner-test'],
  ['POST', '/oauth2/continue', {}],
  ['POST', '/oauth2/introspect', { token: 'x' }],
  ['GET', '/admin/oauth2/resources'],
];

test("Better Auth's routes TinyLap does not use are 404, even for a signed-in user", async () => {
  const user = await createTestUser(accounts.auth, 'Prost');
  const jar = await testSession(accounts.auth, user.id);
  for (const [method, path, body] of UNUSED) {
    const res = await fetch(`${accounts.issuer}${path}`, {
      method,
      headers: { cookie: jar.header(), origin: accounts.issuer, 'sec-fetch-site': 'same-origin', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(res.status, 404, `${method} ${path}`);
    await res.body?.cancel();
  }
  const row = accounts.db.prepare('SELECT name FROM "user" WHERE id = ?').get(user.id);
  assert.equal(row?.name, 'Prost', 'the name was not changed past displayNameOf');
});

test('the database has TinyLap tables next to Better Auth', () => {
  const tables = accounts.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const name of ['user', 'session', 'jwks', 'oauthClient', 'workspace', 'membership', 'invite', 'recovery_code', 'deletion']) {
    assert.ok(tables.includes(name), name);
  }
  assert.equal(accounts.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
});
