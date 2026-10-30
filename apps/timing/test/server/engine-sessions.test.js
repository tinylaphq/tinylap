// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../../server/engine.js';
import { T0, W, rig } from './rig.js';

test('a race: countdown, start crossings, laps, time up, finish, results', () => {
  const { engine, store, clock, events, pass, startPractice } = rig();
  const practice = startPractice();
  pass(1000);
  clock.now = T0 + 2000;
  const { session } = engine.start(W, { kind: 'race', roster: ['ana', 'ben'], durationMs: 60_000, countdownMs: 10_000, replace: true });
  assert.equal(session.state, 'countdown');
  assert.equal(store.session(practice.id).state, 'done', 'practice ended');
  assert.equal(engine.start(W, { kind: 'race', roster: ['ana'], durationMs: 1000 }).error, 'conflict');

  pass(9000); // before go: ignored
  clock.now = T0 + 12_000;
  engine.tick();
  assert.equal(store.session(session.id).state, 'running');
  pass(12_500); // ana's start
  pass(12_700, '0B'); // ben's start
  pass(20_500);
  pass(20_900, '0B');
  pass(28_500);
  clock.now = T0 + 72_000;
  engine.tick();
  assert.equal(store.session(session.id).state, 'finishing');
  pass(73_000); // ana's next crossing (a 44 500 ms lap) finishes her
  assert.equal(store.session(session.id).state, 'finishing', 'ben is still out');
  pass(78_000, '0B'); // ben finishes too (57 100 ms): the race is over
  assert.equal(store.session(session.id).state, 'done');
  const results = events.filter((e) => e.type === 'results').at(-1).data;
  assert.deepEqual(results.standings.map((s) => [s.driverId, s.laps, s.finished]), [['ana', 3, true], ['ben', 2, true]]);
  assert.equal(results.standings[0].elapsedMs, 500 + 8000 + 8000 + 44_500);

});

test('qualifying: a window, best lap, complete once everyone crossed after the close', () => {
  const { engine, store, clock, events, pass } = rig();
  pass(1000);
  clock.now = T0 + 5000;
  const { session } = engine.start(W, { kind: 'qualifying', roster: ['ana'], durationMs: 30_000 });
  assert.equal(session.state, 'running');
  pass(9000); // lap began at 1000, before the window
  pass(17_000);
  pass(25_500);
  pass(33_000);
  clock.now = T0 + 35_000;
  engine.tick();
  assert.equal(store.session(session.id).state, 'finishing');
  pass(41_000); // began 33 000, before the close at 35 000: counts, and ana crossed after the close
  assert.equal(store.session(session.id).state, 'done');
  const results = events.filter((e) => e.type === 'results').at(-1).data;
  assert.deepEqual(results.standings.map((s) => [s.driverId, s.bestMs, s.laps]), [['ana', 7500, 4]]);
});

test('abort ends a race at once', () => {
  const { engine, store, clock } = rig();
  const { session } = engine.start(W, { kind: 'race', roster: ['ana'], durationMs: 60_000, countdownMs: 0 });
  clock.now += 1000;
  assert.equal(engine.abort(W, session.id).state, 'aborted');
  assert.equal(store.session(session.id).state, 'aborted');
  assert.equal(engine.abort(W, session.id), null);
  assert.equal(engine.abort('other', session.id), null);
});

test('assigning a transponder recounts its laps', () => {
  const { engine, store, events, pass, startPractice } = rig();
  const practice = startPractice();
  store.addDriver(W, { id: 'cy', name: 'Cy', colour: '#2dff9b' });
  pass(1000, '0C');
  pass(9000, '0C');
  engine.assign(W, '0C', 'cy');
  const rows = store.crossings(practice.id);
  assert.deepEqual(rows.map((c) => [c.driverId, c.counts]), [['cy', false], ['cy', true]]);
  assert.deepEqual(events.filter((e) => e.type === 'standings').at(-1).data.standings.map((s) => s.driverId), ['cy']);
  assert.deepEqual(events.filter((e) => e.type === 'setup').at(-1).data, { unknown: [] });
});

test('a restart in the middle of a race finishes it from what is stored', () => {
  const { engine, store, hub, clock, pass } = rig();
  const { session } = engine.start(W, { kind: 'race', roster: ['ana'], durationMs: 30_000, countdownMs: 0 });
  pass(1000);
  pass(9000);
  // A new process: the same database, a new engine.
  const again = createEngine({ store, hub, now: () => clock.now });
  clock.now = T0 + 17_000;
  again.ingest({ workspaceId: W, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder: '0A', t: 17_000 }] } });
  clock.now = T0 + 31_000;
  again.tick();
  clock.now = T0 + 33_000;
  again.ingest({ workspaceId: W, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder: '0A', t: 33_000 }] } });
  assert.equal(store.session(session.id).state, 'done');
  assert.deepEqual(again.sessionDetail(W, session.id).standings.map((s) => [s.laps, s.finished]), [[3, true]]);
});

test('a decoder reboot mid-race costs one lap, not the race', () => {
  const { engine, store, pass } = rig();
  const { session } = engine.start(W, { kind: 'race', roster: ['ana'], durationMs: 120_000, countdownMs: 0 });
  pass(1000);
  pass(9000);
  pass(500, '0A', 'n3wb00t1'); // after the reboot: a start, no lap
  pass(8500, '0A', 'n3wb00t1');
  const detail = engine.sessionDetail(W, session.id);
  assert.deepEqual(detail.crossings.map((c) => [c.lapMs, c.counts]), [[null, false], [8000, true], [null, false], [8000, true]]);
  assert.equal(detail.standings[0].laps, 2);
  assert.equal(store.session(session.id).state, 'running');
});

test('the snapshot: members get setup, watchers do not', () => {
  const { engine, store, pass, startPractice } = rig();
  store.setTrack(W, { id: 't1', shape: 'c30:1:x', name: 'Office', snapshotKey: 'k'.repeat(22), layout: '{}' }, 'cw');
  startPractice();
  pass(1000);
  pass(9000);
  pass(9500, '0C');
  const member = engine.snapshot(W);
  assert.deepEqual(member.track, { id: 't1', name: 'Office' });
  assert.equal(member.direction, 'cw');
  assert.equal(member.session.kind, 'practice');
  assert.deepEqual(member.standings.map((s) => s.driverId), ['ana']);
  assert.equal(member.crossings[0].transponder, '0C', 'newest first');
  assert.deepEqual(member.unknown, ['0C']);
  assert.deepEqual(member.bests, [{ driverId: 'ana', bestMs: 8000, at: member.crossings[1].at, seq: member.crossings[1].seq }]);
  assert.deepEqual(member.drivers.map((d) => d.id), ['ana', 'ben']);
  const watcher = engine.snapshot(W, { watcher: true });
  assert.equal('unknown' in watcher, false);
  assert.equal(watcher.crossings.length, 2);
  assert.ok(watcher.crossings.every((c) => !('transponder' in c)));
});

test('assigning a transponder leaves finished races frozen', () => {
  const { engine, store, clock, events, pass } = rig();
  store.addDriver(W, { id: 'cy', name: 'Cy', colour: '#2dff9b' });
  const { session } = engine.start(W, { kind: 'race', roster: ['ana', 'cy'], durationMs: 30_000, countdownMs: 0 });
  pass(1000, '0C');
  pass(9000, '0C');
  pass(2000);
  pass(10_000);
  clock.now = T0 + 31_000;
  engine.tick();
  clock.now = T0 + 100_000;
  engine.tick();
  assert.equal(store.session(session.id).state, 'done');
  const counts = () => store.crossings(session.id).map((c) => c.counts);
  const before = { counts: counts(), standings: engine.sessionDetail(W, session.id).standings };
  const seen = events.length;
  engine.assign(W, '0C', 'cy');
  assert.deepEqual(counts(), before.counts);
  assert.deepEqual(engine.sessionDetail(W, session.id).standings, before.standings);
  assert.deepEqual(events.slice(seen).filter((e) => e.type === 'standings' && e.data.sessionId === session.id), []);
});

test('the snapshot keeps the last results until a new qualifying or race opens', () => {
  const { engine, clock, pass } = rig();
  assert.equal(engine.snapshot(W).lastResults, null);
  const { session } = engine.start(W, { kind: 'race', roster: ['ana'], durationMs: 30_000, countdownMs: 0 });
  pass(1000);
  pass(9000);
  assert.equal(engine.snapshot(W).lastResults, null, 'not while the race runs');
  clock.now = T0 + 31_000;
  engine.tick();
  clock.now = T0 + 100_000;
  engine.tick();
  const member = engine.snapshot(W);
  assert.equal(member.session, null);
  assert.deepEqual([member.lastResults.session.id, member.lastResults.session.state], [session.id, 'done']);
  assert.equal('workspaceId' in member.lastResults.session, false);
  assert.deepEqual(member.lastResults.standings.map((s) => [s.driverId, s.laps]), [['ana', 1]]);
  assert.deepEqual(engine.snapshot(W, { watcher: true }).lastResults, member.lastResults);

  const next = engine.start(W, { kind: 'qualifying', roster: ['ana'], durationMs: 30_000 }).session;
  assert.equal(engine.snapshot(W).lastResults, null, 'a new qualifying clears them');
  clock.now += 1000;
  engine.abort(W, next.id);
  assert.deepEqual(engine.snapshot(W).lastResults.session.state, 'aborted');
});

test('starting while a session runs is a conflict, unless replace', () => {
  const { store, engine } = rig();
  const practice = engine.start(W, { kind: 'practice' }).session;
  const refused = engine.start(W, { kind: 'race', roster: ['ana'], durationMs: 60_000, countdownMs: 10_000 });
  assert.equal(refused.error, 'conflict');
  assert.equal(refused.running.id, practice.id);
  const { session } = engine.start(W, { kind: 'race', roster: ['ana'], durationMs: 60_000, countdownMs: 10_000, replace: true });
  assert.equal(store.session(practice.id).state, 'done');
  assert.equal(store.runningSession(W).id, session.id);
});

test('replacing a counting-down race aborts it', () => {
  const { store, engine, clock } = rig();
  const race = engine.start(W, { kind: 'race', roster: ['ana'], durationMs: 60_000, countdownMs: 10_000 }).session;
  clock.now = T0 + 3000;
  const { session } = engine.start(W, { kind: 'practice', replace: true });
  assert.deepEqual([store.session(race.id).state, store.session(race.id).endedAt], ['aborted', T0 + 3000]);
  assert.equal(store.runningSession(W).id, session.id);
});

test('end stops a running practice, and refuses anything else', () => {
  const { store, engine, clock, pass } = rig();
  const practice = engine.start(W, { kind: 'practice' }).session;
  pass(1000);
  clock.now = T0 + 5000;
  assert.equal(engine.end('other', practice.id), null);
  const ended = engine.end(W, practice.id);
  assert.deepEqual([ended.state, ended.endedAt], ['done', T0 + 1000]);
  assert.equal(engine.end(W, practice.id), null, 'already ended');
  const race = engine.start(W, { kind: 'race', roster: ['ana'], durationMs: 60_000, countdownMs: 0 }).session;
  assert.equal(engine.end(W, race.id), null);
  assert.equal(store.session(race.id).state, 'running');
});

test('a new track ends the running practice', () => {
  const { store, engine, pass } = rig();
  const practice = engine.start(W, { kind: 'practice' }).session;
  pass(1000);
  engine.endPractice(W);
  assert.deepEqual([store.session(practice.id).state, store.session(practice.id).endedAt], ['done', T0 + 1000]);
  assert.equal(store.runningSession(W), null);
});
