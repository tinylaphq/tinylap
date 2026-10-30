// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { IDLE_SQL, TRACK_SQL, openStore } from '../../server/store.js';

const W = 'ws-1';

function practice(store, id = 's1', fields = {}) {
  store.addSession({ id, workspaceId: W, kind: 'practice', trackId: 't1', direction: 'ccw', roster: null, state: 'running', createdAt: 0, opensAt: 0, closesAt: null, endedAt: null, durationMs: null, ...fields });
  return store.session(id);
}

function crossing(store, fields) {
  return store.addCrossing({ workspaceId: W, sessionId: 's1', decoder: 'd1', boot: 'b00tb00t', transponder: '0A', t: 0, driverId: null, at: 0, lapMs: null, counts: false, ref: true, via: 'net', flag: null, ...fields });
}

const LAYOUT = { plannerId: 'p1', shape: 'c30:1:x', snapshotKey: 'k'.repeat(22), layout: '{}' };
const BY = { userId: 'u1', name: 'Ana Admin', at: 1000 };

test('a new club has "Track", current, counter-clockwise, without a layout', () => {
  const store = openStore(':memory:');
  assert.equal(store.workspace(W), null);
  const ws = store.ensureWorkspace(W);
  const track = store.track(W, ws.trackId);
  assert.deepEqual([track.name, track.layout, ws.direction], ['Track', null, 'ccw']);
  assert.equal(store.tracks(W, { archived: false }).length, 1);
  assert.deepEqual(store.ensureWorkspace(W), ws, 'only the first use creates it');
  assert.equal(store.tracks(W, { archived: false }).length, 1);
});

test('the watchers token, set first, still gives a new club its "Track"', () => {
  const store = openStore(':memory:');
  store.setWatchToken(W, 'tok');
  assert.deepEqual(store.tracks(W, { archived: false }).map((t) => t.name), ['Track']);
});

test('names are unique among active tracks, case-insensitively', () => {
  const store = openStore(':memory:');
  store.ensureWorkspace(W);
  assert.equal(store.addTrack(W, { id: 'office', name: 'Office' }), 'added');
  assert.equal(store.addTrack(W, { id: 'office2', name: 'office' }), 'name-in-use');
  assert.equal(store.renameTrack(W, 'office', 'TRACK'), 'name-in-use');
  assert.equal(store.renameTrack(W, 'office', 'Office loop'), 'renamed');
  assert.equal(store.renameTrack(W, 'nope', 'Hall'), 'missing');
  assert.equal(store.setArchived(W, 'office', 5), 'done');
  assert.equal(store.addTrack(W, { id: 'office2', name: 'office loop' }), 'added');
  assert.deepEqual(store.tracks(W, { archived: false }).map((t) => t.name), ['office loop', 'Track']);
  assert.deepEqual(store.tracks(W, { archived: true }).map((t) => [t.name, t.archivedAt]), [['Office loop', 5]]);
  assert.equal(store.track(W, 'nope'), null);
  assert.equal(store.track('other', 'office'), null, 'a track belongs to its club');
});

test('restoring into a name clash is refused', () => {
  const store = openStore(':memory:');
  store.ensureWorkspace(W);
  store.addTrack(W, { id: 'a', name: 'Office' });
  store.setArchived(W, 'a', 5);
  store.addTrack(W, { id: 'b', name: 'OFFICE' });
  assert.equal(store.setArchived(W, 'a', null), 'name-in-use');
  assert.equal(store.track(W, 'a').archivedAt, 5);
  store.renameTrack(W, 'b', 'Hall');
  assert.equal(store.setArchived(W, 'a', null), 'done');
  assert.equal(store.track(W, 'a').archivedAt, null);
  assert.equal(store.setArchived(W, 'nope', 5), 'missing');
});

test('the current track cannot be archived; only an archived track can be deleted', () => {
  const store = openStore(':memory:');
  const ws = store.ensureWorkspace(W);
  assert.equal(store.setArchived(W, ws.trackId, 5), 'current');
  assert.equal(store.track(W, ws.trackId).archivedAt, null);
  assert.equal(store.deleteTrack(W, ws.trackId), 'not-archived');
  store.addTrack(W, { id: 'hall', name: 'Hall' });
  assert.equal(store.deleteTrack(W, 'hall'), 'not-archived');
  assert.equal(store.deleteTrack(W, 'nope'), 'missing');
  store.setArchived(W, 'hall', 5);
  assert.equal(store.setCurrentTrack(W, 'hall', 'cw'), 'archived');
  assert.equal(store.setCurrentTrack(W, 'nope', 'cw'), 'missing');
  store.setArchived(W, 'hall', null);
  assert.equal(store.setCurrentTrack(W, 'hall', 'cw'), 'done');
  assert.deepEqual([store.workspace(W).trackId, store.workspace(W).direction], ['hall', 'cw']);
  assert.equal(store.setArchived(W, ws.trackId, 5), 'done', 'once another track is current');
  assert.equal(store.deleteTrack(W, ws.trackId), 'deleted');
  assert.equal(store.track(W, ws.trackId), null);
});

test('deleting a track removes its layouts and records, not its sessions', () => {
  const store = openStore(':memory:');
  store.ensureWorkspace(W);
  store.addTrack(W, { id: 't1', name: 'Office' });
  store.addTrack(W, { id: 't2', name: 'Hall' });
  store.attachLayout(W, 't1', LAYOUT, BY);
  store.attachLayout(W, 't2', LAYOUT, BY);
  practice(store);
  practice(store, 's2', { trackId: 't2' });
  crossing(store, { driverId: 'ana', lapMs: 8000, counts: true, at: 10 });
  crossing(store, { sessionId: 's2', driverId: 'ana', lapMs: 7000, counts: true, at: 20 });
  store.rebuildRecords(W, 't1', 'ccw');
  store.rebuildRecords(W, 't2', 'ccw');
  assert.equal(store.sessionCount(W, 't1'), 1);
  store.setArchived(W, 't1', 5);
  assert.equal(store.deleteTrack(W, 't1'), 'deleted');
  assert.equal(store.track(W, 't1'), null);
  assert.deepEqual(store.layouts(W, 't1'), []);
  assert.equal(store.currentRecord(W, 't1', 'ccw'), null);
  assert.deepEqual(store.personalBests(W, 't1', 'ccw', ['ana']), []);
  store.rebuildRecords(W, 't1', 'ccw');
  assert.equal(store.currentRecord(W, 't1', 'ccw'), null, 'a rebuild does not bring them back');
  assert.deepEqual(store.personalBests(W, 't1', 'ccw', ['ana']), []);
  assert.equal(store.session('s1').trackId, 't1', 'the session stays, and finds no track');
  assert.equal(store.sessionCount(W, 't1'), 1);
  assert.equal(store.currentRecord(W, 't2', 'ccw').lapMs, 7000, 'other tracks keep theirs');
  assert.equal(store.layouts(W, 't2').length, 1);
});

test('the same layout again adds nothing; a new snapshot adds an entry', () => {
  const store = openStore(':memory:');
  store.ensureWorkspace(W);
  store.addTrack(W, { id: 't1', name: 'Office' });
  assert.equal(store.attachLayout(W, 't1', LAYOUT, BY), 'added');
  assert.equal(store.attachLayout(W, 't1', LAYOUT, { ...BY, at: 2000 }), 'same');
  assert.equal(store.attachLayout(W, 't1', { ...LAYOUT, snapshotKey: 'n'.repeat(22) }, { ...BY, at: 3000 }), 'added');
  assert.deepEqual(store.layouts(W, 't1').map((l) => [l.attachedAt, l.snapshotKey]), [[3000, 'n'.repeat(22)], [1000, 'k'.repeat(22)]]);
  assert.deepEqual(store.track(W, 't1').layout, { attachedAt: 3000, plannerId: 'p1', shape: 'c30:1:x', snapshotKey: 'n'.repeat(22), layout: '{}', by: 'Ana Admin', byMember: true });
  assert.deepEqual(store.tracks(W, { archived: false }).find((t) => t.id === 't1').layout, store.track(W, 't1').layout);
});

test('layoutAt finds the layout current at a time', () => {
  const store = openStore(':memory:');
  store.ensureWorkspace(W);
  store.addTrack(W, { id: 't1', name: 'Office' });
  store.attachLayout(W, 't1', LAYOUT, { ...BY, at: 100 });
  store.attachLayout(W, 't1', { ...LAYOUT, plannerId: 'p2' }, { ...BY, at: 200 });
  assert.equal(store.layoutAt(W, 't1', 99), null);
  assert.equal(store.layoutAt(W, 't1', 101).plannerId, 'p1');
  assert.equal(store.layoutAt(W, 't1', 200).plannerId, 'p2');
});

test('forgetting a member keeps the date and drops the name', () => {
  const store = openStore(':memory:');
  store.ensureWorkspace(W);
  store.addTrack(W, { id: 't1', name: 'Office' });
  store.attachLayout(W, 't1', LAYOUT, BY);
  store.attachLayout(W, 't1', { ...LAYOUT, plannerId: 'p2' }, { userId: 'u2', name: 'Ben', at: 2000 });
  store.forgetUser('u1');
  assert.deepEqual(store.layouts(W, 't1').map((l) => [l.attachedAt, l.by]), [[2000, 'Ben'], [1000, null]]);
});

test('purging a club removes its tracks and layouts', () => {
  const store = openStore(':memory:');
  store.ensureWorkspace(W);
  store.addTrack(W, { id: 't1', name: 'Office' });
  store.attachLayout(W, 't1', LAYOUT, BY);
  store.deleteWorkspaceData(W);
  assert.deepEqual(store.tracks(W, { archived: false }), []);
  assert.deepEqual(store.layouts(W, 't1'), []);
});

test('names compare case-insensitively beyond ASCII', () => {
  const store = openStore(':memory:');
  store.ensureWorkspace(W);
  assert.equal(store.addTrack(W, { id: 'a', name: 'Büro' }), 'added');
  assert.equal(store.addTrack(W, { id: 'b', name: 'büro' }), 'name-in-use');
  assert.equal(store.addTrack(W, { id: 'b', name: 'BÜRO' }), 'name-in-use');
  assert.equal(store.addTrack(W, { id: 'b', name: 'Halle' }), 'added');
  assert.equal(store.renameTrack(W, 'b', 'bu\u0308ro'), 'name-in-use', 'the same name, composed differently');
});

test('the board reads a track and its newest layout through their keys, not by scanning', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'timing-store-')), 'db.sqlite');
  openStore(path).close();
  const db = new DatabaseSync(path);
  const plan = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => String(r.detail)).join(' | ');
  for (const sql of Object.values(TRACK_SQL)) assert.doesNotMatch(plan(sql), /\bSCAN\b/, sql);
  db.close();
});

test('a passing is stored once, and through is the highest t of its boot', () => {
  const store = openStore(':memory:');
  const p = { decoder: 'd1', boot: 'b00tb00t', transponder: '0A', t: 5000, receivedAt: 1, via: 'net', workspaceId: W };
  assert.equal(store.insertPassing(p), true);
  assert.equal(store.insertPassing({ ...p, via: 'serial' }), false);
  store.insertPassing({ ...p, t: 9000 });
  store.insertPassing({ ...p, boot: 'otherboot', t: 99_000 });
  assert.equal(store.through('d1', 'b00tb00t'), 9000);
  assert.equal(store.through('d1', 'nothere1'), null);
});

test('the lap reference is the newest crossing marked ref', () => {
  const store = openStore(':memory:');
  practice(store);
  crossing(store, { t: 1000, ref: true });
  crossing(store, { t: 1100, ref: false });
  assert.deepEqual(store.lastReference('d1', '0A'), { boot: 'b00tb00t', t: 1000 });
  assert.equal(store.lastReference('d1', '0B'), null);
});

test('assigning a transponder gives its unassigned crossings to the driver', () => {
  const store = openStore(':memory:');
  practice(store);
  practice(store, 's2');
  store.addDriver(W, { id: 'ana', name: 'Ana', colour: '#ff2d9b' });
  store.seeTransponder(W, '0A', 1);
  crossing(store, { t: 1, at: 1 });
  crossing(store, { sessionId: 's2', t: 2, at: 2 });
  crossing(store, { transponder: '0B', t: 3, at: 3 });
  store.assignTransponder(W, '0A', 'ana', 5);
  assert.deepEqual(store.assignCrossings(W, '0A', 'ana').sort(), ['s1', 's2']);
  assert.deepEqual(store.crossings('s1').map((c) => [c.transponder, c.driverId]), [['0A', 'ana'], ['0B', null]]);
  assert.deepEqual(store.seeTransponder(W, '0A', 9), { code: '0A', driverId: 'ana', created: false });
  assert.deepEqual(store.seeTransponder(W, '0C', 9), { code: '0C', driverId: null, created: true });
});

test('deleting a driver unassigns their transponders and keeps their laps', () => {
  const store = openStore(':memory:');
  practice(store);
  store.addDriver(W, { id: 'ana', name: 'Ana', colour: '#ff2d9b' });
  store.assignTransponder(W, '0A', 'ana', 1);
  crossing(store, { driverId: 'ana', lapMs: 8000, counts: true });
  assert.equal(store.deleteDriver(W, 'ana'), true);
  assert.equal(store.deleteDriver(W, 'ana'), false);
  assert.deepEqual(store.transponders(W).map((t) => [t.code, t.driverId]), [['0A', null]]);
  assert.equal(store.crossings('s1')[0].driverId, 'ana');
});

test('personal bests: counted, decoder-timed, per track and direction', () => {
  const store = openStore(':memory:');
  store.addTrack(W, { id: 't1', name: 'Office' });
  practice(store);
  practice(store, 'cw', { direction: 'cw' });
  crossing(store, { driverId: 'ana', lapMs: 8000, counts: true, at: 10 });
  const seq = crossing(store, { driverId: 'ana', lapMs: 7000, counts: true, at: 20 });
  crossing(store, { driverId: 'ana', lapMs: 6000, counts: false, at: 30 });
  crossing(store, { driverId: 'ana', lapMs: 5000, counts: true, at: 40, via: 'tap' });
  crossing(store, { sessionId: 'cw', driverId: 'ana', lapMs: 4000, counts: true, at: 50 });
  store.rebuildRecords(W, 't1', 'ccw');
  assert.deepEqual(store.personalBests(W, 't1', 'ccw', ['ana']), [{ driverId: 'ana', bestMs: 7000, at: 20, seq }]);
  assert.deepEqual(store.personalBests(W, 't1', 'ccw', ['ben']), []);
});

test('a database from before records gets them filled from its laps on open', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'timing-store-')), 'db.sqlite');
  const store = openStore(path);
  store.addTrack(W, { id: 't1', name: 'Office' });
  practice(store);
  practice(store, 'cw', { direction: 'cw' });
  crossing(store, { driverId: 'ana', lapMs: 8000, counts: true, at: 10 });
  crossing(store, { driverId: 'ben', lapMs: 7000, counts: true, at: 20 });
  crossing(store, { sessionId: 'cw', driverId: 'ana', lapMs: 6000, counts: true, at: 30 });
  store.close();
  const db = new DatabaseSync(path);
  db.exec("DROP TABLE track_record; DROP TABLE personal_best; DELETE FROM feed_cursor WHERE feed = 'records-filled';");
  db.close();
  const reopened = openStore(path);
  assert.deepEqual(reopened.recordHistory(W, 't1', 'ccw').map((r) => [r.driverId, r.lapMs]), [['ben', 7000], ['ana', 8000]]);
  assert.deepEqual(reopened.recordHistory(W, 't1', 'cw').map((r) => [r.driverId, r.lapMs]), [['ana', 6000]]);
  assert.deepEqual(reopened.personalBests(W, 't1', 'ccw', ['ana', 'ben']).map((b) => [b.driverId, b.bestMs]), [['ben', 7000], ['ana', 8000]]);
  reopened.close();
});

test('a fill of records cut short is done again on the next open, and only until it is done', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'timing-store-')), 'db.sqlite');
  const store = openStore(path);
  store.addTrack(W, { id: 't1', name: 'Office' });
  practice(store);
  crossing(store, { driverId: 'ana', lapMs: 8000, counts: true, at: 10 });
  store.close();
  // The tables were created, but the fill never committed.
  let db = new DatabaseSync(path);
  db.exec("DELETE FROM feed_cursor WHERE feed = 'records-filled'");
  db.close();
  const reopened = openStore(path);
  assert.deepEqual(reopened.recordHistory(W, 't1', 'ccw').map((r) => [r.driverId, r.lapMs]), [['ana', 8000]]);
  reopened.close();
  db = new DatabaseSync(path);
  db.exec('DELETE FROM track_record');
  db.close();
  const again = openStore(path);
  assert.deepEqual(again.recordHistory(W, 't1', 'ccw'), [], 'filled once, not on every open');
  again.close();
});

test('running sessions, of any kind', () => {
  const store = openStore(':memory:');
  practice(store);
  assert.equal(store.runningSession(W).id, 's1');
  assert.deepEqual(store.activeAll().map((s) => s.id), ['s1']);
  store.updateSession('s1', { state: 'done', endedAt: 4 });
  assert.equal(store.runningSession(W), null);
  store.addSession({ id: 'r1', workspaceId: W, kind: 'race', trackId: null, direction: 'ccw', roster: ['ana'], state: 'countdown', createdAt: 5, opensAt: 10, closesAt: 20, endedAt: null, durationMs: 10 });
  assert.deepEqual(store.runningSession(W).roster, ['ana']);
  assert.deepEqual(store.activeAll().map((s) => s.id), ['r1']);
  store.updateSession('r1', { state: 'done', endedAt: 30 });
  assert.equal(store.runningSession(W), null);
  assert.deepEqual(store.listSessions(W, 10).map((s) => s.id), ['r1', 's1']);
});

test('sessions page on by createdAt, and a summary reads one session\'s counted laps', () => {
  const store = openStore(':memory:');
  practice(store, 's1', { createdAt: 1 });
  practice(store, 's2', { createdAt: 2 });
  practice(store, 's3', { createdAt: 3 });
  practice(store, 's2b', { createdAt: 2 });
  assert.deepEqual(store.listSessions(W, 2).map((s) => s.id), ['s3', 's2b']);
  // A page ends between two sessions of the same createdAt: the next starts with the other one.
  assert.deepEqual(store.listSessions(W, 2, { createdAt: 2, id: 's2b' }).map((s) => s.id), ['s2', 's1']);
  assert.deepEqual(store.sessionSummary('s1'), { drivers: 0, best: null });
  crossing(store, { t: 1, driverId: 'ana', counts: true });
  crossing(store, { t: 2, driverId: 'ana', lapMs: 8000, counts: true });
  const best = crossing(store, { t: 3, driverId: 'ben', lapMs: 7000, counts: true });
  crossing(store, { t: 4, driverId: 'cem', lapMs: 6000, counts: false });
  crossing(store, { t: 5, driverId: null, lapMs: 5000, counts: false });
  assert.deepEqual(store.sessionSummary('s1'), { drivers: 2, best: { seq: best, driverId: 'ben', lapMs: 7000 } });
});

test('decoders are found by their token hash', () => {
  const store = openStore(':memory:');
  store.addDecoder(W, { id: 'd1', name: 'Gate', tokenHash: 'h1', createdAt: 1 });
  assert.deepEqual(store.decoderByTokenHash('h1'), { id: 'd1', workspaceId: W });
  assert.equal(store.decoderByTokenHash('h2'), null);
  store.touchDecoder('d1', 7);
  assert.deepEqual(store.decoders(W), [{ id: 'd1', name: 'Gate', createdAt: 1, lastSeenAt: 7 }]);
  assert.equal(store.deleteDecoder(W, 'd1'), true);
  assert.equal(store.decoder('d1'), null);
});

test('the watchers token finds its workspace', () => {
  const store = openStore(':memory:');
  store.ensureWorkspace(W);
  store.setWatchToken(W, 'tok');
  assert.equal(store.workspaceByWatchToken('tok'), W);
  store.setWatchToken(W, 'new');
  assert.equal(store.workspaceByWatchToken('tok'), null);
});

test('deleting a workspace removes all of its rows', () => {
  const store = openStore(':memory:');
  store.addTrack(W, { id: 't1', name: 'Office' });
  practice(store);
  store.addDriver(W, { id: 'ana', name: 'Ana', colour: '#ff2d9b' });
  store.addDecoder(W, { id: 'd1', name: 'Gate', tokenHash: 'h1', createdAt: 1 });
  store.insertPassing({ decoder: 'd1', boot: 'b00tb00t', transponder: '0A', t: 1, receivedAt: 1, via: 'net', workspaceId: W });
  crossing(store, { driverId: 'ana', lapMs: 8000, counts: true, at: 10 });
  store.rebuildRecords(W, 't1', 'ccw');
  assert.equal(store.currentRecord(W, 't1', 'ccw').lapMs, 8000);
  store.deleteWorkspaceData(W);
  assert.equal(store.currentRecord(W, 't1', 'ccw'), null);
  assert.deepEqual(store.personalBests(W, 't1', 'ccw', ['ana']), []);
  assert.equal(store.workspace(W), null);
  assert.deepEqual(store.drivers(W), []);
  assert.equal(store.decoder('d1'), null);
  assert.equal(store.session('s1'), null);
  assert.equal(store.through('d1', 'b00tb00t'), null);
});

test('a transaction is all or nothing', () => {
  const store = openStore(':memory:');
  assert.throws(() => store.transaction(() => {
    store.addDriver(W, { id: 'ana', name: 'Ana', colour: '#ff2d9b' });
    throw new Error('stop');
  }), /stop/);
  assert.deepEqual(store.drivers(W), []);
});

test('choosableDecoders drops a decoder that sends over Wi-Fi, keeps one that only came by cable', () => {
  const store = openStore(':memory:');
  store.addDecoder(W, { id: 'd1', name: 'Wi-Fi', tokenHash: 'h1', createdAt: 1 });
  store.addDecoder(W, { id: 'd2', name: 'Cable', tokenHash: 'h2', createdAt: 2 });
  store.insertPassing({ decoder: 'd1', boot: 'b00tb00t', transponder: '0A', t: 1, receivedAt: 1, via: 'net', workspaceId: W });
  store.insertPassing({ decoder: 'd2', boot: 'b00tb00t', transponder: '0A', t: 1, receivedAt: 1, via: 'serial', workspaceId: W });
  assert.deepEqual(store.choosableDecoders(W), [{ id: 'd2', name: 'Cable', createdAt: 2, lastSeenAt: null }]);
});

test('deleteLoosePassings deletes passings without a crossing once, and only before the cutoff', () => {
  const store = openStore(':memory:');
  practice(store);
  const p = { decoder: 'd1', boot: 'b00tb00t', transponder: '0A', t: 1000, receivedAt: 10, via: 'net', workspaceId: W };
  store.insertPassing(p);
  store.insertPassing({ ...p, t: 2000 });
  store.insertPassing({ ...p, t: 3000, receivedAt: 500 });
  store.insertPassing({ ...p, t: 500, receivedAt: 2 }); // before the first sweep's start: it stays
  crossing(store, { t: 1000 });
  assert.equal(store.deleteLoosePassings(100, 5), 1, 'the first sweep starts at `since`, not at 0');
  assert.equal(store.countPassings(W), 3);
  assert.equal(store.deleteLoosePassings(100, 5), 0);
  assert.equal(store.deleteLoosePassings(1000, 5), 1);
  assert.equal(store.countPassings(W), 2);
});

test('a session’s last crossing is read through an index, not by scanning its laps', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'timing-store-')), 'db.sqlite');
  openStore(path).close();
  const db = new DatabaseSync(path);
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT MAX(at) AS at FROM crossing WHERE session_id = 'x'").all().map((r) => String(r.detail)).join(' ');
  db.close();
  assert.match(plan, /COVERING INDEX crossing_session_at/);
});

test('the fastest on a track are the best per driver, fastest first, the earlier on a tie, as many as asked', () => {
  const store = openStore(':memory:');
  const offer = (driverId, lapMs, at, direction = 'cw', trackId = 't1') => store.offerPersonalBest(W, trackId, direction, { driverId, lapMs, at, seq: at });
  offer('ana', 8000, 1);
  offer('ben', 7500, 2);
  offer('cy', 8000, 0);
  offer('ana', 7900, 3);
  offer('dan', 7000, 4, 'ccw');
  offer('eve', 6000, 5, 'cw', 't2');
  store.offerPersonalBest('ws-2', 't1', 'cw', { driverId: 'fay', lapMs: 5000, at: 6, seq: 6 });
  assert.deepEqual(store.fastest(W, 't1', 'cw', 10).map((b) => [b.driverId, b.bestMs]), [['ben', 7500], ['ana', 7900], ['cy', 8000]]);
  assert.deepEqual(store.fastest(W, 't1', 'cw', 2).map((b) => b.driverId), ['ben', 'ana']);
  assert.deepEqual(store.fastest(W, 't1', 'cw', 1)[0], { driverId: 'ben', bestMs: 7500, at: 2, seq: 2 });
});

test('whether a club has driven is one row of an index', () => {
  const store = openStore(':memory:');
  assert.equal(store.driven(W), false);
  practice(store);
  crossing(store, {});
  assert.equal(store.driven(W), true);
  assert.equal(store.driven('ws-2'), false);
});

test('the idle board reads the fastest and whether a club has driven through indexes that start with the club', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'timing-store-')), 'db.sqlite');
  openStore(path).close();
  const db = new DatabaseSync(path);
  const plan = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => String(r.detail)).join(' | ');
  assert.match(plan(IDLE_SQL.fastest), /^SEARCH personal_best USING INDEX personal_best_fastest \(workspace_id=\? AND track_id=\? AND direction=\?\)$/, 'ordered by the index, no sort');
  assert.match(plan(IDLE_SQL.driven), /^SEARCH crossing USING COVERING INDEX \w+ \(workspace_id=\?\)$/);
  db.close();
});
