// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The notifier splits a long user list into notices timing accepts (at most 1000 users each).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier } from '../server/notices.js';

test('1001 users go out as two notices of 1000 and 1', () => {
  const bodies = [];
  const fetch = async (_uri, init) => {
    bodies.push(JSON.parse(init.body).users);
    return new Response(null, { status: 204 });
  };
  const notify = createNotifier({ clients: [{ noticeUri: 'https://timing.test/notices/membership', noticeToken: 't' }], fetch });
  const users = Array.from({ length: 1001 }, (_, i) => `u${i}`);
  notify(users);
  assert.deepEqual(bodies.map((b) => b.length), [1000, 1]);
  assert.deepEqual(bodies.flat(), users);
});

test('no users send nothing', () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return new Response(null, { status: 204 });
  };
  createNotifier({ clients: [{ noticeUri: 'https://timing.test/n', noticeToken: 't' }], fetch })([]);
  assert.equal(calls, 0);
});
