// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The moment each standings row plays (fastest lap spec §4, §4.1): the server
// decides it from the driver's latest counted lap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MOMENT_SHOW_MS, RECORD_FRESH_MS, RECORD_SHOW_MS, createEngine } from '../../server/engine.js';
import { boardLive } from '../../server/views/board.js';
import { BOOT, T0, W, rig } from './rig.js';
import { useTrack } from './helpers.js';

/** A rig on track `trk`, clockwise, with Cy as a third driver. */
function onTrack() {
  const r = rig();
  useTrack(r.store, W, 'Office', 'cw', 'trk');
  r.store.addDriver(W, { id: 'cy', name: 'Cy', colour: '#2dff9b' });
  r.store.assignTransponder(W, '0C', 'cy', 0);
  return r;
}
/** Laps of `ms` for a transponder, from decoder time `from`: the first passing starts it. Returns the last time. */
function laps(pass, transponder, from, ...ms) {
  let t = from;
  pass(t, transponder);
  for (const lap of ms) pass((t += lap), transponder);
  return t;
}
/** Starts a practice at decoder time `t`, ending the running session. */
function practiceAt(r, t) {
  r.clock.now = T0 + t;
  return r.engine.start(W, { kind: 'practice', replace: true }).session;
}
/** Each driver's moment as the snapshot gives it: `seq mark`, the way the row carries it. */
function moments(r, watcher = false, engine = r.engine) {
  return Object.fromEntries(Object.entries(engine.snapshot(W, { watcher, moments: true }).moments).map(([id, m]) => [id, `${m.seq} ${m.mark}`]));
}
const markOf = (r, driverId, engine = r.engine) => engine.snapshot(W, { moments: true }).moments[driverId]?.mark ?? null;
/** The latest crossing's seq. */
const lastSeq = (r) => r.engine.snapshot(W).crossings[0].seq;

test('a track\'s very first lap plays nothing; nor does the session\'s first counted lap', () => {
  const r = onTrack();
  practiceAt(r, 0);
  laps(r.pass, '0A', 1000, 8000);
  assert.deepEqual(moments(r), {}, 'first counted lap, first record, no earlier best');
});

test('FL plays on every improvement of the session\'s fastest lap', () => {
  const r = onTrack();
  practiceAt(r, 0);
  // An earlier session's record, faster than anything below, so no lap here is a TR.
  laps(r.pass, '0C', 1000, 6000);
  practiceAt(r, 100_000);
  laps(r.pass, '0A', 101_000, 8000, 8000);
  assert.equal(markOf(r, 'ana'), null, 'the first counted lap beat no fastest lap');
  laps(r.pass, '0B', 120_000, 7900);
  assert.deepEqual(moments(r), { ben: `${lastSeq(r)} fl` });
  r.pass(137_000, '0A');
  assert.equal(markOf(r, 'ana'), null, 'a lap slower than the fastest lap');
  r.pass(135_700, '0B');
  assert.deepEqual(moments(r), { ben: `${lastSeq(r)} fl` }, 'again, on the next improvement');
  r.pass(143_500, '0B');
  assert.deepEqual(moments(r), {}, 'a tie is no improvement, and the latest counted lap decides');
});

test('a tapped lap can play FL, never PB or TR', () => {
  const r = onTrack();
  practiceAt(r, 0);
  laps(r.pass, '0A', 1000, 8000);
  r.clock.now = T0 + 20_000;
  r.engine.tap(W, 'ben');
  r.clock.now = T0 + 25_000;
  r.engine.tap(W, 'ben');
  assert.deepEqual(moments(r), { ben: `${lastSeq(r)} fl` });
});

test('PB plays only once the driver had a best here from an earlier session, then on every improvement', () => {
  const r = onTrack();
  practiceAt(r, 0);
  laps(r.pass, '0B', 1000, 6000);
  laps(r.pass, '0A', 2000, 9000);
  practiceAt(r, 100_000);
  laps(r.pass, '0B', 101_000, 8000, 8000);
  assert.equal(markOf(r, 'ben'), null, 'not under his earlier best');
  laps(r.pass, '0A', 103_000, 8500);
  assert.equal(markOf(r, 'ana'), 'pb', 'under her earlier best, though not the fastest lap');
  r.pass(119_900, '0A');
  assert.equal(markOf(r, 'ana'), 'pb', 'every improvement after that plays too');
  r.pass(128_350, '0A');
  assert.equal(markOf(r, 'ana'), null, 'slower than her best of this session');
  laps(r.pass, '0C', 104_000, 8700, 8600);
  assert.equal(markOf(r, 'cy'), null, 'a first best here shows PB with no moment');
});

test('a PB counts an aborted session\'s best as earlier', () => {
  const r = onTrack();
  r.clock.now = T0;
  const { session } = r.engine.start(W, { kind: 'qualifying', roster: ['ana', 'ben'], durationMs: 600_000 });
  laps(r.pass, '0A', 1000, 9000);
  laps(r.pass, '0B', 20_000, 7000);
  r.engine.abort(W, session.id);
  practiceAt(r, 100_000);
  laps(r.pass, '0A', 101_000, 8800);
  assert.equal(markOf(r, 'ana'), 'pb', 'the first counted lap, which is FL too, plays PB');
});

test('the best as it stood at the start is kept: this session\'s laps never make an earlier best', () => {
  const r = onTrack();
  practiceAt(r, 0);
  laps(r.pass, '0B', 1000, 7000);
  laps(r.pass, '0A', 10_000, 9000, 8500);
  assert.equal(markOf(r, 'ana'), null, 'personal_best has her 9.000 now, but from this session');
});

test('TR plays exactly when recordNew is set, and wins over FL and PB', () => {
  const r = onTrack();
  practiceAt(r, 0);
  laps(r.pass, '0C', 1000, 8000);
  laps(r.pass, '0A', 10_000, 9000);
  laps(r.pass, '0B', 20_000, 9500);
  practiceAt(r, 100_000);
  laps(r.pass, '0A', 101_000, 8500);
  laps(r.pass, '0B', 102_000, 7900);
  const snap = r.engine.snapshot(W);
  assert.ok(snap.recordNew, 'a record fell live');
  assert.deepEqual(moments(r), { ana: `${snap.crossings.find((c) => c.driverId === 'ana').seq} pb`, ben: `${snap.recordNew.seq} tr` },
    'Ben\'s lap is FL, PB and TR at once; the widest plays');
  assert.deepEqual(moments(r, true), moments(r), 'the watchers\' board plays the same');
});

test('a late lap plays nothing', () => {
  const r = onTrack();
  practiceAt(r, 0);
  laps(r.pass, '0C', 1000, 8000);
  laps(r.pass, '0A', 10_000, 9000);
  laps(r.pass, '0B', 20_000, 9500);
  practiceAt(r, 100_000);
  laps(r.pass, '0A', 101_000, 8500);
  laps(r.pass, '0B', 112_000, 9200);
  assert.equal(markOf(r, 'ben'), 'pb');
  // Ben's decoder catches up: a lap driven long ago that is FL, PB and a record.
  const receivedT = 121_200 + 7000 + RECORD_FRESH_MS + 30_000;
  r.clock.now = T0 + receivedT;
  r.engine.ingest({ workspaceId: W, decoder: 'd1', via: 'net', batch: { boot: BOOT, passings: [{ transponder: 'FF', t: receivedT }] } });
  r.engine.ingest({ workspaceId: W, decoder: 'd1', via: 'net', batch: { boot: BOOT, passings: [{ transponder: '0B', t: 121_200 + 7000 }] } });
  const snap = r.engine.snapshot(W);
  assert.equal(snap.record.lapMs, 7000, 'it took the record');
  assert.equal(snap.recordNew, null);
  assert.equal(markOf(r, 'ben'), null, 'a lap that arrived just now, but was driven long ago');
});

test('the board\'s rows carry their driver, and their moment when they have one', () => {
  const r = onTrack();
  practiceAt(r, 0);
  laps(r.pass, '0C', 1000, 6000);
  practiceAt(r, 100_000);
  laps(r.pass, '0A', 101_000, 8000, 8000);
  laps(r.pass, '0B', 120_000, 7900);
  const html = String(boardLive({ space: { base: '/clubs/x' } }, r.engine.snapshot(W, { moments: true })));
  const rows = [...html.matchAll(/<tr( [^>]*)?>\s*<td class="pos">/g)].map((m) => m[1]);
  assert.deepEqual(rows, [` data-driver="ben" data-moment="${lastSeq(r)} fl"`, ' data-driver="ana"']);
});

test('an ended session leaves no moments', () => {
  const r = onTrack();
  practiceAt(r, 0);
  laps(r.pass, '0C', 1000, 6000);
  practiceAt(r, 100_000);
  laps(r.pass, '0A', 101_000, 8000);
  laps(r.pass, '0B', 120_000, 7900);
  assert.equal(markOf(r, 'ben'), 'fl');
  r.engine.end(W, r.engine.snapshot(W).session.id);
  assert.deepEqual(r.engine.snapshot(W, { moments: true }).moments, {});
});

/** Three earlier laps: Cy's 8.000 the record, Ana's 9.000 and Ben's 9.500 their bests; then a practice from 100 s. */
function afterEarlier(r) {
  practiceAt(r, 0);
  laps(r.pass, '0C', 1000, 8000);
  laps(r.pass, '0A', 10_000, 9000);
  laps(r.pass, '0B', 20_000, 9500);
  practiceAt(r, 100_000);
}

test('only the board asks for moments: a plain snapshot has none', () => {
  const r = onTrack();
  afterEarlier(r);
  laps(r.pass, '0A', 101_000, 8500);
  assert.equal(markOf(r, 'ana'), 'pb');
  assert.equal('moments' in r.engine.snapshot(W), false);
  assert.equal('moments' in r.engine.snapshot(W, { watcher: true }), false);
});

test('FL and PB moments are offered for MOMENT_SHOW_MS, TR for as long as its record shows', () => {
  const r = onTrack();
  afterEarlier(r);
  laps(r.pass, '0A', 101_000, 8500);
  laps(r.pass, '0C', 102_000, 8400);
  const fl = r.clock.now;
  assert.deepEqual([markOf(r, 'ana'), markOf(r, 'cy')], ['pb', 'fl']);
  laps(r.pass, '0B', 103_000, 7900);
  const tr = r.clock.now;
  assert.equal(markOf(r, 'ben'), 'tr');
  r.clock.now = fl + MOMENT_SHOW_MS - 1;
  assert.equal(markOf(r, 'cy'), 'fl');
  r.clock.now = fl + MOMENT_SHOW_MS;
  assert.deepEqual(moments(r), { ben: `${r.engine.snapshot(W).recordNew.seq} tr` }, 'FL and PB are gone; TR stays');
  r.clock.now = tr + RECORD_SHOW_MS - 1;
  assert.equal(markOf(r, 'ben'), 'tr');
  r.clock.now = tr + RECORD_SHOW_MS;
  assert.equal(r.engine.snapshot(W).recordNew, null);
  assert.deepEqual(moments(r), {}, 'TR goes with recordNew');
});

test('a TR moment goes with recordNew when the club changes track during a race', () => {
  const r = onTrack();
  afterEarlier(r);
  r.engine.start(W, { kind: 'race', roster: ['ana', 'ben', 'cy'], durationMs: 600_000, replace: true });
  laps(r.pass, '0B', 101_000, 7900);
  assert.equal(markOf(r, 'ben'), 'tr');
  useTrack(r.store, W, 'Garden', 'cw', 'trk2');
  assert.equal(r.engine.snapshot(W).recordNew, null, 'the strip leaves it out');
  assert.deepEqual(moments(r), {}, 'and so does the row');
});

test('a race: the start crossing counts for nothing, the first counted lap beats nothing', () => {
  const r = onTrack();
  afterEarlier(r);
  r.clock.now = T0 + 100_000;
  r.engine.start(W, { kind: 'race', roster: ['ana', 'ben'], durationMs: 600_000, replace: true });
  r.pass(101_000, '0A');
  r.pass(101_500, '0B');
  assert.deepEqual(moments(r), {}, 'the start crossings');
  r.pass(110_500, '0A');
  assert.deepEqual(moments(r), {}, 'Ana\'s 9.500: the first counted lap, slower than her best');
  r.pass(110_700, '0B');
  assert.deepEqual(moments(r), { ben: `${lastSeq(r)} fl` }, 'Ben\'s 9.200: the fastest lap, and a PB, plays FL');
});

test('a transponder assigned during a session: its earlier laps become the driver\'s earlier best', () => {
  const r = onTrack();
  practiceAt(r, 0);
  laps(r.pass, '0C', 1000, 7000);
  laps(r.pass, '0E', 10_000, 9000);
  practiceAt(r, 100_000);
  r.store.addDriver(W, { id: 'dee', name: 'Dee', colour: '#9b2dff' });
  r.engine.assign(W, '0E', 'dee');
  laps(r.pass, '0E', 101_000, 8800);
  assert.equal(markOf(r, 'dee'), 'pb', 'the 9.000 she drove before it was hers');
});

test('a rebuild drops the moments its laps earned', () => {
  const r = onTrack();
  afterEarlier(r);
  laps(r.pass, '0A', 101_000, 8500);
  assert.equal(markOf(r, 'ana'), 'pb');
  laps(r.pass, '0E', 102_000, 8200);
  r.store.addDriver(W, { id: 'dee', name: 'Dee', colour: '#9b2dff' });
  r.engine.assign(W, '0E', 'dee');
  assert.deepEqual(moments(r), {}, 'Dee\'s laps count now: Ana\'s may no longer be what they were');
});

test('after a restart the state is replayed and the earlier bests read again', () => {
  const r = onTrack();
  afterEarlier(r);
  laps(r.pass, '0A', 101_000, 8800);
  laps(r.pass, '0B', 102_000, 9400);
  const engine = createEngine({ store: r.store, hub: r.hub, now: () => r.clock.now });
  const pass = (t, transponder) => {
    r.clock.now = T0 + t;
    engine.ingest({ workspaceId: W, decoder: 'd1', via: 'net', batch: { boot: BOOT, passings: [{ transponder, t }] } });
  };
  pass(120_400, '0B');
  assert.equal(markOf(r, 'ben', engine), 'pb', 'his 9.000 beats his 9.500 from before this session');
  pass(118_400, '0A');
  assert.equal(markOf(r, 'ana', engine), 'fl', 'her 8.600 beats the replayed fastest lap, her 8.800');
});
