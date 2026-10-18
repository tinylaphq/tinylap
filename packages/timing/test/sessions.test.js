// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCrossing, emptyState, isComplete, standings } from '../index.js';

const practice = { kind: 'practice', roster: null, opensAt: null, closesAt: null };
const qualifying = { kind: 'qualifying', roster: ['ana', 'ben'], opensAt: 100_000, closesAt: 400_000 };
const race = { kind: 'race', roster: ['ana', 'ben'], opensAt: 100_000, closesAt: 400_000 };

/** Applies crossings `[driverId, at, lapMs]` and returns what counted. */
function run(rules, crossings, state = emptyState()) {
  return { state, counted: crossings.map(([driverId, at, lapMs]) => applyCrossing(rules, state, { driverId, at, lapMs })) };
}

test('practice counts every lap of every known driver', () => {
  const { state, counted } = run(practice, [['ana', 1000, null], ['ana', 9000, 8000], ['ben', 9500, 7900], [null, 9600, 7000]]);
  assert.deepEqual(counted, [false, true, true, false]);
  assert.deepEqual(standings(practice, state).map((s) => [s.driverId, s.position, s.bestMs]), [['ben', 1, 7900], ['ana', 2, 8000]]);
});

test('practice standings leave out drivers without a lap', () => {
  const { state } = run(practice, [['ana', 1000, null]]);
  assert.deepEqual(standings(practice, state), []);
});

test('qualifying counts laps begun inside the window', () => {
  const { counted } = run(qualifying, [
    ['ana', 105_000, 8000], // began at 97 000, before the window
    ['ana', 113_000, 8000], // began at 105 000
    ['ana', 407_999, 8000], // began at 399 999, a millisecond before the close
    ['ana', 416_000, 8001], // began at 407 999, after the close
    ['zed', 120_000, 8000], // not on the roster
  ]);
  assert.deepEqual(counted, [false, true, true, false, false]);
});

test('qualifying ranks by best lap, then by who set it first', () => {
  const { state } = run(qualifying, [['ana', 120_000, 8000], ['ben', 110_000, 8000], ['ben', 118_000, 8000]]);
  assert.deepEqual(standings(qualifying, state).map((s) => s.driverId), ['ben', 'ana']);
});

test('a race starts each driver at their first crossing after go', () => {
  const { state, counted } = run(race, [
    ['ana', 99_000, null], // before go: ignored
    ['ana', 100_400, 1400], // first crossing after go: the start, not a lap
    ['ana', 108_400, 8000],
    ['ben', 101_000, 8000], // ben's start, even with a lap time from practice
    ['ben', 108_900, 7900],
  ]);
  assert.deepEqual(counted, [false, false, true, false, true]);
  assert.equal(state.drivers.ana.startAt, 100_400);
  assert.equal(state.drivers.ana.laps, 1);
});

test('when time is up each driver finishes at their next crossing', () => {
  const { state, counted } = run(race, [
    ['ana', 100_000, null], ['ana', 399_000, 8000], ['ana', 407_000, 8000], ['ana', 415_000, 8000],
  ]);
  assert.deepEqual(counted, [false, true, true, false]);
  assert.equal(state.drivers.ana.finished, true);
});

test('a race ranks by laps, then by reaction plus lap time', () => {
  const { state } = run(race, [
    ['ana', 100_100, null], ['ana', 108_100, 8000],
    ['ben', 100_500, null], ['ben', 108_400, 7900],
  ]);
  // ana: 100 + 8000 = 8100; ben: 500 + 7900 = 8400
  const rows = standings(race, state);
  assert.deepEqual(rows.map((s) => [s.driverId, s.elapsedMs]), [['ana', 8100], ['ben', 8400]]);
  const more = run(race, [['ben', 116_300, 7900]], state).state;
  assert.equal(standings(race, more)[0].driverId, 'ben');
});

test('a roster driver without crossings is listed last', () => {
  const { state } = run(race, [['ana', 100_100, null], ['ana', 108_100, 8000]]);
  assert.deepEqual(standings(race, state).map((s) => [s.driverId, s.laps]), [['ana', 1], ['ben', 0]]);
});

test('a race is complete when everyone finished, or a lap after time up', () => {
  const { state } = run(race, [['ana', 100_100, null], ['ana', 401_000, 8000]]);
  assert.equal(isComplete(race, state, 401_000), false); // ben has not finished
  run(race, [['ben', 100_200, null], ['ben', 402_000, 8000]], state);
  assert.equal(isComplete(race, state, 402_000), true);
  assert.equal(isComplete(race, emptyState(), 460_000), true); // 400 000 + maxLap
  assert.equal(isComplete(race, emptyState(), 459_999), false);
});

test('qualifying is complete when every driver crossed after the close', () => {
  const { state } = run(qualifying, [['ana', 401_000, 8000]]);
  assert.equal(isComplete(qualifying, state, 401_000), false);
  run(qualifying, [['ben', 402_000, 8000]], state);
  assert.equal(isComplete(qualifying, state, 402_000), true);
  assert.equal(isComplete(practice, emptyState(), Number.MAX_SAFE_INTEGER), false);
});

test('standings carry each driver’s last crossing, counted or not', () => {
  const p = run(practice, [['ana', 1000, null], ['ana', 9000, 8000]]);
  assert.equal(standings(practice, p.state)[0].lastAt, 9000);
  const r = run(race, [['ana', 50_000, null]]); // before go
  const rows = standings(race, r.state);
  assert.equal(rows.find((s) => s.driverId === 'ana').lastAt, 50_000);
  assert.equal(rows.find((s) => s.driverId === 'ben').lastAt, null);
  const q = run(qualifying, [['ana', 105_000, 10_000]]); // began before the window: not counted
  const ana = standings(qualifying, q.state).find((s) => s.driverId === 'ana');
  assert.equal(ana.lastAt, 105_000);
  assert.equal(ana.laps, 0);
});
