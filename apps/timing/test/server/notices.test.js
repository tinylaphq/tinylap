// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Accounts' membership notices (spec §4.2): a notice carries no authority. It
// marks the users' tokens stale and has their open streams check now, so only
// refreshed claims decide whether a stream ends.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { removeMember } from '../../../accounts/server/workspaces.js';
import { testSession } from '../../../accounts/test/helpers.js';
import { startTiming } from './helpers.js';
import { events, next } from './sse.js';

const TOKEN = 'n-test';
let app;
let ana;
let office;
let bare;

before(async () => {
  app = await startTiming({ noticeToken: TOKEN });
  ana = await app.signUp('Ana');
  office = app.club(ana, 'Office');
  bare = await startTiming();
});
after(() => Promise.all([app.close(), bare.close()]));

/** Posts a notice to `at`, by default with the right bearer. */
const notice = (body, { at = app, auth = `Bearer ${TOKEN}`, raw } = {}) =>
  fetch(`${at.base}/notices/membership`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: raw ?? JSON.stringify(body),
  });

/** A new member of the office, signed in, with the board stream open. */
async function watching(name) {
  const user = await app.signUp(name);
  app.join(ana, office.id, user);
  const who = await app.login(user);
  const res = await app.api(who, 'GET', `/clubs/${office.id}/board/events`);
  assert.equal(res.status, 200);
  const it = events(res, { raw: true });
  assert.ok(await next(it, 'board'));
  return { user, who, it };
}

test('a notice for a removed member ends their board stream and the reconnect gets 404', async () => {
  const { user, who, it } = await watching('Cy');
  removeMember(app.suite.accounts.db, ana.id, office.id, user.id);
  assert.equal((await notice({ users: [user.id] })).status, 204);
  assert.equal(await next(it, 'ended'), null);
  const again = await app.api(who, 'GET', `/clubs/${office.id}/board/events`);
  assert.equal(again.status, 404);
});

test('a notice for a removed member ends their JSON live stream and the reconnect gets 404', async () => {
  const user = await app.signUp('Gus');
  app.join(ana, office.id, user);
  const who = await app.login(user);
  const res = await app.api(who, 'GET', `/workspaces/${office.id}/live`);
  assert.equal(res.status, 200);
  const it = events(res);
  assert.ok(await next(it, 'snapshot'));
  removeMember(app.suite.accounts.db, ana.id, office.id, user.id);
  assert.equal((await notice({ users: [user.id] })).status, 204);
  assert.equal(await next(it, 'ended'), null);
  const again = await app.api(who, 'GET', `/workspaces/${office.id}/live`);
  assert.equal(again.status, 404);
});

test('removing a member in accounts\' API ends their open stream in timing', async () => {
  const { user, it } = await watching('Fay');
  const owner = await testSession(app.suite.accounts.auth, ana.id);
  const res = await fetch(`${app.suite.issuer}/api/clubs/${office.id}/members/${user.id}`, {
    method: 'DELETE',
    headers: { 'sec-fetch-site': 'same-origin', cookie: owner.header() },
  });
  assert.equal(res.status, 204);
  assert.equal(await next(it, 'ended'), null);
});

test('a notice for a member still allowed leaves the stream open', async () => {
  const { user, it } = await watching('Dee');
  assert.equal((await notice({ users: [user.id] })).status, 204);
  app.hub.publish(office.id, 'still-open', {});
  assert.ok(await next(it, 'board'));
  await it.return();
});

test('a notice for a user without streams is 204', async () => {
  assert.equal((await notice({ users: ['nobody'] })).status, 204);
});

test('a notice that arrives during a running check still ends a removed member\'s stream', async () => {
  const { user, it } = await watching('Eve');
  const { bff } = app.auth;
  const session = bff.session;
  let calls = 0;
  let release;
  const gate = new Promise((done) => { release = done; });
  bff.session = async (...args) => {
    calls += 1;
    if (calls > 1) return session.apply(bff, args);
    // The first check reads the claims as they are now, then is held.
    const found = await session.apply(bff, args);
    await gate;
    return found;
  };
  try {
    assert.equal((await notice({ users: [user.id] })).status, 204);
    for (let waits = 0; calls < 1 && waits < 100; waits += 1) await new Promise((done) => setTimeout(done, 20));
    assert.equal(calls, 1);
    removeMember(app.suite.accounts.db, ana.id, office.id, user.id);
    assert.equal((await notice({ users: [user.id] })).status, 204);
    release();
    assert.equal(await next(it, 'ended'), null);
  } finally {
    release();
    bff.session = session;
  }
});

test('a wrong or missing bearer is 401 and marks nothing', async () => {
  const { bff } = app.auth;
  const stale = bff.stale;
  let calls = 0;
  bff.stale = (...args) => {
    calls += 1;
    return stale.apply(bff, args);
  };
  try {
    for (const auth of ['Bearer wrong', 'Basic bi10ZXN0', TOKEN, null]) {
      const res = await notice({ users: ['u1'] }, { auth });
      assert.equal(res.status, 401);
      assert.equal(res.headers.get('www-authenticate'), 'Bearer realm="notices"');
    }
  } finally {
    bff.stale = stale;
  }
  assert.equal(calls, 0);
});

test('a bad body is 422', async () => {
  const bodies = [{}, { users: 'x' }, { users: [] }, { users: [''] }, { users: [1] }, { users: Array.from({ length: 1001 }, (_, i) => `u${i}`) }];
  for (const body of bodies) assert.equal((await notice(body)).status, 422, JSON.stringify(body).slice(0, 30));
  assert.equal((await notice(null, { raw: '[]' })).status, 422);
});

test('a body over the limit is 413', async () => {
  assert.equal((await notice({ users: ['x'.repeat(70_000)] })).status, 413);
});

test('without a notice token the route is 404', async () => {
  assert.equal((await notice({ users: ['u1'] }, { at: bare })).status, 404);
});
