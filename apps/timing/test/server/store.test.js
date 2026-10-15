// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../../server/store.js';

const W = 'ws-1';

function practice(store, id = 's1', fields = {}) {
  store.addSession({ id, workspaceId: W, kind: 'practice', trackId: 't1', direction: 'ccw', roster: null, state: 'running', createdAt: 0, opensAt: 0, closesAt: null, endedAt: null, durationMs: null, ...fields });
  return store.session(id);
}

function crossing(store, fields) {
  return store.addCrossing({ workspaceId: W, sessionId: 's1', decoder: 'd1', boot: 'b00tb00t', transponder: '0A', t: 0, driverId: null, at: 0, lapMs: null, counts: false, ref: true, via: 'net', flag: null, ...fields });
}

test('a workspace is created on first use with ccw and no track', () => {
  const store = openStore(':memory:');
  assert.equal(store.workspace(W), null);
  assert.deepEqual(store.ensureWorkspace(W), { id: W, trackId: null, direction: 'ccw', watchToken: null });
  store.setTrack(W, { id: 't1', shape: 'c30:1:x', name: 'Office', snapshotKey: 'k'.repeat(22), layout: '{}' }, 'cw');
  assert.deepEqual(store.workspace(W), { id: W, trackId: 't1', direction: 'cw', watchToken: null });
  assert.deepEqual(store.track(W, 't1'), { id: 't1', shape: 'c30:1:x', name: 'Office', snapshotKey: 'k'.repeat(22) });
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
  practice(store);
  practice(store, 'cw', { direction: 'cw' });
  crossing(store, { driverId: 'ana', lapMs: 8000, counts: true, at: 10 });
  crossing(store, { driverId: 'ana', lapMs: 7000, counts: true, at: 20 });
  crossing(store, { driverId: 'ana', lapMs: 6000, counts: false, at: 30 });
  crossing(store, { driverId: 'ana', lapMs: 5000, counts: true, at: 40, via: 'tap' });
  crossing(store, { sessionId: 'cw', driverId: 'ana', lapMs: 4000, counts: true, at: 50 });
  assert.deepEqual(store.personalBests(W, 't1', 'ccw'), [{ driverId: 'ana', bestMs: 7000, at: 20 }]);
});

test('active and open sessions', () => {
  const store = openStore(':memory:');
  practice(store);
  assert.equal(store.openPractice(W).id, 's1');
  assert.equal(store.activeSession(W), null);
  store.addSession({ id: 'r1', workspaceId: W, kind: 'race', trackId: null, direction: 'ccw', roster: ['ana'], state: 'countdown', createdAt: 5, opensAt: 10, closesAt: 20, endedAt: null, durationMs: 10 });
  assert.deepEqual(store.activeSession(W).roster, ['ana']);
  assert.deepEqual(store.activeAll().map((s) => s.id), ['r1']);
  store.updateSession('r1', { state: 'done', endedAt: 30 });
  assert.equal(store.activeSession(W), null);
  assert.deepEqual(store.listSessions(W, 10).map((s) => s.id), ['r1', 's1']);
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
  practice(store);
  store.addDriver(W, { id: 'ana', name: 'Ana', colour: '#ff2d9b' });
  store.addDecoder(W, { id: 'd1', name: 'Gate', tokenHash: 'h1', createdAt: 1 });
  store.insertPassing({ decoder: 'd1', boot: 'b00tb00t', transponder: '0A', t: 1, receivedAt: 1, via: 'net', workspaceId: W });
  crossing(store, {});
  store.deleteWorkspaceData(W);
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
