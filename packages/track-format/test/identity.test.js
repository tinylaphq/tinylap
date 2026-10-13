// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout, isClosedCircuit, placedCells, rotateCell, shapeOf, rectangularRing, stockL, capVertices, computeBarriers, assignTrack, DIRECTIONS, leaderboardKey } from '../index.js';

// Rotate a whole build by `rot` degrees clockwise: every piece turns with it,
// and lands at the minimum of its rotated cells (rotatedDef's convention).
function rotated(pieces, rot) {
  return pieces.map((p) => {
    const cells = placedCells(p).map((c) => rotateCell(c, rot));
    return {
      type: p.type,
      x: Math.min(...cells.map((c) => c[0])),
      y: Math.min(...cells.map((c) => c[1])),
      rot: (p.rot + rot) % 360,
    };
  });
}

// Mirror a build left-to-right. A corner's ports N+E become N+W, which is the
// corner at the rotation in MIRROR_ROT. A straight's two ports are opposite,
// so its rotation is unchanged.
const MIRROR_ROT = { 0: 270, 90: 180, 180: 90, 270: 0 };
function mirrored(pieces) {
  return pieces.map((p) => {
    const xs = placedCells(p).map(([x]) => -x);
    return { type: p.type, x: Math.min(...xs), y: p.y, rot: p.type === 'straight' ? p.rot : MIRROR_ROT[p.rot] };
  });
}

const moved = (pieces, dx, dy) => pieces.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
const shape = (pieces) => shapeOf(createLayout({ pieces }));

test('the test helpers produce closed circuits', () => {
  for (const base of [rectangularRing(), stockL()]) {
    for (const rot of [90, 180, 270]) assert.ok(isClosedCircuit(createLayout({ pieces: rotated(base, rot) })));
    assert.ok(isClosedCircuit(createLayout({ pieces: mirrored(base) })));
  }
});

test('a shape carries the c30:1: prefix', () => {
  assert.match(shape(stockL()), /^c30:1:/);
});

test('the shape ignores where the layout sits', () => {
  for (const base of [rectangularRing(), stockL()]) {
    assert.equal(shape(moved(base, 5, -3)), shape(base));
  }
});

test('the shape ignores quarter-turn rotations of the whole layout', () => {
  for (const base of [rectangularRing(), stockL()]) {
    for (const rot of [90, 180, 270]) assert.equal(shape(rotated(base, rot)), shape(base), `rot ${rot}`);
  }
});

test('a mirrored layout is a different track', () => {
  assert.notEqual(shape(mirrored(stockL())), shape(stockL()));
});

test('a mirror-symmetric layout equals its mirror image, by nature', () => {
  assert.equal(shape(mirrored(rectangularRing())), shape(rectangularRing()));
});

test('different builds have different shapes', () => {
  assert.notEqual(shape(rectangularRing()), shape(stockL()));
});

test('straights at 0 and 180 degrees build the same thing', () => {
  const base = rectangularRing();
  const flipped = base.map((p) => (p.type === 'straight' ? { ...p, rot: (p.rot + 180) % 360 } : p));
  assert.notDeepEqual(flipped, base);
  assert.equal(shape(flipped), shape(base));
});

test('open and overlapping layouts have no shape', () => {
  assert.equal(shape(stockL().slice(1)), null);
  assert.equal(shape([]), null);
  const ring = rectangularRing();
  assert.equal(shape([...ring, ring[4]]), null);
});

test('cap vertices are exactly the caps computeBarriers counts', () => {
  for (const pieces of [stockL(), rectangularRing()]) {
    const layout = createLayout({ pieces });
    assert.equal(capVertices(layout).length, computeBarriers(layout).counts.cornerCap);
    assert.ok(capVertices(layout).length > 0);
  }
});

// One R60 corner among three R30s: a closed loop that exercises large-arc
// rotation. (An all-R60 loop never closes; see the planner's generate tests.)
const MIXED_R60 = [
  { type: 'cornerR30', x: 0, y: 0, rot: 0 }, { type: 'straight', rot: 0, x: 0, y: -1 },
  { type: 'cornerR60', rot: 180, x: 0, y: -4 }, { type: 'straight', rot: 90, x: 3, y: -4 },
  { type: 'cornerR30', rot: 180, x: 4, y: -4 }, { type: 'straight', rot: 0, x: 4, y: -2 },
  { type: 'straight', rot: 0, x: 4, y: -1 }, { type: 'cornerR30', rot: 270, x: 4, y: 0 },
  { type: 'straight', rot: 90, x: 3, y: 0 }, { type: 'straight', rot: 90, x: 2, y: 0 },
];

test('a layout with an R60 corner keeps its shape under quarter turns and piece order', () => {
  const layout = createLayout({ pieces: MIXED_R60 });
  assert.ok(isClosedCircuit(layout));
  assert.equal(computeBarriers(layout).arcs.filter((a) => a.kind === 'arcLarge').length, 1);
  const base = shape(MIXED_R60);
  for (const rot of [90, 180, 270]) assert.equal(shape(rotated(MIXED_R60, rot)), base, `rot ${rot}`);
  assert.equal(shape([...MIXED_R60].reverse()), base, 'piece order');
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('a closed layout without a track gets a fresh id and its shape', () => {
  const layout = createLayout({ pieces: stockL() });
  const out = assignTrack(layout);
  assert.match(out.track.id, UUID);
  assert.equal(out.track.shape, shapeOf(layout));
  assert.equal('track' in layout, false, 'input is not mutated');
});

test('an unchanged layout keeps its id', () => {
  const first = assignTrack(createLayout({ pieces: stockL() }));
  assert.deepEqual(assignTrack(first).track, first.track);
});

test('moving, rotating or resizing the room keeps the id', () => {
  const first = assignTrack(createLayout({ pieces: stockL() }));
  for (const pieces of [moved(stockL(), 4, 2), rotated(stockL(), 90)]) {
    assert.equal(assignTrack({ ...first, pieces }).track.id, first.track.id);
  }
  assert.equal(assignTrack({ ...first, room: { w: 30, h: 30 } }).track.id, first.track.id);
});

test('changed geometry is a new track', () => {
  const first = assignTrack(createLayout({ pieces: stockL() }));
  const changed = assignTrack({ ...first, pieces: rectangularRing() });
  assert.notEqual(changed.track.id, first.track.id);
  assert.equal(changed.track.shape, shapeOf(createLayout({ pieces: rectangularRing() })));
});

test('opening a circuit removes its track', () => {
  const first = assignTrack(createLayout({ pieces: stockL() }));
  const opened = assignTrack({ ...first, pieces: stockL().slice(1) });
  assert.equal('track' in opened, false);
});

test('two fresh assignments of the same build are two tracks', () => {
  const a = assignTrack(createLayout({ pieces: stockL() }));
  const b = assignTrack(createLayout({ pieces: stockL() }));
  assert.notEqual(a.track.id, b.track.id);
  assert.equal(a.track.shape, b.track.shape);
});

test('directions are cw and ccw, and nothing else', () => {
  assert.deepEqual([...DIRECTIONS], ['cw', 'ccw']);
  assert.throws(() => DIRECTIONS.push('x'));
});

test('leaderboard keys split by direction', () => {
  const track = { id: '0f8c2a4e-5b1d-4c3a-9e7f-2d6b8a1c3e5f', shape: 'c30:1:x' };
  assert.equal(leaderboardKey(track, 'cw'), `${track.id}:cw`);
  assert.equal(leaderboardKey(track, 'ccw'), `${track.id}:ccw`);
  for (const bad of ['clockwise', 'CW', '', undefined]) {
    assert.throws(() => leaderboardKey(track, bad), /direction/i, String(bad));
  }
});
