// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Setup says when a decoder was last seen as how long ago by the server's
// clock, not as a bare UTC time.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

const clock = { now: Date.UTC(2026, 9, 15, 12, 0, 0) };
let app;
let who;

before(async () => {
  app = await startTiming({ clock });
  who = await app.login(await app.signUp('Ana'));
});
after(() => app.close());

test('a decoder is seen "N min ago", with its exact time kept in datetime', async () => {
  const res = await app.form(who, '/personal/decoders', { name: 'Gate' });
  assert.equal(res.status, 303);
  const [decoder] = app.store.decoders(await personalId());
  const seen = clock.now - 5 * 60_000;
  app.store.touchDecoder(decoder.id, seen);
  const body = await (await app.api(who, 'GET', '/personal/setup', undefined, { accept: 'text/html' })).text();
  assert.match(body, new RegExp(`seen <time datetime="${new Date(seen).toISOString()}">5 min ago</time>`));
  assert.doesNotMatch(body, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}</);
});

async function personalId() {
  const me = await (await app.api(who, 'GET', '/auth/me')).json();
  return me.workspaces[0].id;
}
