# Kyosho Circuit 30 Track Layout Planner — Design

Date: 2026-09-09

## 1. Purpose

Plan Mini-Z Grand Prix Circuit 30 track layouts before buying extension kits.

The owner has one **87033 Mini-Z Grand Prix Circuit 30 Urethane (48 pcs)** set, which
builds a fixed L-shape. They want to design alternative layouts, see what each one
costs in pieces, and decide which expansion to buy next.

The app is a local tool. It is never deployed. Vanilla JS, no build step, no
dependencies, standards-first.

## 2. Domain

### 2.1 The physical system

Everything sits on a grid of **30 × 30 cm urethane mats**. Foam **barriers** bolt onto
mat edges with Joint A (from above) and Joint B (from below) and define the driving
corridor. The mats are the floor; the barriers are the walls.

Track is **two mats wide**: 60 cm pitch, 47 cm clear between barrier faces. This is
fixed for this project.

A barrier sits **on** the tile it is mounted to and never extends past it, so it does
not push the mats apart and does not change the width of a tile.

**Every lane carries its own barriers. There is no such thing as a shared barrier.**
Where two lanes run alongside each other, each mounts its own wall on its own tile and
the two sit back to back at the seam. That still fits, and both lanes keep the standard
corridor, because each barrier is inside its own lane's 60 cm:

```
lane A:  60 − 6.5 (outer wall) − 6.5 (own inner wall) = 47 cm
lane B:  60 − 6.5 (own inner wall) − 6.5 (outer wall) = 47 cm
```

So an edge where two pieces touch without connecting carries **two** barriers, not one:
two adjacent straights cost **four** straight barriers, and joints scale with them. This
is the single most misunderstood fact in this model — it has been got wrong twice, first
by emitting no barrier there at all, then by emitting one.

It follows that barriers cannot be derived from the outline of the occupied mats alone.
An edge interior to the mat region is still a wall — two walls — when the pieces either
side of it do not connect. `boundaryEdges` in `js/model.js` decides which edges carry a
wall; `computeBarriers` must charge the unjoined contacts twice.

**What this model does and does not claim.** It tracks which edges carry a barrier and
how many — that is what the bill of materials needs. It does not model barrier thickness,
and no computed figure depends on one: mat counts and lap length come from the piece
definitions, joints from the barrier count. The 6.5 cm above is derived from the 60 cm
pitch and 47 cm clear width and is used for nothing in the code.

The renderer draws a barrier as a stroked line centred on the mat edge, so it visually
straddles the seam and two back-to-back barriers draw as one line. For an outer wall that
makes the barrier look thicker than the real part. This is a drawing choice for visual
consistency; it feeds no calculation, and it must not be read as a claim that two lanes
share a wall.

### 2.2 Piece catalog

| Kit | Mats | Barriers | Joints |
| --- | --- | --- | --- |
| 87033 / 87032 starter, 48 pcs | 6 square (joints 4 sides), 36 square (3 sides), 6 quarter-round | 36 straight, 6 corner cap, 6 curve | 90 A + 90 B |
| 87031 / 87051, 96 pcs | 12 / 72 / 12, same three types | 72 straight, 12 corner cap, 12 curve | 180 + 180 |
| 87031-01 / 87033-01 expansion, 62 / 63 pcs | 36 square (4 sides), 26 square (2 holes) — plain only | 26 straight | 52 + 52 |
| 87031-02 / 87033-02 Large Corner, 12 pcs | 4 plain, 4 arc-left, 4 arc-right | 4 + 4 forty-five-degree halves | 16 + 16 |

The starter set builds an L of **2.1 m × 2.7 m** (7 × 9 mats).

### 2.3 The two corner types

Both turn 90°. They differ in the radius, i.e. how many mats the arc is spread over.

- **Regular corner, R30.** One quarter-round mat (a 30 cm mat with a quarter-disc cut,
  arc running corner to corner) plus one 90° curve barrier. The entire turn happens
  within one mat. The inside of the turn is a sharp 90° closed by a small corner cap
  barrier.
- **Wide corner, R60.** Two shaped mats — mirror images, one carrying the arc on its
  left, one on its right — plus two 45° barrier halves laid end to end across them. The
  same 90° spread over two mats. `ラージコーナー` means large *radius*, not large
  footprint: the same turn taken twice as gently so the car keeps speed.

The Large Corner kit ships four corners' worth and its manual states it must be
combined with a base Circuit 30 set.

### 2.4 Sources

- Manual index: https://www.kyosho.com/eng/support/instructionmanual/mini-z_gp_circuit/mini-z_gp_circuit_index.html
- 87032 starter: `pdf/87032_87052.pdf`
- 87031 96 pcs: `pdf/87031_miniz_gp_circuit_30_50_m.pdf`
- 87031-01 expansion: `pdf/87031-01_miniz_gp_circuit_30_exp_62pcs_m.pdf`
- 87031-02 Large Corner: `pdf/87031-02.pdf`

## 3. Scope

In scope:

- Drag-and-drop layout editing on a mat grid, with rotation.
- Live bill of materials against an editable owned-inventory, naming the cheapest kit
  that closes any shortfall.
- A gallery of the official Kyosho plans, each badged buildable or short by N pieces.
- Save and load a self-contained HTML file.
- An optional room boundary to check a layout fits the available floor.

Out of scope for this version:

- Automatic layout generation from an inventory.
- Track widths other than two mats.
- The Circuit 50 range, overbanks, 45° sections.
- Matted infield (see §6.4).
- Any deployment, server, or persistence beyond the exported file.

## 4. Coordinate system and data model

One integer grid. The unit is **1 mat = 300 mm**. Pieces, the room boundary and the
export are all in mat units; millimetres and metres appear only in rendered labels.

The persisted state is the whole model:

```js
{
  version: 1,
  unit: 'mat',                        // 1 mat = 300 mm
  room: { w: 12, h: 15 } | null,      // in mats, null = unbounded
  pieces: [
    { type: 'cornerR30', x: 4, y: 2, rot: 90 },
    { type: 'straight',  x: 4, y: 4, rot: 0  },
  ],
}
```

`rot` is one of 0, 90, 180, 270 degrees clockwise. `x`/`y` locate the piece's local
origin on the grid. Nothing derived is ever stored.

## 5. Piece definitions

The three types are data in `geometry.js`, not code. Each declares its footprint, its
connection ports, its wall geometry and its bill of materials.

Cell coordinates are `[col, row]` with **row increasing downward**, matching SVG. A
**port** is a two-mat-wide opening: the two cells it spans plus an outward compass
direction. Two pieces connect when a port of one spans the same grid edge as an
opposite-facing port of the other.

```js
export const PIECES = {
  straight: {
    label: 'Straight',
    cells: [[0,0],[1,0]],                              // 2 wide × 1 long
    ports: [ { cells:[[0,0],[1,0]], dir:'N' },
             { cells:[[0,0],[1,0]], dir:'S' } ],
    walls: [],                                          // plain edges only
    mats:  { square:2 },
  },

  cornerR30: {                                         // enter N, exit E
    label: 'Corner R30',
    cells: [[0,0],[1,0],[0,1],[1,1]],                  // 2×2
    ports: [ { cells:[[0,0],[1,0]], dir:'N' },
             { cells:[[1,0],[1,1]], dir:'E' } ],
    walls: [ { kind:'arc',  r:1, cell:[0,1], corner:'SW' },  // outside of the turn
             { kind:'cap',  vertex:[2,0] } ],                // inside, sharp 90°
    mats:  { square:3, quarterRound:1 },
  },

  cornerR60: {                                         // enter N, exit E — see §13.1
    label: 'Corner R60',
    cells: [ [0,0],[1,0],                              // 3×3 minus inner cell [2,0]
             [0,1],[1,1],[2,1],
             [0,2],[1,2],[2,2] ],
    ports: [ { cells:[[0,0],[1,0]], dir:'N' },
             { cells:[[2,1],[2,2]], dir:'E' } ],
    walls: [ { kind:'arcLarge', r:2, cell:[0,2], corner:'SW' }, // outside, across 2 mats
             { kind:'cap',      vertex:[2,1] } ],              // inside, sharp 90°
    mats:  { square:6, arcLarge:2 },
  },
};
```

A piece declares **mats only**. Every barrier is produced by the boundary walk (§6.2),
which reads `walls` to learn which stretches of the outline are arcs or caps. Nothing
counts a barrier twice because nothing but the walk counts barriers at all.

Note which corners can be rounded. A **convex** corner of the mat region is rounded by
cutting a mat — that is what a quarter-round mat is. A **concave** corner cannot be
rounded by cutting, so it is closed with a corner-cap barrier and stays a sharp 90°.
The inside of a turn is always concave, so both corner types have a sharp apex; they
differ only in how far the *outer* wall sweeps.

`arcLarge` mats and the large curve barriers come only from the Large Corner kit. Its
plain mats, corner caps and straight barriers come from a base set — which is exactly
why that kit ships no caps and no straights, and why its manual says it cannot be used
alone.

Rotation applies to `cells`, `ports` and `walls` about the local origin, then
normalises so the footprint's minimum cell is at the origin. No other module knows what
a corner is, which keeps §13.1 a one-object edit.

## 6. Derived computations

Recomputed from the model on every change. None of this is persisted.

### 6.1 Occupied cells

The union of every piece's rotated footprint. Two pieces claiming the same cell is an
**overlap error**; both are highlighted and the layout is marked invalid.

### 6.2 Barriers

Walk the boundary of the occupied-cell set. Every 1-mat boundary edge yields one
straight barrier, except where a piece's `walls` entry overrides that stretch:

| override | consumes | yields |
| --- | --- | --- |
| `arc` r1 | one convex corner, one mat of run | 1 curve barrier |
| `arcLarge` r2 | one convex corner, two mats of run | 2 large curve halves |
| `cap` | one concave vertex | 1 corner-cap barrier |

Boundary edges that coincide with a matched port are interior and yield nothing.
Barriers are never placed by hand and are counted in exactly one place, so the drawn
walls and the counted walls cannot disagree.

### 6.3 Connectivity

Match ports pairwise. Unmatched ports are open ends, each drawn with a drag handle
(§7.3). The status line reads `closed circuit` when every port is matched and the
occupied cells form one connected component, otherwise `N open ends`.

### 6.4 Bill of materials and metrics

Sum each piece's `mats`, add the barrier counts from §6.2, and add joints at one Joint
A plus one Joint B per barrier mounting point. Also computed: bounding box in metres, mat count, and lap length as the
centreline sum — 300 mm per straight, `π/2 × 300 ≈ 471` mm per R30 corner.

Mats are laid **under the track corridor only**; the infield is bare floor. Kyosho's own
plans sometimes mat the infield, but with 48 mats you build hollow. Infield fill changes
the mat count and nothing else, so it can become a BOM checkbox later.

## 7. Interface

### 7.1 Structure

Semantic HTML, no framework. `<header>` for the toolbar, `<aside>` for the palette,
`<main>` holding one `<svg>`, `<aside>` for the BOM. `<dialog>` for inventory, room
settings and the preset gallery. `<output>` for every derived number. CSS grid for the
shell; nesting and `:has()` for state styling.

```
┌─ header ────────────────────────────────────────────────┐
│ Circuit 30 Planner    [Open] [Save] [Presets] [Room…]    │
├─ aside (palette) ─┬─ main ──────────────┬─ aside (BOM) ──┤
│ ▭ Straight    ×∞  │                     │ owned  used    │
│ ◜ Corner R30  ×6  │   <svg> grid +      │ mat     42/38 ✓│
│ ◟ Corner R60  ×0  │   pieces + room     │ str.br  36/41 ✗│
│                   │   outline           │ ─────────────  │
│ [edit inventory]  │                     │ 2.1×2.7 m      │
│                   │                     │ lap 8.4 m      │
│                   │                     │ closed ✓       │
└───────────────────┴─────────────────────┴────────────────┘
```

### 7.2 Rendering

SVG, not `<canvas>`. A layout is roughly a hundred mats, well within the DOM's comfort.
It buys real elements with native events, CSS styling, keyboard focus and
accessibility, and it is exactly what the HTML export embeds.

### 7.3 Placing pieces

Drag a palette item onto the canvas using the native HTML Drag and Drop API. A
translucent ghost follows the pointer snapped to the mat grid, green when it fits and
red on overlap. **R** rotates the ghost. Drop commits.

Because a straight is only one mat long, two mechanisms keep long runs cheap:

1. **Drag-to-extend.** Every open port shows a handle. Press and drag it: straights are
   laid continuously along the drag, ghosted, count following the cursor. Release
   commits the whole run as one undo step. Dragging back removes them.
2. **Auto-advance.** After any placement a ghost of the same piece sits at the next
   connecting position. **Space** or **Enter** places it and advances. After a corner
   the ghost sits on its exit port, so a full lap can be chained without returning to
   the palette.

### 7.4 Editing

Pieces already on the canvas are moved with Pointer Events, not the drag-and-drop API,
so the snapping preview stays live. Click selects, pieces are focusable so Tab works,
**R** rotates, **Delete** removes, **Ctrl/Cmd+Z** undoes.

Undo stores whole-model snapshots via `structuredClone`. The model is a few hundred
bytes; snapshotting is simpler and cheaper than a command pattern.

### 7.5 Room boundary

Width and height in metres, set in a `<dialog>`, drawn as a dashed outline behind the
grid. Pieces outside it get a warning tint. This is a warning, not an error — you might
be planning a move.

## 8. Inventory and BOM

`inventory.js` holds owned quantities, seeded from kit presets: tick `1 × 87033
starter` and `1 × 87033-01 expansion` and the counts fill in from §2.2. Quantities stay
editable by hand for odd or second-hand stock.

The BOM panel diffs derived usage against owned stock. When short, it names the
cheapest kit that closes the gap — that is the buying decision, answered live while
drawing.

## 9. Save, load, export

One artifact. `storage.js` writes a self-contained `.html` file containing:

- an inline `<svg>` of the layout, so it opens standalone in any browser,
- a caption with dimensions, mat count, lap length and the BOM,
- `<script type="application/json" id="layout">` carrying the §4 model verbatim.

Loading accepts that same file through a file input and through drop-on-window. The
importer parses the HTML with `DOMParser`, reads the JSON block, and validates
`version` before applying. Unknown future versions are rejected with a clear message
rather than partially loaded.

## 10. Presets

`presets.js` ships the official plans transcribed as piece lists: the stock L from
87032, and plans A–D from both 87031 and 87031-02. The gallery is a `<dialog>` showing
each as a thumbnail with a buildable or short-by-N badge computed against current
inventory. Selecting one loads it into the editor.

## 11. File structure

```
track-layout/
  index.html
  css/app.css
  js/geometry.js    piece definitions, rotation, footprints, arcs
  js/model.js       layout state, mutations, undo, validation
  js/render.js      SVG draw and hit testing
  js/inventory.js   owned stock, BOM diff, kit recommendation
  js/storage.js     HTML export and import
  js/presets.js     official Kyosho plans
  test/*.test.js
  docs/
```

ES modules cannot be imported over `file://`, so the app is served locally:

```
python3 -m http.server
```

The exported layout file is standalone and needs no server.

## 12. Testing

`geometry.js`, `model.js` and `inventory.js` are pure functions over plain data. They
test with `node:test` and zero dependencies:

- rotation of cells, ports and walls through all four angles, and normalisation
- footprint union and overlap detection
- boundary walk producing the expected barrier list, including arc overrides
- port matching, open-end counting, closed-circuit detection
- BOM totals for known layouts. The reference case is a **7 × 9 rectangular ring**,
  every figure of which is derivable by hand: 48 mats (44 square + 4 quarter-round),
  48 boundary edges, 4 curves consuming 8 of them, so 40 straight barriers and 4 corner
  caps. If the walk disagrees with that, the walk is wrong.
- The stock L is a **hard pass/fail** case: its mat count, straight-barrier
  count, bounding box and joint totals must equal the 87033 kit exactly, not just
  its quarter-round/cap/curve counts — see §13.2.
- lap length and bounding box
- round-tripping a layout through export and import

`render.js` and the interaction layer stay thin and are checked by hand.

## 13. Provisional decisions and open questions

### 13.1 Large corner geometry

`cornerR60` is the **complete placeable corner**, not the kit's contribution.
It occupies a 3 x 3 block with the inner cell swept away — 8 mats — and derives
2 large curve halves, 1 curve, 4 straights and no corner caps.

**87033-02 supplies only the inside of the turn.** Three mats per corner (two
shaped, one plain) and two curve halves, with no outside barriers at all. Those
three alone leave a corridor one mat wide, which is not a usable corner. The
placeable piece is that inner assembly plus an outer layer of plain mats and
barriers from a base set, restoring the fixed two-mat corridor. That is exactly
why the kit's manual says it cannot be used alone.

Per corner: kit gives 2 shaped mats + 1 plain + 2 curve halves; the base set
gives 4 plain, 1 quarter-round, 1 curve and 4 straights.

Both walls are ordinary convex quarter-round arcs:

- the **inside** is the kit's large sweep, concentric with the outer wall and
  with the corridor's centreline, and tangent to the adjoining straights;
- the **outside** is an ordinary quarter-round clip from the base set, as on
  any corner.

An earlier "concave" model of the inside sweep (commit 32a766b) never reached
rendering and was removed on 2026-10-13, after a review showed it would kink
the barrier by 90 degrees against both adjoining straights.

Three earlier models were wrong, each caught by the owner against the real
product and a photograph:

1. *Outer large arc, sharp inner apex closed by a cap.* Contradicted by the
   kit shipping no caps — a cap closes a sharp apex, so a kit with none has
   none.
2. *Inner sweep, but square outside.* The kit supplies no outside barriers, so
   nothing about it implies a square outer corner; every other corner in
   Kyosho's layouts is rounded.
3. *Only the kit's three mats.* Correct about the kit, wrong as a placeable
   piece — it yields a one-mat corridor.

The 87031-02 exploded assembly view was also misread early on: it shows the two
curve halves offset above the mats before assembly, which reads as two parallel
walls. They are one arc.

No manual exists for 87033-02 — Kyosho publishes instruction sheets only for
the older 87031 series — so the printed figures cannot settle this. The
physical piece is the authority.

### 13.2 Reconciling the stock L against the 87033 contents

**Correction (Task 16):** the original version of this section argued below that the
87033 figures could not all hold in one 2-mat-wide L ring, concluding "at most two of
{48 mats, 7 x 9 bounding box, 6 quarter-rounds} can hold." That conclusion was wrong.
The **Task 16 result** further down built and verified, against the real model code
rather than by hand, a ring that hits all three exactly — plus the straight-barrier
and joint counts, with zero shortfall and zero surplus against the 87033 kit. The
flaw was in the area argument below: it assumed a 2-wide ring's infield must be the
*independent* sum of a base rectangular hole and a separately-eroded notch, but a
fixed-distance erosion doesn't split apart like that near a corner. The original
reasoning is kept below, clearly marked, because seeing why it looked sound and where
it broke is more useful than deleting it.

The published figures for the 87033 layout were originally thought not to describe a
single 2-mat-wide L ring. **This turned out to be wrong — see the correction above.**

Corner counts are consistent: an L ring has 5 convex plus 1 reflex corner on its outer
boundary and the mirror on its infield hole, giving **6 quarter-round mats and 6 corner
caps**, exactly as shipped. Perimeter is consistent too: 36 straights plus 6 curves
implies 48 boundary edges, and since eroding a rectilinear ring inward by 2 changes
perimeter by `-2 * 2 * (convex - reflex) = -16`, the total is `2 * P_out - 16 = 48`,
so `P_out = 32` — matching a 7 x 9 bounding box.

Area is not. For an L inside a 7 x 9 box with an `a x b` notch, a 2-wide ring holds
`52 - 2a - 2b` mats. A real notch needs `a, b >= 2`, capping the ring at **44 mats**;
48 would require `a + b = 2`, i.e. no notch. A plain 7 x 9 rectangular ring does hold
exactly 48, but has 4 corners and would need 4 quarter-rounds and 4 caps, not 6 and 6.

**Superseded conclusion — see the correction at the top of this section and the
Task 16 result below.** The reasoning above concluded that at most two of {48 mats,
7 x 9 bounding box, 6 quarter-rounds} could hold, and speculated that the 2.1 m and
2.7 m leaders measure the L's legs rather than its bounding box, or that the set ships
spare mats. That conclusion does not hold: a construction exists that satisfies all
three simultaneously, and the box contents besides. It was the area estimate's own
independence assumption that was too loose, not the published figures.

**Consequence for the build:** the stock L is constructed and checked, and — now that
the Task 16 result below has shown the 87033 figures are exactly achievable — its mat
count, straight-barrier count, bounding box and joint totals are asserted as hard
equalities in `test/stock-l.test.js`, alongside the quarter-round/cap/curve counts.
If the boundary walk or the piece list ever drifts from the 87033 contents, that test
fails.

**Task 16 result — the area argument above undercounts.** The `a, b >= 2` / `52 - 2a -
2b` estimate above treats the notch and the 2-mat erosion as independent: base
rectangular hole plus a separately-eroded notch extension. They aren't independent —
eroding a rectilinear region by a fixed distance measures each cell's distance to the
*nearest* non-region cell in any direction, and near a corner notch that distance is
already short, so the hole doesn't need to (and shouldn't) extend as far there as the
additive estimate assumed. Eroding the actual 7 x 9-minus-2x2-notch shape precisely
(Chebyshev distance to the nearest excluded cell, same rule the existing 3 x 5 hole in
the plain 7 x 9 ring already uses) gives a smaller, L-shaped hole than the estimate,
and the resulting ring holds more material than 44.

Built and verified against `js/model.js` and `js/inventory.js` directly (`node -e`,
not by hand), the `stock-l` preset — outer 7 x 9 box, 2x2 notch cut from one corner,
infield hole eroded 2 mats in from every edge including the notch — produces:

- bounding box **7 x 9 mats**
- **42 square + 6 quarter-round mats (48 total)**
- **36 straight barriers, 6 curves, 6 corner caps**
- **90 joints of each type**

Every one of these is an exact match to the 87033 box contents (`js/inventory.js`
`KITS['87033']`), and `diffStock(billOfMaterials(stockL), stockFromKits({'87033':
1}))` reports zero shortfall and zero surplus on every part. So a construction
*does* exist that reconciles all three figures the earlier paragraph called mutually
exclusive — the earlier area estimate was simply not tight enough to find it, not
proof that no such ring exists.

**This does not fully resolve the question.** It shows the published figures are
jointly achievable by *some* 2-mat-wide L ring in a 7 x 9 box with a real (>= 2x2)
notch — the notch that also happens to maximise mat count, per this task's brief. It
does not prove this specific notch position, corner-cut corner, or piece layout is
the one Kyosho actually drew in the 87032/87033 manual; a different notch placement,
or the manual depicting a genuinely different shape (e.g. asymmetric leg widths), is
still possible and would change which physical mats are marked "spare." Counting the
physical set against this exact piece list is still how an owner would confirm it
matches, not just that the totals happen to.

### 13.3 Deferred

- Layout generation from inventory.
- Matted infield as a BOM option.
- Circuit 50 pieces and other track widths.
