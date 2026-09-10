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

import { ROTATIONS, placedCells, placedPorts } from './geometry.js';
import { createLayout, isClosedCircuit, openPorts, placeAgainst, cellKey } from './model.js';

// Rotate a string left by n.
const rotate = (s, n) => s.slice(n) + s.slice(0, n);

// The same outline reflected, still walked clockwise. Reflecting a shape
// flips the handedness of every turn — but walking the reflected shape
// clockwise (rather than the counter-clockwise direction the reflection
// left it facing) reverses the traversal order, which flips every turn's
// handedness right back. The two flips cancel, so this is a plain reversal
// — NOT a reversal plus an R/L swap.
//
// Worked example: a square walked clockwise is RRRR. Its reflection is
// still a square, and walked clockwise it is still RRRR — the mirror
// operation must map RRRR to itself. `reverse('RRRR')` does (RRRR). A
// reversal-plus-swap would not (it gives LLLL, the same square walked
// counter-clockwise, turn sum -4) — that is the bug this used to be.
const reverse = (s) => [...s].reverse().join('');

// Smallest representative of a signature under rotation and mirroring.
function canonicalSignature(s) {
  const forms = [];
  for (let i = 0; i < s.length; i++) {
    forms.push(rotate(s, i));
    forms.push(rotate(reverse(s), i));
  }
  return forms.sort()[0];
}

// Cache of computed results, keyed by corner count. `outlineName`'s fallback
// calls `turnSignatures` again for every shape it names, and Tasks 4 and 6
// call it from nested loops — without this the enumeration below (already
// combinatorial in `corners`) would be redone on every such call.
const signatureCache = new Map();

// Every distinct closed rectilinear outline with `corners` corners.
// Clockwise traversal turns sum to +4, so rights - lefts = 4.
// Returns a fresh copy each call — the array behind `corners` is cached and
// shared, and a caller mutating it (sort, push, splice) would silently
// corrupt every future call for that corner count.
export function turnSignatures(corners) {
  if (signatureCache.has(corners)) return [...signatureCache.get(corners)];
  if (corners < 4 || corners % 2 !== 0) {
    signatureCache.set(corners, []);
    return [];
  }
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

  const result = [...seen].sort();
  signatureCache.set(corners, result);
  return [...result];
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

// Turn tables keyed by the direction currently being walked. Also used by
// Task 4 — keep this the single copy so the two never drift apart.
export const RIGHT_OF = { N: 'E', E: 'S', S: 'W', W: 'N' };
export const LEFT_OF = { N: 'W', W: 'S', S: 'E', E: 'N' };

// Append one piece of `type` against the chain's current growing tip, so
// that the piece's *other* port — the one not used to connect — faces
// `exitDir`. Rotations are found by trial rather than derived: placeAgainst
// already knows the connection rules, and re-deriving them by hand is how
// orientation bugs get in.
//
// The caller must thread the returned tip through to the next call rather
// than re-deriving it from openPorts(layout): a chain always has two open
// ports (one at each end), and nothing guarantees openPorts orders the
// growing tip last. Instead, the new tip is read straight off the piece
// just placed via placedPorts — it can only be one of that piece's own
// ports, and disambiguating by `exitDir` (rather than "whichever wasn't
// just connected") is what lets a corner choose a right turn over a left
// one when both are geometrically non-overlapping.
//
// `occupied` is a Set of cellKey strings covering every cell placed so far
// — maintained by the caller across the whole chain rather than recomputed
// here, so a trial only needs to check the *new* piece's own cells against
// it instead of re-scanning the whole chain's occupancy from scratch. That
// keeps a P-piece loop O(P) instead of O(P^2).
//
// Returns { pieces, occupied, tip } or null if no rotation both connects
// and exits the right way without overlapping the chain so far.
function append(pieces, occupied, tip, type, exitDir) {
  for (const rot of ROTATIONS) {
    const placed = placeAgainst(tip, type, rot);
    if (!placed) continue;
    const cells = placedCells(placed);
    if (cells.some((c) => occupied.has(cellKey(c)))) continue;
    const newTip = placedPorts(placed).find((p) => p.dir === exitDir);
    if (!newTip) continue;
    const nextOccupied = new Set(occupied);
    for (const c of cells) nextOccupied.add(cellKey(c));
    return { pieces: [...pieces, placed], occupied: nextOccupied, tip: newTip };
  }
  return null;
}

// Build a closed loop from a turn signature and the straight-piece counts
// preceding each corner. sides[i] is how many `straight` pieces sit on the
// run before corner i. Returns the piece array, or null if the chosen side
// lengths don't actually bring the loop back to a closed circuit.
export function buildLoop({ signature, sides, cornerType = 'cornerR30' }) {
  if (sides.length !== signature.length) return null;

  const first = { type: cornerType, x: 0, y: 0, rot: 0 };
  let pieces = [first];
  let occupied = new Set(placedCells(first).map(cellKey));
  // A single piece has two open ports and, with nothing else placed yet,
  // no ambiguity about which ports exist — but which of the two becomes
  // the starting tip is still a deliberate, consistent choice (the first
  // one openPorts reports), not a guess re-made on every later step.
  let tip = openPorts(createLayout({ pieces })).map((o) => o.port)[0];

  for (let i = 0; i < signature.length; i++) {
    for (let s = 0; s < sides[i]; s++) {
      const grown = append(pieces, occupied, tip, 'straight', tip.dir);
      if (!grown) return null;
      ({ pieces, occupied, tip } = grown);
    }
    if (i === signature.length - 1) break; // the first piece is the last corner
    const exitDir = signature[i] === 'R' ? RIGHT_OF[tip.dir] : LEFT_OF[tip.dir];
    const grown = append(pieces, occupied, tip, cornerType, exitDir);
    if (!grown) return null;
    ({ pieces, occupied, tip } = grown);
  }

  // isClosedCircuit already checks overlaps internally (and returns false
  // on them), so no separate findOverlaps scan is needed here.
  return isClosedCircuit(createLayout({ pieces })) ? pieces : null;
}
