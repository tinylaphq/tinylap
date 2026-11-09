// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { useTrack } from './helpers.js';
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
  const { store, engine, hub, events, pass } = rig();
  const watched = [];
  hub.subscribe(W, { lastEventId: null, watcher: true }, (e) => watched.push(e));
  pass(1000);
  assert.equal(store.runningSession(W), null);
  assert.equal(store.listSessions(W, 10).length, 0);
  assert.deepEqual(engine.snapshot(W).idle, { transponder: '0A', driverId: 'ana', at: T0 + 1000 });
  assert.equal(engine.snapshot(W, { watcher: true }).idle, undefined);
  const idle = { transponder: '0A', driverId: 'ana', at: T0 + 1000 };
  assert.deepEqual(events.filter((e) => e.type === 'idle').map((e) => e.data), [{ idle }]);
  engine.start(W, { kind: 'practice' });
  assert.deepEqual(events.filter((e) => e.type === 'idle').map((e) => e.data), [{ idle }, { idle: null }], 'starting clears it');
  assert.equal(watched.some((e) => e.type === 'idle'), false);
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

test('a practice that replaces one while a car runs starts clean', () => {
  const { store, engine, clock, pass } = rig();
  engine.start(W, { kind: 'practice' });
  pass(1000);
  pass(9000);
  clock.now = T0 + 10_000;
  const { session } = engine.start(W, { kind: 'practice', replace: true });
  pass(17_000); // began 9000, before the start: a reference, not a lap
  pass(25_000);
  assert.deepEqual(store.crossings(session.id).map((c) => [c.lapMs, c.counts]), [[8000, false], [8000, true]]);
});

test('a practice started just after another ended starts clean', () => {
  const { store, engine, clock, pass } = rig();
  const first = engine.start(W, { kind: 'practice' }).session;
  pass(1000);
  pass(9000);
  clock.now = T0 + 10_000;
  engine.end(W, first.id);
  clock.now = T0 + 12_000;
  const { session } = engine.start(W, { kind: 'practice' });
  pass(17_000);
  pass(25_000);
  assert.deepEqual(store.crossings(session.id).map((c) => [c.lapMs, c.counts]), [[8000, false], [8000, true]]);
});

test('a late crossing driven before a practice started is no lap of it', () => {
  const { store, engine, clock, pass } = rig();
  engine.start(W, { kind: 'practice' });
  pass(1000);
  pass(9000);
  clock.now = T0 + 20_000;
  const { session } = engine.start(W, { kind: 'practice', replace: true });
  // A backlog arrives: driven at 17 000, before the start at 20 000.
  engine.ingest({ workspaceId: W, decoder: 'd1', via: 'serial', batch: { boot: BOOT, passings: [{ transponder: '0A', t: 17_000 }] } });
  pass(25_000); // began 17 000, before the start too
  pass(33_000);
  assert.deepEqual(store.crossings(session.id).map((c) => [c.at - T0, c.lapMs, c.counts]), [[17_000, 8000, false], [25_000, 8000, false], [33_000, 8000, true]]);
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
  useTrack(store, W, 'Office', 'ccw', 't1');
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

test('now places late passings at their real time after a long outage', () => {
  const { engine, clock, store, startPractice } = rig();
  const practice = startPractice();
  clock.now = T0 + 300_000; // five minutes after the passings happened
  engine.ingest({ workspaceId: W, decoder: 'd1', via: 'net', batch: { boot: BOOT, passings: [{ transponder: '0A', t: 1000 }, { transponder: '0A', t: 9000 }], logs: [], now: 300_000 } });
  assert.deepEqual(store.crossings(practice.id).map((c) => c.at), [T0 + 1000, T0 + 9000]);
});

/** A batch from decoder d1 with no passings: the heartbeat of a board in use. */
const beat = (engine, via = 'net', extra = {}) => engine.ingest({ workspaceId: W, decoder: 'd1', via, batch: { boot: BOOT, passings: [], ...extra } });
const offlineEvents = (events) => events.filter((e) => e.type === 'decoders');

test('a wifi decoder silent for 25 s shows offline, and its next batch clears it', () => {
  const { engine, clock, store, events } = rig();
  store.addDecoder(W, { id: 'd1', name: 'Start line', tokenHash: 'h', createdAt: T0 });
  beat(engine);
  clock.now = T0 + 24_000;
  engine.tick();
  assert.deepEqual(engine.snapshot(W).offline, []);
  clock.now = T0 + 25_000;
  engine.tick();
  engine.tick();
  assert.deepEqual(engine.snapshot(W).offline, [{ id: 'd1', name: 'Start line' }]);
  assert.deepEqual(engine.snapshot(W, { watcher: true }).offline, [{ id: 'd1', name: 'Start line' }]);
  assert.deepEqual(offlineEvents(events).map((e) => e.data), [{ offline: [{ id: 'd1', name: 'Start line' }] }]);
  beat(engine);
  engine.tick();
  assert.deepEqual(engine.snapshot(W).offline, []);
  assert.deepEqual(offlineEvents(events).map((e) => e.data.offline.length), [1, 0]);
});

test('quiet ends expecting the decoder', () => {
  const { engine, clock, store, events } = rig();
  store.addDecoder(W, { id: 'd1', name: 'Start line', tokenHash: 'h', createdAt: T0 });
  beat(engine);
  clock.now = T0 + 10_000;
  beat(engine, 'net', { quiet: true });
  clock.now = T0 + 60_000;
  engine.tick();
  assert.deepEqual(engine.snapshot(W).offline, []);
  assert.deepEqual(offlineEvents(events), []);
});

test('a lost quiet keeps the banner until 30 minutes', () => {
  const { engine, clock, store } = rig();
  store.addDecoder(W, { id: 'd1', name: 'Start line', tokenHash: 'h', createdAt: T0 });
  beat(engine);
  clock.now = T0 + 30 * 60_000 - 1;
  engine.tick();
  assert.equal(engine.snapshot(W).offline.length, 1);
  clock.now = T0 + 30 * 60_000;
  engine.tick();
  assert.deepEqual(engine.snapshot(W).offline, []);
});

test('an expected decoder that was unpaired leaves the offline list at the next tick', () => {
  const { engine, clock, store, events } = rig();
  store.addDecoder(W, { id: 'd1', name: 'Start line', tokenHash: 'h', createdAt: T0 });
  beat(engine);
  clock.now = T0 + 25_000;
  engine.tick();
  assert.equal(engine.snapshot(W).offline.length, 1);
  store.deleteDecoder(W, 'd1');
  engine.tick();
  assert.deepEqual(engine.snapshot(W).offline, []);
  assert.deepEqual(offlineEvents(events).map((e) => e.data.offline.length), [1, 0]);
});

test('a cable-only decoder never shows offline', () => {
  const { engine, clock, store, events } = rig();
  store.addDecoder(W, { id: 'd1', name: 'Start line', tokenHash: 'h', createdAt: T0 });
  beat(engine, 'serial');
  clock.now = T0 + 5 * 60_000;
  engine.tick();
  assert.deepEqual(engine.snapshot(W).offline, []);
  assert.deepEqual(offlineEvents(events), []);
});

test('cable batches keep an expected wifi decoder fresh', () => {
  const { engine, clock, store } = rig();
  store.addDecoder(W, { id: 'd1', name: 'Start line', tokenHash: 'h', createdAt: T0 });
  beat(engine);
  clock.now = T0 + 20_000;
  beat(engine, 'serial');
  clock.now = T0 + 40_000;
  engine.tick();
  assert.deepEqual(engine.snapshot(W).offline, []);
  clock.now = T0 + 45_000;
  engine.tick();
  assert.equal(engine.snapshot(W).offline.length, 1);
});

test('the decoders event goes to watchers too', () => {
  const { engine, clock, store, hub } = rig();
  store.addDecoder(W, { id: 'd1', name: 'Start line', tokenHash: 'h', createdAt: T0 });
  const seen = [];
  hub.subscribe(W, { lastEventId: null, watcher: true }, (e) => seen.push(e));
  beat(engine);
  clock.now = T0 + 25_000;
  engine.tick();
  assert.deepEqual(offlineEvents(seen).map((e) => e.data), [{ offline: [{ id: 'd1', name: 'Start line' }] }]);
});
