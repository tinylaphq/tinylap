// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../../server/store.js';
import { startFeed } from '../../server/feed.js';

test('the deletions feed removes a deleted workspace and a deleted user', async () => {
  const store = openStore(':memory:');
  store.ensureWorkspace('w1');
  store.addDriver('w1', { id: 'ana', name: 'Ana', colour: '#ff2d9b' });
  await store.sessions.set('s1', { userId: 'u1', sealedTokens: 'x', createdAt: 0, expiresAt: Date.now() + 60_000 });
  const pages = [
    { deletions: [{ seq: 1, kind: 'workspace', id: 'w1', deletedAt: '2026-01-01T00:00:00Z' }, { seq: 2, kind: 'user', id: 'u1', deletedAt: '2026-01-01T00:00:00Z' }] },
    { deletions: [] },
  ];
  const feed = startFeed({
    issuer: 'http://accounts.test', token: 't', store, poll: false, logger: { warn: () => {} },
    fetch: async () => new Response(JSON.stringify(pages.shift()), { headers: { 'content-type': 'application/json' } }),
  });
  assert.deepEqual(await feed.poll(), { processed: 2 });
  feed.stop();
  assert.equal(store.workspace('w1'), null);
  assert.deepEqual(store.drivers('w1'), []);
  assert.equal(await store.sessions.get('s1'), null);
  assert.equal(store.feedCursor(), 2);
});
