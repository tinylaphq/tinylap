// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAgo, formatClock, formatLap, formatLength } from '../public/format.js';

test('lap times to the millisecond, minutes past a minute', () => {
  assert.equal(formatLap(8000), '8.000');
  assert.equal(formatLap(12_345), '12.345');
  assert.equal(formatLap(62_345), '1:02.345');
  assert.equal(formatLap(null), '—');
  assert.equal(formatLap(undefined), '—');
});

test('the session clock counts whole seconds, rounded up, never negative', () => {
  assert.equal(formatClock(300_000), '5:00');
  assert.equal(formatClock(299_001), '5:00');
  assert.equal(formatClock(59_000), '0:59');
  assert.equal(formatClock(-5), '0:00');
  assert.equal(formatClock(3_600_000), '60:00');
});

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

test('formatLength says seconds under a minute, and minutes plus seconds when not whole', () => {
  assert.equal(formatLength(30_000), '30 seconds');
  assert.equal(formatLength(1000), '1 second');
  assert.equal(formatLength(60_000), '1 minute');
  assert.equal(formatLength(180_000), '3 minutes');
  assert.equal(formatLength(90_000), '1 minute 30 seconds');
  assert.equal(formatLength(121_000), '2 minutes 1 second');
});
