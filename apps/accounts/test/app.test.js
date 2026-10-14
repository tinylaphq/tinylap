// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The HTTP shell around Better Auth: headers, static styles, the database.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startAccounts } from './helpers.js';

/** @type {Awaited<ReturnType<typeof startAccounts>>} */
let accounts;
before(async () => {
  accounts = await startAccounts();
});
after(() => accounts.close());

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

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

test('palace-ui and @tinylap/design styles are served under /pkg/', async () => {
  for (const path of ['/pkg/palace-ui/palace.css', '/pkg/design/design.css']) {
    const res = await fetch(`${accounts.issuer}${path}`);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), /^text\/css/);
  }
  assert.equal((await fetch(`${accounts.issuer}/pkg/design/%2e%2e/package.json`)).status, 404);
  assert.equal((await fetch(`${accounts.issuer}/pkg/other/x.css`)).status, 404);
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

test('the database has TinyLap tables next to Better Auth', () => {
  const tables = accounts.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const name of ['user', 'session', 'jwks', 'oauthClient', 'workspace', 'membership', 'invite', 'recovery_code', 'deletion']) {
    assert.ok(tables.includes(name), name);
  }
  assert.equal(accounts.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
});
