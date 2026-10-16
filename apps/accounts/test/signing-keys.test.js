// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Signing key rotation as the README describes it: expiring the current key
// switches signing to a new one, and the expired key stays in the JWKS for
// the pinned grace period (30 days), so tokens it signed still verify. And
// token issues that race for a new key all end up signing with one.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import * as oidc from 'openid-client';
import { createRemoteJWKSet, decodeProtectedHeader } from 'jose';
import { verifyAccessToken } from '@tinylap/auth';
import { JWKS_GRACE_SECONDS } from '../server/auth.js';
import { createTestUser, driveAuthorize, startAccounts, testSession } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;

/** @type {Awaited<ReturnType<typeof startAccounts>>} */
let accounts;
/** @type {oidc.Configuration} */
let config;

before(async () => {
  accounts = await startAccounts({ plannerPort: 8127 });
  config = await oidc.discovery(new URL(accounts.issuer), accounts.client.clientId, undefined,
    oidc.ClientSecretBasic(accounts.client.clientSecret), { execute: [oidc.allowInsecureRequests] });
});
after(() => accounts.close());

async function accessToken() {
  const user = await createTestUser(accounts.auth, 'Niki');
  const jar = await testSession(accounts.auth, user.id);
  const pkceCodeVerifier = oidc.randomPKCECodeVerifier();
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: accounts.client.redirectUri,
    scope: 'openid profile offline_access',
    code_challenge: await oidc.calculatePKCECodeChallenge(pkceCodeVerifier),
    code_challenge_method: 'S256',
    resource: accounts.client.resource,
  });
  const res = await driveAuthorize(url, jar);
  const tokens = await oidc.authorizationCodeGrant(config, new URL(res.headers.get('location')), { pkceCodeVerifier }, { resource: accounts.client.resource });
  return tokens.access_token;
}

const kids = async () => (await (await fetch(`${accounts.issuer}/jwks`)).json()).keys.map((k) => k.kid);
const expireKey = (kid, at) => accounts.db.prepare('UPDATE jwks SET expiresAt = ? WHERE id = ?').run(new Date(at).toISOString(), kid);

test('the JWT plugin pins a 30-day grace period', () => {
  assert.equal(JWKS_GRACE_SECONDS, 30 * 24 * 60 * 60);
  const jwt = /** @type {any} */ (accounts.auth.options.plugins.find((p) => p.id === 'jwt'));
  assert.equal(jwt.options.jwks.gracePeriod, JWKS_GRACE_SECONDS);
});

test('an expired key stays in the JWKS within the grace period, and its tokens still verify', async () => {
  const old = await accessToken();
  const { kid } = decodeProtectedHeader(old);
  expireKey(kid, Date.now() - 29 * DAY);

  const fresh = await accessToken();
  assert.notEqual(decodeProtectedHeader(fresh).kid, kid, 'signing moved to a new key');
  assert.ok((await kids()).includes(kid), 'the expired key is still published');
  const options = { issuer: accounts.issuer, audience: accounts.client.resource };
  assert.ok(await verifyAccessToken(old, options), 'a token the expired key signed verifies');
  assert.ok(await verifyAccessToken(fresh, options));

  expireKey(kid, Date.now() - 31 * DAY);
  assert.ok(!(await kids()).includes(kid), 'past the grace period it is gone');
});

const liveRows = () => accounts.db.prepare('SELECT id FROM jwks WHERE expiresAt IS NULL OR expiresAt > ?').all(new Date().toISOString());

test('concurrent token issues share one signing key', async () => {
  for (const { id } of liveRows()) expireKey(id, Date.now() - DAY);
  const tokens = await Promise.all(Array.from({ length: 6 }, accessToken));
  assert.equal(new Set(tokens.map((t) => decodeProtectedHeader(t).kid)).size, 1, 'one kid across the tokens');
  assert.equal(liveRows().length, 1, 'one live key in the table');
  // Its own key set: the shared one was fetched within jose's 30 s cooldown.
  const options = { issuer: accounts.issuer, audience: accounts.client.resource, jwks: createRemoteJWKSet(new URL(`${accounts.issuer}/jwks`)) };
  for (const t of tokens) assert.ok(await verifyAccessToken(t, options));
});
