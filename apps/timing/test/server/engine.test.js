// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOT, T0, W, rig } from './rig.js';

test('passings become laps in a practice session', () => {
  const { store, events, pass } = rig();
  pass(1000);
  pass(9000);
  pass(17_100);
  const practice = store.openPractice(W);
  assert.deepEqual(store.crossings(practice.id).map((c) => [c.lapMs, c.counts]), [[null, false], [8000, true], [8100, true]]);
  const standings = events.filter((e) => e.type === 'standings').at(-1).data;
  assert.deepEqual(standings.standings.map((s) => [s.driverId, s.bestMs, s.laps]), [['ana', 8000, 2]]);
  assert.ok(events.some((e) => e.type === 'session' && e.data.kind === 'practice'));
});

test('a batch posted twice is stored once', () => {
  const { engine, store } = rig();
  const batch = { boot: BOOT, passings: [{ transponder: '0A', t: 1000 }, { transponder: '0A', t: 9000 }] };
  assert.deepEqual(engine.ingest({ workspaceId: W, decoder: 'd1', via: 'serial', batch }), { stored: 2, duplicates: 0, through: 9000 });
  assert.deepEqual(engine.ingest({ workspaceId: W, decoder: 'd1', via: 'net', batch }), { stored: 0, duplicates: 2, through: 9000 });
  assert.equal(store.crossings(store.openPractice(W).id).length, 2);
});

test('an unknown transponder is announced once and its laps wait for a driver', () => {
  const { store, events, pass } = rig();
  pass(1000, '0C');
  pass(9000, '0C');
  const setup = events.filter((e) => e.type === 'setup');
  assert.deepEqual(setup.map((e) => e.data), [{ unknown: ['0C'] }]);
  const rows = store.crossings(store.openPractice(W).id);
  assert.deepEqual(rows.map((c) => [c.driverId, c.lapMs, c.counts]), [[null, null, false], [null, 8000, false]]);
});

test('watchers never see transponder codes or unknown cars', () => {
  const { hub, pass } = rig();
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

test('after 30 minutes without a passing, practice starts a new session', () => {
  const { store, pass } = rig();
  pass(1000);
  const first = store.openPractice(W).id;
  pass(1000 + 30 * 60_000);
  assert.equal(store.openPractice(W).id, first);
  pass(2000 + 61 * 60_000);
  const second = store.openPractice(W);
  assert.notEqual(second.id, first);
  assert.equal(store.session(first).state, 'done');
});

test('late passings are mapped with the freshest offset of their batch', () => {
  const { engine, store, clock } = rig();
  // The bridge was offline: three passings arrive together, long after the first.
  clock.now = T0 + 120_000;
  engine.ingest({ workspaceId: W, decoder: 'd1', via: 'serial', batch: { boot: BOOT, passings: [{ transponder: '0A', t: 1000 }, { transponder: '0A', t: 9000 }, { transponder: '0A', t: 119_000 }] } });
  const ats = store.crossings(store.openPractice(W).id).map((c) => c.at);
  assert.deepEqual(ats, [T0 + 2000, T0 + 10_000, T0 + 120_000]);
});

test('a passing older than the reference is stored and flagged, without a lap', () => {
  const { store, pass } = rig();
  pass(1000);
  pass(9000);
  pass(5000);
  const last = store.crossings(store.openPractice(W).id).at(-1);
  assert.deepEqual([last.t, last.lapMs, last.counts, last.flag], [5000, null, false, 'backwards']);
});

test('tap entry makes tap laps that never count as personal bests', () => {
  const { engine, store, clock } = rig();
  store.setTrack(W, { id: 't1', shape: 'c30:1:x', name: 'Office', snapshotKey: 'k'.repeat(22), layout: '{}' }, 'ccw');
  clock.now = T0;
  engine.tap(W, 'ben');
  clock.now = T0 + 8000;
  const row = engine.tap(W, 'ben');
  assert.deepEqual([row.lapMs, row.counts, row.via], [8000, true, 'tap']);
  assert.equal(engine.tap(W, 'ben'), null, 'same millisecond');
  assert.deepEqual(store.personalBests(W, 't1', 'ccw'), []);
});
