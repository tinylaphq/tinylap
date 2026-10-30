// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { clockAt, formatClock, formatLap, formatLength } from '../public/format.js';

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

test('clockAt: the clock and the phase that time alone decides', () => {
  const race = { kind: 'race', state: 'running', opensAt: 10_000, closesAt: 310_000 };
  assert.deepEqual(clockAt({ ...race, state: 'countdown' }, 5000), { phase: 'countdown', label: 'Starts in', ms: 5000 });
  assert.deepEqual(clockAt({ ...race, state: 'countdown' }, 10_000), { phase: 'running', label: 'Remaining', ms: 300_000 });
  assert.deepEqual(clockAt(race, 70_000), { phase: 'running', label: 'Remaining', ms: 240_000 });
  assert.deepEqual(clockAt(race, 310_000), { phase: 'finishing', label: 'Last lap', ms: 0 });
  assert.deepEqual(clockAt({ ...race, state: 'finishing' }, 400_000), { phase: 'finishing', label: 'Last lap', ms: 0 });
  assert.deepEqual(clockAt({ ...race, state: 'done' }, 400_000), { phase: 'done', label: 'Finished', ms: 0 });
  assert.deepEqual(clockAt({ ...race, state: 'aborted' }, 400_000), { phase: 'aborted', label: 'Aborted', ms: 0 });
  assert.equal(clockAt({ kind: 'qualifying', state: 'running', opensAt: 0, closesAt: 1000 }, 1000).phase, 'finishing');
  assert.deepEqual(clockAt({ kind: 'practice', state: 'running', opensAt: 1000, closesAt: null }, 61_000), { phase: 'running', label: 'Started', ms: 60_000 });
  assert.deepEqual(clockAt({ kind: 'practice', state: 'done', opensAt: 1000, closesAt: null }, 61_000), { phase: 'done', label: 'Ended', ms: 0 });
});

test('formatLength says seconds under a minute, and minutes plus seconds when not whole', () => {
  assert.equal(formatLength(30_000), '30 seconds');
  assert.equal(formatLength(1000), '1 second');
  assert.equal(formatLength(60_000), '1 minute');
  assert.equal(formatLength(180_000), '3 minutes');
  assert.equal(formatLength(90_000), '1 minute 30 seconds');
  assert.equal(formatLength(121_000), '2 minutes 1 second');
});
