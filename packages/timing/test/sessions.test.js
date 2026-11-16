// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCrossing, emptyState, finishLimit, isComplete, standings } from '../index.js';

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

test('practice counts only laps begun at or after its start', () => {
  const started = { ...practice, opensAt: 100_000 };
  const { counted } = run(started, [['ana', 95_000, 8000], ['ana', 103_000, 8000], ['ana', 111_000, 8000]]);
  assert.deepEqual(counted, [false, false, true]);
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

test('a race without a roster classifies whoever crossed, and leaves out a car that never did', () => {
  const open = { ...race, roster: null };
  const { state, counted } = run(open, [['ana', 100_100, null], ['ana', 108_100, 8000], ['cy', 100_300, null], ['cy', 109_300, 9000], ['cy', 118_200, 8900], [null, 118_300, 7000]]);
  assert.deepEqual(counted, [false, true, false, true, true, false]);
  assert.deepEqual(standings(open, state).map((s) => [s.driverId, s.position, s.laps]), [['cy', 1, 2], ['ana', 2, 1]]);
});

test('a race without a roster ends when each who crossed has finished', () => {
  const open = { ...race, roster: null };
  assert.equal(isComplete(open, emptyState(), 400_000), true); // nobody drove
  const { state } = run(open, [['ana', 100_100, null], ['ben', 100_200, null], ['ana', 401_000, 8000]]);
  assert.equal(isComplete(open, state, 401_000), false); // ben has not finished
  run(open, [['ben', 402_000, 8000]], state);
  assert.equal(isComplete(open, state, 402_000), true);
});

test('a race ends at the latest twice the slowest best lap after the close, and never under maxLap', () => {
  const open = { ...race, roster: null };
  // ana stopped for good; ben's best is 45 s, so the limit is 90 s.
  const { state } = run(open, [['ana', 100_100, null], ['ana', 108_100, 8000], ['ben', 100_200, null], ['ben', 145_200, 45_000], ['ben', 401_000, 50_000]]);
  assert.equal(finishLimit(open, state), 90_000);
  assert.equal(isComplete(open, state, 489_999), false);
  assert.equal(isComplete(open, state, 490_000), true);
  // With fast laps only, maxLap is the limit.
  const fast = run(open, [['ana', 100_100, null], ['ana', 108_100, 8000]]).state;
  assert.equal(finishLimit(open, fast), 60_000);
  assert.equal(finishLimit(open, fast, 10_000), 16_000);
});

test('without a roster, a crossing before the start makes no entrant', () => {
  const open = { ...race, roster: null };
  const { state, counted } = run(open, [['ben', 99_000, null], ['ana', 100_100, null], ['ana', 108_100, 8000]]);
  assert.deepEqual(counted, [false, false, true]);
  assert.deepEqual(Object.keys(state.drivers), ['ana']);
  run(open, [['ana', 401_000, 8000]], state);
  assert.equal(isComplete(open, state, 401_000), true, 'ben never raced');
  const quali = { ...qualifying, roster: null };
  const q = run(quali, [['ben', 99_500, 7000], ['ana', 108_000, 8000]]).state;
  assert.deepEqual(standings(quali, q).map((s) => s.driverId), ['ana']);
  // With a roster, as before, the countdown crossing keeps its driver's last crossing.
  assert.equal(run(race, [['ben', 99_000, null]]).state.drivers.ben.lastAt, 99_000);
});

test('a qualifying without a roster ends when each who crossed has crossed after the close', () => {
  const open = { ...qualifying, roster: null };
  const { state } = run(open, [['ana', 108_000, 8000], ['ben', 109_000, 9000], ['ana', 401_000, 8000]]);
  assert.deepEqual(standings(open, state).map((s) => s.driverId), ['ana', 'ben']);
  assert.equal(isComplete(open, state, 401_000), false);
  run(open, [['ben', 402_000, 9000]], state);
  assert.equal(isComplete(open, state, 402_000), true);
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
