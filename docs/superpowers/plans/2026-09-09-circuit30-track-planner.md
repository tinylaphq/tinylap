# Circuit 30 Track Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local, dependency-free web app for designing Kyosho Mini-Z Grand Prix Circuit 30 track layouts and costing them against the pieces you own.

**Architecture:** An integer mat grid (1 mat = 300 mm) holds three piece types, all two mats wide. The persisted model is just a list of `{type, x, y, rot}`; mats, barriers, connectivity, metrics and the bill of materials are all derived on every change and never stored. Pure logic lives in four dependency-free modules tested with `node:test`; the DOM layer renders that state to one SVG.

**Tech Stack:** Vanilla JavaScript, ES modules, SVG, `node:test`. No build step, no runtime dependencies. Served locally with `python3 -m http.server`.

**Spec:** `docs/superpowers/specs/2026-09-09-circuit30-track-planner-design.md`

## Global Constraints

- **No dependencies.** No npm packages beyond what ships with Node. No CDN links. `package.json` has no `dependencies` or `devDependencies`.
- **No build step.** Source files are served as written.
- **ES modules everywhere.** `package.json` sets `"type": "module"`. Browser scripts use `<script type="module">`.
- **Unit is the mat.** 1 mat = 300 mm. All model, geometry and test values are in whole mats. Millimetres and metres appear only in rendered labels and in `computeMetrics`.
- **Coordinates are `[col, row]` with row increasing downward**, matching SVG.
- **Rotation is clockwise on screen**, one of 0, 90, 180, 270.
- **Track width is fixed at two mats.** Nothing may be parameterised on width.
- **Derived state is never persisted.** The only stored fields are `version`, `unit`, `room`, `pieces`.
- **Barriers are counted in exactly one place** — the boundary walk in `model.js`. Piece definitions declare mats only.
- **Node 20+** (for stable `node:test` and `structuredClone`). Note: since Node 22 the
  `--test` positional arguments are globs/files, and Node 24 no longer expands a bare
  directory — `node --test test/` throws. The glob form above is required.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `package.json` | `type: module`, `test` script. No dependencies. |
| `index.html` | Semantic shell: header, palette aside, main svg, BOM aside, dialogs. |
| `css/app.css` | Grid shell, palette, SVG piece styling, dialog styling. |
| `js/geometry.js` | Piece definitions, rotation, normalisation, absolute placement. Pure. |
| `js/model.js` | Layout state, occupancy, overlaps, port matching, boundary walk, metrics. Pure. |
| `js/inventory.js` | Kit catalog, owned stock, BOM, shortfall diff, kit recommendation. Pure. |
| `js/storage.js` | Self-contained HTML export and import. Pure string/DOM work. |
| `js/render.js` | Draws a layout into an SVG element; also produces a standalone SVG string. |
| `js/presets.js` | Official Kyosho plans as piece lists. Pure data. |
| `js/app.js` | Wires DOM events to the model. The only stateful module. |
| `test/fixtures.js` | Shared layout fixtures. **Not** a `.test.js` file — importing one test suite from another makes `node --test` run it twice. |
| `test/*.test.js` | `node:test` suites for the four pure modules plus storage round-trip. |

`geometry.js` has no imports. `model.js` imports only `geometry.js`. `inventory.js` imports `model.js`. `storage.js` imports `render.js`. `app.js` imports everything. No cycles.

---

### Task 1: Project skeleton and piece rotation

**Files:**
- Create: `package.json`
- Create: `js/geometry.js`
- Create: `test/geometry.test.js`
- Create: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `MAT_MM: number`, `PIECES: object`, `rotateDir(dir: string, rot: number) -> string`, `rotateCorner(corner: string, rot: number) -> string`, `rotateVertex(v: [number,number], rot: number) -> [number,number]`, `rotateCell(c: [number,number], rot: number) -> [number,number]`, `rotatedDef(type: string, rot: number) -> {label, centrelineMm, mats, cells, ports, walls}`.

The subtlety this task exists to get right: **a cell and a vertex do not rotate by the same formula.** A vertex is a point, so 90° clockwise in screen coordinates sends `(x, y)` to `(-y, x)`. A cell is the unit square whose corners are `(x, y)` and `(x+1, y+1)`; rotating those corners gives a square indexed `(-y-1, x)`. Getting this wrong shifts every rotated piece by one mat, which looks almost right and is miserable to debug later.

- [ ] **Step 1: Create the project skeleton**

`package.json`:

```json
{
  "name": "circuit30-track-planner",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test 'test/**/*.test.js'",
    "serve": "python3 -m http.server 8000"
  }
}
```

`README.md`:

```markdown
# Circuit 30 Track Planner

Design Kyosho Mini-Z Grand Prix Circuit 30 layouts and cost them against the
pieces you own.

    npm run serve      # then open http://localhost:8000
    npm test

ES modules cannot be imported over `file://`, so the app must be served.
Exported layout files are standalone and open directly in a browser.

Design: `docs/superpowers/specs/2026-09-09-circuit30-track-planner-design.md`
```

- [ ] **Step 2: Write the failing test**

`test/geometry.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAT_MM, PIECES, rotateCell, rotateVertex, rotateDir, rotateCorner, rotatedDef } from '../js/geometry.js';

test('a mat is 300 mm', () => {
  assert.equal(MAT_MM, 300);
});

test('a vertex rotates as a point', () => {
  assert.deepEqual(rotateVertex([1, 0], 90), [0, 1]);
  assert.deepEqual(rotateVertex([1, 0], 180), [-1, 0]);
  assert.deepEqual(rotateVertex([1, 0], 270), [0, -1]);
  assert.deepEqual(rotateVertex([2, 3], 0), [2, 3]);
});

test('a cell rotates as a unit square, not as its origin corner', () => {
  assert.deepEqual(rotateCell([0, 0], 90), [-1, 0]);
  assert.deepEqual(rotateCell([1, 0], 90), [-1, 1]);
  assert.deepEqual(rotateCell([0, 0], 180), [-1, -1]);
  assert.deepEqual(rotateCell([2, 3], 0), [2, 3]);
});

test('directions and corners rotate clockwise', () => {
  assert.equal(rotateDir('N', 90), 'E');
  assert.equal(rotateDir('W', 90), 'N');
  assert.equal(rotateDir('N', 270), 'W');
  assert.equal(rotateCorner('NE', 90), 'SE');
  assert.equal(rotateCorner('SW', 180), 'NE');
});

test('an unrotated definition is returned as-is', () => {
  const d = rotatedDef('straight', 0);
  assert.deepEqual(d.cells, [[0, 0], [1, 0]]);
  assert.deepEqual(d.ports.map((p) => p.dir), ['N', 'S']);
});

test('a rotated straight is normalised back to the origin and turns 1x2', () => {
  const d = rotatedDef('straight', 90);
  assert.deepEqual(d.cells, [[0, 0], [0, 1]]);
  assert.deepEqual(d.ports.map((p) => p.dir), ['E', 'W']);
  assert.deepEqual(d.ports[0].cells, [[0, 0], [0, 1]]);
});

test('every rotation of every piece keeps its footprint at the origin', () => {
  for (const type of Object.keys(PIECES)) {
    for (const rot of [0, 90, 180, 270]) {
      const { cells } = rotatedDef(type, rot);
      assert.equal(Math.min(...cells.map((c) => c[0])), 0, `${type}@${rot} min x`);
      assert.equal(Math.min(...cells.map((c) => c[1])), 0, `${type}@${rot} min y`);
      assert.equal(cells.length, PIECES[type].cells.length, `${type}@${rot} cell count`);
    }
  }
});

test('rotating a corner carries its walls around with it', () => {
  const d = rotatedDef('cornerR30', 90);
  assert.deepEqual(d.walls.find((w) => w.kind === 'cap').vertex, [2, 2]);
  const arc = d.walls.find((w) => w.kind === 'arc');
  assert.equal(arc.corner, 'NW');
});

test('the three piece types have the footprints the spec fixes', () => {
  assert.equal(PIECES.straight.cells.length, 2);
  assert.equal(PIECES.cornerR30.cells.length, 4);
  assert.equal(PIECES.cornerR60.cells.length, 8);
  assert.deepEqual(PIECES.cornerR30.mats, { square: 3, quarterRound: 1 });
  assert.deepEqual(PIECES.cornerR60.mats, { square: 6, arcLarge: 2 });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/geometry.js'`.

- [ ] **Step 4: Write the implementation**

`js/geometry.js`:

```js
// Kyosho Mini-Z Grand Prix Circuit 30 geometry.
// Cells are [col, row] with row increasing downward, matching SVG.
// Rotation is clockwise on screen: 0, 90, 180, 270.

export const MAT_MM = 300;

const DIRS = ['N', 'E', 'S', 'W'];
const CORNERS = ['NE', 'SE', 'SW', 'NW'];

const steps = (rot) => (((rot / 90) % 4) + 4) % 4;

export function rotateDir(dir, rot) {
  return DIRS[(DIRS.indexOf(dir) + steps(rot)) % 4];
}

export function rotateCorner(corner, rot) {
  return CORNERS[(CORNERS.indexOf(corner) + steps(rot)) % 4];
}

// A vertex is a point: (x, y) -> (-y, x) per quarter turn.
export function rotateVertex([x, y], rot) {
  let p = [x, y];
  for (let i = steps(rot); i > 0; i--) p = [-p[1], p[0]];
  return p;
}

// A cell is the unit square (x, y)..(x+1, y+1). Rotating those corners
// yields the square indexed (-y-1, x).
export function rotateCell([x, y], rot) {
  let p = [x, y];
  for (let i = steps(rot); i > 0; i--) p = [-p[1] - 1, p[0]];
  return p;
}

const QUARTER_TURN_MM = (Math.PI / 2) * MAT_MM;

export const PIECES = {
  straight: {
    label: 'Straight',
    cells: [[0, 0], [1, 0]],
    ports: [
      { cells: [[0, 0], [1, 0]], dir: 'N' },
      { cells: [[0, 0], [1, 0]], dir: 'S' },
    ],
    walls: [],
    mats: { square: 2 },
    centrelineMm: MAT_MM,
  },

  cornerR30: {
    label: 'Corner R30',
    cells: [[0, 0], [1, 0], [0, 1], [1, 1]],
    ports: [
      { cells: [[0, 0], [1, 0]], dir: 'N' },
      { cells: [[1, 0], [1, 1]], dir: 'E' },
    ],
    walls: [
      { kind: 'arc', r: 1, cell: [0, 1], corner: 'SW' },
      { kind: 'cap', vertex: [2, 0] },
    ],
    mats: { square: 3, quarterRound: 1 },
    centrelineMm: QUARTER_TURN_MM,
  },

  cornerR60: {
    label: 'Corner R60',
    cells: [
      [0, 0], [1, 0],
      [0, 1], [1, 1], [2, 1],
      [0, 2], [1, 2], [2, 2],
    ],
    ports: [
      { cells: [[0, 0], [1, 0]], dir: 'N' },
      { cells: [[2, 1], [2, 2]], dir: 'E' },
    ],
    walls: [
      { kind: 'arcLarge', r: 2, cell: [0, 2], corner: 'SW' },
      { kind: 'cap', vertex: [2, 1] },
    ],
    mats: { square: 6, arcLarge: 2 },
    centrelineMm: 2 * QUARTER_TURN_MM,
  },
};

export const PIECE_TYPES = Object.keys(PIECES);
export const ROTATIONS = [0, 90, 180, 270];

const cache = new Map();

// Rotate a definition and translate it so its footprint starts at [0, 0].
export function rotatedDef(type, rot) {
  const key = `${type}:${steps(rot) * 90}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const def = PIECES[type];
  if (!def) throw new Error(`unknown piece type: ${type}`);

  const spun = def.cells.map((c) => rotateCell(c, rot));
  const dx = -Math.min(...spun.map((c) => c[0]));
  const dy = -Math.min(...spun.map((c) => c[1]));
  const shift = ([x, y]) => [x + dx, y + dy];

  const out = {
    label: def.label,
    mats: def.mats,
    centrelineMm: def.centrelineMm,
    cells: spun.map(shift),
    ports: def.ports.map((p) => ({
      cells: p.cells.map((c) => shift(rotateCell(c, rot))),
      dir: rotateDir(p.dir, rot),
    })),
    walls: def.walls.map((w) =>
      w.kind === 'cap'
        ? { kind: 'cap', vertex: shift(rotateVertex(w.vertex, rot)) }
        : {
            kind: w.kind,
            r: w.r,
            cell: shift(rotateCell(w.cell, rot)),
            corner: rotateCorner(w.corner, rot),
          },
    ),
  };

  cache.set(key, out);
  return out;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json README.md js/geometry.js test/geometry.test.js
git commit -m "feat(geometry): piece definitions and rotation"
```

---

### Task 2: Absolute placement

**Files:**
- Modify: `js/geometry.js`
- Modify: `test/geometry.test.js`

**Interfaces:**
- Consumes: `rotatedDef` from Task 1.
- Produces: `placedCells(piece) -> [[x,y], ...]`, `placedPorts(piece) -> [{cells, dir}]`, `placedWalls(piece) -> [{kind, r?, cell?, corner?, vertex?}]`, where `piece` is `{type, x, y, rot}`. All coordinates absolute.

- [ ] **Step 1: Write the failing test**

Append to `test/geometry.test.js`:

```js
import { placedCells, placedPorts, placedWalls } from '../js/geometry.js';

test('placement translates a rotated footprint onto the grid', () => {
  const cells = placedCells({ type: 'straight', x: 5, y: 3, rot: 0 });
  assert.deepEqual(cells, [[5, 3], [6, 3]]);
});

test('placement composes rotation and translation', () => {
  const cells = placedCells({ type: 'straight', x: 5, y: 3, rot: 90 });
  assert.deepEqual(cells, [[5, 3], [5, 4]]);
});

test('ports and walls are placed in the same frame as cells', () => {
  const ports = placedPorts({ type: 'cornerR30', x: 10, y: 10, rot: 0 });
  assert.deepEqual(ports[0], { cells: [[10, 10], [11, 10]], dir: 'N' });
  assert.deepEqual(ports[1], { cells: [[11, 10], [11, 11]], dir: 'E' });

  const walls = placedWalls({ type: 'cornerR30', x: 10, y: 10, rot: 0 });
  assert.deepEqual(walls.find((w) => w.kind === 'cap').vertex, [12, 10]);
  assert.deepEqual(walls.find((w) => w.kind === 'arc').cell, [10, 11]);
});

test('an R60 corner occupies 3x3 minus its inner cell', () => {
  const cells = placedCells({ type: 'cornerR60', x: 0, y: 0, rot: 0 });
  assert.equal(cells.length, 8);
  assert.ok(!cells.some(([x, y]) => x === 2 && y === 0), 'inner cell [2,0] is empty');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `placedCells is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `js/geometry.js`:

```js
export function placedCells({ type, x, y, rot }) {
  return rotatedDef(type, rot).cells.map(([cx, cy]) => [cx + x, cy + y]);
}

export function placedPorts({ type, x, y, rot }) {
  return rotatedDef(type, rot).ports.map((p) => ({
    cells: p.cells.map(([cx, cy]) => [cx + x, cy + y]),
    dir: p.dir,
  }));
}

export function placedWalls({ type, x, y, rot }) {
  return rotatedDef(type, rot).walls.map((w) =>
    w.kind === 'cap'
      ? { kind: 'cap', vertex: [w.vertex[0] + x, w.vertex[1] + y] }
      : { ...w, cell: [w.cell[0] + x, w.cell[1] + y] },
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add js/geometry.js test/geometry.test.js
git commit -m "feat(geometry): absolute placement of cells, ports and walls"
```

---

### Task 3: Occupancy and overlap detection

**Files:**
- Create: `js/model.js`
- Create: `test/model.test.js`

**Interfaces:**
- Consumes: `placedCells` from Task 2.
- Produces: `createLayout(overrides?) -> layout`, `cellKey([x,y]) -> string`, `parseCellKey(string) -> [x,y]`, `occupancy(layout) -> Map<string, number[]>`, `findOverlaps(layout) -> string[]`, `occupiedSet(layout) -> Set<string>`.

`cellKey` is `` `${x},${y}` ``. Every set and map of cells in this codebase is keyed that way; nothing compares cell arrays by identity.

- [ ] **Step 1: Write the failing test**

`test/model.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout, cellKey, parseCellKey, occupancy, findOverlaps, occupiedSet } from '../js/model.js';

test('a new layout is empty and versioned', () => {
  const l = createLayout();
  assert.equal(l.version, 1);
  assert.equal(l.unit, 'mat');
  assert.equal(l.room, null);
  assert.deepEqual(l.pieces, []);
});

test('cell keys round-trip', () => {
  assert.equal(cellKey([3, -4]), '3,-4');
  assert.deepEqual(parseCellKey('3,-4'), [3, -4]);
});

test('occupancy maps every cell to the pieces claiming it', () => {
  const l = createLayout({ pieces: [{ type: 'straight', x: 0, y: 0, rot: 0 }] });
  const occ = occupancy(l);
  assert.deepEqual([...occ.keys()].sort(), ['0,0', '1,0']);
  assert.deepEqual(occ.get('0,0'), [0]);
});

test('non-overlapping pieces report no overlaps', () => {
  const l = createLayout({ pieces: [
    { type: 'straight', x: 0, y: 0, rot: 0 },
    { type: 'straight', x: 0, y: 1, rot: 0 },
  ] });
  assert.deepEqual(findOverlaps(l), []);
  assert.equal(occupiedSet(l).size, 4);
});

test('overlapping pieces report the contested cells', () => {
  const l = createLayout({ pieces: [
    { type: 'straight', x: 0, y: 0, rot: 0 },
    { type: 'straight', x: 1, y: 0, rot: 0 },
  ] });
  assert.deepEqual(findOverlaps(l), ['1,0']);
  assert.equal(occupancy(l).get('1,0').length, 2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/model.js'`.

- [ ] **Step 3: Write the implementation**

`js/model.js`:

```js
import { placedCells } from './geometry.js';

export function createLayout(overrides = {}) {
  return { version: 1, unit: 'mat', room: null, pieces: [], ...overrides };
}

export const cellKey = ([x, y]) => `${x},${y}`;
export const parseCellKey = (k) => k.split(',').map(Number);

export function occupancy(layout) {
  const map = new Map();
  layout.pieces.forEach((piece, index) => {
    for (const cell of placedCells(piece)) {
      const key = cellKey(cell);
      const owners = map.get(key);
      if (owners) owners.push(index);
      else map.set(key, [index]);
    }
  });
  return map;
}

export function occupiedSet(layout) {
  return new Set(occupancy(layout).keys());
}

export function findOverlaps(layout) {
  return [...occupancy(layout)]
    .filter(([, owners]) => owners.length > 1)
    .map(([key]) => key);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add js/model.js test/model.test.js
git commit -m "feat(model): occupancy and overlap detection"
```

---

### Task 4: Port matching and connectivity

**Files:**
- Modify: `js/model.js`
- Modify: `test/model.test.js`

**Interfaces:**
- Consumes: `placedPorts`, `occupiedSet` from Tasks 2–3.
- Produces: `edgeId(cell, dir) -> string`, `portKey(port) -> string`, `matchPorts(layout) -> {matched: Set<string>, open: [{pieceIndex, port}]}`, `openEdgeIds(layout) -> Set<string>`, `isClosedCircuit(layout) -> boolean`.

An edge is named by the cell boundary it sits on, so both cells sharing it agree on the name: horizontal edges are `H:x:y` (the edge above cell `[x,y]`), vertical edges are `V:x:y` (the edge left of cell `[x,y]`). A port's key is its two edge ids sorted and joined, so two abutting ports produce the same key from opposite sides.

- [ ] **Step 1: Write the failing test**

Append to `test/model.test.js`:

```js
import { edgeId, portKey, matchPorts, openEdgeIds, isClosedCircuit } from '../js/model.js';

test('an edge has one name whichever cell you approach it from', () => {
  assert.equal(edgeId([3, 4], 'N'), 'H:3:4');
  assert.equal(edgeId([3, 3], 'S'), 'H:3:4');
  assert.equal(edgeId([3, 4], 'W'), 'V:3:4');
  assert.equal(edgeId([2, 4], 'E'), 'V:3:4');
});

test('abutting ports share a key', () => {
  const [a] = matchPortsFixtureA();
  const [b] = matchPortsFixtureB();
  assert.equal(portKey(a), portKey(b));
});

function matchPortsFixtureA() {
  // south port of a straight at (0,0)
  return [{ cells: [[0, 0], [1, 0]], dir: 'S' }];
}
function matchPortsFixtureB() {
  // north port of a straight at (0,1)
  return [{ cells: [[0, 1], [1, 1]], dir: 'N' }];
}

test('a lone straight has two open ends', () => {
  const l = createLayout({ pieces: [{ type: 'straight', x: 0, y: 0, rot: 0 }] });
  const { matched, open } = matchPorts(l);
  assert.equal(matched.size, 0);
  assert.equal(open.length, 2);
  assert.equal(isClosedCircuit(l), false);
});

test('two stacked straights match one pair and leave two open', () => {
  const l = createLayout({ pieces: [
    { type: 'straight', x: 0, y: 0, rot: 0 },
    { type: 'straight', x: 0, y: 1, rot: 0 },
  ] });
  const { matched, open } = matchPorts(l);
  assert.equal(matched.size, 1);
  assert.equal(open.length, 2);
});

test('open port edges are reported for the boundary walk to skip', () => {
  const l = createLayout({ pieces: [{ type: 'straight', x: 0, y: 0, rot: 0 }] });
  assert.deepEqual([...openEdgeIds(l)].sort(), ['H:0:0', 'H:0:1', 'H:1:0', 'H:1:1']);
});

test('a 2x2 loop of four R30 corners is a closed circuit', () => {
  const l = createLayout({ pieces: fourCornerLoop() });
  assert.deepEqual(findOverlaps(l), []);
  assert.equal(matchPorts(l).open.length, 0);
  assert.equal(isClosedCircuit(l), true);
});

```

Create `test/fixtures.js` in the same step — fixtures must **not** live in a
`.test.js` file, because importing one suite from another makes `node --test`
execute it twice:

```js
// Four R30 corners packed into a 4x4 block. rot 0 exits N and E, so each
// corner is turned to face the two neighbours it must meet.
export function fourCornerLoop() {
  return [
    { type: 'cornerR30', x: 0, y: 0, rot: 90 },   // top-left,  ports E + S
    { type: 'cornerR30', x: 2, y: 0, rot: 180 },  // top-right, ports S + W
    { type: 'cornerR30', x: 2, y: 2, rot: 270 },  // bot-right, ports W + N
    { type: 'cornerR30', x: 0, y: 2, rot: 0 },    // bot-left,  ports N + E
  ];
}
```

and import it at the top of `test/model.test.js`:

```js
import { fourCornerLoop } from './fixtures.js';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `edgeId is not a function`.

Note on the last test: if `fourCornerLoop` does not close, do **not** relax the assertion. Print `matchPorts(l).open` and adjust the four `rot` values until every port matches — the loop is a real geometric fact and it is the fixture the next three tasks depend on. Keep the piece order clockwise from the top-left.

- [ ] **Step 3: Write the implementation**

Append to `js/model.js`:

```js
import { placedPorts } from './geometry.js';

export function edgeId([x, y], dir) {
  switch (dir) {
    case 'N': return `H:${x}:${y}`;
    case 'S': return `H:${x}:${y + 1}`;
    case 'W': return `V:${x}:${y}`;
    case 'E': return `V:${x + 1}:${y}`;
    default: throw new Error(`bad direction: ${dir}`);
  }
}

export const portEdgeIds = (port) => port.cells.map((c) => edgeId(c, port.dir));
export const portKey = (port) => portEdgeIds(port).slice().sort().join('|');

const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

export function matchPorts(layout) {
  const byKey = new Map();
  layout.pieces.forEach((piece, pieceIndex) => {
    for (const port of placedPorts(piece)) {
      const key = portKey(port);
      const bucket = byKey.get(key);
      if (bucket) bucket.push({ pieceIndex, port });
      else byKey.set(key, [{ pieceIndex, port }]);
    }
  });

  const matched = new Set();
  const open = [];
  for (const [key, entries] of byKey) {
    const paired =
      entries.length === 2 && entries[0].port.dir === OPPOSITE[entries[1].port.dir];
    if (paired) matched.add(key);
    else open.push(...entries);
  }
  return { matched, open };
}

// Edges of unmatched ports. These are openings, not walls, so the
// boundary walk must not put a barrier on them.
export function openEdgeIds(layout) {
  const ids = new Set();
  for (const { port } of matchPorts(layout).open) {
    for (const id of portEdgeIds(port)) ids.add(id);
  }
  return ids;
}

export function isClosedCircuit(layout) {
  if (layout.pieces.length === 0) return false;
  if (findOverlaps(layout).length > 0) return false;
  if (matchPorts(layout).open.length > 0) return false;
  return isSingleComponent(layout);
}

function isSingleComponent(layout) {
  const cells = occupiedSet(layout);
  const first = cells.values().next().value;
  if (!first) return false;
  const seen = new Set([first]);
  const queue = [parseCellKey(first)];
  while (queue.length > 0) {
    const [x, y] = queue.pop();
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      const key = cellKey([nx, ny]);
      if (cells.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push([nx, ny]);
      }
    }
  }
  return seen.size === cells.size;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add js/model.js test/model.test.js
git commit -m "feat(model): port matching and closed-circuit detection"
```

---

### Task 5: The boundary walk

**Files:**
- Modify: `js/model.js`
- Modify: `test/model.test.js`

**Interfaces:**
- Consumes: `placedWalls`, `occupiedSet`, `openEdgeIds`, `edgeId` from Tasks 2–4.
- Produces: `boundaryEdges(layout) -> Set<string>`, `arcEdgeIds(wall) -> string[]`, `computeBarriers(layout) -> {counts: {straight, curve, curveLarge, cornerCap}, straightEdgeIds: string[], arcs: wall[]}`.

This is the only place in the codebase that counts a barrier. Three rules:

1. A boundary edge is one where a mat sits on exactly one side. Edges belonging to an **unmatched port** are openings, not walls, and are excluded — otherwise every half-built layout would be quoted a wall across its own entrance.
2. An `arc` override consumes `r` edges along each of the two sides meeting at its corner and replaces them with one curve barrier; `arcLarge` consumes `2 + 2` and yields two large curve halves. An override only applies if **every** edge it claims is actually on the boundary, so an arc that has been built over by a neighbouring piece is silently ignored rather than corrupting the count.
3. A cap counts only at a genuinely **concave** corner — exactly three of the four cells around its vertex occupied. A lone corner piece has open ends on both sides of its apex and needs no cap; four corners packed into a solid block have no concave corner at all.

- [ ] **Step 1: Write the failing test**

Append to `test/model.test.js`:

```js
import { boundaryEdges, arcEdgeIds, computeBarriers } from '../js/model.js';

test('a lone straight is walled on its two long sides only', () => {
  const l = createLayout({ pieces: [{ type: 'straight', x: 0, y: 0, rot: 0 }] });
  assert.deepEqual([...boundaryEdges(l)].sort(), ['V:0:0', 'V:2:0']);
  const { counts } = computeBarriers(l);
  assert.deepEqual(counts, { straight: 2, curve: 0, curveLarge: 0, cornerCap: 0 });
});

test('an arc claims r edges along each side of its corner', () => {
  assert.deepEqual(
    arcEdgeIds({ kind: 'arc', r: 1, cell: [0, 1], corner: 'SW' }).sort(),
    ['H:0:2', 'V:0:1'],
  );
  assert.deepEqual(
    arcEdgeIds({ kind: 'arcLarge', r: 2, cell: [0, 2], corner: 'SW' }).sort(),
    ['H:0:3', 'H:1:3', 'V:0:1', 'V:0:2'],
  );
});

test('four corners packed solid have curves but no caps', () => {
  const l = createLayout({ pieces: fourCornerLoop() });
  const { counts } = computeBarriers(l);
  assert.deepEqual(counts, { straight: 8, curve: 4, curveLarge: 0, cornerCap: 0 });
});

test('the 7x9 rectangular ring matches its hand-derived figures', () => {
  const l = createLayout({ pieces: rectangularRing() });
  assert.deepEqual(findOverlaps(l), []);
  assert.equal(isClosedCircuit(l), true);
  assert.equal(occupiedSet(l).size, 48);

  // Outer perimeter 2*(7+9)=32 edges, inner hole 2*(3+5)=16, total 48.
  // Four arcs consume 2 edges each, leaving 40 straights. The hole's four
  // corners are concave, so four caps.
  const { counts } = computeBarriers(l);
  assert.deepEqual(counts, { straight: 40, curve: 4, curveLarge: 0, cornerCap: 4 });
});

```

Add to `test/fixtures.js` and import it in `test/model.test.js` alongside
`fourCornerLoop`:

```js
// Outer 7x9, hole 3x5, corridor 2 mats wide, 48 mats.
// Corner rotations: rot 0 exits N and E, so each corner is rotated to face
// the two neighbours it must meet.
export function rectangularRing() {
  const pieces = [
    { type: 'cornerR30', x: 0, y: 0, rot: 90 },   // top-left,  ports E + S
    { type: 'cornerR30', x: 5, y: 0, rot: 180 },  // top-right, ports S + W
    { type: 'cornerR30', x: 5, y: 7, rot: 270 },  // bot-right, ports W + N
    { type: 'cornerR30', x: 0, y: 7, rot: 0 },    // bot-left,  ports N + E
  ];
  for (const x of [2, 3, 4]) {
    pieces.push({ type: 'straight', x, y: 0, rot: 90 });
    pieces.push({ type: 'straight', x, y: 7, rot: 90 });
  }
  for (const y of [2, 3, 4, 5, 6]) {
    pieces.push({ type: 'straight', x: 0, y, rot: 0 });
    pieces.push({ type: 'straight', x: 5, y, rot: 0 });
  }
  return pieces;
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `boundaryEdges is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `js/model.js`. Merge this import into the existing `./geometry.js`
import at the top of the file rather than adding a second import statement —
by Task 6 `model.js` needs `placedCells`, `placedPorts`, `placedWalls` and
`rotatedDef` from it, and they belong on one line.

```js
import { placedWalls } from './geometry.js';

const NEIGHBOUR = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

// For each corner, the two edges meeting there and the direction each
// one runs as you walk away from the corner.
const CORNER_EDGES = {
  NE: [['N', [-1, 0]], ['E', [0, 1]]],
  SE: [['S', [-1, 0]], ['E', [0, -1]]],
  SW: [['S', [1, 0]], ['W', [0, -1]]],
  NW: [['N', [1, 0]], ['W', [0, 1]]],
};

export function boundaryEdges(layout) {
  const cells = occupiedSet(layout);
  const open = openEdgeIds(layout);
  const edges = new Set();
  for (const key of cells) {
    const [x, y] = parseCellKey(key);
    for (const dir of ['N', 'E', 'S', 'W']) {
      const [dx, dy] = NEIGHBOUR[dir];
      if (cells.has(cellKey([x + dx, y + dy]))) continue;
      const id = edgeId([x, y], dir);
      if (open.has(id)) continue;
      edges.add(id);
    }
  }
  return edges;
}

export function arcEdgeIds(wall) {
  const ids = [];
  for (const [dir, [sx, sy]] of CORNER_EDGES[wall.corner]) {
    for (let i = 0; i < wall.r; i++) {
      ids.push(edgeId([wall.cell[0] + sx * i, wall.cell[1] + sy * i], dir));
    }
  }
  return ids;
}

// A cap belongs at a concave corner: three of the four cells around the
// vertex occupied, one empty.
function isConcaveVertex(cells, [vx, vy]) {
  const around = [[vx - 1, vy - 1], [vx, vy - 1], [vx - 1, vy], [vx, vy]];
  return around.filter((c) => cells.has(cellKey(c))).length === 3;
}

export function computeBarriers(layout) {
  const edges = boundaryEdges(layout);
  const cells = occupiedSet(layout);
  const counts = { straight: 0, curve: 0, curveLarge: 0, cornerCap: 0 };
  const arcs = [];

  for (const piece of layout.pieces) {
    for (const wall of placedWalls(piece)) {
      if (wall.kind === 'cap') {
        if (isConcaveVertex(cells, wall.vertex)) counts.cornerCap += 1;
        continue;
      }
      const claimed = arcEdgeIds(wall);
      if (!claimed.every((id) => edges.has(id))) continue;
      for (const id of claimed) edges.delete(id);
      if (wall.kind === 'arc') counts.curve += 1;
      else counts.curveLarge += 2;
      arcs.push(wall);
    }
  }

  counts.straight = edges.size;
  return { counts, straightEdgeIds: [...edges], arcs };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 28 tests.

- [ ] **Step 5: Commit**

```bash
git add js/model.js test/model.test.js
git commit -m "feat(model): boundary walk deriving barriers from mats"
```

---

### Task 6: Metrics

**Files:**
- Modify: `js/model.js`
- Modify: `test/model.test.js`

**Interfaces:**
- Consumes: `occupiedSet`, `rotatedDef` from Tasks 1–3.
- Produces: `computeMetrics(layout) -> {bbox: {x, y, w, h} | null, matCount: number, mats: {square?, quarterRound?, arcLarge?}, lapMm: number}`. `bbox` is in mats; `lapMm` in millimetres.

- [ ] **Step 1: Write the failing test**

Append to `test/model.test.js`:

```js
import { computeMetrics } from '../js/model.js';
import { MAT_MM } from '../js/geometry.js';

test('an empty layout has no bounding box', () => {
  const m = computeMetrics(createLayout());
  assert.equal(m.bbox, null);
  assert.equal(m.matCount, 0);
  assert.equal(m.lapMm, 0);
});

test('the 7x9 ring measures 7 by 9 mats and 48 mats of material', () => {
  const m = computeMetrics(createLayout({ pieces: rectangularRing() }));
  assert.deepEqual(m.bbox, { x: 0, y: 0, w: 7, h: 9 });
  assert.equal(m.matCount, 48);
  assert.deepEqual(m.mats, { square: 44, quarterRound: 4 });
});

test('lap length sums piece centrelines', () => {
  const m = computeMetrics(createLayout({ pieces: rectangularRing() }));
  const expected = 16 * MAT_MM + 4 * (Math.PI / 2) * MAT_MM;
  assert.ok(Math.abs(m.lapMm - expected) < 1e-6, `${m.lapMm} vs ${expected}`);
});

test('mat totals equal the occupied cell count', () => {
  const m = computeMetrics(createLayout({ pieces: rectangularRing() }));
  const summed = Object.values(m.mats).reduce((a, b) => a + b, 0);
  assert.equal(summed, m.matCount);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `computeMetrics is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `js/model.js`:

```js
import { rotatedDef } from './geometry.js';

export function computeMetrics(layout) {
  const cells = [...occupiedSet(layout)].map(parseCellKey);

  const bbox = cells.length === 0 ? null : (() => {
    const xs = cells.map((c) => c[0]);
    const ys = cells.map((c) => c[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 };
  })();

  const mats = {};
  let lapMm = 0;
  for (const piece of layout.pieces) {
    const def = rotatedDef(piece.type, piece.rot);
    for (const [kind, n] of Object.entries(def.mats)) {
      mats[kind] = (mats[kind] ?? 0) + n;
    }
    lapMm += def.centrelineMm;
  }

  return { bbox, matCount: cells.length, mats, lapMm };
}
```

Note: `matCount` counts occupied cells while `mats` sums declared mats. They differ exactly when pieces overlap, which `findOverlaps` already flags — the test above asserts they agree on a valid layout.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 32 tests.

- [ ] **Step 5: Commit**

```bash
git add js/model.js test/model.test.js
git commit -m "feat(model): bounding box, mat totals and lap length"
```

---

### Task 7: Inventory, bill of materials and kit recommendation

**Files:**
- Create: `js/inventory.js`
- Create: `test/inventory.test.js`

**Interfaces:**
- Consumes: `computeBarriers`, `computeMetrics` from Tasks 5–6.
- Produces: `KITS: object`, `MOUNT_POINTS: object`, `emptyStock() -> stock`, `stockFromKits({[kitId]: count}) -> stock`, `billOfMaterials(layout) -> {mats, barriers, joints: {a, b}}`, `diffStock(bom, stock) -> [{part, label, owned, used, short}]`, `recommendKit(shortfall, kits?) -> {id, name} | null`.

A `stock` is `{mats: {square, quarterRound, arcLarge}, barriers: {straight, curve, curveLarge, cornerCap}, joints: {a, b}}` with every key present and numeric.

Joint counts come from the mounting holes drawn in the manuals: a straight barrier and a curve barrier have two each, a corner cap has one, and each large curve half has two. That reconciles the starter set exactly — `36*2 + 6*2 + 6*1 = 90`, which is the 90 Joint A and 90 Joint B it ships. The test below asserts that identity, because it is the one independent check available on the joint figures.

- [ ] **Step 1: Write the failing test**

`test/inventory.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout } from '../js/model.js';
import {
  KITS, MOUNT_POINTS, emptyStock, stockFromKits,
  billOfMaterials, diffStock, recommendKit,
} from '../js/inventory.js';
import { rectangularRing } from './fixtures.js';

test('the starter kit contents reconcile with its joint count', () => {
  const k = KITS['87033'];
  assert.equal(k.mats.square + k.mats.quarterRound, 48);
  const mounts =
    k.barriers.straight * MOUNT_POINTS.straight +
    k.barriers.curve * MOUNT_POINTS.curve +
    k.barriers.cornerCap * MOUNT_POINTS.cornerCap;
  assert.equal(mounts, 90);
  assert.equal(k.joints.a, 90);
  assert.equal(k.joints.b, 90);
});

test('the large corner kit ships no caps and no straights', () => {
  const k = KITS['87033-02'];
  assert.equal(k.barriers.straight ?? 0, 0);
  assert.equal(k.barriers.cornerCap ?? 0, 0);
  assert.equal(k.barriers.curveLarge, 8);
  assert.equal(k.mats.square + k.mats.arcLarge, 12);
});

test('an empty stock has every part at zero', () => {
  const s = emptyStock();
  assert.equal(s.mats.square, 0);
  assert.equal(s.barriers.curveLarge, 0);
  assert.equal(s.joints.a, 0);
});

test('stock accumulates across kits', () => {
  const s = stockFromKits({ '87033': 1, '87033-02': 2 });
  assert.equal(s.mats.square, 42 + 8);
  assert.equal(s.mats.arcLarge, 16);
  assert.equal(s.barriers.straight, 36);
  assert.equal(s.joints.a, 90 + 32);
});

test('the bill of materials for the 7x9 ring', () => {
  const bom = billOfMaterials(createLayout({ pieces: rectangularRing() }));
  assert.deepEqual(bom.mats, { square: 44, quarterRound: 4 });
  assert.deepEqual(bom.barriers, { straight: 40, curve: 4, curveLarge: 0, cornerCap: 4 });
  assert.equal(bom.joints.a, 40 * 2 + 4 * 2 + 4 * 1);
  assert.equal(bom.joints.b, bom.joints.a);
});

test('the diff names shortfalls against one starter set', () => {
  const bom = billOfMaterials(createLayout({ pieces: rectangularRing() }));
  const rows = diffStock(bom, stockFromKits({ '87033': 1 }));
  const straight = rows.find((r) => r.part === 'barriers.straight');
  assert.equal(straight.owned, 36);
  assert.equal(straight.used, 40);
  assert.equal(straight.short, 4);
  const square = rows.find((r) => r.part === 'mats.square');
  assert.equal(square.short, 2);
});

test('a layout inside stock reports no shortfall', () => {
  const bom = billOfMaterials(createLayout({ pieces: [{ type: 'straight', x: 0, y: 0, rot: 0 }] }));
  const rows = diffStock(bom, stockFromKits({ '87033': 1 }));
  assert.equal(rows.filter((r) => r.short > 0).length, 0);
  assert.equal(recommendKit(rows), null);
});

test('the recommendation is the cheapest kit that clears every shortfall', () => {
  const bom = billOfMaterials(createLayout({ pieces: rectangularRing() }));
  const rows = diffStock(bom, stockFromKits({ '87033': 1 }));
  const kit = recommendKit(rows);
  assert.equal(kit.id, '87033-01');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/inventory.js'`.

Note: `rectangularRing` comes from `test/fixtures.js`, created in Task 5 — never import a `.test.js` file from another suite.

- [ ] **Step 3: Write the implementation**

`js/inventory.js`:

```js
import { computeBarriers, computeMetrics } from './model.js';

export const MAT_PARTS = ['square', 'quarterRound', 'arcLarge'];
export const BARRIER_PARTS = ['straight', 'curve', 'curveLarge', 'cornerCap'];

export const PART_LABELS = {
  'mats.square': 'Square mat',
  'mats.quarterRound': 'Quarter-round mat',
  'mats.arcLarge': 'Large-arc mat',
  'barriers.straight': 'Straight barrier',
  'barriers.curve': 'Curve barrier',
  'barriers.curveLarge': 'Large curve half',
  'barriers.cornerCap': 'Corner cap',
  'joints.a': 'Joint A',
  'joints.b': 'Joint B',
};

// Mounting holes per barrier, from the manual drawings. These reconcile
// the starter set exactly: 36*2 + 6*2 + 6*1 = 90 joints of each type.
export const MOUNT_POINTS = { straight: 2, curve: 2, curveLarge: 2, cornerCap: 1 };

export const KITS = {
  '87033': {
    name: 'Circuit 30 Starter, 48 pcs',
    priceRank: 3,
    mats: { square: 42, quarterRound: 6 },
    barriers: { straight: 36, curve: 6, cornerCap: 6 },
    joints: { a: 90, b: 90 },
  },
  '87031': {
    name: 'Circuit 30, 96 pcs',
    priceRank: 4,
    mats: { square: 84, quarterRound: 12 },
    barriers: { straight: 72, curve: 12, cornerCap: 12 },
    joints: { a: 180, b: 180 },
  },
  '87033-01': {
    name: 'Circuit 30 Expansion, 63 pcs',
    priceRank: 2,
    mats: { square: 63 },
    barriers: { straight: 26 },
    joints: { a: 52, b: 52 },
  },
  '87033-02': {
    name: 'Large Corner Expansion, 12 pcs',
    priceRank: 1,
    mats: { square: 4, arcLarge: 8 },
    barriers: { curveLarge: 8 },
    joints: { a: 16, b: 16 },
  },
};

export function emptyStock() {
  const mats = Object.fromEntries(MAT_PARTS.map((p) => [p, 0]));
  const barriers = Object.fromEntries(BARRIER_PARTS.map((p) => [p, 0]));
  return { mats, barriers, joints: { a: 0, b: 0 } };
}

export function stockFromKits(counts) {
  const stock = emptyStock();
  for (const [id, n] of Object.entries(counts)) {
    const kit = KITS[id];
    if (!kit || !n) continue;
    for (const p of MAT_PARTS) stock.mats[p] += (kit.mats[p] ?? 0) * n;
    for (const p of BARRIER_PARTS) stock.barriers[p] += (kit.barriers[p] ?? 0) * n;
    stock.joints.a += kit.joints.a * n;
    stock.joints.b += kit.joints.b * n;
  }
  return stock;
}

export function billOfMaterials(layout) {
  const { mats } = computeMetrics(layout);
  const { counts } = computeBarriers(layout);
  const mounts = BARRIER_PARTS.reduce(
    (total, p) => total + counts[p] * MOUNT_POINTS[p], 0,
  );
  return { mats, barriers: counts, joints: { a: mounts, b: mounts } };
}

const flatten = (bag) => [
  ...MAT_PARTS.map((p) => [`mats.${p}`, bag.mats?.[p] ?? 0]),
  ...BARRIER_PARTS.map((p) => [`barriers.${p}`, bag.barriers?.[p] ?? 0]),
  ['joints.a', bag.joints?.a ?? 0],
  ['joints.b', bag.joints?.b ?? 0],
];

export function diffStock(bom, stock) {
  const owned = Object.fromEntries(flatten(stock));
  return flatten(bom).map(([part, used]) => ({
    part,
    label: PART_LABELS[part],
    owned: owned[part],
    used,
    short: Math.max(0, used - owned[part]),
  }));
}

export function recommendKit(rows, kits = KITS) {
  const shortfalls = rows.filter((r) => r.short > 0);
  if (shortfalls.length === 0) return null;

  const candidates = Object.entries(kits)
    .filter(([, kit]) => shortfalls.every((r) => {
      const [group, part] = r.part.split('.');
      const supplied = group === 'joints' ? kit.joints[part] : (kit[group]?.[part] ?? 0);
      return supplied >= r.short;
    }))
    .sort((a, b) => a[1].priceRank - b[1].priceRank);

  if (candidates.length === 0) return null;
  const [id, kit] = candidates[0];
  return { id, name: kit.name };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 40 tests.

If `recommendKit` returns `87031` rather than `87033-01`, check `priceRank` ordering — lower is cheaper, and the expansion kit must outrank the 96-piece set.

- [ ] **Step 5: Commit**

```bash
git add js/inventory.js test/inventory.test.js
git commit -m "feat(inventory): kit catalog, bill of materials and shortfall diff"
```

---

### Task 8: SVG rendering

**Files:**
- Create: `js/render.js`
- Create: `test/render.test.js`

**Interfaces:**
- Consumes: `placedCells`, `placedWalls`, `MAT_MM` from Tasks 1–2; `computeBarriers`, `computeMetrics`, `findOverlaps` from Tasks 3–6.
- Produces: `MAT_PX: number`, `arcPath(wall) -> string`, `layoutGeometry(layout) -> {mats, lines, arcs, bbox}`, `layoutToSvgString(layout, opts?) -> string`, `drawLayout(svgEl, layout, opts?) -> void`.

`layoutGeometry` is pure and testable in Node; `drawLayout` is the only part that touches the DOM. `layoutToSvgString` builds the standalone markup that `storage.js` embeds, so it must not depend on any stylesheet — it inlines its own `fill` and `stroke`.

The arc maths is the part worth stating exactly. For a wall at cell `[cx, cy]` with corner `K` and radius `r`:

- the corner vertex is `NE (cx+1, cy)`, `SE (cx+1, cy+1)`, `SW (cx, cy+1)`, `NW (cx, cy)`;
- the two endpoints lie `r` mats along each of the corner's two edges, using the same step vectors as `CORNER_EDGES` in `model.js`;
- the arc centre is the corner vertex displaced `r` along **both** step vectors;
- the sweep flag follows from the sign of the cross product of the two endpoint vectors about the centre — do not hard-code it per corner, three of the four cases differ.

- [ ] **Step 1: Write the failing test**

`test/render.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout } from '../js/model.js';
import { arcPath, layoutGeometry, layoutToSvgString } from '../js/render.js';
import { rectangularRing } from './fixtures.js';

test('an R30 arc runs corner to corner of its mat', () => {
  const d = arcPath({ kind: 'arc', r: 1, cell: [0, 1], corner: 'SW' });
  // endpoints (1,2) along the S edge and (0,1) along the W edge, centre (1,1)
  assert.match(d, /^M 1 2 A 1 1 0 0 [01] 0 1$/);
});

test('an R60 arc spans two mats each way', () => {
  const d = arcPath({ kind: 'arcLarge', r: 2, cell: [0, 2], corner: 'SW' });
  assert.match(d, /^M 2 3 A 2 2 0 0 [01] 0 1$/);
});

test('geometry lists one rect per mat and one line per straight barrier', () => {
  const g = layoutGeometry(createLayout({ pieces: rectangularRing() }));
  assert.equal(g.mats.length, 48);
  assert.equal(g.lines.length, 40);
  assert.equal(g.arcs.length, 4);
  assert.deepEqual(g.bbox, { x: 0, y: 0, w: 7, h: 9 });
});

test('the standalone svg string carries a viewBox and no external references', () => {
  const svg = layoutToSvgString(createLayout({ pieces: rectangularRing() }));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /viewBox="/);
  assert.ok(!svg.includes('class='), 'no stylesheet dependency');
  assert.ok(!svg.includes('http://localhost'));
});

test('an empty layout still produces valid svg', () => {
  const svg = layoutToSvgString(createLayout());
  assert.match(svg, /<svg /);
  assert.match(svg, /<\/svg>$/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/render.js'`.

- [ ] **Step 3: Write the implementation**

`js/render.js`:

```js
import { placedCells, placedWalls, MAT_MM } from './geometry.js';
import { computeBarriers, computeMetrics, findOverlaps } from './model.js';

export const MAT_PX = 24;

const CORNER_VERTEX = {
  NE: ([cx, cy]) => [cx + 1, cy],
  SE: ([cx, cy]) => [cx + 1, cy + 1],
  SW: ([cx, cy]) => [cx, cy + 1],
  NW: ([cx, cy]) => [cx, cy],
};

// Same step vectors as CORNER_EDGES in model.js.
const CORNER_STEPS = {
  NE: [[-1, 0], [0, 1]],
  SE: [[-1, 0], [0, -1]],
  SW: [[1, 0], [0, -1]],
  NW: [[1, 0], [0, 1]],
};

export function arcPath(wall) {
  const { r, cell, corner } = wall;
  const [vx, vy] = CORNER_VERTEX[corner](cell);
  const [s1, s2] = CORNER_STEPS[corner];
  const a = [vx + s1[0] * r, vy + s1[1] * r];
  const b = [vx + s2[0] * r, vy + s2[1] * r];
  const c = [vx + (s1[0] + s2[0]) * r, vy + (s1[1] + s2[1]) * r];
  const cross = (a[0] - c[0]) * (b[1] - c[1]) - (a[1] - c[1]) * (b[0] - c[0]);
  const sweep = cross > 0 ? 1 : 0;
  return `M ${a[0]} ${a[1]} A ${r} ${r} 0 0 ${sweep} ${b[0]} ${b[1]}`;
}

function edgeLine(id) {
  const [axis, x, y] = id.split(':');
  const [ix, iy] = [Number(x), Number(y)];
  return axis === 'H'
    ? { x1: ix, y1: iy, x2: ix + 1, y2: iy }
    : { x1: ix, y1: iy, x2: ix, y2: iy + 1 };
}

export function layoutGeometry(layout) {
  const { straightEdgeIds, arcs } = computeBarriers(layout);
  const { bbox } = computeMetrics(layout);
  const overlaps = new Set(findOverlaps(layout));

  const mats = [];
  layout.pieces.forEach((piece, index) => {
    for (const cell of placedCells(piece)) {
      mats.push({ x: cell[0], y: cell[1], pieceIndex: index, overlapping: overlaps.has(`${cell[0]},${cell[1]}`) });
    }
  });

  return {
    mats,
    lines: straightEdgeIds.map(edgeLine),
    arcs: arcs.map((w) => ({ d: arcPath(w), kind: w.kind })),
    bbox: bbox ?? { x: 0, y: 0, w: 0, h: 0 },
  };
}

export function layoutToSvgString(layout, { pad = 1 } = {}) {
  const g = layoutGeometry(layout);
  const vb = [g.bbox.x - pad, g.bbox.y - pad, g.bbox.w + pad * 2, g.bbox.h + pad * 2];
  const mats = g.mats
    .map((m) => `<rect x="${m.x}" y="${m.y}" width="1" height="1" fill="#2b2b2b" stroke="#3d3d3d" stroke-width="0.02"/>`)
    .join('');
  const lines = g.lines
    .map((l) => `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="#f2f2f2" stroke-width="0.12" stroke-linecap="round"/>`)
    .join('');
  const arcs = g.arcs
    .map((a) => `<path d="${a.d}" fill="none" stroke="#f2f2f2" stroke-width="0.12" stroke-linecap="round"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${g.bbox.w * MAT_PX}" height="${g.bbox.h * MAT_PX}">${mats}${lines}${arcs}</svg>`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

export function drawLayout(svgEl, layout, { room = null, ghost = null } = {}) {
  const g = layoutGeometry(layout);
  svgEl.replaceChildren();

  const pad = 4;
  const w = Math.max(g.bbox.w, room?.w ?? 0) + pad * 2;
  const h = Math.max(g.bbox.h, room?.h ?? 0) + pad * 2;
  svgEl.setAttribute('viewBox', `${g.bbox.x - pad} ${g.bbox.y - pad} ${w} ${h}`);

  const grid = el('g', { class: 'grid' });
  for (let x = Math.floor(g.bbox.x - pad); x <= g.bbox.x + w; x++) {
    grid.append(el('line', { x1: x, y1: g.bbox.y - pad, x2: x, y2: g.bbox.y + h, class: 'gridline' }));
  }
  for (let y = Math.floor(g.bbox.y - pad); y <= g.bbox.y + h; y++) {
    grid.append(el('line', { x1: g.bbox.x - pad, y1: y, x2: g.bbox.x + w, y2: y, class: 'gridline' }));
  }
  svgEl.append(grid);

  if (room) {
    svgEl.append(el('rect', { x: 0, y: 0, width: room.w, height: room.h, class: 'room' }));
  }

  const matsG = el('g', { class: 'mats' });
  for (const m of g.mats) {
    matsG.append(el('rect', {
      x: m.x, y: m.y, width: 1, height: 1,
      class: m.overlapping ? 'mat overlap' : 'mat',
      'data-piece': m.pieceIndex,
    }));
  }
  svgEl.append(matsG);

  const wallsG = el('g', { class: 'walls' });
  for (const l of g.lines) wallsG.append(el('line', { ...l, class: 'wall' }));
  for (const a of g.arcs) wallsG.append(el('path', { d: a.d, class: 'wall' }));
  svgEl.append(wallsG);

  if (ghost) {
    const ghostG = el('g', { class: ghost.valid ? 'ghost valid' : 'ghost invalid' });
    for (const [x, y] of ghost.cells) {
      ghostG.append(el('rect', { x, y, width: 1, height: 1 }));
    }
    svgEl.append(ghostG);
  }
}

export { MAT_MM };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 45 tests. `drawLayout` is not exercised in Node and must not be imported at module top level by any test — it references `document` only inside the function body, which is safe.

- [ ] **Step 5: Commit**

```bash
git add js/render.js test/render.test.js
git commit -m "feat(render): svg geometry, arc paths and standalone export markup"
```

---

### Task 9: Save and load a self-contained HTML file

**Files:**
- Create: `js/storage.js`
- Create: `test/storage.test.js`

**Interfaces:**
- Consumes: `layoutToSvgString` from Task 8; `computeMetrics`, `createLayout` from Tasks 3–6; `billOfMaterials` from Task 7.
- Produces: `LAYOUT_SCRIPT_ID = 'layout'`, `exportHtml(layout) -> string`, `extractLayoutJson(html) -> object`, `importHtml(html) -> layout`.

`extractLayoutJson` must not depend on `DOMParser`, so the round-trip is testable in Node: it finds the script block by a regular expression anchored on `id="layout"`. The browser path uses the same function.

`importHtml` rejects an unknown `version` rather than partially applying it, and rejects a layout containing a piece type this build does not know.

- [ ] **Step 1: Write the failing test**

`test/storage.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout } from '../js/model.js';
import { exportHtml, importHtml, extractLayoutJson } from '../js/storage.js';
import { rectangularRing } from './fixtures.js';

const ring = () => createLayout({ pieces: rectangularRing(), room: { w: 12, h: 15 } });

test('the export is a complete html document with an inline svg', () => {
  const html = exportHtml(ring());
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<svg /);
  assert.match(html, /<\/html>\s*$/);
});

test('the export states its dimensions, mat count and lap length', () => {
  const html = exportHtml(ring());
  assert.match(html, /2\.10 m/);
  assert.match(html, /2\.70 m/);
  assert.match(html, /48/);
});

test('the layout json rides along and survives a round trip', () => {
  const before = ring();
  const after = importHtml(exportHtml(before));
  assert.deepEqual(after, before);
});

test('the json block is found without a DOM', () => {
  const data = extractLayoutJson(exportHtml(ring()));
  assert.equal(data.version, 1);
  assert.equal(data.pieces.length, 20);
});

test('a future version is rejected outright', () => {
  const html = exportHtml(ring()).replace('"version": 1', '"version": 99');
  assert.throws(() => importHtml(html), /version 99/);
});

test('an unknown piece type is rejected', () => {
  const html = exportHtml(ring()).replace('"straight"', '"loopTheLoop"');
  assert.throws(() => importHtml(html), /loopTheLoop/);
});

test('a file with no layout block is rejected', () => {
  assert.throws(() => importHtml('<!doctype html><html><body>hi</body></html>'), /no layout/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/storage.js'`.

- [ ] **Step 3: Write the implementation**

`js/storage.js`:

```js
import { layoutToSvgString } from './render.js';
import { computeMetrics, createLayout } from './model.js';
import { billOfMaterials, PART_LABELS } from './inventory.js';
import { PIECES, MAT_MM } from './geometry.js';

export const LAYOUT_SCRIPT_ID = 'layout';
export const SUPPORTED_VERSION = 1;

const metres = (mats) => ((mats * MAT_MM) / 1000).toFixed(2);

export function exportHtml(layout) {
  const { bbox, matCount, lapMm } = computeMetrics(layout);
  const bom = billOfMaterials(layout);
  const svg = layoutToSvgString(layout);

  const rows = [
    ...Object.entries(bom.mats).map(([k, v]) => [PART_LABELS[`mats.${k}`], v]),
    ...Object.entries(bom.barriers).map(([k, v]) => [PART_LABELS[`barriers.${k}`], v]),
    ['Joint A', bom.joints.a],
    ['Joint B', bom.joints.b],
  ]
    .filter(([, v]) => v > 0)
    .map(([label, v]) => `<tr><th scope="row">${label}</th><td>${v}</td></tr>`)
    .join('');

  const size = bbox ? `${metres(bbox.w)} m &times; ${metres(bbox.h)} m` : 'empty';

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Circuit 30 layout</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 2rem; background: #fafafa; color: #222; }
  svg { max-width: 100%; height: auto; background: #fff; border: 1px solid #ddd; }
  table { border-collapse: collapse; margin-top: 1rem; }
  th, td { border: 1px solid #ddd; padding: 0.25rem 0.75rem; text-align: left; }
  td { text-align: right; font-variant-numeric: tabular-nums; }
</style>
<h1>Circuit 30 layout</h1>
<figure>
  ${svg}
  <figcaption>${size} &middot; ${matCount} mats &middot; lap ${(lapMm / 1000).toFixed(2)} m</figcaption>
</figure>
<table><caption>Bill of materials</caption><tbody>${rows}</tbody></table>
<p>Open this file in the Circuit 30 Planner to keep editing it.</p>
<script type="application/json" id="${LAYOUT_SCRIPT_ID}">
${JSON.stringify(layout, null, 2)}
</script>
</html>
`;
}

const BLOCK = new RegExp(
  `<script[^>]*id=["']${LAYOUT_SCRIPT_ID}["'][^>]*>([\\s\\S]*?)</script>`,
  'i',
);

export function extractLayoutJson(html) {
  const match = BLOCK.exec(html);
  if (!match) throw new Error('This file has no layout data in it.');
  try {
    return JSON.parse(match[1]);
  } catch (cause) {
    throw new Error('The layout data in this file is not valid JSON.', { cause });
  }
}

export function importHtml(html) {
  const data = extractLayoutJson(html);

  if (data.version !== SUPPORTED_VERSION) {
    throw new Error(
      `This file was saved by a newer planner (version ${data.version}); this build reads version ${SUPPORTED_VERSION}.`,
    );
  }
  if (!Array.isArray(data.pieces)) {
    throw new Error('The layout data has no pieces array.');
  }
  for (const piece of data.pieces) {
    if (!PIECES[piece.type]) throw new Error(`Unknown piece type: ${piece.type}`);
    if (![0, 90, 180, 270].includes(piece.rot)) {
      throw new Error(`Unknown rotation: ${piece.rot}`);
    }
  }

  return createLayout({
    room: data.room ?? null,
    pieces: data.pieces.map(({ type, x, y, rot }) => ({ type, x, y, rot })),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 52 tests.

- [ ] **Step 5: Commit**

```bash
git add js/storage.js test/storage.test.js
git commit -m "feat(storage): self-contained html export and import"
```

---

### Task 10: The application shell

**Files:**
- Create: `index.html`
- Create: `css/app.css`
- Create: `js/app.js`

**Interfaces:**
- Consumes: `drawLayout`, `MAT_PX` from Task 8; `createLayout` from Task 3.
- Produces: the DOM contract every later task depends on. Element ids: `#canvas` (the `<svg>`), `#palette`, `#bom`, `#status`, `#inventory-dialog`, `#room-dialog`, `#presets-dialog`, `#open-input`. Buttons: `#btn-open`, `#btn-save`, `#btn-presets`, `#btn-room`, `#btn-inventory`.

This task has no unit test — its deliverable is a page that loads and draws a hard-coded layout. Verify by eye.

- [ ] **Step 1: Write `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Circuit 30 Planner</title>
  <link rel="stylesheet" href="css/app.css">
</head>
<body>
  <header>
    <h1>Circuit 30 Planner</h1>
    <nav>
      <button type="button" id="btn-open">Open…</button>
      <button type="button" id="btn-save">Save</button>
      <button type="button" id="btn-presets">Presets…</button>
      <button type="button" id="btn-room">Room…</button>
    </nav>
    <input type="file" id="open-input" accept=".html,text/html" hidden>
  </header>

  <aside id="palette" aria-label="Track pieces">
    <h2>Pieces</h2>
    <ul id="palette-list"></ul>
    <button type="button" id="btn-inventory">Edit inventory…</button>
  </aside>

  <main>
    <svg id="canvas" role="application" aria-label="Track layout" tabindex="0"></svg>
    <p id="status" role="status"></p>
  </main>

  <aside id="bom" aria-label="Bill of materials">
    <h2>Materials</h2>
    <table id="bom-table"><tbody></tbody></table>
    <dl id="metrics">
      <dt>Size</dt><dd><output id="out-size">—</output></dd>
      <dt>Lap</dt><dd><output id="out-lap">—</output></dd>
      <dt>Mats</dt><dd><output id="out-mats">—</output></dd>
    </dl>
    <p id="recommendation"></p>
  </aside>

  <dialog id="inventory-dialog"><form method="dialog" id="inventory-form"></form></dialog>
  <dialog id="room-dialog">
    <form method="dialog" id="room-form">
      <p><label>Width (m) <input type="number" name="w" step="0.3" min="0"></label></p>
      <p><label>Depth (m) <input type="number" name="h" step="0.3" min="0"></label></p>
      <menu>
        <button value="clear">No boundary</button>
        <button value="set">Set</button>
      </menu>
    </form>
  </dialog>
  <dialog id="presets-dialog"><ul id="presets-list"></ul>
    <form method="dialog"><button>Close</button></form>
  </dialog>

  <script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `css/app.css`**

Use a three-column CSS grid shell with the header spanning it, a dark canvas, and classes matching what `drawLayout` emits: `.gridline`, `.room`, `.mat`, `.mat.overlap`, `.wall`, `.ghost.valid`, `.ghost.invalid`, `.mat.selected`.

```css
:root { --bg: #1b1b1b; --mat: #2b2b2b; --wall: #f2f2f2; --ok: #4caf50; --bad: #e53935; }
* { box-sizing: border-box; }
body {
  margin: 0; height: 100dvh; display: grid;
  grid-template: auto 1fr / 14rem 1fr 16rem;
  font: 15px/1.5 system-ui, sans-serif;
}
header { grid-column: 1 / -1; display: flex; gap: 1rem; align-items: center;
         padding: 0.5rem 1rem; border-bottom: 1px solid #ddd; }
header h1 { font-size: 1rem; margin: 0; margin-right: auto; }
aside { padding: 1rem; overflow-y: auto; border-inline: 1px solid #ddd; }
main { display: grid; grid-template-rows: 1fr auto; min-width: 0; }
#canvas { width: 100%; height: 100%; background: var(--bg); touch-action: none; }
#palette ul { list-style: none; padding: 0; }
#palette li { padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px;
              margin-bottom: 0.5rem; cursor: grab; display: flex;
              justify-content: space-between; align-items: center; }
#palette li:has(+ *) { user-select: none; }
#bom table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
#bom td { text-align: right; }
#bom tr.short { color: var(--bad); font-weight: 600; }

.gridline { stroke: #333; stroke-width: 0.02; }
.room { fill: none; stroke: #888; stroke-width: 0.06; stroke-dasharray: 0.3 0.2; }
.mat { fill: var(--mat); stroke: #3d3d3d; stroke-width: 0.02; }
.mat.selected { fill: #3a4a5a; }
.mat.overlap { fill: var(--bad); }
.wall { stroke: var(--wall); stroke-width: 0.12; fill: none; stroke-linecap: round; }
.ghost rect { opacity: 0.5; }
.ghost.valid rect { fill: var(--ok); }
.ghost.invalid rect { fill: var(--bad); }
```

- [ ] **Step 3: Write a minimal `js/app.js` that draws something**

```js
import { createLayout } from './model.js';
import { drawLayout } from './render.js';
import { PIECES } from './geometry.js';

const canvas = document.querySelector('#canvas');

const state = {
  layout: createLayout({ pieces: [{ type: 'cornerR30', x: 0, y: 0, rot: 0 }] }),
};

function renderPalette() {
  const list = document.querySelector('#palette-list');
  list.replaceChildren(...Object.entries(PIECES).map(([type, def]) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.type = type;
    li.textContent = def.label;
    return li;
  }));
}

export function render() {
  drawLayout(canvas, state.layout, { room: state.layout.room });
}

renderPalette();
render();
```

- [ ] **Step 4: Verify by eye**

Run: `npm run serve`, open `http://localhost:8000`.
Expected: a three-column page, the palette listing Straight / Corner R30 / Corner R60, and one corner piece drawn on a dark grid with two white walls and an arc. The arc must bulge **outward** at the bottom-left of the 2×2 block. If it bulges the wrong way the sweep flag is inverted — fix `arcPath`, not the CSS.

- [ ] **Step 5: Commit**

```bash
git add index.html css/app.css js/app.js
git commit -m "feat(app): semantic shell, stylesheet and first render"
```

---

### Task 11: Placing pieces from the palette

**Files:**
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `render` from Task 10; `placedCells` from Task 2; `findOverlaps` from Task 3.
- Produces: `state.tool: {type, rot} | null`, `commit(mutator)`, `pointerCell(event) -> [x, y]`.

Native HTML Drag and Drop carries the piece type from the palette; a `dragover` listener on the SVG updates the ghost. **R** during a drag rotates it. Rotation must be tracked in `state.tool.rot` rather than read from the drag event, since `dragover` fires without keyboard state.

- [ ] **Step 1: Add placement to `js/app.js`**

```js
import { placedCells } from './geometry.js';
import { findOverlaps, occupiedSet, cellKey } from './model.js';
import { MAT_PX } from './render.js';

state.tool = null;     // { type, rot }
state.ghost = null;    // { cells, valid }
state.history = [];

export function commit(mutate) {
  state.history.push(structuredClone(state.layout));
  mutate(state.layout);
  render();
}

export function pointerCell(event) {
  const pt = new DOMPoint(event.clientX, event.clientY)
    .matrixTransform(canvas.getScreenCTM().inverse());
  return [Math.floor(pt.x), Math.floor(pt.y)];
}

function ghostFor(type, rot, [x, y]) {
  const cells = placedCells({ type, x, y, rot });
  const taken = occupiedSet(state.layout);
  return { cells, valid: !cells.some((c) => taken.has(cellKey(c))) };
}

document.querySelector('#palette-list').addEventListener('dragstart', (e) => {
  const type = e.target.dataset.type;
  if (!type) return;
  state.tool = { type, rot: 0 };
  e.dataTransfer.setData('text/plain', type);
  e.dataTransfer.effectAllowed = 'copy';
});

canvas.addEventListener('dragover', (e) => {
  if (!state.tool) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  state.ghost = ghostFor(state.tool.type, state.tool.rot, pointerCell(e));
  drawLayout(canvas, state.layout, { room: state.layout.room, ghost: state.ghost });
});

canvas.addEventListener('dragleave', () => { state.ghost = null; render(); });

canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!state.tool || !state.ghost?.valid) { state.ghost = null; render(); return; }
  const [x, y] = pointerCell(e);
  const { type, rot } = state.tool;
  commit((l) => l.pieces.push({ type, x, y, rot }));
  state.ghost = null;
  state.lastPlaced = { type, rot, x, y };
  render();
});

document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'r') return;
  if (state.tool) {
    state.tool.rot = (state.tool.rot + 90) % 360;
    if (state.ghost) render();
  }
});
```

- [ ] **Step 2: Verify by eye**

Run: `npm run serve`.
Expected: dragging "Straight" over the canvas shows a green two-cell ghost that follows the pointer and snaps to whole mats; pressing **R** mid-drag turns it vertical; dropping it adds a piece with two walls; dragging over an existing piece turns the ghost red and dropping there does nothing.

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat(app): drag pieces from the palette onto the grid"
```

---

### Task 12: Selecting, moving, rotating, deleting and undo

**Files:**
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `commit`, `pointerCell` from Task 11.
- Produces: `state.selected: number | null`, `undo()`.

Placed pieces move with Pointer Events, not drag and drop, so the ghost stays live. `setPointerCapture` keeps the drag alive when the pointer leaves the piece.

- [ ] **Step 1: Add editing to `js/app.js`**

```js
canvas.addEventListener('pointerdown', (e) => {
  const rect = e.target.closest('.mat');
  if (!rect) { state.selected = null; render(); return; }

  const index = Number(rect.dataset.piece);
  state.selected = index;
  const piece = state.layout.pieces[index];
  const [cx, cy] = pointerCell(e);
  const grab = { dx: piece.x - cx, dy: piece.y - cy, index, moved: false };
  canvas.setPointerCapture(e.pointerId);

  const onMove = (ev) => {
    const [nx, ny] = pointerCell(ev);
    const next = { ...piece, x: nx + grab.dx, y: ny + grab.dy };
    if (next.x === piece.x && next.y === piece.y) return;
    if (!grab.moved) { state.history.push(structuredClone(state.layout)); grab.moved = true; }
    state.layout.pieces[grab.index] = next;
    render();
  };
  const onUp = () => {
    canvas.releasePointerCapture(e.pointerId);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
});

export function undo() {
  const previous = state.history.pop();
  if (previous) { state.layout = previous; state.selected = null; render(); }
}

document.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input, textarea, select');
  if (typing) return;

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  if (state.selected === null) return;

  if (e.key.toLowerCase() === 'r' && !state.tool) {
    e.preventDefault();
    commit((l) => {
      const p = l.pieces[state.selected];
      p.rot = (p.rot + 90) % 360;
    });
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    const index = state.selected;
    state.selected = null;
    commit((l) => l.pieces.splice(index, 1));
  }
});
```

Add to `drawLayout`'s mat class in `js/render.js` so selection is visible — pass `selected` through the options and add `selected` to the class list when `m.pieceIndex === selected`.

- [ ] **Step 2: Verify by eye**

Expected: clicking a piece tints it; dragging moves it a mat at a time; **R** rotates the selection in place; **Delete** removes it; **Ctrl/Cmd+Z** steps back through every one of those, including a whole drag as one step.

- [ ] **Step 3: Commit**

```bash
git add js/app.js js/render.js
git commit -m "feat(app): select, move, rotate, delete and undo"
```

---

### Task 13: Chaining pieces — drag-to-extend and auto-advance

**Files:**
- Modify: `js/model.js`
- Modify: `test/model.test.js`
- Modify: `js/app.js`
- Modify: `js/render.js`

**Interfaces:**
- Consumes: `matchPorts`, `rotatedDef`, `placedPorts` from Tasks 1–4.
- Produces: `placeAgainst(port, type, rot) -> {type, x, y, rot} | null`, `openPorts(layout) -> [{pieceIndex, port}]`.

One pure function carries both features. Given an **open port** and a piece type and rotation, `placeAgainst` returns where that piece must sit for its opposite-facing port to meet the given one. Drag-to-extend calls it repeatedly along a drag; auto-advance calls it once after every placement.

- [ ] **Step 1: Write the failing test**

Append to `test/model.test.js`:

```js
import { placeAgainst, openPorts } from '../js/model.js';

test('a straight is placed to meet a southward port', () => {
  const port = { cells: [[0, 0], [1, 0]], dir: 'S' };
  assert.deepEqual(placeAgainst(port, 'straight', 0), { type: 'straight', x: 0, y: 1, rot: 0 });
});

test('a straight is placed to meet an eastward port', () => {
  const port = { cells: [[0, 0], [0, 1]], dir: 'E' };
  assert.deepEqual(placeAgainst(port, 'straight', 90), { type: 'straight', x: 1, y: 0, rot: 90 });
});

test('placing against a port actually closes that port', () => {
  const first = { type: 'straight', x: 0, y: 0, rot: 0 };
  const l = createLayout({ pieces: [first] });
  const south = openPorts(l).find(({ port }) => port.dir === 'S').port;
  const next = placeAgainst(south, 'straight', 0);
  l.pieces.push(next);
  assert.equal(matchPorts(l).matched.size, 1);
  assert.equal(openPorts(l).length, 2);
});

test('a rotation with no opposing port yields null', () => {
  const port = { cells: [[0, 0], [1, 0]], dir: 'S' };
  assert.equal(placeAgainst(port, 'straight', 90), null);
});

test('a closed circuit has no open ports', () => {
  assert.equal(openPorts(createLayout({ pieces: rectangularRing() })).length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `placeAgainst is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `js/model.js`:

```js
export const openPorts = (layout) => matchPorts(layout).open;

const sortCells = (cells) => [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

export function placeAgainst(port, type, rot) {
  const want = OPPOSITE[port.dir];
  const mate = rotatedDef(type, rot).ports.find((p) => p.dir === want);
  if (!mate) return null;

  const [dx, dy] = NEIGHBOUR[port.dir];
  const target = sortCells(port.cells.map(([x, y]) => [x + dx, y + dy]));
  const local = sortCells(mate.cells);

  return {
    type,
    rot,
    x: target[0][0] - local[0][0],
    y: target[0][1] - local[0][1],
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 57 tests.

- [ ] **Step 5: Wire drag-to-extend and auto-advance into `js/app.js`**

```js
import { openPorts, placeAgainst } from './model.js';

// Auto-advance: after any placement, ghost the same piece at its open port.
function advanceGhost() {
  const last = state.lastPlaced;
  if (!last) { state.ghost = null; return; }
  const index = state.layout.pieces.length - 1;
  const stillOpen = openPorts(state.layout).filter((o) => o.pieceIndex === index);
  const forward = stillOpen.at(-1);
  if (!forward) { state.ghost = null; return; }
  const next = placeAgainst(forward.port, last.type, last.rot);
  if (!next) { state.ghost = null; return; }
  state.pending = next;
  state.ghost = ghostFor(next.type, next.rot, [next.x, next.y]);
}

document.addEventListener('keydown', (e) => {
  if ((e.key !== ' ' && e.key !== 'Enter') || !state.pending) return;
  if (e.target.matches('input, textarea, select')) return;
  e.preventDefault();
  const next = state.pending;
  commit((l) => l.pieces.push(next));
  state.lastPlaced = next;
  advanceGhost();
  render();
});

// Drag-to-extend: press an open-port handle and drag to lay a run.
canvas.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.port-handle');
  if (!handle) return;
  e.stopPropagation();

  const origin = openPorts(state.layout)[Number(handle.dataset.port)];
  const baseline = structuredClone(state.layout);
  let laid = 0;
  canvas.setPointerCapture(e.pointerId);

  const onMove = (ev) => {
    const [cx, cy] = pointerCell(ev);
    const [ox, oy] = origin.port.cells[0];
    const wanted = Math.max(0, Math.abs(cx - ox) + Math.abs(cy - oy) - 1);
    if (wanted === laid) return;

    state.layout = structuredClone(baseline);
    laid = 0;
    for (let i = 0; i < wanted; i++) {
      const tip = openPorts(state.layout).find(
        (o) => o.port.dir === origin.port.dir,
      );
      if (!tip) break;
      const next = placeAgainst(tip.port, 'straight', origin.port.dir === 'N' || origin.port.dir === 'S' ? 0 : 90);
      if (!next) break;
      state.layout.pieces.push(next);
      laid += 1;
    }
    render();
  };
  const onUp = () => {
    canvas.releasePointerCapture(e.pointerId);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    if (laid > 0) state.history.push(baseline);
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
});
```

Call `advanceGhost()` at the end of the existing `drop` handler, replacing the bare `state.ghost = null`.

- [ ] **Step 6: Draw the handles in `js/render.js`**

In `drawLayout`, after the walls group, append one circle per open port at the midpoint of its two cells, offset half a mat outward along its direction:

```js
if (handles) {
  const g = el('g', { class: 'handles' });
  openPorts(layout).forEach(({ port }, i) => {
    const [dx, dy] = { N: [0, -0.5], S: [0, 0.5], E: [0.5, 0], W: [-0.5, 0] }[port.dir];
    const cx = (port.cells[0][0] + port.cells[1][0]) / 2 + 0.5 + dx;
    const cy = (port.cells[0][1] + port.cells[1][1]) / 2 + 0.5 + dy;
    g.append(el('circle', { cx, cy, r: 0.22, class: 'port-handle', 'data-port': i }));
  });
  svgEl.append(g);
}
```

Add `.port-handle { fill: var(--ok); opacity: 0.7; cursor: grab; } .port-handle:hover { opacity: 1; }` to `css/app.css`.

- [ ] **Step 7: Verify by eye**

Expected: every open end shows a green dot. Dragging one lays straights that follow the pointer and disappear when you drag back; releasing leaves one undo step for the whole run. After dropping a straight, a ghost appears at its far end and **Space** places it and advances, so a long straight is one drag or one held key.

- [ ] **Step 8: Commit**

```bash
git add js/model.js test/model.test.js js/app.js js/render.js css/app.css
git commit -m "feat(app): drag-to-extend runs and auto-advance chaining"
```

---

### Task 14: The materials panel, inventory, room and file handling

**Files:**
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `billOfMaterials`, `diffStock`, `stockFromKits`, `recommendKit`, `KITS` from Task 7; `exportHtml`, `importHtml` from Task 9; `computeMetrics`, `isClosedCircuit`, `openPorts` from Tasks 4–6.
- Produces: `state.kits: {[kitId]: number}`, `renderBom()`, `renderStatus()`.

- [ ] **Step 1: Add the panel and dialogs to `js/app.js`**

```js
import { billOfMaterials, diffStock, stockFromKits, recommendKit, KITS } from './inventory.js';
import { exportHtml, importHtml } from './storage.js';
import { computeMetrics, isClosedCircuit, openPorts } from './model.js';
import { MAT_MM } from './geometry.js';

state.kits = { '87033': 1 };

const metres = (mats) => ((mats * MAT_MM) / 1000).toFixed(2);

function renderBom() {
  const bom = billOfMaterials(state.layout);
  const rows = diffStock(bom, stockFromKits(state.kits)).filter((r) => r.used > 0 || r.owned > 0);

  document.querySelector('#bom-table tbody').replaceChildren(...rows.map((r) => {
    const tr = document.createElement('tr');
    if (r.short > 0) tr.className = 'short';
    tr.innerHTML = `<th scope="row">${r.label}</th><td>${r.owned}</td><td>${r.used}</td>`;
    return tr;
  }));

  const kit = recommendKit(rows);
  document.querySelector('#recommendation').textContent = kit
    ? `Short on pieces — ${kit.name} (${kit.id}) covers it.`
    : 'Everything you need is in stock.';

  const { bbox, matCount, lapMm } = computeMetrics(state.layout);
  document.querySelector('#out-size').value = bbox ? `${metres(bbox.w)} × ${metres(bbox.h)} m` : '—';
  document.querySelector('#out-lap').value = lapMm ? `${(lapMm / 1000).toFixed(2)} m` : '—';
  document.querySelector('#out-mats').value = String(matCount);
}

function renderStatus() {
  const open = openPorts(state.layout).length;
  document.querySelector('#status').textContent =
    state.layout.pieces.length === 0 ? 'Empty — drag a piece from the left.'
    : isClosedCircuit(state.layout) ? 'Closed circuit ✓'
    : `${open} open end${open === 1 ? '' : 's'}`;
}
```

Call `renderBom()` and `renderStatus()` at the end of `render()`.

- [ ] **Step 2: Wire the inventory dialog**

```js
const inventoryDialog = document.querySelector('#inventory-dialog');
document.querySelector('#btn-inventory').addEventListener('click', () => {
  const form = document.querySelector('#inventory-form');
  form.replaceChildren(
    ...Object.entries(KITS).map(([id, kit]) => {
      const p = document.createElement('p');
      p.innerHTML = `<label>${kit.name} (${id})
        <input type="number" name="${id}" min="0" step="1" value="${state.kits[id] ?? 0}"></label>`;
      return p;
    }),
    Object.assign(document.createElement('menu'), {
      innerHTML: '<button value="save">Save</button><button value="cancel" formnovalidate>Cancel</button>',
    }),
  );
  inventoryDialog.showModal();
});

inventoryDialog.addEventListener('close', () => {
  if (inventoryDialog.returnValue !== 'save') return;
  const data = new FormData(document.querySelector('#inventory-form'));
  state.kits = Object.fromEntries([...data].map(([k, v]) => [k, Number(v) || 0]));
  render();
});
```

- [ ] **Step 3: Wire the room dialog**

Read width and depth in metres, convert to whole mats with `Math.round(m * 1000 / MAT_MM)`, store as `state.layout.room`, and set it to `null` when the dialog returns `clear`. Commit through `commit()` so the room change is undoable.

- [ ] **Step 4: Wire save and open**

```js
document.querySelector('#btn-save').addEventListener('click', () => {
  const blob = new Blob([exportHtml(state.layout)], { type: 'text/html' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'circuit30-layout.html',
  });
  a.click();
  URL.revokeObjectURL(a.href);
});

const openInput = document.querySelector('#open-input');
document.querySelector('#btn-open').addEventListener('click', () => openInput.click());
openInput.addEventListener('change', () => loadFile(openInput.files[0]));

async function loadFile(file) {
  if (!file) return;
  try {
    state.history.push(structuredClone(state.layout));
    state.layout = importHtml(await file.text());
    state.selected = null;
    render();
  } catch (error) {
    document.querySelector('#status').textContent = error.message;
  }
}

document.addEventListener('dragover', (e) => {
  if (e.dataTransfer.types.includes('Files')) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  loadFile(e.dataTransfer.files[0]);
});
```

The window-level `drop` must not fire for palette drags. Palette drags set `text/plain`, not `Files`, and the canvas handler calls `stopPropagation()` — add that call if it is missing.

- [ ] **Step 5: Verify by eye**

Expected: the right panel lists owned versus used for every part, turning red and naming a kit when short; the status line switches between open ends and closed circuit; saving downloads an HTML file that opens standalone in a browser and shows the track; dragging that file back onto the page restores it exactly, including the room boundary.

- [ ] **Step 6: Commit**

```bash
git add js/app.js
git commit -m "feat(app): materials panel, inventory, room boundary, save and open"
```

---

### Task 15: Official layout presets

**Files:**
- Create: `js/presets.js`
- Create: `test/presets.test.js`
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `createLayout`, `isClosedCircuit`, `findOverlaps` from Tasks 3–4; `billOfMaterials`, `diffStock`, `stockFromKits` from Task 7; `layoutToSvgString` from Task 8.
- Produces: `PRESETS: [{id, name, source, pieces}]`.

Transcribe from the manuals in `docs/`. Start with the two that are unambiguous, and add the plan A–D layouts only where the grid can actually be counted in the figure. A preset that cannot be read confidently should be left out rather than guessed — a wrong preset silently teaches the BOM the wrong thing.

Required at minimum: `rectangularRing` from Task 5 as `id: 'ring-7x9'`, and the stock L from Task 16.

- [ ] **Step 1: Write the failing test**

`test/presets.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../js/presets.js';
import { createLayout, findOverlaps, isClosedCircuit } from '../js/model.js';

test('every preset is a valid, closed, non-overlapping circuit', () => {
  assert.ok(PRESETS.length >= 2);
  for (const preset of PRESETS) {
    const l = createLayout({ pieces: preset.pieces });
    assert.deepEqual(findOverlaps(l), [], `${preset.id} overlaps`);
    assert.equal(isClosedCircuit(l), true, `${preset.id} is not closed`);
  }
});

test('every preset is uniquely identified and attributed', () => {
  const ids = PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of PRESETS) {
    assert.ok(p.name.length > 0);
    assert.match(p.source, /870\d\d/);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails, then write `js/presets.js`**

Export `PRESETS` as an array of `{id, name, source, pieces}`. Reuse the ring construction from Task 5 rather than pasting 20 literals.

- [ ] **Step 3: Wire the gallery into `js/app.js`**

Populate `#presets-list` with one `<li>` per preset containing a thumbnail (`layoutToSvgString` at a small size), the name, the source part number, and a badge computed by running `diffStock(billOfMaterials(...), stockFromKits(state.kits))` — "Buildable" when nothing is short, otherwise "Short by N pieces" summing `short` across rows. Clicking a preset commits it as the current layout.

- [ ] **Step 4: Verify by eye, then commit**

```bash
git add js/presets.js test/presets.test.js js/app.js
git commit -m "feat(presets): official layout gallery with buildability badges"
```

---

### Task 16: Reconcile the stock L against the 87033 contents

**Files:**
- Modify: `js/presets.js`
- Create: `test/stock-l.test.js`
- Modify: `docs/superpowers/specs/2026-09-09-circuit30-track-planner-design.md`

**Interfaces:**
- Consumes: everything.
- Produces: a preset with `id: 'stock-l'`, and a recorded answer to spec §13.2.

Read spec §13.2 before starting. The published figures for the 87033 layout are **mutually inconsistent** for a 2-mat-wide L ring: corner counts and perimeter agree with the box contents, area does not. This task asserts only what is certain and reports the rest.

- [ ] **Step 1: Transcribe the stock L**

Work from the layout figure in `87032_87052.pdf` page 2. Build it from straights and R30 corners as an L-shaped closed ring, two mats wide. Add it to `PRESETS` as `{id: 'stock-l', name: 'Stock L (87033)', source: '87032/87033', pieces}`.

- [ ] **Step 2: Write the test**

`test/stock-l.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../js/presets.js';
import { createLayout, computeBarriers, computeMetrics, isClosedCircuit } from '../js/model.js';
import { KITS } from '../js/inventory.js';

const stockL = () => createLayout({ pieces: PRESETS.find((p) => p.id === 'stock-l').pieces });

test('the stock L is a closed circuit', () => {
  assert.equal(isClosedCircuit(stockL()), true);
});

test('an L ring needs six quarter-rounds and six caps, as the box ships', () => {
  const { counts } = computeBarriers(stockL());
  const { mats } = computeMetrics(stockL());
  assert.equal(mats.quarterRound, 6);
  assert.equal(counts.cornerCap, 6);
  assert.equal(counts.curve, 6);
});

test('CALIBRATION: report the mat and straight deltas against 87033', () => {
  const { counts } = computeBarriers(stockL());
  const { mats, bbox } = computeMetrics(stockL());
  const kit = KITS['87033'];
  console.log('stock L reconciliation vs 87033');
  console.log('  bounding box   ', `${bbox.w} x ${bbox.h} mats`);
  console.log('  square mats    ', mats.square, 'vs', kit.mats.square);
  console.log('  straights      ', counts.straight, 'vs', kit.barriers.straight);
  // Deliberately not asserted — see spec section 13.2.
  assert.ok(mats.square > 0);
});
```

- [ ] **Step 3: Run it and record the outcome**

Run: `npm test -- --test-name-pattern=CALIBRATION`

Update spec §13.2 with the three printed figures and what they imply. If the transcribed L reproduces 42 square mats and 36 straights, delete §13.2's caveat and tighten this test into hard assertions. If it does not, record the actual figures and leave the caveat, noting that counting the physical set is the way to settle it.

- [ ] **Step 4: Commit**

```bash
git add js/presets.js test/stock-l.test.js docs/superpowers/specs/2026-09-09-circuit30-track-planner-design.md
git commit -m "test: reconcile the stock L against the 87033 contents"
```

---

## Self-Review

**Spec coverage.** §4 model → Task 3. §5 pieces and rotation → Tasks 1–2. §6.1 occupancy → Task 3. §6.2 barriers → Task 5. §6.3 connectivity → Task 4. §6.4 metrics and BOM → Tasks 6–7. §7.1 shell → Task 10. §7.2 SVG → Task 8. §7.3 placement and chaining → Tasks 11, 13. §7.4 editing and undo → Task 12. §7.5 room → Task 14. §8 inventory → Tasks 7, 14. §9 storage → Task 9. §10 presets → Task 15. §11 file structure → Task 1 and the table above. §12 testing → every task. §13.1 R60 footprint → encoded in Task 1, isolated as the spec requires. §13.2 stock L → Task 16.

**Known gaps, accepted deliberately:**

- `drawLayout`, the pointer handlers and the dialogs have no automated tests. The spec says the interaction layer is checked by hand; each of those tasks carries an explicit "verify by eye" step naming what to look for.
- The `arcLarge` geometry rests on spec §13.1, which is provisional. Task 1 keeps it to one object so a correction is a single edit plus a re-run of the suite.
- `recommendKit` finds the cheapest **single** kit that clears every shortfall. It returns `null` when no one kit suffices rather than searching combinations. That is a real limitation and is the natural first extension.

**Test count** rises to 62 across six suites by Task 16. Every task states the expected total so a mismatch surfaces immediately.
