// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// What people read, the bridge shows API text too: Sign in, club and personal, never "log in" or "workspace".
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthError, createBff } from '@tinylap/auth';
import { BANNED, exempt, openapiStrings, proseLiterals, visibleText } from '../../../../tools/glossary.js';
import { startServer, startTiming } from './helpers.js';

const appDir = fileURLToPath(new URL('../../', import.meta.url));
const banned = (text) => BANNED.test(exempt(text));

/** @param {string} dir @returns {string[]} */
const sources = (dir) => readdirSync(join(appDir, dir), { recursive: true, encoding: 'utf8' })
  .filter((name) => name.endsWith('.js'))
  .map((name) => join(dir, name));

let app;
before(async () => { app = await startTiming(); });
after(() => app.close());

test('API refusals say "sign in", "club" and "personal"', async () => {
  const signedOut = await (await app.api(null, 'GET', '/workspaces/w1/drivers')).json();
  assert.equal(signedOut.detail, 'Sign in to use timing.');
  const decoder = await (await app.api(null, 'POST', '/decoders/d1/passings', {})).json();
  assert.doesNotMatch(decoder.detail, /workspace|logged in|log in/i);
  assert.match(decoder.detail, /club or personal space|signed in/);
  const who = await app.login(await app.signUp('Ana'));
  const unknown = await (await app.api(who, 'GET', '/workspaces/nope/drivers')).json();
  assert.doesNotMatch(unknown.detail, /workspace|log in/i);
});

test('the sign-in failure pages say "sign in"', async () => {
  // A real BFF: a callback without its sign-in cookie answers 400 with the
  // body the page shows, before it asks the issuer anything.
  const real = createBff({ issuer: 'http://127.0.0.1:9', clientId: 'x', redirectUri: 'http://127.0.0.1/auth/callback', keys: [{ id: 'k1', key: randomBytes(32) }], store: new Map() });
  const refused = await real.callback({ headers: {}, url: '/auth/callback?code=c&state=s' });
  assert.equal(refused.status, 400);
  const outage = { issuer: 'http://127.0.0.1:9', accountUrl: 'x', bff: { login: async () => { throw new AuthError('unavailable', 'down'); }, session: async () => null, callback: real.callback } };
  const server = await startServer({ auth: outage });
  try {
    const down = await (await fetch(`${server.base}/auth/login`, { headers: { accept: 'text/html' } })).text();
    assert.match(down, /Can&#39;t sign in right now/);
    assert.match(down, /Sign in again/);
    assert.doesNotMatch(down.replace(/href="[^"]*"/g, ''), /log[- ]?in/i);
    assert.match(down, /<title>Can&#39;t sign in right now · TinyLap Timing<\/title>/);
    const failed = await (await fetch(`${server.base}/auth/callback`, { headers: { accept: 'text/html' } })).text();
    assert.ok(failed.includes(`<p>${refused.body}</p>`), 'the BFF says why on the page');
    assert.ok(!banned(visibleText(failed)), visibleText(failed));
    const off = await (await fetch(`${server.base}/auth/login`)).json();
    assert.doesNotMatch(off.detail, /log[- ]?in/i);
  } finally {
    await server.close();
  }
});

test('the API description says "sign in", "club" and "personal"', () => {
  const doc = JSON.parse(readFileSync(join(appDir, 'server/openapi.json'), 'utf8'));
  const strings = openapiStrings(doc);
  assert.ok(strings.length > 50, 'the description is read');
  assert.deepEqual(strings.filter(banned), []);
});

test('the words in the sources follow the glossary', () => {
  const files = [...sources('server'), ...sources('public')];
  assert.ok(files.some((file) => file.startsWith(join('server', 'views'))), 'server/views is read');
  const found = files.flatMap((file) => proseLiterals(readFileSync(join(appDir, file), 'utf8')).map((l) => ({ ...l, file })));
  assert.ok(found.length > 100, 'the prose is read');
  assert.deepEqual(found.filter((l) => banned(l.text)).map((l) => `${l.file}:${l.line}: ${l.text}`), []);
});
