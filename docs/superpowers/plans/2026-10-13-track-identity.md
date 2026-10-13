# Track Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give closed Circuit 30 layouts a stable track identity (a random id plus a shape fingerprint) in format version 2, so the timing app can keep leaderboards per track and direction.

**Architecture:** A new `packages/track-format/identity.js` holds the shape fingerprint, the identity rules, the direction vocabulary and the leaderboard key. `data.js` reads format versions 1 and 2, keeping a valid `track` block, and gains the HTML extraction that used to live in the planner. The planner settles the track id at export, through a new `prepareExport()` in `storage.js`, and keeps it in its state and session.

**Tech Stack:** Plain ES modules, `node:test`, TypeScript 7 `--checkJs` (track-format strict), pnpm 10 + Turborepo, `crypto.randomUUID()`.

**Spec:** `docs/superpowers/specs/2026-10-13-track-identity-design.md`

## Global Constraints

- **No bundler, no transpiler, no new dependency.** Use `crypto.randomUUID()` from the platform.
- **JSDoc types only.** `packages/track-format` is checked strict (`pnpm --filter @tinylap/track-format typecheck` must stay clean).
- **SPDX headers on new files.**
  - In `packages/`: `// SPDX-FileCopyrightText: 2026 The TinyLap contributors`, a line `//`, then `// SPDX-License-Identifier: MPL-2.0`.
  - In `apps/`: the same, with `AGPL-3.0-or-later`.
- **Shape prefix:** `c30:1:`. Directions: `'cw'` and `'ccw'`. Leaderboard key: `` `${track.id}:${direction}` ``.
- **The golden file `apps/track-planner/test/fixtures/live-export.html` is never edited.**
- **Commits:**
  - `git commit -s`, conventional messages
  - author `1009814+jostsg@users.noreply.github.com`
  - **no Co-Authored-By, no AI mention**
- **Branch `feat/track-identity`.** Never push; never touch `main`.
- **After each task, all of these pass:** `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `uvx --from 'reuse[charset-normalizer]' reuse lint`.

## Review Focus

1. **A shared layout file opened in the planner, re-exported without changes, keeps its id.** Opening must adopt the file's `track`, and export must not re-issue it. Pinned by Task 4's "open then export keeps the id" test.
2. **The planner tab is reloaded between edits and export.** The session store must keep `track`, or every reload makes a new track. Pinned by Task 4's session round-trip test.
3. **A hand-edited file with a damaged `track` block** (an uppercase id, a missing shape, a non-object) must still open, and simply lose the block. Pinned by Task 1's malformed-block cases.
4. **A layout rotated by a multiple of 90° in the planner must keep its id.** Rotation normalisation has to cover arcs and caps, not just cells. Pinned by Task 2's rotation invariance over every reference layout plus an R60 ring (Task 4, planner side).
5. **Unknown direction strings coming from timing-app state** (`'clockwise'`, `'CW'`, `undefined`) must throw, never produce a key. Pinned by Task 3's `leaderboardKey` cases.

---

### Task 1: Format version 2 reading, and the HTML extraction moved into the package

**Files:**
- Modify:
  - `packages/track-format/types.d.ts` (`Layout`, plus new `Track` and `Direction`)
  - `packages/track-format/model.js:11-13` (`createLayout` writes version 2)
  - `packages/track-format/data.js` (versions 1 and 2, `track`, `extractLayoutJson`, `layoutFromHtml`, `LAYOUT_SCRIPT_ID`)
  - `packages/track-format/index.js` (export identity.js, typedefs for `Track` and `Direction`)
- Create: `packages/track-format/identity.js` (for now only `isTrack`)
- Modify:
  - `apps/track-planner/js/storage.js` (drop the moved code, re-export it)
  - tests that assert version 1: `packages/track-format/test/model.test.js:14`, `packages/track-format/test/data.test.js:13`, `apps/track-planner/test/storage.test.js:40,45`, `apps/track-planner/test/live-export.test.js:19`
- Test: `packages/track-format/test/data.test.js`

**Interfaces:**
- Produces:
  - `isTrack(value: unknown): value is Track`
  - `SUPPORTED_VERSION = 2`, `SUPPORTED_VERSIONS = [1, 2]`, `LAYOUT_SCRIPT_ID = 'layout'`
  - `extractLayoutJson(html: string): unknown`
  - `layoutFromHtml(html: string): Layout`
  - `layoutFromData(data)` returns `{ version: 2, unit: 'mat', room, pieces, track? }`
  - types `Track { id: string; shape: string }` and `Direction = 'cw' | 'ccw'`
- The planner's `storage.js` still exports `extractLayoutJson`, `importHtml` and `LAYOUT_SCRIPT_ID`, re-exported, so its existing importers don't change.

- [ ] **Step 1: Write the failing tests** (append to `packages/track-format/test/data.test.js`)

```js
import { isTrack, layoutFromHtml, extractLayoutJson, SUPPORTED_VERSIONS, createLayout } from '../index.js';

const TRACK = { id: '0f8c2a4e-5b1d-4c3a-9e7f-2d6b8a1c3e5f', shape: 'c30:1:example' };

test('version 1 data is read and upgraded to version 2', () => {
  const layout = layoutFromData(valid());
  assert.equal(layout.version, 2);
  assert.equal('track' in layout, false);
});

test('a version 2 track block survives reading', () => {
  const layout = layoutFromData({ ...valid(), version: 2, track: { ...TRACK, extra: 1 } });
  assert.deepEqual(layout.track, TRACK);
});

test('a damaged track block is dropped, not fatal', () => {
  for (const track of [
    null, 'x', 42, {}, { id: TRACK.id }, { shape: TRACK.shape },
    { ...TRACK, id: TRACK.id.toUpperCase() }, { ...TRACK, id: 'not-a-uuid' },
    { ...TRACK, shape: 'other:1:x' }, { ...TRACK, shape: 7 },
  ]) {
    const layout = layoutFromData({ ...valid(), version: 2, track });
    assert.equal('track' in layout, false, JSON.stringify(track));
  }
});

test('only versions 1 and 2 are read', () => {
  assert.deepEqual(SUPPORTED_VERSIONS, [1, 2]);
  assert.throws(() => layoutFromData({ ...valid(), version: 3 }), /newer planner/);
});

test('isTrack accepts exactly a lowercase uuid and a c30 shape', () => {
  assert.equal(isTrack(TRACK), true);
  assert.equal(isTrack({ ...TRACK, id: TRACK.id.toUpperCase() }), false);
  assert.equal(isTrack(undefined), false);
});

test('new layouts are version 2', () => {
  assert.equal(createLayout().version, 2);
});

test('layouts are read out of an exported html file', () => {
  const html = `<html><script type="application/json" id="layout">${JSON.stringify({ ...valid(), version: 2, track: TRACK })}</script></html>`;
  assert.deepEqual(extractLayoutJson(html).track, TRACK);
  assert.deepEqual(layoutFromHtml(html).track, TRACK);
  assert.throws(() => layoutFromHtml('<html></html>'), /no layout data/);
  assert.throws(() => layoutFromHtml('<script id="layout">{nope</script>'), /not valid JSON/);
});
```

Also change the existing assertion in `data.test.js` test "valid data rebuilds the same layout" from `version: 1` to `version: 2` in the expected object. Leave the input at `version: 1`.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @tinylap/track-format test`
Expected: FAIL, because `isTrack`, `layoutFromHtml`, `extractLayoutJson` and `SUPPORTED_VERSIONS` aren't exported.

- [ ] **Step 3: Implement**

`packages/track-format/types.d.ts`: replace the `Layout` interface and add the two new types.

```ts
/** A concrete track: one closed build. See shapeOf / assignTrack. */
export interface Track { id: string; shape: string }

/** Driving direction, seen from above in the planner's coordinates (x right, y down). */
export type Direction = 'cw' | 'ccw';

/** A layout in memory, format version 2. Version 1 files are upgraded on read. */
export interface Layout {
  version: 2;
  unit: 'mat';
  room: Room | null;
  pieces: PlacedPiece[];
  /** Present only for closed circuits; see assignTrack. */
  track?: Track;
}
```

`packages/track-format/model.js`: in `createLayout`, change `version: 1` to `version: 2`.

`packages/track-format/identity.js` (new):

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// Track identity: which concrete track a layout is. See the design spec
// docs/superpowers/specs/2026-10-13-track-identity-design.md.

/** @import { Track } from './types.js' */

// crypto.randomUUID() emits lowercase RFC 4122 version 4 ids.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** @param {unknown} value @returns {value is Track} */
export function isTrack(value) {
  if (typeof value !== 'object' || value === null) return false;
  const { id, shape } = /** @type {{ id?: unknown, shape?: unknown }} */ (value);
  return typeof id === 'string' && UUID.test(id) && typeof shape === 'string' && shape.startsWith('c30:');
}
```

`packages/track-format/data.js`:
- Replace `export const SUPPORTED_VERSION = 1;` with:

```js
export const SUPPORTED_VERSION = 2;
/** Every format version layoutFromData reads. Older ones are upgraded in memory. */
export const SUPPORTED_VERSIONS = [1, 2];
```

- Add `import { isTrack } from './identity.js';`.
- In `layoutFromData`, change the version check to `if (!SUPPORTED_VERSIONS.includes(/** @type {number} */ (data.version))) {`, keeping the existing throw and message.
- Extend the JSDoc parameter type to `{ version: unknown, room?: Room | null, pieces: PlacedPiece[], track?: unknown }`.
- Replace the final `return createLayout({…})` with:

```js
  const layout = createLayout({
    room,
    pieces: data.pieces.map(({ type, x, y, rot }) => ({ type, x, y, rot })),
  });
  // A damaged track block costs only a re-issued id, never a file that won't open.
  if (isTrack(data.track)) layout.track = { id: data.track.id, shape: data.track.shape };
  return layout;
```

- Append the HTML extraction, moved verbatim from `apps/track-planner/js/storage.js` (the `BLOCK` regex and `extractLayoutJson`), plus:

```js
export const LAYOUT_SCRIPT_ID = 'layout';
```

  (declared above `BLOCK`), and:

```js
/** @param {string} html @returns {Layout} */
export function layoutFromHtml(html) {
  return layoutFromData(/** @type {any} */ (extractLayoutJson(html)));
}
```

  Give `extractLayoutJson` the JSDoc `/** @param {string} html @returns {unknown} */`. Its body stays verbatim. If strict typecheck rejects passing `unknown` to `layoutFromData`, the `any` cast above is the one allowed escape hatch; keep it on that line only.

`packages/track-format/index.js`:
- Add `export * from './identity.js';` after the other `export *` lines.
- Add `/** @typedef {import('./types.js').Track} Track */` and `/** @typedef {import('./types.js').Direction} Direction */` to the typedef block.

`apps/track-planner/js/storage.js`:
- Delete `LAYOUT_SCRIPT_ID`, `BLOCK`, `extractLayoutJson` and `importHtml`.
- Change the import line to `import { computeMetrics, layoutFromData, layoutFromHtml, extractLayoutJson, LAYOUT_SCRIPT_ID, SUPPORTED_VERSION, MAT_MM } from '@tinylap/track-format';`, keeping only the names the file still uses.
- Re-export:

```js
export { layoutFromData, SUPPORTED_VERSION, extractLayoutJson, LAYOUT_SCRIPT_ID };
// Kept under its planner name; the package calls it layoutFromHtml.
export const importHtml = layoutFromHtml;
```

Existing tests to update (no other changes):
- `packages/track-format/test/model.test.js:14`: `assert.equal(l.version, 2);`
- `apps/track-planner/test/storage.test.js:40`: `assert.equal(data.version, 2);`
- `apps/track-planner/test/storage.test.js:45`: `.replace('"version": 2', '"version": 99')`
- `apps/track-planner/test/live-export.test.js:19`: `assert.equal(layout.version, 2);`. Add `assert.equal('track' in layout, false);` after it. The fixture file stays untouched.

- [ ] **Step 4: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green. track-format gains 7 tests (71); the planner stays at 97.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -s -m "feat(track-format): read format version 2 with an optional track block"
```

---

### Task 2: The shape fingerprint

**Files:**
- Modify: `packages/track-format/model.js` (new export `capVertices`, after `computeBarriers`)
- Modify: `packages/track-format/identity.js` (`SHAPE_PREFIX`, `shapeOf`)
- Create: `packages/track-format/test/identity.test.js`

**Interfaces:**
- Consumes: from `geometry.js`, `rotateCell(cell, rot)`, `rotateCorner(corner, rot)`, `rotateVertex(vertex, rot)` and `placedCells(piece)`; from `model.js`, `isClosedCircuit`, `occupiedSet`, `parseCellKey`, `wallCounts`, `computeBarriers` and `placedWalls`.
- Produces:
  - `capVertices(layout: Layout): Cell[]`
  - `SHAPE_PREFIX = 'c30:1:'`
  - `shapeOf(layout: Layout): string | null`

- [ ] **Step 1: Write the failing tests** (`packages/track-format/test/identity.test.js`)

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout, isClosedCircuit, placedCells, rotateCell, shapeOf, rectangularRing, stockL, capVertices } from '../index.js';

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
```

Add `computeBarriers` to this file's import list from `'../index.js'`.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @tinylap/track-format test`
Expected: FAIL, because `shapeOf` and `capVertices` aren't exported.

- [ ] **Step 3: Implement**

`packages/track-format/model.js`: add directly after `computeBarriers`:

```js
// Where the corner caps actually go: the same rule computeBarriers counts by,
// returned as positions so the shape fingerprint can include them.
/** @param {Layout} layout @returns {Cell[]} */
export function capVertices(layout) {
  const cells = occupiedSet(layout);
  /** @type {Cell[]} */
  const out = [];
  for (const piece of layout.pieces) {
    for (const wall of placedWalls(piece)) {
      if (wall.kind === 'cap' && isConcaveVertex(cells, wall.vertex)) out.push(wall.vertex);
    }
  }
  return out;
}
```

If `Cell` isn't yet in the file's `@import` JSDoc line, add it. Check the existing `@import` at the top of `model.js`.

`packages/track-format/identity.js`: add the imports and the fingerprint.

```js
import { rotateCell, rotateCorner, rotateVertex } from './geometry.js';
import { isClosedCircuit, occupiedSet, parseCellKey, wallCounts, computeBarriers, capVertices } from './model.js';

/** @import { Layout, Cell } from './types.js' */

export const SHAPE_PREFIX = 'c30:1:';

// An edge id names a unit edge by its upper-left vertex:
// H:x:y runs (x,y)-(x+1,y), V:x:y runs (x,y)-(x,y+1).
/** @param {string} id @returns {[Cell, Cell]} */
function edgeEnds(id) {
  const [axis, xs, ys] = id.split(':');
  const x = Number(xs);
  const y = Number(ys);
  return axis === 'H' ? [[x, y], [x + 1, y]] : [[x, y], [x, y + 1]];
}

/** @param {Cell} a @param {Cell} b @returns {string} */
function edgeKey(a, b) {
  return a[1] === b[1] ? `H:${Math.min(a[0], b[0])}:${a[1]}` : `V:${a[0]}:${Math.min(a[1], b[1])}`;
}

// The fingerprint of what is physically built: cells, straight barriers (with
// how many each edge carries), curved barriers and corner caps. It is
// normalised for position and the four quarter turns, but not for mirroring,
// because a mirrored layout turns the other way and is a different track.
/** @param {Layout} layout @returns {string | null} */
export function shapeOf(layout) {
  if (!isClosedCircuit(layout)) return null;
  const cells = [...occupiedSet(layout)].map(parseCellKey);
  const edges = [...wallCounts(layout)].filter(([, n]) => n > 0).map(([id, n]) => ({ ends: edgeEnds(id), n }));
  const { arcs } = computeBarriers(layout);
  const caps = capVertices(layout);

  const forms = [0, 90, 180, 270].map((rot) => {
    const turned = cells.map((c) => rotateCell(c, rot));
    const mx = Math.min(...turned.map((c) => c[0]));
    const my = Math.min(...turned.map((c) => c[1]));
    /** @param {Cell} c */
    const at = ([x, y]) => `${x - mx},${y - my}`;
    /** @param {Cell} v @returns {Cell} */
    const vertex = (v) => {
      const [x, y] = rotateVertex(v, rot);
      return [x - mx, y - my];
    };
    return [
      ...turned.map((c) => `c${at(c)}`),
      ...edges.map(({ ends, n }) => `e${edgeKey(vertex(ends[0]), vertex(ends[1]))}*${n}`),
      ...arcs.map((w) => `a${w.kind}:${w.r}:${rotateCorner(w.corner, rot)}:${at(rotateCell(w.cell, rot))}`),
      ...caps.map((v) => `k${vertex(v).join(',')}`),
    ].sort().join(';');
  });
  return SHAPE_PREFIX + forms.sort()[0];
}
```

Check before relying on it: `rotateCell` and `rotateVertex` are consistent, because rotating a cell's four corners with `rotateVertex` gives the square that `rotateCell` names (see the comments in `geometry.js`). That's why translating vertices by the same `(mx, my)` as cells is correct. If the rotation-invariance test fails for arcs only, compare `rotateCorner`'s direction with `rotateCell`'s and report it. Don't invent a different rotation.

- [ ] **Step 4: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -s -m "feat(track-format): fingerprint the built shape of a closed layout"
```

---

### Task 3: Identity rules, directions and leaderboard keys

**Files:**
- Modify: `packages/track-format/identity.js` (`assignTrack`, `DIRECTIONS`, `leaderboardKey`)
- Modify: `packages/track-format/test/identity.test.js`

**Interfaces:**
- Consumes: `shapeOf` (Task 2) and `isTrack` (Task 1).
- Produces:
  - `assignTrack(layout: Layout): Layout`: always a new object; the input is never mutated
  - `DIRECTIONS: readonly Direction[]`, frozen `['cw', 'ccw']`
  - `leaderboardKey(track: Track, direction: Direction): string`

- [ ] **Step 1: Write the failing tests** (append to `identity.test.js`)

```js
import { assignTrack, DIRECTIONS, leaderboardKey } from '../index.js';

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
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @tinylap/track-format test`
Expected: FAIL, because `assignTrack`, `DIRECTIONS` and `leaderboardKey` aren't exported.

- [ ] **Step 3: Implement** (append to `identity.js`, and extend its `@import` to include `Track` and `Direction`)

```js
// The identity rules, in one place so every app applies them alike: a closed
// layout carries a track; changed geometry means a new track; an open or
// overlapping layout carries none. Runs where a layout leaves or enters as a
// file (planner export, timing-app import), never on every edit.
/** @param {Layout} layout @returns {Layout} */
export function assignTrack(layout) {
  const shape = shapeOf(layout);
  const { track, ...rest } = layout;
  if (shape === null) return /** @type {Layout} */ (rest);
  if (track && track.shape === shape) return { ...rest, track: { ...track } };
  return { ...rest, track: { id: crypto.randomUUID(), shape } };
}

// Seen from above in the planner's coordinates (x right, y down). Direction is
// not part of a track: one build is raced either way, and the timing app
// remembers the chosen direction per track.
/** @type {readonly Direction[]} */
export const DIRECTIONS = Object.freeze(['cw', 'ccw']);

// Times from the two directions never share a leaderboard. A timing app must
// still scope this key by its own venue: a shared, unmodified layout file
// carries the same id to every venue that builds it.
/** @param {Track} track @param {Direction} direction @returns {string} */
export function leaderboardKey(track, direction) {
  if (!DIRECTIONS.includes(direction)) throw new Error(`Unknown direction: ${String(direction)}`);
  return `${track.id}:${direction}`;
}
```

- [ ] **Step 4: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -s -m "feat(track-format): assign track identities and key leaderboards by direction"
```

---

### Task 4: The planner settles the track at export and keeps it

**Files:**
- Modify: `apps/track-planner/js/storage.js` (`prepareExport`)
- Modify: `apps/track-planner/js/session-store.js:14,46-50` (keep `track`)
- Modify: `apps/track-planner/js/app.js` (the `#btn-save` click handler, around line 1206)
- Create: `apps/track-planner/test/identity.test.js`
- Modify: `apps/track-planner/test/session-store.test.js` (a track round-trip case)

**Interfaces:**
- Consumes: `assignTrack`, `shapeOf` and `rotateCell` from `@tinylap/track-format`; `exportHtml` and `importHtml` (planner `storage.js`); `saveLayout(storage, layout)` and `loadLayout(storage)` (planner `session-store.js`); `buildLoop` from planner `generate.js`.
- Produces: `prepareExport(layout: Layout): { layout: Layout, html: string }`

- [ ] **Step 1: Write the failing tests**

`apps/track-planner/test/identity.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout, placedCells, rotateCell, shapeOf } from '@tinylap/track-format';
import { prepareExport, importHtml } from '../js/storage.js';
import { buildLoop } from '../js/generate.js';
import { stockL } from '../js/presets.js';

const closed = () => createLayout({ pieces: stockL() });

test('an exported closed layout carries a track block', () => {
  const { layout, html } = prepareExport(closed());
  assert.ok(layout.track);
  assert.deepEqual(importHtml(html).track, layout.track);
});

test('exporting twice without changes keeps the id', () => {
  const first = prepareExport(closed()).layout;
  assert.equal(prepareExport(first).layout.track.id, first.track.id);
});

test('exporting after a change issues a new id', () => {
  const first = prepareExport(closed()).layout;
  const changed = { ...first, pieces: first.pieces.slice(1) };
  assert.equal(prepareExport(changed).layout.track, undefined, 'opened circuit');
  const grown = buildLoop({ signature: 'RRRR', sides: [3, 5, 3, 5] });
  assert.notEqual(prepareExport({ ...first, pieces: grown }).layout.track.id, first.track.id);
});

test('a change reverted before the next export keeps the id', () => {
  const first = prepareExport(closed()).layout;
  const edited = structuredClone(first);
  edited.pieces[0] = { ...edited.pieces[0], x: edited.pieces[0].x + 1 };
  edited.pieces[0] = { ...edited.pieces[0], x: edited.pieces[0].x - 1 };
  assert.equal(prepareExport(edited).layout.track.id, first.track.id);
});

test('opening a file adopts its track, and re-exporting keeps it', () => {
  const { layout, html } = prepareExport(closed());
  const opened = importHtml(html);
  assert.equal(prepareExport(opened).layout.track.id, layout.track.id);
});

// The package's reference layouts have no R60 corner. The generator builds
// one, which pins that rotation normalisation covers large arcs too.
test('an R60 ring keeps its shape under quarter turns', () => {
  let pieces = null;
  for (let n = 1; n <= 6 && !pieces; n++) {
    pieces = buildLoop({ signature: 'RRRR', sides: [n, n + 1, n, n + 1], cornerType: 'cornerR60' });
  }
  assert.ok(pieces, 'an R60 ring closes for some small size');
  const base = shapeOf(createLayout({ pieces }));
  for (const rot of [90, 180, 270]) {
    const turned = pieces.map((p) => {
      const cells = placedCells(p).map((c) => rotateCell(c, rot));
      return { type: p.type, x: Math.min(...cells.map((c) => c[0])), y: Math.min(...cells.map((c) => c[1])), rot: (p.rot + rot) % 360 };
    });
    assert.equal(shapeOf(createLayout({ pieces: turned })), base, `rot ${rot}`);
  }
});
```

In `apps/track-planner/test/session-store.test.js`, append the following. Reuse the in-memory `storage` helper the file already uses; check its existing tests for the helper's name, and match it.

```js
import { prepareExport } from '../js/storage.js';

test('the session keeps a layout\'s track across a reload', () => {
  const storage = memoryStorage();
  const { layout } = prepareExport(createLayout({ pieces: stockL() }));
  saveLayout(storage, layout);
  assert.deepEqual(loadLayout(storage).track, layout.track);
});
```

If the file has no `stockL` import, add `import { stockL } from '../js/presets.js';`. If its storage helper has another name, use that name in place of `memoryStorage()`.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @tinylap/track-planner test`
Expected: FAIL, because `prepareExport` isn't exported.

- [ ] **Step 3: Implement**

`apps/track-planner/js/storage.js`: add `assignTrack` to the `@tinylap/track-format` import, and add:

```js
// The track identity is settled when a layout leaves as a file. The caller
// keeps the returned layout, so the next export compares against the id this
// file carries; edits in between never touch it.
export function prepareExport(layout) {
  const settled = assignTrack(layout);
  return { layout: settled, html: exportHtml(settled) };
}
```

`apps/track-planner/js/session-store.js`:
- Change the comment at line 14 to say: only the layout is stored (version, unit, room, pieces, and its track when it has one).
- In `saveLayout`, change:

```js
    const { version, unit, room, pieces, track } = layout;
    storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(track ? { version, unit, room, pieces, track } : { version, unit, room, pieces }));
```

`apps/track-planner/js/app.js`:
- Add `prepareExport` to the `./storage.js` import.
- In the `#btn-save` click handler, replace `const blob = new Blob([exportHtml(state.layout)], { type: 'text/html' });` with:

```js
  const { layout, html } = prepareExport(state.layout);
  state.layout = layout;
  saveLayout(sessionStorage, state.layout);
  const blob = new Blob([html], { type: 'text/html' });
```

  Remove `exportHtml` from the import only if nothing else in `app.js` uses it; check with `grep -n exportHtml apps/track-planner/js/app.js`.

- [ ] **Step 4: Run everything, and smoke the planner**

Run: `pnpm test && pnpm typecheck && pnpm lint && uvx --from 'reuse[charset-normalizer]' reuse lint`
Expected: all green.

Then run the Docker smoke test from the repo root, on a free host port:

```bash
docker build -f apps/track-planner/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t tl-id .
docker run -d --rm -p 18090:8080 --name tl-id tl-id
node tools/smoke.js http://localhost:18090/
docker stop tl-id
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -s -m "feat(track-planner): settle the track id at export and keep it in the session"
```
