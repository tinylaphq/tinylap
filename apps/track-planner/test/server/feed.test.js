// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The deletions feed (identity spec §7) against a real accounts: a deleted
// user's planner sessions go, the cursor advances, and an outage is logged
// once and survived.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClub, deleteClub, deleteUser } from '../../../accounts/server/workspaces.js';
import { startFeed } from '../../server/feed.js';
import { startPlanner } from './helpers.js';

/** @type {Awaited<ReturnType<typeof startPlanner>>} */
let planner;

before(async () => {
  planner = await startPlanner();
});
after(() => planner.close());

/** A feed reading the suite's accounts, its interval never firing during a test. */
function feedFor(store, extra = {}) {
  /** @type {string[]} */
  const logged = [];
  const feed = startFeed({
    issuer: planner.suite.issuer, token: 'feed-test', store, intervalMs: 3_600_000, poll: false,
    logger: { warn: (message) => void logged.push(message), info: () => {} }, ...extra,
  });
  return { feed, logged };
}

const loggedIn = async (jar) => (await (await fetch(`${planner.base}/auth/me`, { headers: { cookie: jar.header() } })).json()).loggedIn;

test('deleting a user in accounts removes their planner sessions after a poll', async (t) => {
  const removed = [];
  const store = { ...planner.store, sessions: planner.store.sessions, deleteWorkspaceData: (id) => void removed.push(id) };
  const { feed } = feedFor(store);
  t.after(() => feed.stop());
  await feed.poll(); // past everything deleted so far

  const gone = await planner.login('/', 'Gone');
  const kept = await planner.login('/', 'Kept');
  const club = createClub(planner.suite.accounts.db, kept.user.id, 'Stays Then Goes');
  assert.equal(await loggedIn(gone.jar), true);
  await deleteUser(planner.suite.accounts.db, planner.suite.accounts.auth, gone.user.id);
  deleteClub(planner.suite.accounts.db, kept.user.id, club.id);

  const before = planner.store.feedCursor();
  const result = await feed.poll();
  assert.equal(result.processed, 2);
  assert.equal(await loggedIn(gone.jar), false, 'the deleted user is logged out');
  assert.equal(await loggedIn(kept.jar), true, 'others are not');
  assert.deepEqual(removed, [club.id], "the club's data is removed");

  assert.equal(planner.store.feedCursor(), before + 2, 'the cursor advanced');
  assert.equal((await feed.poll()).processed, 0, 'a second poll processes nothing new');
  assert.equal(planner.store.feedCursor(), before + 2);
});

test('the feed reads every page, not just the first', async (t) => {
  const pages = [
    { deletions: [{ seq: 1, kind: 'user', id: 'a', deletedAt: 'x' }, { seq: 2, kind: 'user', id: 'b', deletedAt: 'x' }], next: 2 },
    { deletions: [{ seq: 3, kind: 'workspace', id: 'w', deletedAt: 'x' }], next: 3 },
    { deletions: [], next: 3 },
  ];
  const asked = [];
  const users = [];
  const cursor = { seq: 0 };
  const forgotten = [];
  const store = {
    sessions: { deleteUser: async (id) => void users.push(id) },
    forgetUser: (id) => void forgotten.push(id),
    deleteWorkspaceData: () => {},
    feedCursor: () => cursor.seq,
    setFeedCursor: (seq) => { cursor.seq = seq; },
  };
  const { feed } = feedFor(store, {
    fetch: async (url, init) => {
      asked.push(new URL(url).searchParams.get('after'));
      assert.equal(init.headers.authorization, 'Bearer feed-test');
      return Response.json(pages.shift());
    },
  });
  t.after(() => feed.stop());
  assert.equal((await feed.poll()).processed, 3);
  assert.deepEqual(asked, ['0', '2', '3']);
  assert.deepEqual(users, ['a', 'b']);
  assert.deepEqual(forgotten, ['a', 'b'], 'their names on library saves go too');
  assert.equal(cursor.seq, 3);
});

test('a refused feed token is logged and keeps the cursor', async (t) => {
  const { feed, logged } = feedFor(planner.store, { token: 'wrong' });
  t.after(() => feed.stop());
  const before = planner.store.feedCursor();
  await feed.poll();
  assert.equal(planner.store.feedCursor(), before);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /401/);
});

// Last: it stops accounts.
test('accounts down: the poll logs once per failure streak, does not throw, and keeps the cursor', async (t) => {
  const { feed, logged } = feedFor(planner.store);
  t.after(() => feed.stop());
  await feed.poll();
  const before = planner.store.feedCursor();
  await planner.suite.close();
  const result = await feed.poll();
  assert.equal(result.processed, 0);
  assert.ok(result.error);
  await feed.poll();
  assert.equal(planner.store.feedCursor(), before);
  assert.equal(logged.length, 1, 'one line for the whole streak');
  assert.match(logged[0], /deletions feed/i);
  assert.doesNotMatch(logged[0], /feed-test/, 'never the token');
});

test('startFeed reads on start and on its interval, and stop() ends it', async () => {
  let calls = 0;
  const cursor = { seq: 0 };
  const store = { sessions: { deleteUser: async () => {} }, forgetUser: () => {}, deleteWorkspaceData: () => {}, feedCursor: () => cursor.seq, setFeedCursor: (s) => { cursor.seq = s; } };
  const feed = startFeed({
    issuer: 'http://feed.test', token: 't', store, intervalMs: 20,
    logger: { warn: () => {}, info: () => {} },
    fetch: async () => { calls += 1; return Response.json({ deletions: [], next: 0 }); },
  });
  await new Promise((resolve) => setTimeout(resolve, 70));
  feed.stop();
  const seen = calls;
  assert.ok(seen >= 3, `read on start and then on the interval (${seen})`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls, seen, 'nothing after stop()');
});
