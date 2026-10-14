// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { verifyAccessToken } from '../index.js';

const ISSUER = 'http://accounts.test';
const AUD = 'http://planner.test';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
const jwks = createLocalJWKSet({ keys: [jwk] });

const sign = (claims = {}, { alg = 'RS256', key = privateKey, typ = 'at+jwt', exp = '10m' } = {}) =>
  new SignJWT({ workspaces: [{ id: 'w1', role: 'member' }], ...claims })
    .setProtectedHeader({ alg, kid: 'k1', typ })
    .setIssuer(ISSUER).setAudience(AUD).setSubject('user-1').setIssuedAt().setExpirationTime(exp)
    .sign(key);

test('a good token gives its claims', async () => {
  const claims = await verifyAccessToken(await sign(), { issuer: ISSUER, audience: AUD, jwks });
  assert.equal(claims.sub, 'user-1');
  assert.deepEqual(claims.workspaces, [{ id: 'w1', role: 'member' }]);
});

test('wrong audience, issuer, expiry or signature are all invalid_token', async () => {
  const other = await generateKeyPair('RS256');
  const cases = [
    [await sign(), { issuer: ISSUER, audience: 'http://timing.test' }],
    [await sign(), { issuer: 'http://evil.test', audience: AUD }],
    [await sign({}, { exp: '-1m' }), { issuer: ISSUER, audience: AUD }],
    [await sign({}, { key: other.privateKey }), { issuer: ISSUER, audience: AUD }],
  ];
  for (const [token, opts] of cases) {
    await assert.rejects(verifyAccessToken(token, { ...opts, jwks }), (e) => e.code === 'invalid_token');
  }
});

test('only RS256 is accepted', async () => {
  const ec = await generateKeyPair('ES256');
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setIssuer(ISSUER).setAudience(AUD).setSubject('u').setExpirationTime('5m').sign(ec.privateKey);
  await assert.rejects(verifyAccessToken(token, { issuer: ISSUER, audience: AUD, jwks }), (e) => e.code === 'invalid_token');
});

test('a token without a workspaces claim reads as no workspaces', async () => {
  const token = await sign({ workspaces: undefined });
  assert.deepEqual((await verifyAccessToken(token, { issuer: ISSUER, audience: AUD, jwks })).workspaces, []);
});
