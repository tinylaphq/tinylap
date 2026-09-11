# Layout Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate buildable track layouts from the owned inventory, grouped into genuinely distinct shapes, and let one be loaded onto the canvas as an editable starting point.

**Architecture:** Outlines are enumerated as turn signatures (cyclic sequences of left/right turns summing to +4), side lengths are solved against the closure equations rather than brute-forced, and each candidate is *built from real pieces* by chaining `placeAgainst` then validated and costed by the existing engine. Results are deduplicated over the 8 symmetries and grouped into characters by `(outline, corner feel)`. A new pure module `js/generate.js` holds all of it; `js/app.js` gains a suggestions section in the presets dialog.

**Tech Stack:** Vanilla JavaScript, ES modules, `node:test`. No dependencies, no build step.

**Spec:** `docs/superpowers/specs/2026-09-10-layout-generator-design.md`
**Parent spec:** `docs/superpowers/specs/2026-09-09-circuit30-track-planner-design.md`

## Global Constraints

- **No dependencies.** No npm packages, no CDN links beyond the existing Google Fonts link. **No build step.** ES modules only. `node:test` only.
- **1 mat = 300 mm.** Coordinates are `[col, row]` with row increasing downward. Rotation is clockwise, one of 0, 90, 180, 270.
- **Track width is fixed at two mats.** Nothing may be parameterised on width.
- **Derived state is never persisted** in the layout: only `version`, `unit`, `room`, `pieces`. The inventory is UI state and must never enter `state.layout` or the exported file.
- **Barriers are counted in exactly one place** — `computeBarriers` in `js/model.js`.
- **No parallel geometry maths.** `js/generate.js` must not compute mat counts, barrier counts or areas with its own formulas. Every figure comes from `computeMetrics` / `computeBarriers` / `billOfMaterials`. A closed-form area formula written earlier in this project was wrong and produced a confident false conclusion; see parent spec §13.2.
- **No silent truncation.** If a bound is hit, the result says how many candidates were examined and that it stopped.
- Module boundaries: `js/generate.js` imports `geometry`, `model`, `inventory` only. Nothing imports it but `js/app.js` and its tests. No cycles.
- The blank canvas stays the default. Suggestions are opt-in; a loaded suggestion is ordinary pieces with no special mode.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `js/generate.js` | Turn signatures, loop construction, dedup, enumeration, character grouping, out-of-reach analysis. Pure. |
| `js/app.js` | Suggestions section in the presets dialog, the paging cursor, loading a suggestion, inventory persistence. |
| `index.html` | Markup for the suggestions and out-of-reach sections. |
| `css/app.css` | Styling for the new sections, reusing `.preset-card`. |
| `test/generate.test.js` | All generator tests. |

Existing APIs this builds on, verbatim:

- `js/geometry.js`: `PIECES`, `ROTATIONS`, `placedCells(piece)`
- `js/model.js`: `createLayout(overrides)`, `occupiedSet(layout)`, `parseCellKey(k)`, `findOverlaps(layout)`, `isClosedCircuit(layout)`, `openPorts(layout)`, `placeAgainst(port, type, rot)`, `computeMetrics(layout)`, `NEIGHBOUR`
- `js/inventory.js`: `KITS`, `stockFromKits(counts)`, `billOfMaterials(layout)`, `diffStock(bom, stock)`
- `js/presets.js`: `PRESETS`, `rectangularRing()`, `stockL()`

---

### Task 1: Turn signatures

**Files:**
- Create: `js/generate.js`
- Create: `test/generate.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `turnSignatures(corners: number) -> string[]`, `OUTLINE_NAMES: object`, `outlineName(signature: string) -> string`.

A closed rectilinear outline traversed clockwise makes turns of +1 (right) and −1 (left) summing to **+4**. With `n` corners that means `r = (n+4)/2` rights and `l = (n−4)/2` lefts, so `n` is even and at least 4. Two signatures describing the same shape differ only by where you started walking (rotation) or by walking it mirrored (reversal with R/L swapped), so both are quotiented out.

- [ ] **Step 1: Write the failing test**

`test/generate.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { turnSignatures, outlineName } from '../js/generate.js';

test('four corners give exactly one outline: the rectangle', () => {
  assert.deepEqual(turnSignatures(4), ['RRRR']);
});

test('six corners give exactly one outline: the L', () => {
  const sigs = turnSignatures(6);
  assert.equal(sigs.length, 1);
  assert.equal(sigs[0].length, 6);
  assert.equal([...sigs[0]].filter((c) => c === 'R').length, 5);
  assert.equal([...sigs[0]].filter((c) => c === 'L').length, 1);
});

test('eight corners give several distinct outlines', () => {
  const sigs = turnSignatures(8);
  assert.ok(sigs.length >= 3, `expected several, got ${sigs.length}`);
  for (const s of sigs) {
    assert.equal(s.length, 8);
    assert.equal([...s].filter((c) => c === 'R').length, 6);
  }
  assert.equal(new Set(sigs).size, sigs.length, 'no duplicates');
});

test('odd or too-small corner counts yield nothing', () => {
  assert.deepEqual(turnSignatures(3), []);
  assert.deepEqual(turnSignatures(5), []);
  assert.deepEqual(turnSignatures(2), []);
});

test('the two small outlines have friendly names', () => {
  assert.equal(outlineName('RRRR'), 'Rectangle');
  assert.equal(outlineName(turnSignatures(6)[0]), 'L-shape');
});

test('larger outlines fall back to an honest generic name', () => {
  // We do not claim to know which 8-corner class is "the T" and which is
  // "the U" — naming them would be inventing knowledge we have not verified.
  assert.match(outlineName(turnSignatures(8)[0]), /8-corner shape/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/generate.js'`.

- [ ] **Step 3: Write the implementation**

`js/generate.js`:

```js
// Layout generation for the Circuit 30 planner.
//
// Outlines are enumerated as turn signatures rather than by searching the
// grid. A depth-first walk over piece placements does not work: a probe
// explored 60,000 nodes in 25 seconds and closed zero loops, because a
// wandering chain almost never returns to its own start.
//
// NOTHING in this module computes mat counts, barrier counts or areas. Those
// come from computeMetrics / computeBarriers / billOfMaterials. See the spec's
// "no parallel geometry maths" constraint and the parent spec's section 13.2
// for what happens when that rule is broken.

// Rotate a string left by n.
const rotate = (s, n) => s.slice(n) + s.slice(0, n);

// The same outline walked in the opposite direction, which swaps the sense of
// every turn. Used to quotient out mirror images.
const mirror = (s) => [...s].reverse().map((c) => (c === 'R' ? 'L' : 'R')).join('');

// Smallest representative of a signature under rotation and mirroring.
function canonicalSignature(s) {
  const forms = [];
  for (let i = 0; i < s.length; i++) {
    forms.push(rotate(s, i));
    forms.push(rotate(mirror(s), i));
  }
  return forms.sort()[0];
}

// Every distinct closed rectilinear outline with `corners` corners.
// Clockwise traversal turns sum to +4, so rights - lefts = 4.
export function turnSignatures(corners) {
  if (corners < 4 || corners % 2 !== 0) return [];
  const lefts = (corners - 4) / 2;
  const seen = new Set();

  // Choose which positions hold the left turns.
  const choose = (start, remaining, picked) => {
    if (remaining === 0) {
      const chars = Array.from({ length: corners }, (_, i) => (picked.includes(i) ? 'L' : 'R'));
      seen.add(canonicalSignature(chars.join('')));
      return;
    }
    for (let i = start; i <= corners - remaining; i++) choose(i + 1, remaining - 1, [...picked, i]);
  };
  choose(0, lefts, []);

  return [...seen].sort();
}

export const OUTLINE_NAMES = {
  RRRR: 'Rectangle',
  LRRRRR: 'L-shape',
};

export function outlineName(signature) {
  const canonical = canonicalSignature(signature);
  if (OUTLINE_NAMES[canonical]) return OUTLINE_NAMES[canonical];
  // Deliberately generic. Which 8-corner class is "the T" and which is "the
  // U" is not something we have verified, and inventing the mapping would be
  // asserting knowledge we do not have.
  const index = turnSignatures(canonical.length).indexOf(canonical);
  return `${canonical.length}-corner shape ${index + 1}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS. Note the `OUTLINE_NAMES` key for the L must be whatever
`canonicalSignature` actually produces for a 5R/1L sequence — run
`node -e "import('./js/generate.js').then(m => console.log(m.turnSignatures(6)))"`
and use that exact string as the key. Do not guess it.

- [ ] **Step 5: Commit**

```bash
git add js/generate.js test/generate.test.js
git commit -m "feat(generate): enumerate distinct rectilinear outlines as turn signatures"
```

---

### Task 2: Build a loop from an outline

**Files:**
- Modify: `js/generate.js`
- Modify: `test/generate.test.js`

**Interfaces:**
- Consumes: `turnSignatures` from Task 1.
- Produces: `buildLoop({ signature, sides, cornerType }) -> {type,x,y,rot}[] | null`.

`sides[i]` is the number of straight pieces on the run *before* corner `i`. The builder lays pieces by chaining `placeAgainst`, exactly as a person would, and returns `null` if the result is not a valid closed circuit.

**Do not compute rotations by hand.** For each piece, try all four rotations, keep the ones that actually connect, and choose by the direction the new open port faces. `placeAgainst` already encodes the connection rules; re-deriving them is how orientation bugs get in.

- [ ] **Step 1: Write the failing test**

Append to `test/generate.test.js`:

```js
import { buildLoop } from '../js/generate.js';
import { createLayout, isClosedCircuit, findOverlaps, occupiedSet } from '../js/model.js';

test('a rectangle outline with equal sides closes', () => {
  const pieces = buildLoop({ signature: 'RRRR', sides: [3, 5, 3, 5], cornerType: 'cornerR30' });
  assert.ok(pieces, 'expected a closed loop');
  const l = createLayout({ pieces });
  assert.deepEqual(findOverlaps(l), []);
  assert.equal(isClosedCircuit(l), true);
});

test('the built rectangle is the 7x9 ring the rest of the suite already trusts', () => {
  const pieces = buildLoop({ signature: 'RRRR', sides: [3, 5, 3, 5], cornerType: 'cornerR30' });
  assert.equal(occupiedSet(createLayout({ pieces })).size, 48);
});

test('a rectangle outline with mismatched sides does not close', () => {
  assert.equal(buildLoop({ signature: 'RRRR', sides: [3, 5, 4, 5], cornerType: 'cornerR30' }), null);
});

test('zero-length sides are allowed: four corners butted together close', () => {
  const pieces = buildLoop({ signature: 'RRRR', sides: [0, 0, 0, 0], cornerType: 'cornerR30' });
  assert.ok(pieces);
  assert.equal(occupiedSet(createLayout({ pieces })).size, 16);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `buildLoop is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `js/generate.js`:

```js
import { ROTATIONS } from './geometry.js';
import { createLayout, isClosedCircuit, findOverlaps, openPorts, placeAgainst } from './model.js';

const RIGHT_OF = { N: 'E', E: 'S', S: 'W', W: 'N' };
const LEFT_OF = { N: 'W', W: 'S', S: 'E', E: 'N' };

// Append one piece to the layout's open tip so that the new open port faces
// `exitDir`. Rotations are found by trial rather than derived: placeAgainst
// already knows the connection rules, and re-deriving them by hand is how
// orientation bugs get in.
function append(pieces, type, exitDir) {
  const layout = createLayout({ pieces });
  const open = openPorts(layout);
  if (open.length === 0) return null;
  const tip = open[open.length - 1].port;

  for (const rot of ROTATIONS) {
    const next = placeAgainst(tip, type, rot);
    if (!next) continue;
    const grown = [...pieces, next];
    if (findOverlaps(createLayout({ pieces: grown })).length > 0) continue;
    const after = openPorts(createLayout({ pieces: grown }));
    if (after.some((o) => o.port.dir === exitDir)) return grown;
  }
  return null;
}

export function buildLoop({ signature, sides, cornerType = 'cornerR30' }) {
  if (sides.length !== signature.length) return null;

  let pieces = [{ type: cornerType, x: 0, y: 0, rot: 0 }];
  let heading = openPorts(createLayout({ pieces }))[0].port.dir;

  for (let i = 0; i < signature.length; i++) {
    for (let s = 0; s < sides[i]; s++) {
      pieces = append(pieces, 'straight', heading);
      if (!pieces) return null;
    }
    if (i === signature.length - 1) break;      // the first piece is the last corner
    heading = signature[i] === 'R' ? RIGHT_OF[heading] : LEFT_OF[heading];
    pieces = append(pieces, cornerType, heading);
    if (!pieces) return null;
  }

  const layout = createLayout({ pieces });
  if (findOverlaps(layout).length > 0) return null;
  return isClosedCircuit(layout) ? pieces : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

If the 7x9 assertion fails, print the built cell set and compare against
`rectangularRing()` in `js/presets.js` — that fixture is trusted by several
existing suites, so a mismatch means the builder is wrong, not the fixture.
Do not change the fixture.

- [ ] **Step 5: Commit**

```bash
git add js/generate.js test/generate.test.js
git commit -m "feat(generate): build a closed loop from an outline by chaining placeAgainst"
```

---

### Task 3: Canonical form and deduplication

**Files:**
- Modify: `js/generate.js`
- Modify: `test/generate.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks beyond `js/model.js`.
- Produces: `canonicalLayoutKey(pieces) -> string`.

A layout and its rotations and mirrors are the same track. Reduce the occupied-cell set to a canonical string: apply each of the 8 symmetries, translate so the minimum cell is the origin, sort the cells, and take the lexicographically smallest result.

- [ ] **Step 1: Write the failing test**

Append to `test/generate.test.js`:

```js
import { canonicalLayoutKey } from '../js/generate.js';

test('a rectangle and its quarter turn share a canonical key', () => {
  const a = buildLoop({ signature: 'RRRR', sides: [3, 5, 3, 5], cornerType: 'cornerR30' });
  const b = buildLoop({ signature: 'RRRR', sides: [5, 3, 5, 3], cornerType: 'cornerR30' });
  assert.ok(a && b);
  assert.equal(canonicalLayoutKey(a), canonicalLayoutKey(b));
});

test('a translated layout shares a canonical key', () => {
  const a = buildLoop({ signature: 'RRRR', sides: [3, 5, 3, 5], cornerType: 'cornerR30' });
  const moved = a.map((p) => ({ ...p, x: p.x + 7, y: p.y - 3 }));
  assert.equal(canonicalLayoutKey(a), canonicalLayoutKey(moved));
});

test('genuinely different layouts have different keys', () => {
  const rect = buildLoop({ signature: 'RRRR', sides: [3, 5, 3, 5], cornerType: 'cornerR30' });
  const bigger = buildLoop({ signature: 'RRRR', sides: [4, 5, 4, 5], cornerType: 'cornerR30' });
  assert.ok(rect && bigger);
  assert.notEqual(canonicalLayoutKey(rect), canonicalLayoutKey(bigger));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `canonicalLayoutKey is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `js/generate.js`:

```js
import { placedCells } from './geometry.js';

// The 8 symmetries of the square: optional mirror, then 0-3 quarter turns.
function symmetry(cells, index) {
  return cells.map(([x, y]) => {
    let a = index & 4 ? -x : x;
    let b = y;
    for (let i = 0; i < (index & 3); i++) [a, b] = [-b, a];
    return [a, b];
  });
}

export function canonicalLayoutKey(pieces) {
  const cells = pieces.flatMap((p) => placedCells(p));
  const forms = [];
  for (let i = 0; i < 8; i++) {
    const t = symmetry(cells, i);
    const mx = Math.min(...t.map((c) => c[0]));
    const my = Math.min(...t.map((c) => c[1]));
    forms.push(t.map(([x, y]) => `${x - mx},${y - my}`).sort().join(';'));
  }
  return forms.sort()[0];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/generate.js test/generate.test.js
git commit -m "feat(generate): canonical layout key over the 8 symmetries"
```

---

### Task 4: Enumerate buildable layouts

**Files:**
- Modify: `js/generate.js`
- Modify: `test/generate.test.js`

**Interfaces:**
- Consumes: `turnSignatures`, `buildLoop`, `canonicalLayoutKey` from Tasks 1-3.
- Produces: `generateLayouts(stock, opts) -> { results, examined, stopped }` where each result is `{ pieces, signature, cornerType, sides, matCount, lapMm, bbox, key }`.

`opts` is `{ maxCorners = 10, maxSide = 12, budget = 20000, room = null }`.

**Closure is checked arithmetically before building.** Walking the headings gives each side a direction; a closed outline needs the signed side lengths to sum to zero on both axes. Rejecting non-closing tuples before construction is what keeps this fast — building every tuple would be thousands of times slower.

This is *not* a breach of the no-parallel-maths rule: it decides which candidates are worth building, and every candidate that survives is still built from real pieces and validated by `isClosedCircuit`. The rule forbids computing **mat counts, barrier counts and areas** outside the engine, and this computes none of those.

- [ ] **Step 1: Write the failing test**

Append to `test/generate.test.js`:

```js
import { generateLayouts } from '../js/generate.js';
import { stockFromKits, billOfMaterials, diffStock } from '../js/inventory.js';

test('a starter set generates layouts, all of them buildable', () => {
  const stock = stockFromKits({ '87033': 1 });
  const { results } = generateLayouts(stock, { maxSide: 10 });
  assert.ok(results.length > 0, 'expected some layouts');
  for (const r of results) {
    const l = createLayout({ pieces: r.pieces });
    assert.deepEqual(findOverlaps(l), [], `${r.key} overlaps`);
    assert.equal(isClosedCircuit(l), true, `${r.key} is not closed`);
    const short = diffStock(billOfMaterials(l), stock).filter((row) => row.short > 0);
    assert.deepEqual(short, [], `${r.key} exceeds stock`);
  }
});

test('results are deduplicated', () => {
  const { results } = generateLayouts(stockFromKits({ '87033': 1 }), { maxSide: 10 });
  const keys = results.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('the 7x9 rectangle ring is among the generated results', () => {
  const { results } = generateLayouts(stockFromKits({ '87033': 1 }), { maxSide: 10 });
  const target = canonicalLayoutKey(rectangularRing());
  assert.ok(results.some((r) => r.key === target), 'the trusted ring fixture was not generated');
});

test('a room boundary shrinks the result set', () => {
  const stock = stockFromKits({ '87033': 1 });
  const all = generateLayouts(stock, { maxSide: 10 });
  const small = generateLayouts(stock, { maxSide: 10, room: { w: 7, h: 7 } });
  assert.ok(small.results.length < all.results.length);
  for (const r of small.results) {
    assert.ok(r.bbox.w <= 7 && r.bbox.h <= 7, `${r.key} does not fit the room`);
  }
});

test('hitting the budget is reported, never silent', () => {
  const out = generateLayouts(stockFromKits({ '87031': 4 }), { maxSide: 14, budget: 200 });
  assert.equal(out.stopped, true);
  assert.ok(out.examined >= 200);
});
```

Add `import { rectangularRing } from '../js/presets.js';` to the imports at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `generateLayouts is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `js/generate.js`:

```js
import { computeMetrics } from './model.js';
import { billOfMaterials, diffStock } from './inventory.js';

const RIGHT = { N: 'E', E: 'S', S: 'W', W: 'N' };
const LEFT = { N: 'W', W: 'S', S: 'E', E: 'N' };
const STEP = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

// The heading each side of an outline is walked in.
function headings(signature) {
  const out = [];
  let dir = 'N';
  for (const turn of signature) {
    out.push(dir);
    dir = turn === 'R' ? RIGHT[dir] : LEFT[dir];
  }
  return out;
}

// A closed outline's signed side lengths sum to zero on both axes. Checking
// this before building is what makes enumeration fast; every tuple that
// survives is still built and validated by isClosedCircuit.
function closes(signature, sides) {
  let x = 0;
  let y = 0;
  headings(signature).forEach((dir, i) => {
    x += STEP[dir][0] * sides[i];
    y += STEP[dir][1] * sides[i];
  });
  return x === 0 && y === 0;
}

function cornerTypesFor(stock) {
  const types = [];
  if (stock.mats.quarterRound > 0) types.push('cornerR30');
  if (stock.mats.arcLarge > 0) types.push('cornerR60');
  return types;
}

export function generateLayouts(stock, opts = {}) {
  const { maxCorners = 10, maxSide = 12, budget = 20000, room = null } = opts;
  const totalMats = stock.mats.square + stock.mats.quarterRound + stock.mats.arcLarge;
  // Each straight is 2 mats, so the straights alone cannot exceed this.
  const maxStraights = Math.floor(totalMats / 2);

  const results = [];
  const seen = new Set();
  let examined = 0;
  let stopped = false;

  for (const cornerType of cornerTypesFor(stock)) {
    for (let corners = 4; corners <= maxCorners; corners += 2) {
      for (const signature of turnSignatures(corners)) {
        const sides = new Array(corners).fill(0);

        const walk = (i, used) => {
          if (stopped) return;
          if (i === corners) {
            if (!closes(signature, sides)) return;
            if (++examined > budget) { stopped = true; return; }
            const pieces = buildLoop({ signature, sides: [...sides], cornerType });
            if (!pieces) return;
            const layout = createLayout({ pieces });
            const { bbox, matCount, lapMm } = computeMetrics(layout);
            if (room && (bbox.w > room.w || bbox.h > room.h)) return;
            if (diffStock(billOfMaterials(layout), stock).some((r) => r.short > 0)) return;
            const key = canonicalLayoutKey(pieces);
            if (seen.has(key)) return;
            seen.add(key);
            results.push({ pieces, signature, cornerType, sides: [...sides], matCount, lapMm, bbox, key });
            return;
          }
          for (let n = 0; n <= maxSide; n++) {
            if (used + n > maxStraights) break;
            sides[i] = n;
            walk(i + 1, used + n);
            if (stopped) return;
          }
          sides[i] = 0;
        };
        walk(0, 0);
      }
    }
  }

  return { results, examined, stopped };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

If generation is slow, reduce `maxSide` in the tests rather than weakening any
assertion. If the 7x9 ring is missing, print the generated keys and compare —
that fixture is trusted by several existing suites, so a mismatch means the
generator is wrong.

- [ ] **Step 5: Commit**

```bash
git add js/generate.js test/generate.test.js
git commit -m "feat(generate): enumerate buildable layouts within stock and room"
```

---

### Task 5: Group into characters

**Files:**
- Modify: `js/generate.js`
- Modify: `test/generate.test.js`

**Interfaces:**
- Consumes: `generateLayouts` from Task 4.
- Produces: `cornerFeel(result) -> 'tight'|'sweeping'`, `groupByCharacter(results) -> Character[]` where `Character` is `{ key, name, feel, corners, variants, best }`, sorted by corner count then name. `variants` is sorted by `matCount` descending; `best` is `variants[0]`.

Two layouts are the same character when they share both outline and corner feel. Size and proportion are variants — without this the output is the same outline at a thousand length increments.

- [ ] **Step 1: Write the failing test**

Append to `test/generate.test.js`:

```js
import { groupByCharacter } from '../js/generate.js';

test('a starter set yields exactly two characters: rectangle and L', () => {
  const { results } = generateLayouts(stockFromKits({ '87033': 1 }), { maxSide: 10 });
  const chars = groupByCharacter(results);
  assert.equal(chars.length, 2, chars.map((c) => c.name).join(', '));
  assert.deepEqual(chars.map((c) => c.name).sort(), ['L-shape', 'Rectangle']);
  for (const c of chars) assert.equal(c.feel, 'tight');
});

test('every character keeps its variants, best first by mat count', () => {
  const { results } = generateLayouts(stockFromKits({ '87033': 1 }), { maxSide: 10 });
  for (const c of groupByCharacter(results)) {
    assert.ok(c.variants.length >= 1);
    assert.equal(c.best, c.variants[0]);
    for (let i = 1; i < c.variants.length; i++) {
      assert.ok(c.variants[i - 1].matCount >= c.variants[i].matCount);
    }
  }
});

test('variants and characters are different things: many variants, few characters', () => {
  const { results } = generateLayouts(stockFromKits({ '87033': 1 }), { maxSide: 10 });
  const chars = groupByCharacter(results);
  const variants = chars.reduce((n, c) => n + c.variants.length, 0);
  assert.equal(variants, results.length);
  assert.ok(variants > chars.length, 'expected size variants to outnumber characters');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `groupByCharacter is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `js/generate.js`:

```js
export function cornerFeel(result) {
  return result.cornerType === 'cornerR60' ? 'sweeping' : 'tight';
}

const FEEL_LABEL = { tight: 'tight corners', sweeping: 'sweeping corners' };

export function groupByCharacter(results) {
  const groups = new Map();
  for (const r of results) {
    const feel = cornerFeel(r);
    const name = outlineName(r.signature);
    const key = `${name}|${feel}`;
    if (!groups.has(key)) {
      groups.set(key, { key, name, feel, corners: r.signature.length, variants: [] });
    }
    groups.get(key).variants.push(r);
  }

  const characters = [...groups.values()];
  for (const c of characters) {
    c.variants.sort((a, b) => b.matCount - a.matCount || b.lapMm - a.lapMm);
    c.best = c.variants[0];
    c.label = `${c.name}, ${FEEL_LABEL[c.feel]}`;
  }
  characters.sort((a, b) => a.corners - b.corners || a.name.localeCompare(b.name));
  return characters;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS. The "exactly two characters" assertion is the headline claim
of the whole feature — if it fails, do not relax it. Either the generator is
producing shapes the inventory cannot pay for, or the corner-budget reasoning
in the spec is wrong; both need investigating, not silencing.

- [ ] **Step 5: Commit**

```bash
git add js/generate.js test/generate.test.js
git commit -m "feat(generate): group layouts into characters by outline and corner feel"
```

---

### Task 6: What is out of reach, and why

**Files:**
- Modify: `js/generate.js`
- Modify: `test/generate.test.js`

**Interfaces:**
- Consumes: `turnSignatures`, `buildLoop`, `groupByCharacter`, `generateLayouts`.
- Produces: `outOfReach(stock, opts) -> { name, corners, feel, missing }[]` where `missing` is `{ label, short }` naming the part that blocks it.

This replaces a what-if panel: it says what you cannot build and what is stopping you. **Establish the reason by evidence, not by formula** — build a minimal example of the unreachable character ignoring stock, then diff it against the stock and report the first shortfall. A hardcoded rule like "n corners need n quarter-rounds" would be another unverified formula of exactly the kind that has already gone wrong in this project.

- [ ] **Step 1: Write the failing test**

Append to `test/generate.test.js`:

```js
import { outOfReach } from '../js/generate.js';

test('a starter set cannot reach 8-corner shapes, and says which part blocks it', () => {
  const blocked = outOfReach(stockFromKits({ '87033': 1 }), { maxSide: 8 });
  const eight = blocked.find((b) => b.corners === 8);
  assert.ok(eight, 'expected 8-corner shapes to be reported as out of reach');
  assert.ok(eight.missing.short > 0);
  assert.match(eight.missing.label, /mat|barrier|joint/i);
});

test('a starter set cannot reach sweeping corners without the large corner kit', () => {
  const blocked = outOfReach(stockFromKits({ '87033': 1 }), { maxSide: 8 });
  assert.ok(blocked.some((b) => b.feel === 'sweeping'));
});

test('owning large corners makes the sweeping character reachable', () => {
  const stock = stockFromKits({ '87033': 1, '87033-02': 1 });
  const chars = groupByCharacter(generateLayouts(stock, { maxSide: 8 }).results);
  assert.ok(chars.some((c) => c.feel === 'sweeping'), chars.map((c) => c.label).join(', '));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `outOfReach is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `js/generate.js`:

```js
import { emptyStock } from './inventory.js';

// Smallest buildable example of an outline, ignoring stock entirely. Used to
// find out WHY a character is unreachable, by pricing it against what is
// actually owned.
function smallestExample(signature, cornerType, maxSide) {
  for (let n = 0; n <= maxSide; n++) {
    const sides = new Array(signature.length).fill(n);
    if (!closes(signature, sides)) continue;
    const pieces = buildLoop({ signature, sides, cornerType });
    if (pieces) return pieces;
  }
  return null;
}

export function outOfReach(stock, opts = {}) {
  const { maxCorners = 10, maxSide = 8 } = opts;
  const reachable = new Set(
    groupByCharacter(generateLayouts(stock, opts).results).map((c) => c.key),
  );

  const blocked = [];
  for (const cornerType of ['cornerR30', 'cornerR60']) {
    const feel = cornerType === 'cornerR60' ? 'sweeping' : 'tight';
    for (let corners = 4; corners <= maxCorners; corners += 2) {
      for (const signature of turnSignatures(corners)) {
        const name = outlineName(signature);
        const key = `${name}|${feel}`;
        if (reachable.has(key) || blocked.some((b) => b.key === key)) continue;

        const pieces = smallestExample(signature, cornerType, maxSide);
        if (!pieces) continue;                    // not constructible at all
        const rows = diffStock(billOfMaterials(createLayout({ pieces })), stock)
          .filter((r) => r.short > 0)
          .sort((a, b) => b.short - a.short);
        if (rows.length === 0) continue;          // reachable after all
        blocked.push({ key, name, corners, feel, missing: rows[0] });
      }
    }
  }
  return blocked;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/generate.js test/generate.test.js
git commit -m "feat(generate): report unreachable characters with the part that blocks them"
```

---

### Task 7: Persist the inventory

**Files:**
- Create: `js/kits-store.js`
- Create: `test/kits-store.test.js`
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `KITS` from `js/inventory.js`.
- Produces: `KITS_STORAGE_KEY = 'circuit30.kits'`, `DEFAULT_KITS = { '87033': 1 }`, `parseKits(raw) -> object`, `loadKits(storage) -> object`, `saveKits(storage, kits) -> void`.

`state.kits` currently resets to `{'87033': 1}` on every reload. Once it is the generator's input that is untenable. It moves to `localStorage`.

It stays out of the exported layout file, which remains correct: the inventory is the owner's shelf, not a property of a track.

`parseKits` is separated from `loadKits` so the parsing rules can be tested in Node without a `localStorage` stub, and `loadKits` takes the storage object as a parameter so tests can pass a fake.

- [ ] **Step 1: Write the failing test**

`test/kits-store.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKits, loadKits, saveKits, DEFAULT_KITS, KITS_STORAGE_KEY } from '../js/kits-store.js';

const fakeStorage = (initial) => {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    dump: () => Object.fromEntries(map),
  };
};

test('a good payload round-trips', () => {
  assert.deepEqual(parseKits('{"87033":2,"87033-01":1}'), { '87033': 2, '87033-01': 1 });
});

test('unknown kit ids are dropped rather than trusted', () => {
  assert.deepEqual(parseKits('{"87033":1,"not-a-kit":5}'), { '87033': 1 });
});

test('non-numeric, negative and fractional counts are rejected', () => {
  assert.deepEqual(parseKits('{"87033":"two"}'), DEFAULT_KITS);
  assert.deepEqual(parseKits('{"87033":-1}'), DEFAULT_KITS);
  assert.deepEqual(parseKits('{"87033":1.5}'), DEFAULT_KITS);
});

test('malformed or absent storage falls back to the default, never throws', () => {
  assert.deepEqual(parseKits('not json'), DEFAULT_KITS);
  assert.deepEqual(parseKits(null), DEFAULT_KITS);
  assert.deepEqual(parseKits('[]'), DEFAULT_KITS);
  assert.deepEqual(loadKits(fakeStorage()), DEFAULT_KITS);
});

test('a storage that throws does not break the app', () => {
  const hostile = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(loadKits(hostile), DEFAULT_KITS);
  assert.doesNotThrow(() => saveKits(hostile, { '87033': 1 }));
});

test('save then load returns what was saved', () => {
  const s = fakeStorage();
  saveKits(s, { '87033': 3 });
  assert.equal(typeof s.dump()[KITS_STORAGE_KEY], 'string');
  assert.deepEqual(loadKits(s), { '87033': 3 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/kits-store.js'`.

- [ ] **Step 3: Write the implementation**

`js/kits-store.js`:

```js
// The owned inventory, persisted across reloads.
//
// It stays out of the exported layout file on purpose: the inventory is the
// owner's shelf, not a property of any particular track. But it is the
// generator's input, so losing it on reload is wrong.

import { KITS } from './inventory.js';

export const KITS_STORAGE_KEY = 'circuit30.kits';
export const DEFAULT_KITS = { '87033': 1 };

// A stored value is untrusted: it can be absent, corrupt, hand-edited, or
// left behind by an older build. Anything that is not a clean map of known
// kit ids to non-negative integers falls back to the default rather than
// half-applying.
export function parseKits(raw) {
  if (typeof raw !== 'string') return { ...DEFAULT_KITS };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_KITS };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return { ...DEFAULT_KITS };

  const out = {};
  for (const [id, count] of Object.entries(data)) {
    if (!KITS[id]) continue;                                   // unknown kit: drop it
    if (!Number.isInteger(count) || count < 0) return { ...DEFAULT_KITS };
    out[id] = count;
  }
  return Object.keys(out).length > 0 ? out : { ...DEFAULT_KITS };
}

export function loadKits(storage) {
  try {
    return parseKits(storage.getItem(KITS_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_KITS };                                // storage can be denied
  }
}

export function saveKits(storage, kits) {
  try {
    storage.setItem(KITS_STORAGE_KEY, JSON.stringify(kits));
  } catch {
    /* Storage denied or full. The inventory still works for this session. */
  }
}
```

- [ ] **Step 4: Wire it into `js/app.js`**

Replace the hardcoded initialisation with a load, and save on change:

```js
import { loadKits, saveKits } from './kits-store.js';

// ... in the state initialiser, replace `kits: { '87033': 1 }` with:
kits: loadKits(localStorage),
```

and in the inventory dialog's `close` handler, immediately after `state.kits` is assigned:

```js
saveKits(localStorage, state.kits);
```

- [ ] **Step 5: Run the tests and check the wiring**

Run: `npm test`
Expected: PASS, plus `node --check js/app.js` and `node --check js/kits-store.js` clean.

Then verify in the browser: open the app, set a kit count in the inventory dialog, reload, and confirm the count survived. State plainly in the report that this one was checked in a browser, since it cannot be checked from Node.

- [ ] **Step 6: Commit**

```bash
git add js/kits-store.js test/kits-store.test.js js/app.js
git commit -m "feat(app): persist the owned inventory across reloads"
```

---

### Task 8: Suggestions in the presets dialog

**Files:**
- Modify: `index.html`
- Modify: `js/app.js`
- Modify: `css/app.css`

**Interfaces:**
- Consumes: `generateLayouts`, `groupByCharacter`, `outOfReach` from Tasks 4-6; `layoutToSvgString` from `js/render.js`; `commit` and `render` from `js/app.js`.
- Produces: no exports; DOM ids `#suggestions-list`, `#suggestions-summary`, `#btn-more-suggestions`, `#out-of-reach`.

The presets dialog becomes the place layouts come from. It reuses `.preset-card`, so there is no new row styling.

**Five are chosen for spread, not rank** — round-robin across characters, then by descending mat count within each. Ranking by lap length alone fills the list with five near-identical rectangles.

**The button advances a cursor; it does not reshuffle.** Repeated presses walk 6-10, 11-15 and so on with no repeats until the pool is exhausted, then wrap. Random selection would re-show rejected layouts and could never promise the whole space had been seen.

**Five or fewer results:** show them all and hide the button.

- [ ] **Step 1: Add the markup**

In `index.html`, inside `#presets-dialog` after the existing `#presets-list`:

```html
    <hr class="divider">
    <h3 class="h3">Suggestions</h3>
    <p class="subtitle" id="suggestions-summary"></p>
    <ul id="suggestions-list"></ul>
    <button type="button" class="btn btn-sm btn-outline btn-block" id="btn-more-suggestions" hidden>
      Show 5 different
    </button>
    <div id="out-of-reach"></div>
```

- [ ] **Step 2: Build the ordered pool and render it**

In `js/app.js`:

```js
import { generateLayouts, groupByCharacter, outOfReach } from './generate.js';

state.suggestions = { pool: [], cursor: 0, stopped: false };

// Round-robin across characters so the first five show different shapes
// rather than five rectangles differing by one mat.
function suggestionPool(characters) {
  const pool = [];
  const queues = characters.map((c) => [...c.variants]);
  while (queues.some((q) => q.length > 0)) {
    for (const q of queues) if (q.length > 0) pool.push(q.shift());
  }
  return pool;
}

function renderSuggestions() {
  const stock = stockFromKits(state.kits);
  const { results, stopped } = generateLayouts(stock, { room: state.layout.room });
  const characters = groupByCharacter(results);
  state.suggestions = { pool: suggestionPool(characters), cursor: 0, stopped };

  document.querySelector('#suggestions-summary').textContent = results.length === 0
    ? 'Nothing can be built with the current inventory.'
    : `${results.length} layout${results.length === 1 ? '' : 's'} across `
      + `${characters.length} shape${characters.length === 1 ? '' : 's'}`
      + (stopped ? ' — stopped early, there may be more' : '');

  renderOutOfReach(stock);
  renderSuggestionPage();
}

function renderSuggestionPage() {
  const { pool, cursor } = state.suggestions;
  const page = pool.slice(cursor, cursor + 5);
  const list = document.querySelector('#suggestions-list');
  list.replaceChildren(...page.map(suggestionListItem));

  const more = document.querySelector('#btn-more-suggestions');
  more.hidden = pool.length <= 5;
  more.textContent = cursor + 5 >= pool.length ? 'Start again from the first' : 'Show 5 different';
  document.querySelector('#suggestions-summary').dataset.page =
    pool.length ? `showing ${cursor + 1}-${Math.min(cursor + 5, pool.length)} of ${pool.length}` : '';
}

document.querySelector('#btn-more-suggestions').addEventListener('click', () => {
  const { pool, cursor } = state.suggestions;
  state.suggestions.cursor = cursor + 5 >= pool.length ? 0 : cursor + 5;
  renderSuggestionPage();
});
```

- [ ] **Step 3: Render one suggestion row and the out-of-reach list**

```js
function suggestionListItem(result) {
  const li = document.createElement('li');
  try {
    const layout = createLayout({ pieces: result.pieces });
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset-card';
    button.dataset.suggestionKey = result.key;
    button.innerHTML = `<span class="preset-thumb">${layoutToSvgString(layout, { pad: 0.6, theme: 'light' })}</span>
      <span class="preset-info">
        <span class="preset-name">${outlineName(result.signature)} ${result.bbox.w}×${result.bbox.h}</span>
        <span class="preset-source">${result.matCount} mats · lap ${(result.lapMm / 1000).toFixed(2)} m</span>
      </span>`;
    li.append(button);
  } catch (error) {
    console.error(`Suggestion "${result.key}" could not be rendered:`, error);
    const p = document.createElement('p');
    p.className = 'preset-broken';
    p.textContent = 'This suggestion could not be drawn.';
    li.append(p);
  }
  return li;
}

function renderOutOfReach(stock) {
  const blocked = outOfReach(stock);
  const host = document.querySelector('#out-of-reach');
  if (blocked.length === 0) { host.replaceChildren(); return; }
  const seen = new Set();
  const lines = blocked.filter((b) => !seen.has(b.name + b.feel) && seen.add(b.name + b.feel));
  host.innerHTML = `<hr class="divider"><h3 class="h3">Out of reach</h3><dl id="out-of-reach-list">`
    + lines.map((b) => `<dt>${b.name}${b.feel === 'sweeping' ? ', sweeping' : ''}</dt>`
      + `<dd>needs ${b.missing.short} more ${b.missing.label.toLowerCase()}</dd>`).join('')
    + `</dl>`;
}
```

Add `outlineName` to the `./generate.js` import.

- [ ] **Step 4: Load a chosen suggestion**

Delegate from the list, mirroring the existing preset click handler so the behaviour is identical:

```js
document.querySelector('#suggestions-list').addEventListener('click', (e) => {
  const button = e.target.closest('[data-suggestion-key]');
  if (!button) return;
  const chosen = state.suggestions.pool.find((r) => r.key === button.dataset.suggestionKey);
  if (!chosen) return;
  commit((l) => { l.pieces = chosen.pieces.map((p) => ({ ...p })); });
  // A loaded suggestion is ordinary pieces. Clear the interaction state the
  // same way the preset and file-open paths do — anything computed against
  // the previous layout is meaningless now.
  state.selected = null;
  state.ghost = null;
  state.pending = null;
  state.hoverCell = null;
  state.tool = null;
  presetsDialog.close();
  render();
});
```

Call `renderSuggestions()` from the existing `#btn-presets` click handler, right after `renderPresetsList()`, so both sections refresh together when the dialog opens.

- [ ] **Step 5: Style the new sections**

In `css/app.css`, reusing the tokens already in use:

```css
#suggestions-list { list-style: none; padding: 0; margin: 0 0 var(--p-space-sm); }
#suggestions-list li { margin-bottom: var(--p-space-sm); }
#suggestions-list li:nth-child(3n+1) { --accent: var(--p-accent-1); }
#suggestions-list li:nth-child(3n+2) { --accent: var(--p-accent-2); }
#suggestions-list li:nth-child(3n+3) { --accent: var(--p-accent-3); }
#suggestions-summary::after { content: attr(data-page); display: block; color: var(--p-text-faint); }
#out-of-reach-list { display: grid; grid-template-columns: auto 1fr; gap: var(--p-space-xs) var(--p-space-md);
                     margin: 0; font-size: 12px; }
#out-of-reach-list dt { font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
#out-of-reach-list dd { margin: 0; color: var(--p-text-muted); }
```

- [ ] **Step 6: Verify**

Run: `npm test` — all tests still pass.
Run: `node --check js/app.js`.
Confirm exactly one `document` keydown listener still exists.
Confirm every `querySelector('#...')` in `js/app.js` resolves to an id in `index.html`.

Then in a browser: open Presets, confirm suggestions appear with thumbnails, page through with the button and confirm no repeats until it wraps, choose one and confirm it lands on the canvas, then press Ctrl/Cmd+Z and confirm the previous layout returns. Report exactly which of these were checked in a browser and which were not.

- [ ] **Step 7: Commit**

```bash
git add index.html js/app.js css/app.css
git commit -m "feat(app): suggest buildable layouts from the owned inventory"
```

---

## Self-Review

**Spec coverage.** §2 corner budget → Tasks 1, 6 (asserted in tests). §3 distinctness → Task 5. §4 scope → Tasks 4-8; the excluded items appear nowhere. §5.1 construction not search → Task 2. §5.2 no parallel maths → stated in Global Constraints and in Task 4's note on why the closure check is not a breach. §5.3 dedup → Task 3. §5.4 bounds and honesty → Task 4 (`stopped`/`examined`, asserted). §6 persistence → Task 7. §7 interface → Task 8. §8 testing → distributed across tasks; every assertion the spec names has a home. §9 risks → the turn-signature risk is covered by Task 1's tests plus Task 4's "the trusted ring fixture must be generated"; the candidate-count risk by Task 4's budget test.

**Known gaps, accepted deliberately:**

- The 8-corner outlines are not given friendly names. Which class is "the T" and which is "the U" is not something this project has verified, and inventing the mapping would repeat the pattern of confident unverified claims that has already cost time on this codebase. They are named `8-corner shape N`.
- Task 8 has no automated tests, consistent with the rest of the interaction layer. Its verification steps name what must be checked in a browser and require the report to say which checks were actually performed.
- `outOfReach` rebuilds the generated set internally, so opening the dialog generates twice. At the measured throughput this is imperceptible; if it ever matters, pass the already-generated results in rather than caching.

**Test count** rises from 73 to roughly 95 across eight suites.
