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
  assert.deepEqual(offlineEvents(events).at(-1).data, { offline: [{ id: 'd1', name: 'Start line' }], decoders: [{ id: 'd1', name: 'Start line', state: 'offline' }] });
  beat(engine);
  engine.tick();
  assert.deepEqual(engine.snapshot(W).offline, []);
  // The first event is the header going from nothing to reporting (connections spec §6).
  assert.deepEqual(offlineEvents(events).map((e) => e.data.offline.length), [0, 1, 0]);
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
  assert.deepEqual(offlineEvents(events).filter((e) => e.data.offline.length), []);
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
  assert.deepEqual(offlineEvents(seen).map((e) => e.data), [{ offline: [{ id: 'd1', name: 'Start line' }], decoders: [{ id: 'd1', name: 'Start line', state: 'offline' }] }]);
});

const connection = (engine, id = 'd1') => engine.connectionsOf(W).find((d) => d.id === id);
const withDecoder = () => {
  const r = rig();
  r.store.addDecoder(W, { id: 'd1', name: 'Start line', tokenHash: 'h', createdAt: T0 });
  return r;
};

test('wifi batch within 25 s reads reporting', () => {
  const { engine, clock } = withDecoder();
  beat(engine);
  clock.now = T0 + 24_000;
  assert.deepEqual(connection(engine).wifi, { state: 'reporting', at: T0 });
  assert.equal(connection(engine).name, 'Start line');
  assert.equal(connection(engine).createdAt, T0);
});

test('quiet reads idle', () => {
  const { engine, clock } = withDecoder();
  beat(engine, 'net', { quiet: true });
  clock.now = T0 + 25_000;
  assert.deepEqual(connection(engine).wifi, { state: 'idle', at: T0 });
});

test('expected and silent reads offline', () => {
  const { engine, clock } = withDecoder();
  beat(engine);
  clock.now = T0 + 25_000;
  assert.equal(connection(engine).wifi.state, 'offline');
});

test('after a restart the wifi row claims nothing', () => {
  const { engine, store } = withDecoder();
  store.touchDecoder('d1', T0);
  assert.deepEqual(connection(engine).wifi, { state: 'unknown', at: null });
  assert.equal(connection(engine).lastSeenAt, T0);
});

test('cable batch from another bridge reads as connected elsewhere', () => {
  const { engine, clock } = withDecoder();
  assert.equal(connection(engine).cable.state, 'none');
  beat(engine, 'serial');
  clock.now = T0 + 24_000;
  assert.equal(connection(engine).cable.state, 'other');
  clock.now = T0 + 25_000;
  assert.equal(connection(engine).cable.state, 'none');
});

test('header lists decoders heard in 30 min with their state', () => {
  const { engine, clock, store } = withDecoder();
  store.addDecoder(W, { id: 'd2', name: 'Pit', tokenHash: 'h2', createdAt: T0 });
  store.addDecoder(W, { id: 'd3', name: 'Old', tokenHash: 'h3', createdAt: T0 });
  assert.deepEqual(engine.headerOf(W), []);
  beat(engine);
  engine.ingest({ workspaceId: W, decoder: 'd2', via: 'net', batch: { boot: BOOT, passings: [], quiet: true } });
  clock.now = T0 + 25_000;
  assert.deepEqual(engine.headerOf(W), [{ id: 'd2', name: 'Pit', state: 'idle' }, { id: 'd1', name: 'Start line', state: 'offline' }]);
  assert.deepEqual(engine.snapshot(W).decoders, engine.headerOf(W));
  assert.deepEqual(engine.snapshot(W, { watcher: true }).decoders, engine.headerOf(W));
  clock.now = T0 + 30 * 60_000;
  assert.deepEqual(engine.headerOf(W), []);
});

test('decoders event on a state change only', () => {
  const { engine, clock, events } = withDecoder();
  beat(engine);
  engine.tick();
  const count = () => offlineEvents(events).length;
  const first = count();
  clock.now = T0 + 10_000;
  engine.tick();
  assert.equal(count(), first, 'still reporting: nothing new');
  clock.now = T0 + 25_000;
  engine.tick();
  assert.equal(count(), first + 1);
  engine.tick();
  assert.equal(count(), first + 1);
});

test('a tinylap decoder silent on the cable reads not reporting', () => {
  const { engine, clock } = withDecoder();
  beat(engine, 'serial', { logs: ['boot'] });
  clock.now = T0 + 24_000;
  assert.deepEqual(engine.headerOf(W).map((d) => d.state), ['reporting']);
  clock.now = T0 + 25_000;
  assert.deepEqual(engine.headerOf(W).map((d) => d.state), ['offline']);
  clock.now = T0 + 30 * 60_000;
  assert.deepEqual(engine.headerOf(W), []);
});

test('a passings-only cable decoder disappears after 25 s', () => {
  const { engine, clock } = withDecoder();
  beat(engine, 'serial');
  clock.now = T0 + 25_000;
  assert.deepEqual(engine.headerOf(W), []);
});

test('a closed cable clears the cable state and the header at once', () => {
  const { engine, clock, events } = withDecoder();
  beat(engine, 'serial', { logs: ['boot'] });
  engine.tick();
  const count = () => offlineEvents(events).length;
  const first = count();
  clock.now = T0 + 5_000;
  engine.cableClosed(W, 'd1');
  assert.equal(connection(engine).cable.state, 'none');
  assert.deepEqual(engine.headerOf(W).map((d) => d.state), ['offline'], 'a TinyLap decoder whose cable is gone is not reporting');
  assert.equal(count(), first + 1, 'published at once');
  assert.deepEqual(offlineEvents(events).at(-1).data.decoders.map((d) => d.state), ['offline']);
  engine.tick();
  assert.equal(count(), first + 1, 'and not again');
  // A batch over a cable again (this tab or another) opens it again.
  beat(engine, 'serial', { logs: ['stat'] });
  assert.equal(connection(engine).cable.state, 'other');
  assert.deepEqual(engine.headerOf(W).map((d) => d.state), ['reporting']);
});

test('a closed cable leaves Wi-Fi reporting, and a passings-only decoder shows nothing', () => {
  const { engine, clock, store } = withDecoder();
  store.addDecoder(W, { id: 'd2', name: 'Pit', tokenHash: 'h2', createdAt: T0 });
  beat(engine, 'net');
  beat(engine, 'serial', { logs: ['boot'] });
  engine.ingest({ workspaceId: W, decoder: 'd2', via: 'serial', batch: { boot: BOOT, passings: [{ transponder: '0A', t: 1 }] } });
  clock.now = T0 + 1_000;
  engine.cableClosed(W, 'd1');
  engine.cableClosed(W, 'd2');
  assert.equal(connection(engine).cable.state, 'none');
  assert.equal(connection(engine).wifi.state, 'reporting');
  assert.deepEqual(engine.headerOf(W), [{ id: 'd1', name: 'Start line', state: 'reporting' }]);
});

test('an opened cable counts as on a cable at once, clears a close, and is published', () => {
  const { engine, clock, events } = withDecoder();
  const count = () => offlineEvents(events).length;
  // Never heard: a plain ZRound decoder just plugged in, no lap yet.
  engine.cableOpened(W, 'd1');
  assert.equal(connection(engine).cable.state, 'other');
  assert.deepEqual(engine.headerOf(W).map((d) => d.state), ['reporting']);
  const first = count();
  assert.ok(first > 0, 'published');
  clock.now = T0 + 1_000;
  engine.cableClosed(W, 'd1');
  assert.equal(connection(engine).cable.state, 'none');
  // Plugged back in before any lap: on the cable again at once, not at its next lap.
  clock.now = T0 + 2_000;
  engine.cableOpened(W, 'd1');
  assert.equal(connection(engine).cable.state, 'other');
  assert.equal(count(), first + 2);
  // Like a batch over a cable, it lasts 25 s without news.
  clock.now = T0 + 2_000 + 25_000;
  assert.equal(connection(engine).cable.state, 'none');
});

test('a closed cable of another club or a decoder never heard changes nothing', () => {
  const { engine } = withDecoder();
  beat(engine, 'serial', { logs: ['boot'] });
  engine.cableClosed('other-club', 'd1');
  engine.cableClosed(W, 'nope');
  assert.equal(connection(engine).cable.state, 'other');
});

test('a cable:false batch after a close keeps the cable closed and stores the passing', () => {
  const { engine, clock, store } = withDecoder();
  beat(engine, 'serial', { logs: ['boot'] });
  clock.now = T0 + 1_000;
  engine.cableClosed(W, 'd1');
  clock.now = T0 + 2_000;
  const answer = beat(engine, 'serial', { passings: [{ transponder: '0A', t: 500 }], logs: ['stat'], cable: false });
  assert.equal(answer.stored, 1);
  assert.equal(connection(engine).cable.state, 'none');
  assert.equal(connection(engine).lastSeenAt, T0 + 2_000);
  assert.deepEqual(engine.headerOf(W).map((d) => d.state), ['offline']);
  // Never on a cable: it stays so.
  store.addDecoder(W, { id: 'd2', name: 'Pit', tokenHash: 'h2', createdAt: T0 });
  engine.ingest({ workspaceId: W, decoder: 'd2', via: 'serial', batch: { boot: BOOT, passings: [{ transponder: '0B', t: 1 }], cable: false } });
  assert.equal(connection(engine, 'd2').cable.state, 'none');
  assert.deepEqual(engine.headerOf(W).map((d) => d.id), ['d1']);
});
