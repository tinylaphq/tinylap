// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../server/config.js';

const SECRET = 'x'.repeat(32);
const client = (redirect = 'https://planner.tinylap.test/auth/callback') => ({
  clientId: 'planner',
  clientSecret: 'planner-secret',
  redirectUris: [redirect],
  postLogoutRedirectUris: ['https://planner.tinylap.test/'],
  resource: 'https://planner.tinylap.test',
});
const env = (overrides = {}) => ({
  TINYLAP_ISSUER: 'https://accounts.tinylap.test',
  BETTER_AUTH_SECRET: SECRET,
  TINYLAP_CLIENTS: JSON.stringify([client()]),
  TINYLAP_FEED_TOKENS: 'feed-a, feed-b',
  ...overrides,
});

test('a valid env parses', () => {
  const config = readConfig(env({ PORT: '4200', TINYLAP_DB: '/tmp/a.sqlite' }));
  assert.equal(config.issuer, 'https://accounts.tinylap.test');
  assert.equal(config.dev, false);
  assert.equal(config.secret, SECRET);
  assert.equal(config.port, 4200);
  assert.equal(config.dbPath, '/tmp/a.sqlite');
  assert.equal(config.accessTtlSeconds, 600);
  assert.deepEqual(config.feedTokens, ['feed-a', 'feed-b']);
  assert.deepEqual(config.clients, [{ ...client(), trusted: true }]);
});

test('defaults: port 4100, the volume database, no feed tokens', () => {
  const config = readConfig(env({ TINYLAP_FEED_TOKENS: undefined }));
  assert.equal(config.port, 4100);
  assert.equal(config.dbPath, '/data/accounts.sqlite');
  assert.deepEqual(config.feedTokens, []);
  assert.equal(config.clientIpHeader, null);
});

test('the client address header is read in lower case', () => {
  assert.equal(readConfig(env({ TINYLAP_CLIENT_IP_HEADER: 'Fly-Client-IP' })).clientIpHeader, 'fly-client-ip');
});

test('dev mode allows loopback redirect URIs and defaults to an in-memory database', () => {
  const config = readConfig(env({
    TINYLAP_DEV: '1',
    TINYLAP_ISSUER: 'http://localhost:4100',
    TINYLAP_CLIENTS: JSON.stringify([client('http://127.0.0.1:8000/auth/callback')]),
  }));
  assert.equal(config.dev, true);
  assert.equal(config.dbPath, ':memory:');
});

test('TINYLAP_DEV=1 with an https issuer throws', () => {
  assert.throws(() => readConfig(env({ TINYLAP_DEV: '1' })), /TINYLAP_DEV.*https/);
});

test('a missing or short BETTER_AUTH_SECRET throws', () => {
  assert.throws(() => readConfig(env({ BETTER_AUTH_SECRET: undefined })), /BETTER_AUTH_SECRET/);
  assert.throws(() => readConfig(env({ BETTER_AUTH_SECRET: 'x'.repeat(31) })), /BETTER_AUTH_SECRET/);
});

test('a missing issuer throws', () => {
  assert.throws(() => readConfig(env({ TINYLAP_ISSUER: undefined })), /TINYLAP_ISSUER/);
});

test('TINYLAP_CLIENTS that is not valid JSON throws', () => {
  assert.throws(() => readConfig(env({ TINYLAP_CLIENTS: '[{' })), /TINYLAP_CLIENTS/);
});

test('a client without a secret or resource throws', () => {
  const noSecret = client();
  delete noSecret.clientSecret;
  assert.throws(() => readConfig(env({ TINYLAP_CLIENTS: JSON.stringify([noSecret]) })), /clientSecret/);
  const noResource = client();
  delete noResource.resource;
  assert.throws(() => readConfig(env({ TINYLAP_CLIENTS: JSON.stringify([noResource]) })), /resource/);
});

test('a loopback redirect URI without TINYLAP_DEV throws', () => {
  for (const uri of ['http://127.0.0.1:8000/auth/callback', 'http://localhost/cb', 'https://[::1]/cb']) {
    assert.throws(() => readConfig(env({ TINYLAP_CLIENTS: JSON.stringify([client(uri)]) })), /loopback/);
  }
});

test('a plain-http redirect URI outside dev mode throws', () => {
  assert.throws(() => readConfig(env({ TINYLAP_CLIENTS: JSON.stringify([client('http://planner.tinylap.test/cb')]) })), /https/);
});

test('TINYLAP_ACCESS_TTL is honoured only in dev mode', () => {
  const dev = { TINYLAP_DEV: '1', TINYLAP_ISSUER: 'http://localhost:4100' };
  assert.equal(readConfig(env({ ...dev, TINYLAP_ACCESS_TTL: '5' })).accessTtlSeconds, 5);
  assert.throws(() => readConfig(env({ TINYLAP_ACCESS_TTL: '5' })), /TINYLAP_ACCESS_TTL.*TINYLAP_DEV/);
  assert.throws(() => readConfig(env({ ...dev, TINYLAP_ACCESS_TTL: 'soon' })), /TINYLAP_ACCESS_TTL/);
});
