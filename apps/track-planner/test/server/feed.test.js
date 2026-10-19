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

const OLD = '2026-01-01T00:00:00.000Z';

const loggedIn = async (jar) => (await (await fetch(`${planner.base}/auth/me`, { headers: { cookie: jar.header() } })).json()).loggedIn;

test('deleting a user in accounts removes their planner sessions after a poll', async (t) => {
  const removed = [];
  const store = { ...planner.store, sessions: planner.store.sessions, deleteWorkspaceData: (id) => void removed.push(id) };
  // As if one token lifetime and the skew had passed since each deletion.
  const { feed } = feedFor(store, { now: () => Date.now() + 11 * 60_000 });
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
    { deletions: [{ seq: 1, kind: 'user', id: 'a', deletedAt: OLD }, { seq: 2, kind: 'user', id: 'b', deletedAt: OLD }], next: 2 },
    { deletions: [{ seq: 3, kind: 'workspace', id: 'w', deletedAt: OLD }], next: 3 },
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

/** A store in memory, for feeds against a fake accounts. */
function memoryStore() {
  const cursor = { seq: 0 };
  const done = [];
  return {
    cursor, done,
    sessions: { deleteUser: async (id) => void done.push(`sessions:${id}`) },
    forgetUser: (id) => void done.push(`user:${id}`),
    deleteWorkspaceData: (id) => void done.push(`workspace:${id}`),
    feedCursor: () => cursor.seq,
    setFeedCursor: (seq) => { cursor.seq = seq; },
  };
}

test('a deletion younger than one token lifetime plus 60 s waits for a later poll', async (t) => {
  const MIN = 60_000;
  let clock = Date.parse('2026-10-14T12:00:00Z');
  const rows = [
    { seq: 1, kind: 'workspace', id: 'old', deletedAt: new Date(clock - 12 * MIN).toISOString() },
    { seq: 2, kind: 'workspace', id: 'young', deletedAt: new Date(clock - 5 * MIN).toISOString() },
    { seq: 3, kind: 'user', id: 'younger', deletedAt: new Date(clock - 1 * MIN).toISOString() },
  ];
  const asked = [];
  const store = memoryStore();
  const { feed } = feedFor(store, {
    accessTtlSeconds: 600,
    now: () => clock,
    fetch: async (url) => {
      const after = Number(new URL(url).searchParams.get('after'));
      asked.push(after);
      const deletions = rows.filter((r) => r.seq > after);
      return Response.json({ deletions, next: deletions.at(-1)?.seq ?? after });
    },
  });
  t.after(() => feed.stop());
  assert.equal((await feed.poll()).processed, 1);
  assert.deepEqual(store.done, ['workspace:old'], 'a token may still name the young club: it waits');
  assert.equal(store.cursor.seq, 1, 'the cursor stops before the first young row');
  assert.deepEqual(asked, [0], 'no further page once a young row is met');

  clock += 6 * MIN; // seq 2 is now 11 minutes old, seq 3 only 7
  assert.equal((await feed.poll()).processed, 1);
  assert.deepEqual(store.done, ['workspace:old', 'workspace:young']);
  clock += 5 * MIN;
  assert.equal((await feed.poll()).processed, 1);
  assert.deepEqual(store.done.slice(2), ['sessions:younger', 'user:younger']);
  assert.equal(store.cursor.seq, 3);
});

test('a page that does not move past the cursor, or holds a row it cannot read, is an error, not a loop', async (t) => {
  const old = '2026-01-01T00:00:00.000Z';
  const bad = [
    [{ seq: 0, kind: 'user', id: 'a', deletedAt: old }],
    [{ seq: 1.5, kind: 'user', id: 'a', deletedAt: old }],
    [{ seq: 1, kind: 'club', id: 'a', deletedAt: old }],
    [{ seq: 1, kind: 'user', id: 7, deletedAt: old }],
    [{ seq: 1, kind: 'user', id: 'a', deletedAt: 'yesterday' }],
    [{ seq: 2, kind: 'user', id: 'a', deletedAt: old }, { seq: 2, kind: 'user', id: 'b', deletedAt: old }],
  ];
  for (const deletions of bad) {
    let calls = 0;
    const store = memoryStore();
    const { feed, logged } = feedFor(store, {
      fetch: async () => {
        calls += 1;
        if (calls > 3) throw new Error('read again and again');
        return Response.json({ deletions, next: 1 });
      },
    });
    t.after(() => feed.stop());
    const result = await feed.poll();
    const what = JSON.stringify(deletions);
    assert.ok(result.error, what);
    assert.doesNotMatch(result.error.message, /again and again/, `${what}: stops at the first page`);
    assert.equal(calls, 1, what);
    assert.equal(logged.length, 1, what);
    assert.equal(store.cursor.seq, 0, `${what}: nothing of a bad page is processed`);
    assert.deepEqual(store.done, [], what);
  }
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
  // Wait for the reads themselves, not a fixed 70 ms: timers run late on a busy machine.
  const deadline = Date.now() + 5000;
  while (calls < 3 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  feed.stop();
  const seen = calls;
  assert.ok(seen >= 3, `read on start and then on the interval (${seen})`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls, seen, 'nothing after stop()');
});
