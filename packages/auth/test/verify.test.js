// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { randomBytes, subtle } from 'node:crypto';
import { createServer } from 'node:http';
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

test('a token without exp or sub is rejected', async () => {
  const noExp = await new SignJWT({ workspaces: [{ id: 'w1', role: 'member' }] })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER).setAudience(AUD).setSubject('user-1').setIssuedAt()
    .sign(privateKey);
  await assert.rejects(verifyAccessToken(noExp, { issuer: ISSUER, audience: AUD, jwks }), (e) => e.code === 'invalid_token');

  const noSub = await new SignJWT({ workspaces: [{ id: 'w1', role: 'member' }] })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER).setAudience(AUD).setIssuedAt().setExpirationTime('10m')
    .sign(privateKey);
  await assert.rejects(verifyAccessToken(noSub, { issuer: ISSUER, audience: AUD, jwks }), (e) => e.code === 'invalid_token');
});

test('only RS256 is accepted (algorithm pinning)', async () => {
  const secret = await subtle.importKey('raw', randomBytes(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const hsToken = await new SignJWT({ workspaces: [{ id: 'w1', role: 'member' }] })
    .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
    .setIssuer(ISSUER).setAudience(AUD).setSubject('u').setIssuedAt().setExpirationTime('5m')
    .sign(secret);
  const hsJwks = () => Promise.resolve(secret);
  await assert.rejects(verifyAccessToken(hsToken, { issuer: ISSUER, audience: AUD, jwks: hsJwks }), (e) => e.code === 'invalid_token');
});

test('a token without a workspaces claim reads as no workspaces', async () => {
  const token = await sign({ workspaces: undefined });
  assert.deepEqual((await verifyAccessToken(token, { issuer: ISSUER, audience: AUD, jwks })).workspaces, []);
});

test('malformed workspace claims are filtered out', async () => {
  const token = await sign({ workspaces: [null, { id: 'w1', role: 'member' }, { role: 'member' }, { id: 'w2' }] });
  assert.deepEqual((await verifyAccessToken(token, { issuer: ISSUER, audience: AUD, jwks })).workspaces, [{ id: 'w1', role: 'member' }]);
});

test('JWKS fetch failure throws unavailable', async () => {
  await assert.rejects(
    verifyAccessToken(await sign(), { issuer: 'http://127.0.0.1:1', audience: AUD }),
    (e) => e.code === 'unavailable'
  );
});

test('a token without kid against multi-key JWKS is invalid_token, not unavailable', async () => {
  const { publicKey: pub2 } = await generateKeyPair('RS256');
  const jwk2 = { ...(await exportJWK(pub2)), kid: 'k2', alg: 'RS256' };
  const multiJwks = createLocalJWKSet({ keys: [jwk, jwk2] });

  const noKidToken = await new SignJWT({ workspaces: [{ id: 'w1', role: 'member' }] })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(ISSUER).setAudience(AUD).setSubject('u').setIssuedAt().setExpirationTime('5m')
    .sign(privateKey);

  await assert.rejects(verifyAccessToken(noKidToken, { issuer: ISSUER, audience: AUD, jwks: multiJwks }), (e) => e.code === 'invalid_token');
});

test('JWKS endpoint returning 500 throws unavailable', async () => {
  const server = createServer((req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error": "server error"}');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    await assert.rejects(
      verifyAccessToken(await sign(), { issuer: `http://127.0.0.1:${port}`, audience: AUD }),
      (e) => e.code === 'unavailable'
    );
  } finally {
    server.close();
  }
});

test('JWKS endpoint returning unparseable JSON throws unavailable', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('not json at all');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    await assert.rejects(
      verifyAccessToken(await sign(), { issuer: `http://127.0.0.1:${port}`, audience: AUD }),
      (e) => e.code === 'unavailable'
    );
  } finally {
    server.close();
  }
});
