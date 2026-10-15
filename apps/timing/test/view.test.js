// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, clockOf, createView, driverName, serverNow } from '../js/view.js';

const practice = { id: 'p1', kind: 'practice', state: 'running', opensAt: 1000, closesAt: null, trackId: 't1' };
const snapshot = (fields = {}) => ({
  now: 50_000, track: { id: 't1', name: 'Office' }, direction: 'cw', session: practice, standings: [],
  crossings: [], drivers: [{ id: 'ana', name: 'Ana', colour: '#ff2d9b' }], bests: [{ driverId: 'ana', bestMs: 8000, at: 1 }], unknown: ['0C'], ...fields,
});

test('the snapshot sets everything, and the skew to the server clock', () => {
  const view = applyEvent(createView(), 'snapshot', snapshot(), 45_000);
  assert.equal(view.skew, 5000);
  assert.equal(serverNow(view, 46_000), 51_000);
  assert.equal(view.drivers.get('ana').name, 'Ana');
  assert.equal(view.bests.get('ana'), 8000);
  assert.deepEqual(view.unknown, ['0C']);
});

test('a screen whose clock is off still counts down with the server', () => {
  // The device is 7 s behind the server.
  const view = applyEvent(createView(), 'snapshot', snapshot({ now: 100_000 }), 93_000);
  const race = { id: 'r1', kind: 'race', state: 'countdown', opensAt: 110_000, closesAt: 410_000, now: 100_000 };
  applyEvent(view, 'session', race, 93_000);
  assert.deepEqual(clockOf(view.session, serverNow(view, 93_000)), { label: 'Starts in', ms: 10_000 });
});

test('crossings of the current session are kept newest first, and improve bests', () => {
  const view = applyEvent(createView(), 'snapshot', snapshot(), 50_000);
  applyEvent(view, 'crossing', { sessionId: 'p1', driverId: 'ana', lapMs: 7900, counts: true, via: 'net', at: 2 });
  applyEvent(view, 'crossing', { sessionId: 'p1', driverId: 'ana', lapMs: 7000, counts: true, via: 'tap', at: 3 });
  applyEvent(view, 'crossing', { sessionId: 'old', driverId: 'ana', lapMs: 1, counts: true, via: 'net', at: 4 });
  assert.deepEqual(view.crossings.map((c) => c.lapMs), [7000, 7900]);
  assert.equal(view.bests.get('ana'), 7900, 'tap laps are never bests');
});

test('a new session clears the board; standings and results apply to their session', () => {
  const view = applyEvent(createView(), 'snapshot', snapshot({ crossings: [{ sessionId: 'p1', lapMs: 8000 }] }), 50_000);
  applyEvent(view, 'session', { id: 'r1', kind: 'race', state: 'countdown', opensAt: 1, closesAt: 2, now: 50_000 });
  assert.deepEqual([view.session.id, view.crossings, view.standings], ['r1', [], []]);
  assert.equal('now' in view.session, false);
  applyEvent(view, 'standings', { sessionId: 'p1', standings: [{ driverId: 'x' }] });
  assert.deepEqual(view.standings, []);
  applyEvent(view, 'results', { sessionId: 'r1', standings: [{ driverId: 'ana' }] });
  assert.deepEqual(view.standings, [{ driverId: 'ana' }]);
});

test('drivers, track and setup events', () => {
  const view = applyEvent(createView(), 'snapshot', snapshot(), 50_000);
  applyEvent(view, 'drivers', [{ id: 'ben', name: 'Ben', colour: '#2d9bff' }]);
  assert.equal(driverName(view, 'ben'), 'Ben');
  assert.equal(driverName(view, 'ana'), 'former driver', 'a deleted driver keeps their laps');
  assert.equal(driverName(view, null), 'unknown car');
  applyEvent(view, 'track', { track: { id: 't2', name: 'Hall' }, direction: 'ccw', bests: [] });
  assert.deepEqual([view.track.name, view.direction, view.bests.size], ['Hall', 'ccw', 0]);
  applyEvent(view, 'setup', { unknown: [] });
  assert.deepEqual(view.unknown, []);
});

test('the clock for each state', () => {
  assert.equal(clockOf(null, 0), null);
  assert.deepEqual(clockOf(practice, 61_000), { label: 'Practice', ms: 60_000 });
  const race = { kind: 'race', opensAt: 10_000, closesAt: 310_000 };
  assert.deepEqual(clockOf({ ...race, state: 'running' }, 70_000), { label: 'Remaining', ms: 240_000 });
  assert.deepEqual(clockOf({ ...race, state: 'running' }, 400_000), { label: 'Remaining', ms: 0 });
  assert.deepEqual(clockOf({ ...race, state: 'finishing' }, 400_000), { label: 'Last lap', ms: 0 });
  assert.deepEqual(clockOf({ ...race, state: 'done' }, 400_000), { label: 'Finished', ms: 0 });
  assert.deepEqual(clockOf({ ...race, state: 'aborted' }, 400_000), { label: 'Aborted', ms: 0 });
});
