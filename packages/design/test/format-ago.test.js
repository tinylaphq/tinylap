// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAgo } from '../format-ago.js';

test('formatAgo says how long ago, then the date', () => {
  const now = Date.UTC(2026, 9, 15, 12, 0, 0);
  assert.equal(formatAgo(now, now), 'just now');
  assert.equal(formatAgo(now - 59_000, now), 'just now');
  assert.equal(formatAgo(now + 5000, now), 'just now');
  assert.equal(formatAgo(now - 60_000, now), '1 min ago');
  assert.equal(formatAgo(now - 59 * 60_000, now), '59 min ago');
  assert.equal(formatAgo(now - 3_600_000, now), '1 h ago');
  assert.equal(formatAgo(now - 23 * 3_600_000 - 59 * 60_000, now), '23 h ago');
  assert.equal(formatAgo(Date.UTC(2026, 9, 14, 11, 0, 0), now), '14 Oct 2026');
});
