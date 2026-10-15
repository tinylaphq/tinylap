// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../../server/live.js';

const collect = () => {
  const got = [];
  return { got, send: (e) => got.push(e) };
};

test('subscribers get what is published in their workspace', () => {
  const hub = createHub();
  const a = collect();
  const b = collect();
  hub.subscribe('w1', { lastEventId: null, watcher: false }, a.send);
  hub.subscribe('w2', { lastEventId: null, watcher: false }, b.send);
  hub.publish('w1', 'crossing', { lapMs: 8000 });
  assert.deepEqual(a.got, [{ id: 1, type: 'crossing', data: { lapMs: 8000 } }]);
  assert.deepEqual(b.got, []);
});

test('watchers get the watcher version, or nothing for members-only events', () => {
  const hub = createHub();
  const w = collect();
  hub.subscribe('w1', { lastEventId: null, watcher: true }, w.send);
  hub.publish('w1', 'crossing', { transponder: '0A', lapMs: 8000 }, { lapMs: 8000 });
  hub.publish('w1', 'setup', { unknown: ['0B'] }, null);
  hub.publish('w1', 'drivers', [{ id: 'ana' }]);
  assert.deepEqual(w.got.map((e) => [e.type, e.data]), [['crossing', { lapMs: 8000 }], ['drivers', [{ id: 'ana' }]]]);
});

test('a reconnect gets the events after its last id, or a snapshot', () => {
  const hub = createHub();
  hub.publish('w1', 'a', 1);
  hub.publish('w1', 'b', 2);
  hub.publish('w1', 'c', 3);
  const r = collect();
  assert.equal(hub.subscribe('w1', { lastEventId: 1, watcher: false }, r.send).replay, 'events');
  assert.deepEqual(r.got.map((e) => e.type), ['b', 'c']);
  assert.equal(hub.subscribe('w1', { lastEventId: 99, watcher: false }, () => {}).replay, 'snapshot');
  assert.equal(hub.subscribe('w1', { lastEventId: null, watcher: false }, () => {}).replay, 'snapshot');
  assert.equal(hub.lastId(), 3);
});

test('events older than the window are forgotten', () => {
  let t = 0;
  const hub = createHub({ now: () => t, keepMs: 1000 });
  hub.publish('w1', 'old', 1);
  t = 2000;
  hub.publish('w1', 'new', 2);
  assert.equal(hub.subscribe('w1', { lastEventId: 1, watcher: false }, () => {}).replay, 'snapshot');
  assert.equal(hub.subscribe('w1', { lastEventId: 2, watcher: false }, () => {}).replay, 'events');
});

test('unsubscribe and closeTagged stop delivery', () => {
  const hub = createHub();
  const a = collect();
  const b = collect();
  let closed = 0;
  const sub = hub.subscribe('w1', { lastEventId: null, watcher: false }, a.send);
  hub.subscribe('w1', { lastEventId: null, watcher: true, tag: 'tok', onClose: () => { closed += 1; } }, b.send);
  sub.unsubscribe();
  hub.closeTagged('w1', 'tok');
  hub.publish('w1', 'x', 1);
  assert.deepEqual(a.got, []);
  assert.deepEqual(b.got, []);
  assert.equal(closed, 1);
});
