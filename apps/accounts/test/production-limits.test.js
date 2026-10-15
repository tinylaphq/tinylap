// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Better Auth turns its own rate limiter on with NODE_ENV=production and
// keys it on the client address. Every token, refresh, revoke and userinfo
// call comes from the planner's one server, so those client-authenticated
// endpoints must not be limited per address (TinyLap limits the browser-facing
// ones itself). Better Auth reads NODE_ENV once, when it is first imported,
// so this file sets it before importing anything that loads Better Auth.
// TINYLAP_DEV=1 still lets the issuer be http. As on Fly, the proxy's
// Fly-Client-IP header names the client; every request here carries one.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'production';
const oidc = await import('openid-client');
const { createTestUser, navigate, startAccounts, testSession } = await import('./helpers.js');

const PLANNER_IP = '203.0.113.7';
/** @type {typeof fetch} */
const fromPlanner = (url, init = {}) => fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), 'fly-client-ip': PLANNER_IP } });

/** @type {Awaited<ReturnType<typeof startAccounts>>} */
let accounts;
/** @type {import('openid-client').Configuration} */
let config;

before(async () => {
  accounts = await startAccounts({ plannerPort: 8126, env: { TINYLAP_CLIENT_IP_HEADER: 'Fly-Client-IP' } });
  config = await oidc.discovery(
    new URL(accounts.issuer),
    accounts.client.clientId,
    undefined,
    oidc.ClientSecretBasic(accounts.client.clientSecret),
    { execute: [oidc.allowInsecureRequests], [oidc.customFetch]: /** @type {any} */ (fromPlanner) },
  );
});
after(() => accounts.close());

/** The browser's authorize navigation, from its own address. */
const authorize = (url, jar, ip = '198.51.100.1', extra = {}) =>
  navigate(url, { accept: 'text/html', 'sec-fetch-mode': 'navigate', cookie: jar.header(), 'fly-client-ip': ip, ...extra });

async function login() {
  const user = await createTestUser(accounts.auth, 'Jochen');
  const jar = await testSession(accounts.auth, user.id);
  const pkceCodeVerifier = oidc.randomPKCECodeVerifier();
  const expectedNonce = oidc.randomNonce();
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: accounts.client.redirectUri,
    scope: 'openid profile offline_access',
    code_challenge: await oidc.calculatePKCECodeChallenge(pkceCodeVerifier),
    code_challenge_method: 'S256',
    nonce: expectedNonce,
    resource: accounts.client.resource,
  });
  const res = await authorize(url, jar);
  assert.equal(res.status, 302);
  return oidc.authorizationCodeGrant(config, new URL(res.headers.get('location')), { pkceCodeVerifier, expectedNonce, idTokenExpected: true }, { resource: accounts.client.resource });
}

test('Better Auth runs with its production rate limiter', async () => {
  const { rateLimit } = await accounts.auth.$context;
  assert.equal(rateLimit.enabled, true);
});

test('30 refreshes, userinfo calls and revocations from one address are never throttled', async () => {
  let tokens = await login();
  for (let i = 0; i < 30; i++) {
    tokens = await oidc.refreshTokenGrant(config, tokens.refresh_token, { resource: accounts.client.resource });
  }
  for (let i = 0; i < 65; i++) {
    const res = await fromPlanner(`${accounts.issuer}/oauth2/userinfo`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    assert.equal(res.status, 200, `userinfo call ${i + 1}`);
  }
  const basic = `Basic ${Buffer.from(`${accounts.client.clientId}:${accounts.client.clientSecret}`).toString('base64')}`;
  for (let i = 0; i < 35; i++) {
    const res = await fromPlanner(`${accounts.issuer}/oauth2/revoke`, {
      method: 'POST',
      headers: { authorization: basic, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: `not-a-token-${i}` }),
    });
    // An unknown token is a 400 here; what matters is that it is not a 429.
    assert.notEqual(res.status, 429, `revoke call ${i + 1}`);
  }
});

test('25 logins from one address are never throttled at the token endpoint', async () => {
  for (let i = 0; i < 25; i++) await login();
});

test('the browser-facing limit keys on Fly-Client-IP, not on a forged X-Forwarded-For', async () => {
  const user = await createTestUser(accounts.auth, 'Spoof');
  const jar = await testSession(accounts.auth, user.id);
  const url = `${accounts.issuer}/oauth2/authorize?client_id=nobody`;
  const statuses = [];
  for (let i = 0; i < 31; i++) {
    statuses.push((await authorize(url, jar, '198.51.100.99', { 'x-forwarded-for': `192.0.2.${i + 1}` })).status);
  }
  assert.ok(!statuses.slice(0, 30).includes(429), statuses.join(' '));
  assert.equal(statuses[30], 429);
});
