# Layout Generator — Design Specification

Date: 2026-09-10
Extends: `docs/superpowers/specs/2026-09-09-circuit30-track-planner-design.md`

## 1. Purpose

Answer "what can I actually build with the pieces I own?" — and, by changing the
inventory, "what would I be able to build if I bought more?"

The owner has one 87033 starter set and wants to add extensions. The planner
already prices a layout they have drawn. This adds the other direction: given
the inventory, produce layouts.

**It is additive.** The app still opens to a blank canvas and building by hand
remains the primary flow. Suggestions are opt-in, reached through a dialog, and
exist to offer a starting point or inspiration. A loaded suggestion is *just
pieces* — no generated mode, no locking, no link back to the generator. Delete
half of it and carry on; undo restores whatever was there before.

## 2. The search space is small, and that is the headline

Every corner in the mat region costs one quarter-round mat. A rectilinear ring
always satisfies `convex - reflex = 4`, so corner counts run 4, 6, 8, 10..., and
for each count there is essentially one outline up to rotation and mirroring.

| corners | outline | quarter-rounds |
| --- | --- | --- |
| 4 | rectangle | 4 |
| 6 | L | 6 |
| 8 | Z/S, T, U | 8 |
| 10 | plus, staircase, comb | 10 |

87033 ships **6 quarter-round mats**. So a single starter set builds rectangles
and L-shapes and nothing else. Every other result — 7x9, 5x11, 8x8 — is one of
those two outlines at a different size.

This is the most useful thing the feature has to say, and it explains the
owner's original complaint about being locked into an L-shape. It is not the
manual lacking imagination; it is the corner budget.

It also reframes what to buy:

- **87033-01** is 63 mats and **zero** quarter-rounds. It buys bigger, never
  different.
- A **second 87033** (or 87031, 12 quarter-rounds) unlocks 8-corner outlines,
  including the S/Z the owner asked about.
- **87033-02** does not change the outline; it changes the corner *feel* from
  tight to sweeping.

## 3. What counts as genuinely different

Two layouts are the same **character** when they share both:

1. **Outline** — the cyclic turn signature, reduced up to rotation and
   mirroring. Rectangle, L, Z/S, T, U.
2. **Corner feel** — the corner types used: all tight (R30), all sweeping
   (R60), or mixed.

Size and proportion are *variants* within a character, not new characters.
Without this rule the output is dominated by the same outline at a thousand
length increments, which is noise.

## 4. Scope

In scope:

- Enumerate buildable closed circuits from the current inventory.
- Group them into characters; report the count of variants per character.
- Surface up to five diverse suggestions at a time, with a way to page through
  the rest.
- Load a chosen suggestion onto the canvas as ordinary, editable pieces.
- Report characters that are **out of reach** and the binding reason.
- Persist the inventory across reloads.

Out of scope:

- A separate what-if panel. Changing the inventory *is* the what-if.
- Ranking layouts by driving quality, lap-time simulation, or racing lines.
- Non-rectilinear or non-closed layouts; track widths other than two mats.
- Suggesting combinations of kits to reach a target.

## 5. Engine

One new pure module, `js/generate.js`. It imports `geometry`, `model` and
`inventory`; only `app.js` and its tests import it. No DOM.

### 5.1 Construction, not search

A depth-first walk over piece placements does not work. A throwaway probe
explored 60,000 nodes in 25 seconds and found **zero** closed loops: a wandering
chain almost never happens to return to its own start.

Instead, generate the outline first and lay pieces along it:

1. Enumerate turn signatures per corner count — cyclic sequences of left/right
   turns summing to +4, reduced up to rotation and mirroring.
2. For each signature, enumerate integer side lengths bounded by the mat budget
   and the room boundary if one is set.
3. Build the candidate by chaining `placeAgainst` from a starting piece, exactly
   as a person would lay it.
4. Validate with `isClosedCircuit` and `findOverlaps`; cost with
   `billOfMaterials`; keep it if `diffStock` reports no shortfall.

### 5.2 No parallel geometry maths

Every figure comes from the existing engine. The generator must not compute mat
counts, barrier counts or areas with its own formulas.

This is not a style preference. A closed-form area formula for L-rings written
earlier in this project was wrong, and it produced a confident, incorrect
conclusion that the 87033 figures were mutually inconsistent (see the parent
spec, section 13.2). Anything that recomputes what `computeBarriers` and
`computeMetrics` already derive can disagree with the canvas and the bill of
materials, and will eventually do so silently.

### 5.3 Deduplication

A layout and its rotations and mirrors are the same track. Each candidate is
reduced to a canonical form — translate the occupied-cell set to the origin,
then take the lexicographically smallest of its 8 symmetries — and duplicates
are dropped. Without this a rectangle appears four to eight times.

### 5.4 Bounds and honesty

Enumeration is bounded by the mat budget and the room. It is synchronous; the
probe measured roughly 2,400 loop validations per second, so a few hundred
candidates is imperceptible.

If a bound would exceed the candidate budget, the result reports how many were
examined and that it stopped, rather than silently truncating. Silent
truncation would read as "that is everything" when it is not.

## 6. Inventory persistence

`state.kits` is currently in memory only: it resets to `{'87033': 1}` on every
reload, and is deliberately excluded from the exported layout file.

Excluding it from the file stays correct — the inventory is the owner's shelf,
not a property of a track. But once inventory is the generator's input, losing
it on reload is wrong. It moves to `localStorage` under a single key, read at
boot and written whenever the inventory dialog saves. A malformed or absent
value falls back to the current default rather than throwing.

## 7. Interface

Folded into the existing presets dialog, which becomes the place layouts come
from. It reuses the `.preset-card` row component; no new styling.

```
KNOWN LAYOUTS
  Stock L (87033)          48 mats · buildable

SUGGESTIONS — 1x 87033              23 layouts across 2 shapes
  L-shape 7x9              48 mats · lap 6.43 m · uses all 48   [use]
  Rectangle 7x9            48 mats · lap 6.43 m · uses all 48   [use]
  L-shape 5x13 (2x2)       44 mats · lap 6.10 m                 [use]
  Rectangle 5x11           44 mats · lap 6.00 m                 [use]
  L-shape 9x7 (3x2)        42 mats · lap 5.80 m                 [use]

  [ Show 5 different ]                        showing 1-5 of 23

OUT OF REACH
  S/Z, T, U     need 8 corners — you have 6
  Sweeping      need large corners (87033-02)
```

**Five are chosen for spread, not rank.** Round-robin across characters first,
then vary size and proportion within a character. Ranking by lap length alone
would fill the list with five rectangles differing by one mat.

**"Show 5 different" advances a cursor; it does not reshuffle.** Repeated
presses walk 6-10, 11-15 and so on with no repeats until the space is
exhausted, then wrap and say so. Random selection would re-show rejected
layouts and could never promise the whole space had been seen.

**Five or fewer results:** all are shown and the button is hidden.

**Choosing one** loads it through `commit()`, so it replaces the current layout
and Ctrl/Cmd+Z restores what was there — identical to loading a preset or a
file. Stale interaction state (`ghost`, `pending`, `hoverCell`, `tool`,
`selected`) is cleared on the same path.

## 8. Testing

`test/generate.test.js`, run under `node:test` like the rest of the core. The
domain assertions are the point of this suite:

- With 1x 87033: **exactly two characters**, rectangle and L.
- Adding **87033-01** (63 mats, zero quarter-rounds): more variants, **zero**
  new characters. This encodes "bigger, never different".
- Adding a **second 87033** (12 quarter-rounds): 8-corner characters appear,
  including Z/S.
- Adding **87033-02**: a sweeping-corner character appears.
- Every generated layout in the result set is closed, overlap-free and within
  stock — asserted across the whole set, so a broken family generator cannot
  slip one through.
- Both layouts in `PRESETS` are produced by the generator, tying it to fixtures
  already verified elsewhere.
- Deduplication: a rectangle and its 90-degree rotation collapse to one entry.
- The suggestion cursor: paging through covers every result exactly once before
  wrapping.

## 9. Risks

- **Turn-signature enumeration is the one piece of new combinatorial code.** If
  it is wrong the generator silently misses shapes. Mitigated by asserting the
  known corner-count-to-outline table in tests, and by requiring both existing
  presets to be reproduced.
- **Candidate counts grow with inventory.** A large inventory with a large room
  could push enumeration past a comfortable synchronous budget. Mitigated by the
  explicit cap and the honest "stopped at N" report; if it becomes a real
  problem the fix is to bound side lengths more aggressively before building
  pieces, not to hide the truncation.
