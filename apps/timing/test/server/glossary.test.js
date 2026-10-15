// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// What people read, the bridge shows API text too: Sign in, club and personal, never "log in" or "workspace".
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { AuthError } from '@tinylap/auth';
import { startServer, startTiming } from './helpers.js';

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
  const outage = { issuer: 'http://127.0.0.1:9', accountUrl: 'x', bff: { login: async () => { throw new AuthError('unavailable', 'down'); }, session: async () => null, callback: async () => ({ status: 400, headers: {}, body: undefined }) } };
  const server = await startServer({ auth: outage });
  try {
    const down = await (await fetch(`${server.base}/auth/login`, { headers: { accept: 'text/html' } })).text();
    assert.match(down, /Can&#39;t sign in right now/);
    assert.match(down, /Sign in again/);
    assert.doesNotMatch(down.replace(/href="[^"]*"/g, ''), /log[- ]?in/i);
    const failed = await (await fetch(`${server.base}/auth/callback`, { headers: { accept: 'text/html' } })).text();
    assert.doesNotMatch(failed.replace(/href="[^"]*"/g, ''), /log[- ]?in/i);
    const off = await (await fetch(`${server.base}/auth/login`)).json();
    assert.doesNotMatch(off.detail, /log[- ]?in/i);
  } finally {
    await server.close();
  }
});
