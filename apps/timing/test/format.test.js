// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, formatLap } from '../public/format.js';

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
