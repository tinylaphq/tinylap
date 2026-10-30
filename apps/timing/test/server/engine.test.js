// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOT, T0, W, rig } from './rig.js';

test('passings become laps in a practice session', () => {
  const { store, events, pass, startPractice } = rig();
  const practice = startPractice();
  pass(1000);
  pass(9000);
  pass(17_100);
  assert.deepEqual(store.crossings(practice.id).map((c) => [c.lapMs, c.counts]), [[null, false], [8000, true], [8100, true]]);
  const standings = events.filter((e) => e.type === 'standings').at(-1).data;
  assert.deepEqual(standings.standings.map((s) => [s.driverId, s.bestMs, s.laps]), [['ana', 8000, 2]]);
  assert.ok(events.some((e) => e.type === 'session' && e.data.kind === 'practice'));
});

test('a batch posted twice is stored once', () => {
  const { engine, store, startPractice } = rig();
  const practice = startPractice();
  const batch = { boot: BOOT, passings: [{ transponder: '0A', t: 1000 }, { transponder: '0A', t: 9000 }] };
  assert.deepEqual(engine.ingest({ workspaceId: W, decoder: 'd1', via: 'serial', batch }), { stored: 2, duplicates: 0, through: 9000 });
  assert.deepEqual(engine.ingest({ workspaceId: W, decoder: 'd1', via: 'net', batch }), { stored: 0, duplicates: 2, through: 9000 });
  assert.equal(store.crossings(practice.id).length, 2);
});

test('an unknown transponder is announced once and its laps wait for a driver', () => {
  const { store, events, pass, startPractice } = rig();
  const practice = startPractice();
  pass(1000, '0C');
  pass(9000, '0C');
  const setup = events.filter((e) => e.type === 'setup');
  assert.deepEqual(setup.map((e) => e.data), [{ unknown: ['0C'] }]);
  const rows = store.crossings(practice.id);
  assert.deepEqual(rows.map((c) => [c.driverId, c.lapMs, c.counts]), [[null, null, false], [null, 8000, false]]);
});

test('watchers never see transponder codes or unknown cars', () => {
  const { hub, pass, startPractice } = rig();
  startPractice();
  const seen = [];
  hub.subscribe(W, { lastEventId: null, watcher: true }, (e) => seen.push(e));
  pass(1000, '0C');
  pass(2000, '0A');
  const crossings = seen.filter((e) => e.type === 'crossing');
  assert.equal(crossings.length, 1);
  assert.equal(crossings[0].data.driverId, 'ana');
  assert.equal('transponder' in crossings[0].data, false);
  assert.equal(seen.some((e) => e.type === 'setup'), false);
});

test('a passing with no session makes no crossing, and members hear of it', () => {
  const { store, engine, events, pass } = rig();
  pass(1000);
  assert.equal(store.runningSession(W), null);
  assert.equal(store.listSessions(W, 10).length, 0);
  assert.deepEqual(engine.snapshot(W).idle, { transponder: '0A', driverId: 'ana', at: T0 + 1000 });
  assert.equal(engine.snapshot(W, { watcher: true }).idle, undefined);
  assert.ok(events.some((e) => e.type === 'idle'));
});

test('a practice started by hand counts from the first crossing after its start', () => {
  const { store, engine, clock, pass } = rig();
  pass(1000);
  clock.now = T0 + 2000;
  const { session } = engine.start(W, { kind: 'practice' });
  assert.equal(engine.snapshot(W).idle, null);
  pass(9000);
  pass(17_000);
  assert.deepEqual(store.crossings(session.id).map((c) => [c.lapMs, c.counts]), [[null, false], [8000, true]]);
});

test('a practice ends after an hour without a passing, at its last passing', () => {
  const { store, engine, clock, pass } = rig();
  clock.now = T0;
  const { session } = engine.start(W, { kind: 'practice' });
  pass(1000);
  pass(9000);
  clock.now = T0 + 9000 + 60 * 60_000 - 1;
  engine.tick();
  assert.equal(store.session(session.id).state, 'running');
  clock.now += 1;
  engine.tick();
  assert.deepEqual([store.session(session.id).state, store.session(session.id).endedAt], ['done', T0 + 9000]);
});

test('a practice without passings idle-ends at its start', () => {
  const { store, engine, clock } = rig();
  const { session } = engine.start(W, { kind: 'practice' });
  clock.now = T0 + 60 * 60_000;
  engine.tick();
  assert.deepEqual([store.session(session.id).state, store.session(session.id).endedAt], ['done', T0]);
});

test('a passing after the idle end makes no lap in the ended practice', () => {
  const { store, engine, clock, pass } = rig();
  const { session } = engine.start(W, { kind: 'practice' });
  pass(1000);
  clock.now = T0 + 1000 + 60 * 60_000;
  engine.tick();
  pass(9000 + 60 * 60_000);
  assert.equal(store.crossings(session.id).length, 1);
  assert.equal(engine.snapshot(W).idle.at, T0 + 9000 + 60 * 60_000);
});

test('late passings are mapped with the freshest offset of their batch', () => {
  const { engine, store, clock, startPractice } = rig();
  const practice = startPractice();
  // The bridge was offline: three passings arrive together, long after the first.
  clock.now = T0 + 120_000;
  engine.ingest({ workspaceId: W, decoder: 'd1', via: 'serial', batch: { boot: BOOT, passings: [{ transponder: '0A', t: 1000 }, { transponder: '0A', t: 9000 }, { transponder: '0A', t: 119_000 }] } });
  const ats = store.crossings(practice.id).map((c) => c.at);
  assert.deepEqual(ats, [T0 + 2000, T0 + 10_000, T0 + 120_000]);
});

test('a passing older than the reference is stored and flagged, without a lap', () => {
  const { store, pass, startPractice } = rig();
  const practice = startPractice();
  pass(1000);
  pass(9000);
  pass(5000);
  const last = store.crossings(practice.id).at(-1);
  assert.deepEqual([last.t, last.lapMs, last.counts, last.flag], [5000, null, false, 'backwards']);
});

test('tap entry makes tap laps that never count as personal bests', () => {
  const { engine, store, clock, startPractice } = rig();
  store.setTrack(W, { id: 't1', shape: 'c30:1:x', name: 'Office', snapshotKey: 'k'.repeat(22), layout: '{}' }, 'ccw');
  clock.now = T0;
  startPractice();
  engine.tap(W, 'ben');
  clock.now = T0 + 8000;
  const row = engine.tap(W, 'ben');
  assert.deepEqual([row.lapMs, row.counts, row.via], [8000, true, 'tap']);
  assert.equal(engine.tap(W, 'ben'), null, 'same millisecond');
  assert.deepEqual(store.personalBests(W, 't1', 'ccw', ['ben']), []);
});

test('a tap with no session is refused and stores nothing', () => {
  const { engine, store } = rig();
  assert.deepEqual(engine.tap(W, 'ben'), { error: 'no-session' });
  assert.equal(store.listSessions(W, 10).length, 0);
});

test('publishUnknown announces the transponders without a driver', () => {
  const { engine, events, pass, startPractice } = rig();
  startPractice();
  pass(1000, '0C');
  events.length = 0;
  engine.publishUnknown(W);
  assert.deepEqual(events.filter((e) => e.type === 'setup').map((e) => e.data), [{ unknown: ['0C'] }]);
});

test('loose passings older than a day are deleted; passings of a session and transponders stay', () => {
  const { store, engine, clock, pass } = rig();
  pass(1000); // loose
  clock.now = T0 + 2000;
  engine.start(W, { kind: 'practice' });
  pass(9000); // in the practice, and as old as the loose one when the day is over
  clock.now = T0 + 9000 + 24 * 60 * 60_000 + 1;
  engine.tick();
  assert.equal(store.through('d1', BOOT), 9000);
  assert.equal(store.countPassings(W), 1);
  assert.ok(store.transponders(W).some((t) => t.code === '0A'));
});
