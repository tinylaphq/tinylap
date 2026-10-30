// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRACK_PROBLEMS, fail } from '../../server/operations.js';
import { PROBLEMS } from '../../server/problems.js';

test('a failure takes its status from the problem table, and an unknown problem fails at once', () => {
  assert.deepEqual(fail('conflict', 'Busy.'), { error: { problem: 'conflict', status: 409, message: 'Busy.' } });
  assert.deepEqual(fail('invalid-request', 'Bad.', 'name').error.status, PROBLEMS['invalid-request'].status);
  assert.throws(() => fail('no-such-problem', 'x'), /unknown problem no-such-problem/);
});

test('every problem the operations and pages name is in the table', () => {
  const named = new Set(Object.values(TRACK_PROBLEMS));
  for (const file of ['operations.js', 'sessions-pages.js']) {
    const source = readFileSync(new URL(`../../server/${file}`, import.meta.url), 'utf8');
    for (const [, name] of source.matchAll(/\bfail\('([^']+)'/g)) named.add(name);
  }
  assert.ok(named.size >= 6, [...named].join(', '));
  for (const name of named) assert.ok(Object.hasOwn(PROBLEMS, name), name);
});
