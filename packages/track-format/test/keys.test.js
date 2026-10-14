// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, snapshotKey, shapeKey, parseLayout, KEY_PATTERN, createLayout, assignTrack, shapeOf, rectangularRing } from '../index.js';
import { rotated } from './fixtures.js';

const GOLDEN = {
  version: 2,
  unit: 'mat',
  room: { w: 10, h: 8 },
  pieces: [
    { type: 'cornerR30', x: 4, y: 2, rot: 90 },
    { type: 'straight', x: 0, y: 0, rot: 0 },
  ],
};

test('the canonical form sorts pieces and fixes key order', () => {
  assert.equal(
    canonicalJson(GOLDEN),
    '{"version":2,"unit":"mat","room":{"w":10,"h":8},"pieces":[{"type":"straight","x":0,"y":0,"rot":0},{"type":"cornerR30","x":4,"y":2,"rot":90}]}',
  );
});

test('the snapshot key of a known layout never changes', async () => {
  // Pinned: changing the canonical form or the hash silently moves every
  // stored link. If this fails, that is what just happened.
  assert.equal(await snapshotKey(GOLDEN), 'gGzDWQuxgVLYMqBGHopfLA');
});

test('piece order does not change the snapshot key', async () => {
  const reversed = { ...GOLDEN, pieces: [...GOLDEN.pieces].reverse() };
  assert.equal(await snapshotKey(reversed), await snapshotKey(GOLDEN));
});

test('any change changes the snapshot key', async () => {
  const moved = { ...GOLDEN, pieces: [GOLDEN.pieces[0], { ...GOLDEN.pieces[1], x: 1 }] };
  const room = { ...GOLDEN, room: { w: 11, h: 8 } };
  const base = await snapshotKey(GOLDEN);
  assert.notEqual(await snapshotKey(moved), base);
  assert.notEqual(await snapshotKey(room), base);
});

test('keys are 22 url-safe characters', async () => {
  assert.match(await snapshotKey(GOLDEN), KEY_PATTERN);
  assert.equal(await shapeKey('c30:1:x'), 'ZledtuwItUHIKLi4IoHZyw');
});

test('the shape key is the same for a rotated build', async () => {
  const ring = createLayout({ pieces: rectangularRing() });
  const turned = createLayout({ pieces: rotated(rectangularRing(), 90) });
  assert.equal(await shapeKey(shapeOf(turned)), await shapeKey(shapeOf(ring)));
});

test('parseLayout reads JSON and exported HTML alike', () => {
  const layout = assignTrack(createLayout({ pieces: rectangularRing() }));
  const json = JSON.stringify(layout);
  const html = `<!doctype html><p>x</p><script type="application/json" id="layout">${json}</script>`;
  assert.deepEqual(parseLayout(`  \n${json}`), layout);
  assert.deepEqual(parseLayout(html), layout);
});

test('parseLayout rejects text that is neither', () => {
  assert.throws(() => parseLayout('hello'), /no layout data/);
  assert.throws(() => parseLayout('{"version":3,"pieces":[]}'), /newer planner/);
  assert.throws(() => parseLayout('{not json'), SyntaxError);
});
