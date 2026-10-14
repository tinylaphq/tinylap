// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The `workspaces` claim in access tokens (spec §3), as a relying party sees
// it through openid-client: it names the user's memberships, read live at
// every issuance, so after a removal the next refresh drops the club. A
// removal revokes nothing: the member stays logged in.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import * as oidc from 'openid-client';
import { decodeJwt } from 'jose';
import { createClub, createInvite, createPersonalWorkspace, listMemberships, redeemInvite, removeMember } from '../server/workspaces.js';
import { createTestUser, driveAuthorize, startAccounts, testSession } from './helpers.js';

/** @type {Awaited<ReturnType<typeof startAccounts>>} */
let accounts;
/** @type {oidc.Configuration} */
let config;

before(async () => {
  accounts = await startAccounts({ plannerPort: 8125 });
  config = await oidc.discovery(
    new URL(accounts.issuer),
    accounts.client.clientId,
    undefined,
    oidc.ClientSecretBasic(accounts.client.clientSecret),
    { execute: [oidc.allowInsecureRequests] },
  );
});
after(() => accounts.close());

/** A full login for `userId`: authorize with a session, then the code. */
async function login(userId) {
  const jar = await testSession(accounts.auth, userId);
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
  const res = await driveAuthorize(url, jar);
  return oidc.authorizationCodeGrant(config, new URL(res.headers.get('location')), { pkceCodeVerifier, expectedNonce, expectedState }, { resource: accounts.client.resource });
}

/** @returns {{ id: string, role: string, name: string }[]} */
const claimOf = (tokens) => /** @type {any} */ (decodeJwt(tokens.access_token).workspaces);

async function setUp() {
  const owner = (await createTestUser(accounts.auth, 'Owner')).id;
  const member = (await createTestUser(accounts.auth, 'Member')).id;
  createPersonalWorkspace(accounts.db, member, 'Member');
  const club = createClub(accounts.db, owner, 'Kart Club');
  const { link } = createInvite(accounts.db, owner, club.id, { singleUse: true });
  redeemInvite(accounts.db, member, link.split('/').pop());
  return { owner, member, club };
}

test('the access token names every workspace with its id, role and name', async () => {
  const { member, club } = await setUp();
  const tokens = await login(member);
  const expected = listMemberships(accounts.db, member).map(({ id, role, name }) => ({ id, role, name }));
  assert.equal(expected.length, 2);
  assert.deepEqual(claimOf(tokens), expected);
  assert.ok(claimOf(tokens).some((w) => w.id === club.id && w.role === 'member' && w.name === 'Kart Club'));
});

test('a refreshed token re-reads the memberships', async () => {
  const { owner, member, club } = await setUp();
  const tokens = await login(member);
  const other = createClub(accounts.db, member, 'Second Club');
  const refreshed = await oidc.refreshTokenGrant(config, tokens.refresh_token, { resource: accounts.client.resource });
  assert.ok(claimOf(refreshed).some((w) => w.id === other.id && w.role === 'owner'));
  assert.ok(claimOf(refreshed).some((w) => w.id === club.id));
  assert.ok(owner);
});

test('after removeMember the next refresh succeeds and its token lacks the club', async () => {
  const { owner, member, club } = await setUp();
  const first = await login(member);
  const second = await login(member); // another device, another refresh token
  const ownerTokens = await login(owner);
  const refreshTokens = accounts.db.prepare('SELECT COUNT(*) AS n FROM oauthRefreshToken WHERE userId = ?').get(member).n;

  removeMember(accounts.db, owner, club.id, member);

  assert.equal(accounts.db.prepare('SELECT COUNT(*) AS n FROM oauthRefreshToken WHERE userId = ?').get(member).n, refreshTokens, 'nothing revoked');
  for (const tokens of [first, second]) {
    const refreshed = await oidc.refreshTokenGrant(config, tokens.refresh_token, { resource: accounts.client.resource });
    assert.equal(claimOf(refreshed).some((w) => w.id === club.id), false, 'the club is gone from the next token');
    assert.equal(claimOf(refreshed).length, 1, 'the personal workspace stays');
  }
  const ownerRefreshed = await oidc.refreshTokenGrant(config, ownerTokens.refresh_token, { resource: accounts.client.resource });
  assert.ok(claimOf(ownerRefreshed).some((w) => w.id === club.id && w.role === 'owner'));
});
