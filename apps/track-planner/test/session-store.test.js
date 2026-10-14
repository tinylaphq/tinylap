// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLayout, loadLayout, saveLayout, clearLayout, LAYOUT_STORAGE_KEY, loadTrackRef, saveTrackRef, TRACK_STORAGE_KEY } from '../js/session-store.js';
import { createLayout } from '@tinylap/track-format';
import { prepareExport } from '../js/storage.js';
import { stockL } from '../js/presets.js';

const fakeStorage = (initial) => {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map),
  };
};

test('a layout round-trips through the store', () => {
  const s = fakeStorage();
  const layout = createLayout({
    room: { w: 10, h: 8 },
    pieces: [{ type: 'straight', x: 1, y: 2, rot: 90 }, { type: 'cornerR30', x: 3, y: 4, rot: 180 }],
  });
  saveLayout(s, layout);
  const back = loadLayout(s);
  assert.deepEqual(back.pieces, layout.pieces);
  assert.deepEqual(back.room, layout.room);
});

test('only the layout is stored, never the interaction state', () => {
  // Selection, ghosts and hover are not a layout. If they ever leak in,
  // a reload would restore a half-finished gesture.
  const s = fakeStorage();
  saveLayout(s, { ...createLayout({ pieces: [] }), selection: [3], ghost: { cells: [] }, kits: { '87033': 9 } });
  const stored = JSON.parse(s.dump()[LAYOUT_STORAGE_KEY]);
  assert.deepEqual(Object.keys(stored).sort(), ['pieces', 'room', 'unit', 'version']);
});

test('a corrupt or hostile payload gives a blank canvas, never a throw', () => {
  assert.equal(parseLayout('not json'), null);
  assert.equal(parseLayout(null), null);
  assert.equal(parseLayout('[]'), null);
  assert.equal(parseLayout(JSON.stringify({ version: 99, pieces: [] })), null);
  assert.equal(parseLayout(JSON.stringify({ version: 1, pieces: 'nope' })), null);
  // The same guards that protect an opened file: an unknown piece type
  // would otherwise reach the renderer through this door.
  assert.equal(parseLayout(JSON.stringify({ version: 1, pieces: [{ type: '__proto__', x: 0, y: 0, rot: 0 }] })), null);
  assert.equal(parseLayout(JSON.stringify({ version: 1, pieces: [{ type: 'straight', x: 0, y: 0, rot: 45 }] })), null);
  // eslint-disable-next-line no-loss-of-precision -- deliberately non-finite: 1e999 overflows to Infinity
  assert.equal(parseLayout(JSON.stringify({ version: 1, pieces: [{ type: 'straight', x: 1e999, y: 0, rot: 0 }] })), null);
});

test('a storage that throws does not break startup', () => {
  const hostile = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  assert.equal(loadLayout(hostile), null);
  assert.doesNotThrow(() => saveLayout(hostile, createLayout()));
  assert.doesNotThrow(() => clearLayout(hostile));
});

test('clearing removes the entry so a reload starts blank', () => {
  const s = fakeStorage();
  saveLayout(s, createLayout({ pieces: [{ type: 'straight', x: 0, y: 0, rot: 0 }] }));
  assert.ok(loadLayout(s));
  clearLayout(s);
  assert.equal(loadLayout(s), null);
});

test('the session keeps a layout\'s track across a reload', () => {
  const storage = fakeStorage();
  const { layout } = prepareExport(createLayout({ pieces: stockL() }));
  saveLayout(storage, layout);
  assert.deepEqual(loadLayout(storage).track, layout.track);
});

test('the library track the canvas came from round-trips and can be forgotten', () => {
  const s = fakeStorage();
  assert.equal(loadTrackRef(s), null);
  saveTrackRef(s, { id: 'T1', name: 'Monza', workspaceId: 'W1', extra: 'dropped' });
  assert.deepEqual(loadTrackRef(s), { id: 'T1', name: 'Monza', workspaceId: 'W1' });
  saveTrackRef(s, null);
  assert.equal(loadTrackRef(s), null);
  assert.equal(s.dump()[TRACK_STORAGE_KEY], undefined);
});

test('a damaged track reference is no reference', () => {
  for (const raw of ['{', '"x"', '{"id":1,"name":"a","workspaceId":"w"}', '{"id":"a"}']) {
    assert.equal(loadTrackRef(fakeStorage({ [TRACK_STORAGE_KEY]: raw })), null, raw);
  }
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(loadTrackRef(denied), null);
  saveTrackRef(denied, { id: 'a', name: 'b', workspaceId: 'c' });
});
