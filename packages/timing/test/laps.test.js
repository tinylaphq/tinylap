// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { lapsOf, nextLap } from '../index.js';

const at = (t, boot = 'b00tb00t') => ({ boot, t });
const kinds = (steps) => steps.map((s) => (s.kind === 'lap' ? s.ms : s.kind));

test('the first passing starts, the next completes a lap', () => {
  assert.deepEqual(kinds(lapsOf([at(1000), at(9500), at(17_800)])), ['start', 8500, 8300]);
});

test('a double read is dropped and the lap is measured from the first read', () => {
  assert.deepEqual(kinds(lapsOf([at(1000), at(9500), at(9600), at(18_000)])), ['start', 8500, 'double', 8500]);
});

test('a gap longer than maxLap is a parked car: no lap, a new start', () => {
  assert.deepEqual(kinds(lapsOf([at(0), at(8000), at(90_000), at(98_000)])), ['start', 8000, 'start', 8000]);
});

test('a new boot is a new start', () => {
  assert.deepEqual(kinds(lapsOf([at(1000), at(9000), at(500, 'n3wb00t1'), at(8500, 'n3wb00t1')])), ['start', 8000, 'start', 8000]);
});

test('a passing older than the reference makes no lap and keeps the reference', () => {
  assert.deepEqual(kinds(lapsOf([at(1000), at(9000), at(5000), at(17_000)])), ['start', 8000, 'backwards', 8000]);
});

test('limits are options, and the bounds themselves are laps', () => {
  assert.equal(nextLap(at(0), at(1500)).kind, 'lap');
  assert.equal(nextLap(at(0), at(1499)).kind, 'double');
  assert.equal(nextLap(at(0), at(60_000)).kind, 'lap');
  assert.equal(nextLap(at(0), at(60_001)).kind, 'start');
  assert.equal(nextLap(at(0), at(500), { minLap: 100 }).kind, 'lap');
  assert.equal(nextLap(at(0), at(20_000), { maxLap: 10_000 }).kind, 'start');
});
