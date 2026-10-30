// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { RECORD_FRESH_MS, RECORD_SHOW_MS } from '../../server/engine.js';
import { BOOT, T0, W, rig } from './rig.js';
import { useTrack } from './helpers.js';


/** A rig on track `trk`, clockwise, with practice running. */
function onTrack() {
  const r = rig();
  useTrack(r.store, W, 'Office', 'cw', 'trk');
  r.startPractice();
  return r;
}
/** Laps of `ms` for a transponder, from decoder time `from`: the first passing starts it. */
function laps(pass, transponder, from, ...ms) {
  let t = from;
  pass(t, transponder);
  for (const lap of ms) pass((t += lap), transponder);
  return t;
}
/** A batch received now whose passings were driven at decoder times `ts`; mapped by an on-time passing just before. */
function late({ engine, clock }, receivedT, transponder, ts) {
  clock.now = T0 + receivedT;
  engine.ingest({ workspaceId: W, decoder: 'd1', via: 'net', batch: { boot: BOOT, passings: [{ transponder: 'FF', t: receivedT }] } });
  return engine.ingest({ workspaceId: W, decoder: 'd1', via: 'net', batch: { boot: BOOT, passings: ts.map((t) => ({ transponder, t })) } });
}
const recordEvents = (events) => events.filter((e) => e.type === 'record');
/** The lap times of the 'record' events: a number when one falls, null when its state ends. */
const recordLaps = (events) => recordEvents(events).map((e) => e.data.recordNew?.lapMs ?? null);
/** Events a watcher's subscription receives. */
function watch(hub) {
  const seen = [];
  hub.subscribe(W, { lastEventId: null, watcher: true }, (e) => seen.push(e));
  return seen;
}
const history = (store, ws = W, direction = 'cw') => store.recordHistory(ws, 'trk', direction).map((r) => [r.driverId, r.lapMs]);
const allDrivers = (store, ws = W) => store.drivers(ws).map((d) => d.id);

/** The stored tables equal what a rebuild from the laps makes. */
function assertProjection(store, ws = W) {
  const before = { records: store.recordHistory(ws, 'trk', 'cw'), bests: store.personalBests(ws, 'trk', 'cw', allDrivers(store, ws)) };
  store.rebuildRecords(ws, 'trk', 'cw');
  assert.deepEqual({ records: store.recordHistory(ws, 'trk', 'cw'), bests: store.personalBests(ws, 'trk', 'cw', allDrivers(store, ws)) }, before);
}

test('the first lap on a track sets the record silently', () => {
  const r = onTrack();
  laps(r.pass, '0A', 1000, 8000);
  const snap = r.engine.snapshot(W);
  assert.equal(snap.record.lapMs, 8000);
  assert.equal(snap.record.driverId, 'ana');
  assert.equal(snap.record.beat, null, 'the first record beat nothing');
  assert.equal(snap.recordNew, null);
  assert.deepEqual(recordEvents(r.events), []);
  assertProjection(r.store);
});

test('a faster lap takes the record, live, with what it beat', () => {
  const r = onTrack();
  const watched = watch(r.hub);
  laps(r.pass, '0A', 1000, 8000);
  laps(r.pass, '0B', 10_000, 7900);
  const snap = r.engine.snapshot(W);
  assert.deepEqual(snap.record, { driverId: 'ben', lapMs: 7900, at: T0 + 17_900, beat: { driverId: 'ana', lapMs: 8000, at: T0 + 9000 } });
  assert.equal(snap.recordNew.beat.lapMs, 8000);
  assert.deepEqual(snap.recordNew, {
    seq: snap.crossings[0].seq, driverId: 'ben', lapMs: 7900, at: T0 + 17_900,
    beat: { driverId: 'ana', lapMs: 8000, at: T0 + 9000 },
  });
  assert.deepEqual(r.engine.snapshot(W, { watcher: true }).recordNew, snap.recordNew);
  assert.deepEqual(recordEvents(r.events).map((e) => e.data), [{ recordNew: snap.recordNew }]);
  assert.deepEqual(recordEvents(watched).map((e) => e.data), [{ recordNew: snap.recordNew }]);
  assert.deepEqual(r.store.recordHistory(W, 'trk', 'cw').map((x) => x.lapMs), [7900, 8000]);
  assertProjection(r.store);
});

test('a tie does not take the record', () => {
  const r = onTrack();
  laps(r.pass, '0A', 1000, 8000);
  laps(r.pass, '0B', 10_000, 8000);
  assert.equal(r.engine.snapshot(W).record.driverId, 'ana');
  assert.deepEqual(recordEvents(r.events), []);
  assert.deepEqual(history(r.store), [['ana', 8000]]);
  assertProjection(r.store);
});

test('tapped laps never set a record or a personal best', () => {
  const r = onTrack();
  laps(r.pass, '0A', 1000, 8000);
  r.clock.now = T0 + 20_000;
  r.engine.tap(W, 'ben');
  r.clock.now = T0 + 25_000;
  r.engine.tap(W, 'ana');
  r.clock.now = T0 + 27_000;
  r.engine.tap(W, 'ben');
  assert.deepEqual(history(r.store), [['ana', 8000]]);
  assert.deepEqual(r.store.personalBests(W, 'trk', 'cw', ['ana', 'ben']).map((b) => [b.driverId, b.bestMs]), [['ana', 8000]]);
  assert.deepEqual(recordEvents(r.events), []);
  assertProjection(r.store);
});

test('a late lap takes the record silently, at its own time in the history', () => {
  const r = onTrack();
  laps(r.pass, '0A', 1000, 8000);
  late(r, 130_000, '0B', [10_000, 17_900]);
  const snap = r.engine.snapshot(W);
  assert.deepEqual(snap.record, { driverId: 'ben', lapMs: 7900, at: T0 + 17_900, beat: { driverId: 'ana', lapMs: 8000, at: T0 + 9000 } });
  assert.equal(snap.recordNew, null);
  assert.deepEqual(recordEvents(r.events), []);
  assert.deepEqual(r.store.recordHistory(W, 'trk', 'cw').map((x) => [x.lapMs, x.at]), [[7900, T0 + 17_900], [8000, T0 + 9000]]);
  assertProjection(r.store);
});

test('a late lap that was a record at its time joins the history before the latest row', () => {
  const r = onTrack();
  r.store.addDriver(W, { id: 'cy', name: 'Cy', colour: '#2dff9b' });
  r.store.assignTransponder(W, '0D', 'cy', 0);
  laps(r.pass, '0A', 1000, 8000);
  laps(r.pass, '0B', 292_200, 7800);
  const before = recordEvents(r.events).length;
  late(r, 310_000, '0D', [112_100, 120_000]);
  assert.deepEqual(history(r.store), [['ben', 7800], ['cy', 7900], ['ana', 8000]]);
  assert.deepEqual(r.engine.snapshot(W).record, { driverId: 'ben', lapMs: 7800, at: T0 + 300_000, beat: { driverId: 'cy', lapMs: 7900, at: T0 + 120_000 } });
  assert.equal(recordEvents(r.events).length, before);
  assertProjection(r.store);
});

test('an unassigned car sets no record until assigned, then silently', () => {
  const r = onTrack();
  laps(r.pass, '0A', 1000, 8000);
  laps(r.pass, '0C', 10_000, 7000);
  assert.deepEqual(history(r.store), [['ana', 8000]]);
  r.engine.assign(W, '0C', 'ana');
  assert.deepEqual(history(r.store), [['ana', 7000], ['ana', 8000]]);
  assert.deepEqual(r.store.personalBests(W, 'trk', 'cw', ['ana']).map((b) => b.bestMs), [7000]);
  assert.deepEqual(recordEvents(r.events), []);
  assertProjection(r.store);
});

test('the record is per track and direction', () => {
  const r = onTrack();
  laps(r.pass, '0A', 1000, 8000);
  useTrack(r.store, W, 'Office', 'ccw', 'trk');
  r.engine.endPractice(W);
  assert.equal(r.engine.snapshot(W).record, null);
  assert.deepEqual(r.engine.snapshot(W).bests, []);
  assert.equal(r.store.currentRecord(W, 'trk', 'cw').lapMs, 8000);
  assertProjection(r.store);
});

test('personal bests: the faster lap, the earlier on a tie, only for the drivers asked', () => {
  const r = onTrack();
  laps(r.pass, '0A', 1000, 8000, 7900, 7900);
  laps(r.pass, '0B', 40_000, 8500);
  const crossings = r.store.crossings(r.store.runningSession(W).id);
  const first7900 = crossings.find((c) => c.lapMs === 7900);
  assert.deepEqual(r.store.personalBests(W, 'trk', 'cw', ['ana']), [{ driverId: 'ana', bestMs: 7900, at: first7900.at, seq: first7900.seq }]);
  assert.deepEqual(r.store.personalBests(W, 'trk', 'cw', ['ana', 'ben']).map((b) => [b.driverId, b.bestMs]), [['ana', 7900], ['ben', 8500]]);
  assert.deepEqual(r.engine.snapshot(W).bests.map((b) => b.driverId), ['ana', 'ben'], 'the board asks for its standings');
  assertProjection(r.store);
});

test('records are per workspace', () => {
  const r = onTrack();
  laps(r.pass, '0A', 1000, 8000);
  const ws2 = 'ws-2';
  useTrack(r.store, ws2, 'Office', 'cw', 'trk');
  r.store.addDriver(ws2, { id: 'cy', name: 'Cy', colour: '#2dff9b' });
  r.store.assignTransponder(ws2, '0A', 'cy', 0);
  r.engine.start(ws2, { kind: 'practice' });
  const pass2 = (t) => r.engine.ingest({ workspaceId: ws2, decoder: 'd2', via: 'net', batch: { boot: BOOT, passings: [{ transponder: '0A', t }] } });
  r.clock.now = T0 + 20_000;
  pass2(20_000);
  r.clock.now = T0 + 27_000;
  pass2(27_000);
  assert.deepEqual(history(r.store), [['ana', 8000]]);
  assert.deepEqual(history(r.store, ws2), [['cy', 7000]]);
  assert.deepEqual(r.store.personalBests(W, 'trk', 'cw', ['ana', 'cy']).map((b) => b.driverId), ['ana']);
  assertProjection(r.store);
  assertProjection(r.store, ws2);
});

test('the record state lasts 30 s after the lap, and its end reaches every board', () => {
  const r = onTrack();
  const watched = watch(r.hub);
  laps(r.pass, '0A', 1000, 8000);
  const at = laps(r.pass, '0B', 10_000, 7900);
  r.clock.now = T0 + at + RECORD_SHOW_MS - 1000;
  r.engine.tick();
  assert.equal(r.engine.snapshot(W).recordNew.lapMs, 7900);
  r.clock.now = T0 + at + RECORD_SHOW_MS;
  r.engine.tick();
  assert.equal(r.engine.snapshot(W).recordNew, null, 'ben has not crossed again, and it ends anyway');
  assert.deepEqual(recordLaps(r.events), [7900, null]);
  assert.deepEqual(recordLaps(watched), [7900, null], 'the end reaches watchers too');
  r.engine.tick();
  assert.deepEqual(recordLaps(r.events), [7900, null], 'once');
  assertProjection(r.store);
});

test('the holder’s later laps don’t extend the record state', () => {
  const r = onTrack();
  laps(r.pass, '0A', 1000, 8000);
  const at = laps(r.pass, '0B', 10_000, 7900);
  r.pass(at + 8500, '0B');
  r.pass(at + 17_000, '0B');
  r.pass(at + 25_500, '0B');
  r.engine.tick();
  assert.equal(r.engine.snapshot(W).recordNew.lapMs, 7900);
  r.clock.now = T0 + at + RECORD_SHOW_MS;
  r.engine.tick();
  assert.equal(r.engine.snapshot(W).recordNew, null);
});

test('a record on a practice ended by hand still shows its 30 s, then ends', () => {
  const r = onTrack();
  laps(r.pass, '0A', 1000, 8000);
  const at = laps(r.pass, '0B', 10_000, 7900);
  r.clock.now = T0 + at + 5000;
  r.engine.end(W, r.store.runningSession(W).id);
  r.engine.tick();
  assert.equal(r.engine.snapshot(W).recordNew.lapMs, 7900);
  r.clock.now = T0 + at + RECORD_SHOW_MS;
  r.engine.tick();
  assert.equal(r.engine.snapshot(W).recordNew, null);
  assert.deepEqual(recordLaps(r.events), [7900, null]);
  assert.equal(r.engine.snapshot(W).record.lapMs, 7900, 'the record stays');
});

test('a record on a race’s final lap is celebrated, and ends 30 s later', () => {
  const r = onTrack();
  const watched = watch(r.hub);
  laps(r.pass, '0A', 1000, 8000);
  r.clock.now = T0 + 20_000;
  const { session } = r.engine.start(W, { kind: 'race', roster: ['ana', 'ben'], durationMs: 20_000, replace: true });
  r.pass(21_000);
  r.pass(21_500, '0B');
  r.pass(30_000);
  r.pass(33_600, '0B');
  r.clock.now = T0 + 40_000;
  r.engine.tick();
  r.pass(41_000); // ana finishes
  const at = 41_500;
  r.pass(at, '0B'); // ben's last lap, 7900, is a record and finishes the race
  assert.equal(r.store.session(session.id).state, 'done');
  assert.equal(r.engine.snapshot(W).recordNew.lapMs, 7900);
  r.clock.now = T0 + at + RECORD_SHOW_MS - 1;
  r.engine.tick();
  assert.equal(r.engine.snapshot(W).recordNew.lapMs, 7900);
  r.clock.now = T0 + at + RECORD_SHOW_MS;
  r.engine.tick();
  assert.equal(r.engine.snapshot(W).recordNew, null);
  assert.deepEqual(recordLaps(watched), [7900, null]);
});

test('the record state survives a session’s end and a new start within its 30 s', () => {
  const r = onTrack();
  laps(r.pass, '0A', 1000, 8000);
  const at = laps(r.pass, '0B', 10_000, 7900);
  r.clock.now = T0 + at + 5000;
  r.engine.start(W, { kind: 'practice', replace: true });
  r.engine.tick();
  assert.equal(r.engine.snapshot(W).recordNew.lapMs, 7900);
  assert.deepEqual(recordLaps(r.events), [7900]);
  r.clock.now = T0 + at + RECORD_SHOW_MS;
  r.engine.tick();
  assert.equal(r.engine.snapshot(W).recordNew, null);
  assert.deepEqual(recordLaps(r.events), [7900, null]);
});

test('the record state shows only under its own track and direction, and again when they come back within its 30 s', () => {
  const r = onTrack();
  laps(r.pass, '0A', 1000, 8000);
  const at = laps(r.pass, '0B', 10_000, 7900);
  r.clock.now = T0 + at + 5000;
  useTrack(r.store, W, 'Office', 'ccw', 'trk');
  r.engine.endPractice(W);
  r.engine.tick();
  assert.equal(r.engine.snapshot(W).recordNew, null, 'not under the anticlockwise header');
  useTrack(r.store, W, 'Office', 'cw', 'trk');
  r.engine.endPractice(W);
  assert.equal(r.engine.snapshot(W).recordNew.lapMs, 7900);
  assert.deepEqual(recordLaps(r.events), [7900]);
  r.clock.now = T0 + at + RECORD_SHOW_MS;
  r.engine.tick();
  assert.equal(r.engine.snapshot(W).recordNew, null);
  assert.deepEqual(recordLaps(r.events), [7900, null]);
});

test('a record lap is celebrated only if it arrives less than a minute after it was driven', () => {
  for (const [delay, celebrated] of [[30_000, true], [RECORD_FRESH_MS + 1000, false]]) {
    const r = onTrack();
    laps(r.pass, '0A', 1000, 8000);
    late(r, 17_900 + delay, '0B', [10_000, 17_900]);
    assert.equal(r.engine.snapshot(W).record.lapMs, 7900);
    assert.equal(r.engine.snapshot(W).recordNew?.lapMs ?? null, celebrated ? 7900 : null, `${delay} ms late`);
    assert.deepEqual(recordLaps(r.events), celebrated ? [7900] : [], `${delay} ms late`);
  }
});

test('a lap that arrives 45 s late shows the record state for 30 s from its arrival', () => {
  const r = onTrack();
  laps(r.pass, '0A', 1000, 8000);
  const arrived = 17_900 + 45_000;
  late(r, arrived, '0B', [10_000, 17_900]);
  r.clock.now = T0 + arrived + RECORD_SHOW_MS - 1000;
  r.engine.tick();
  assert.equal(r.engine.snapshot(W).recordNew.lapMs, 7900);
  r.clock.now = T0 + arrived + RECORD_SHOW_MS;
  r.engine.tick();
  assert.equal(r.engine.snapshot(W).recordNew, null);
  assert.deepEqual(recordLaps(r.events), [7900, null]);
});

test('a record set in a race after the track changed shows only under its own track', () => {
  const r = onTrack();
  laps(r.pass, '0A', 1000, 8000);
  r.clock.now = T0 + 20_000;
  r.engine.start(W, { kind: 'race', roster: ['ana', 'ben'], durationMs: 60_000, replace: true });
  r.pass(21_000, '0B');
  useTrack(r.store, W, 'Office', 'ccw', 'trk'); // the race keeps the track it started with
  r.engine.endPractice(W);
  r.pass(28_900, '0B'); // 7900: a record of trk clockwise
  assert.deepEqual(history(r.store), [['ben', 7900], ['ana', 8000]]);
  assert.deepEqual(recordLaps(r.events), [7900]);
  const snap = r.engine.snapshot(W);
  assert.equal(snap.direction, 'ccw');
  assert.equal(snap.recordNew, null, 'not under the anticlockwise header');
});

test('the snapshot holds the fastest on the track and direction, top ten, and whether the club has driven', () => {
  const r = rig();
  useTrack(r.store, W, 'Office', 'cw', 'trk');
  assert.deepEqual(r.engine.snapshot(W).fastest, []);
  assert.equal(r.engine.snapshot(W).driven, false);
  const practice = r.startPractice();
  laps(r.pass, '0A', 1000, 8000, 7600);
  laps(r.pass, '0B', 30_000, 7900);
  assert.deepEqual(r.engine.snapshot(W).fastest, [], 'only while nobody is racing');
  r.engine.end(W, practice.id);
  for (let i = 0; i < 11; i += 1) r.store.offerPersonalBest(W, 'trk', 'cw', { driverId: `x${i}`, lapMs: 9000 + i, at: i, seq: i });
  const snap = r.engine.snapshot(W);
  assert.equal(snap.driven, true);
  assert.equal(snap.fastest.length, 10);
  assert.deepEqual(snap.fastest.slice(0, 3).map((b) => [b.driverId, b.bestMs]), [['ana', 7600], ['ben', 7900], ['x0', 9000]]);
  assert.deepEqual(r.engine.snapshot(W, { watcher: true }).fastest, snap.fastest);
  assert.equal('driven' in r.engine.snapshot(W, { watcher: true }), false, 'members only');
  useTrack(r.store, W, 'Office', 'ccw', 'trk');
  assert.deepEqual(r.engine.snapshot(W).fastest, [], 'per direction');
});
