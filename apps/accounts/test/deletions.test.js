// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The deletions feed (spec §7): every deleted club and user appends a row;
// consumers page through GET /deletions?after=<seq> with a bearer token.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readDeletions, recordDeletion } from '../server/deletions.js';
import { createClub, createPersonalWorkspace, deleteClub, deleteUser, WorkspaceError } from '../server/workspaces.js';
import { problemOf } from '../server/api.js';
import { createTestUser, startAccounts, testSession } from './helpers.js';

/** @type {Awaited<ReturnType<typeof startAccounts>>} */
let accounts;
before(async () => {
  accounts = await startAccounts({ env: { TINYLAP_FEED_TOKENS: 'feed-one, feed-two' } });
});
after(() => accounts.close());

const feed = (query = '', token = 'feed-one') =>
  fetch(`${accounts.issuer}/deletions${query}`, { headers: token === null ? {} : { authorization: `Bearer ${token}` } });

const last = () => Number(accounts.db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM deletion').get().s);

test('deleting a club and deleting a user each append a row with increasing seq', async () => {
  const start = last();
  const owner = (await createTestUser(accounts.auth, 'Owner')).id;
  const club = createClub(accounts.db, owner, 'Gone Club');
  deleteClub(accounts.db, owner, club.id);

  const leaver = (await createTestUser(accounts.auth, 'Leaver')).id;
  const personal = createPersonalWorkspace(accounts.db, leaver, 'Leaver');
  await testSession(accounts.auth, leaver);
  await deleteUser(accounts.db, accounts.auth, leaver);

  const { deletions, next } = readDeletions(accounts.db, start);
  assert.deepEqual(deletions.map(({ kind, id }) => ({ kind, id })), [
    { kind: 'workspace', id: club.id },
    { kind: 'workspace', id: personal },
    { kind: 'user', id: leaver },
  ]);
  const seqs = deletions.map((d) => d.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  assert.equal(new Set(seqs).size, 3);
  assert.equal(next, seqs.at(-1));
  for (const d of deletions) assert.ok(!Number.isNaN(Date.parse(d.deletedAt)));

  // The user and everything that hung on them are gone.
  assert.equal(accounts.db.prepare('SELECT COUNT(*) AS n FROM "user" WHERE id = ?').get(leaver).n, 0);
  assert.equal(accounts.db.prepare('SELECT COUNT(*) AS n FROM session WHERE userId = ?').get(leaver).n, 0);
  assert.equal(accounts.db.prepare('SELECT COUNT(*) AS n FROM workspace WHERE id = ?').get(personal).n, 0);
});

test('?after= pages through the feed', async () => {
  const start = last();
  const ids = ['a', 'b', 'c'].map((id) => recordDeletion(accounts.db, 'workspace', `page-${id}-${start}`));
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));

  const all = await (await feed(`?after=${start}`)).json();
  assert.deepEqual(all.deletions.map((d) => d.id), ['a', 'b', 'c'].map((id) => `page-${id}-${start}`));
  assert.equal(all.next, ids[2]);

  const rest = await (await feed(`?after=${ids[0]}`, 'feed-two')).json();
  assert.deepEqual(rest.deletions.map((d) => d.seq), [ids[1], ids[2]]);

  const none = await (await feed(`?after=${ids[2]}`)).json();
  assert.deepEqual(none, { deletions: [], next: ids[2] });

  const first = readDeletions(accounts.db, start, 2);
  assert.equal(first.deletions.length, 2);
  assert.equal(first.next, ids[1]);

  const res = await feed();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.ok((await res.json()).deletions.length >= 6, 'no after= starts from 0');

  for (const bad of ['?after=-1', '?after=x', '?after=1.5']) assert.equal((await feed(bad)).status, 400, bad);
});

test('a wrong or missing bearer token gives 401', async () => {
  for (const token of [null, 'feed-three', 'feed-on', '', 'feed-one-x']) {
    const res = await feed('', token);
    assert.equal(res.status, 401, String(token));
    assert.equal(res.headers.get('content-type'), 'application/problem+json');
    assert.match(res.headers.get('www-authenticate') ?? '', /^Bearer/);
  }
  const basic = await fetch(`${accounts.issuer}/deletions`, { headers: { authorization: 'Basic ZmVlZC1vbmU6' } });
  assert.equal(basic.status, 401);
});

test('without feed tokens configured, the feed refuses everyone', async () => {
  const bare = await startAccounts({ env: { TINYLAP_FEED_TOKENS: '' } });
  try {
    const res = await fetch(`${bare.issuer}/deletions`, { headers: { authorization: 'Bearer ' } });
    assert.equal(res.status, 401);
  } finally {
    await bare.close();
  }
});

test('deleting a user who owns a club gives 409 Problem Details naming the club', async () => {
  const owner = (await createTestUser(accounts.auth, 'Boss')).id;
  createPersonalWorkspace(accounts.db, owner, 'Boss');
  createClub(accounts.db, owner, 'Thunder Slot Club');
  const before = last();
  await assert.rejects(deleteUser(accounts.db, accounts.auth, owner), (error) => {
    assert.ok(error instanceof WorkspaceError);
    assert.equal(error.code, 'conflict');
    const p = problemOf(accounts.issuer, error);
    assert.equal(p.status, 409);
    assert.equal(p.type, `${accounts.issuer}/problems/conflict`);
    assert.match(p.detail, /Thunder Slot Club/);
    return true;
  });
  assert.equal(last(), before, 'nothing recorded');
  assert.equal(accounts.db.prepare('SELECT COUNT(*) AS n FROM "user" WHERE id = ?').get(owner).n, 1);
});
