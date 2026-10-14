// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// accounts as any relying party sees it: standard endpoints only, driven
// through openid-client. The session comes from the test-only testSession:
// a passkey sign-in needs a real browser, and test/browser/passkeys.test.js
// runs the same OIDC login through the passkey sign-in page.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import * as oidc from 'openid-client';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { verifyAccessToken } from '@tinylap/auth';
import { seedClients } from '../server/auth.js';
import { createTestUser, driveAuthorize, Jar, startAccounts, testSession } from './helpers.js';

/** @type {Awaited<ReturnType<typeof startAccounts>>} */
let accounts;
/** @type {oidc.Configuration} */
let config;

before(async () => {
  accounts = await startAccounts({ plannerPort: 8123 });
  config = await oidc.discovery(
    new URL(accounts.issuer),
    accounts.client.clientId,
    undefined,
    oidc.ClientSecretBasic(accounts.client.clientSecret),
    { execute: [oidc.allowInsecureRequests] },
  );
});
after(() => accounts.close());

/** Starts a login and returns what the callback needs to finish it. */
async function begin() {
  const pkceCodeVerifier = oidc.randomPKCECodeVerifier();
  const expectedNonce = oidc.randomNonce();
  const expectedState = oidc.randomState();
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: accounts.client.redirectUri,
    scope: 'openid profile offline_access',
    code_challenge: await oidc.calculatePKCECodeChallenge(pkceCodeVerifier),
    code_challenge_method: 'S256',
    nonce: expectedNonce,
    state: expectedState,
    resource: accounts.client.resource,
  });
  return { url, checks: { pkceCodeVerifier, expectedNonce, expectedState, idTokenExpected: true } };
}

/** A signed-in user's full login: authorize, then the code at the token endpoint. */
async function login(name = 'Ayrton') {
  const user = await createTestUser(accounts.auth, name);
  const jar = await testSession(accounts.auth, user.id);
  const { url, checks } = await begin();
  const res = await driveAuthorize(url, jar);
  const callback = new URL(res.headers.get('location'));
  const tokens = await oidc.authorizationCodeGrant(config, callback, checks, { resource: accounts.client.resource });
  return { user, jar, tokens, res };
}

test('discovery describes a standards OIDC provider', () => {
  const meta = config.serverMetadata();
  assert.equal(meta.issuer, accounts.issuer);
  assert.equal(meta.authorization_endpoint, `${accounts.issuer}/oauth2/authorize`);
  assert.equal(meta.token_endpoint, `${accounts.issuer}/oauth2/token`);
  assert.equal(meta.jwks_uri, `${accounts.issuer}/jwks`);
  assert.equal(meta.end_session_endpoint, `${accounts.issuer}/oauth2/end-session`);
  assert.ok(meta.code_challenge_methods_supported.includes('S256'));
  assert.ok(meta.id_token_signing_alg_values_supported.includes('RS256'));
  assert.equal(meta.registration_endpoint, undefined);
});

test('the JWKS holds an RS256 key', async () => {
  const { keys } = await (await fetch(config.serverMetadata().jwks_uri)).json();
  assert.ok(keys.some((k) => k.kty === 'RSA' && k.alg === 'RS256' && k.kid));
  assert.ok(keys.every((k) => k.d === undefined), 'no private parts');
});

test('without a session, authorize redirects (302) to the sign-in page with the signed query', async () => {
  const { url } = await begin();
  const res = await driveAuthorize(url, new Jar());
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('x-test-via'), null, 'a real redirect, not the JSON fallback');
  const location = new URL(res.headers.get('location'), accounts.issuer);
  assert.equal(location.origin + location.pathname, `${accounts.issuer}/sign-in`);
  assert.ok(location.searchParams.get('sig'), 'the query is signed');
  assert.equal(location.searchParams.get('client_id'), accounts.client.clientId);
});

test('a fetch() of authorize (sec-fetch-mode: cors) gets JSON, not a redirect', async () => {
  const { url } = await begin();
  const res = await fetch(url, { redirect: 'manual' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(new URL(body.url, accounts.issuer).pathname, '/sign-in');
});

test('code + PKCE: the trusted client skips consent and the ID token validates', async () => {
  const { user, tokens, res } = await login();
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('x-test-via'), null, 'a real redirect, not the JSON fallback');
  assert.equal(new URL(res.headers.get('location')).origin + new URL(res.headers.get('location')).pathname, accounts.client.redirectUri);
  // openid-client has checked signature, iss, aud, exp, nonce, state, PKCE.
  const claims = tokens.claims();
  assert.equal(claims.iss, accounts.issuer);
  assert.equal(claims.aud, accounts.client.clientId);
  assert.equal(claims.sub, user.id);
  assert.equal(decodeProtectedHeader(tokens.id_token).alg, 'RS256');
});

test('the access token is an RS256 JWT for the resource, living 600 s', async () => {
  const { user, tokens } = await login();
  assert.equal(tokens.expires_in, 600);
  const header = decodeProtectedHeader(tokens.access_token);
  assert.equal(header.alg, 'RS256');
  const payload = decodeJwt(tokens.access_token);
  assert.equal(payload.iss, accounts.issuer);
  assert.equal(payload.sub, user.id);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  assert.ok(aud.includes(accounts.client.resource), `aud ${JSON.stringify(payload.aud)}`);
  assert.equal(payload.exp - payload.iat, 600);
  assert.deepEqual(payload.workspaces, []);
});

test('userinfo gives the subject and the display name', async () => {
  const { user, tokens } = await login('Michèle');
  const info = await oidc.fetchUserInfo(config, tokens.access_token, user.id);
  assert.equal(info.sub, user.id);
  assert.equal(info.name, 'Michèle');
});

test('refresh rotates: the old refresh token is refused afterwards', async () => {
  const { tokens } = await login();
  assert.ok(tokens.refresh_token);
  const next = await oidc.refreshTokenGrant(config, tokens.refresh_token, { resource: accounts.client.resource });
  assert.ok(next.refresh_token);
  assert.notEqual(next.refresh_token, tokens.refresh_token);
  assert.equal(decodeJwt(next.access_token).exp - decodeJwt(next.access_token).iat, 600);
  await assert.rejects(
    oidc.refreshTokenGrant(config, tokens.refresh_token, { resource: accounts.client.resource }),
    (/** @type {any} */ error) => error.error === 'invalid_grant',
  );
});

test('@tinylap/auth accepts the token for its resource and rejects it for another', async () => {
  const { user, tokens } = await login();
  const claims = await verifyAccessToken(tokens.access_token, { issuer: accounts.issuer, audience: accounts.client.resource });
  assert.equal(claims.sub, user.id);
  await assert.rejects(
    verifyAccessToken(tokens.access_token, { issuer: accounts.issuer, audience: 'http://127.0.0.1:1' }),
    (/** @type {any} */ error) => error.code === 'invalid_token',
  );
});

test('a client no longer in TINYLAP_CLIENTS is disabled at the next start: its refresh tokens and logins stop working', async () => {
  const retired = {
    clientId: 'retired-test', clientSecret: 's3cret-retired', redirectUris: ['http://127.0.0.1:8124/auth/callback'],
    postLogoutRedirectUris: [], resource: accounts.client.resource, trusted: /** @type {const} */ (true),
  };
  await seedClients(accounts.auth, [...accounts.config.clients, retired]);
  const rp = await oidc.discovery(new URL(accounts.issuer), retired.clientId, undefined,
    oidc.ClientSecretBasic(retired.clientSecret), { execute: [oidc.allowInsecureRequests] });
  const user = await createTestUser(accounts.auth, 'Retired');
  const jar = await testSession(accounts.auth, user.id);
  const pkceCodeVerifier = oidc.randomPKCECodeVerifier();
  const url = oidc.buildAuthorizationUrl(rp, {
    redirect_uri: retired.redirectUris[0], scope: 'openid profile offline_access', resource: retired.resource,
    code_challenge: await oidc.calculatePKCECodeChallenge(pkceCodeVerifier), code_challenge_method: 'S256',
  });
  const res = await driveAuthorize(url, jar);
  const tokens = await oidc.authorizationCodeGrant(rp, new URL(res.headers.get('location')), { pkceCodeVerifier }, { resource: retired.resource });
  assert.ok(tokens.refresh_token);

  // The next start's configuration no longer has it.
  await seedClients(accounts.auth, accounts.config.clients);
  const row = accounts.db.prepare('SELECT disabled FROM oauthClient WHERE clientId = ?').get(retired.clientId);
  assert.equal(Number(row?.disabled), 1, 'the row is disabled');
  await assert.rejects(
    oidc.refreshTokenGrant(rp, tokens.refresh_token, { resource: retired.resource }),
    // invalid_client, as a 401 with a WWW-Authenticate challenge.
    (/** @type {any} */ error) => error.status === 401,
  );
  const again = await driveAuthorize(url, jar);
  assert.equal(new URL(again.headers.get('location'), accounts.issuer).searchParams.get('code'), null, 'no code for a disabled client');
  // The configured client is untouched.
  const { tokens: planner } = await login();
  assert.ok(await oidc.refreshTokenGrant(config, planner.refresh_token, { resource: accounts.client.resource }));
});
