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

import { PIECES, PIECE_TYPES, ROTATIONS, placedCells, placedPorts } from './geometry.js';
import { createLayout, isClosedCircuit, openPorts, placeAgainst, cellKey, computeMetrics, enclosedInfields, unjoinedContacts, subWidthNotches } from './model.js';
import { billOfMaterials, diffStock, emptyStock, MAT_PARTS, BARRIER_PARTS } from './inventory.js';

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

// Unit step per heading. RIGHT_OF/LEFT_OF above are the single copy of the
// turn tables (Task 2) — reused here rather than redeclared so the two
// never drift apart.
const STEP = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

// The heading each side of an outline is walked in.
function headings(signature) {
  const out = [];
  let dir = 'N';
  for (const turn of signature) {
    out.push(dir);
    dir = turn === 'R' ? RIGHT_OF[dir] : LEFT_OF[dir];
  }
  return out;
}

// The opposite of each heading — used only to work out which of a corner's
// two ports is the one that attaches backward onto the growing chain.
const OPPOSITE_OF = { N: 'S', S: 'N', E: 'W', W: 'E' };

// Midpoint of a port's edge, in the piece's own local cell coordinates.
// A port spans two adjacent cells (the fixed 2-mat track width); its edge
// sits on whichever side `dir` names.
function portMidpoint(port) {
  const xs = port.cells.map((c) => c[0]);
  const ys = port.cells.map((c) => c[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (port.dir === 'N') return [(minX + maxX + 1) / 2, minY];
  if (port.dir === 'S') return [(minX + maxX + 1) / 2, maxY + 1];
  if (port.dir === 'E') return [maxX + 1, (minY + maxY + 1) / 2];
  return [minX, (minY + maxY + 1) / 2]; // 'W'
}

// How far a corner piece of `cornerType` carries the walk along each of its
// two headings — the displacement `closes()` was missing. Measured, not
// hardcoded, from the piece's own unrotated ports (as buildLoop places
// them): one port is the one that attaches backward onto the chain (so the
// heading arriving at the corner is the OPPOSITE of that port's own facing
// direction — matching ports face opposite ways, same as any two abutting
// edges), and the other is the exit port, whose facing direction *is* the
// heading leaving the corner (exactly the exitDir convention `append` and
// `closes` both already use). The displacement between the two ports'
// edge midpoints decomposes evenly onto those two heading vectors; that
// even split is `k`. If a future piece's geometry ever made the two axes
// disagree, that is a real modelling error worth surfacing loudly, so this
// asserts rather than silently picking one.
//
// Measured this way: cornerR30 -> k=1, cornerR60 -> k=2. (Not asserted as
// literals — recomputed from geometry every time, cached below.)
const cornerFactorCache = new Map();
function cornerDisplacementFactor(cornerType) {
  if (cornerFactorCache.has(cornerType)) return cornerFactorCache.get(cornerType);
  const [entryPort, exitPort] = placedPorts({ type: cornerType, x: 0, y: 0, rot: 0 });
  const hIn = OPPOSITE_OF[entryPort.dir];
  const hOut = exitPort.dir;
  const d = [
    portMidpoint(exitPort)[0] - portMidpoint(entryPort)[0],
    portMidpoint(exitPort)[1] - portMidpoint(entryPort)[1],
  ];
  const denom = [STEP[hIn][0] + STEP[hOut][0], STEP[hIn][1] + STEP[hOut][1]];
  const solve = (i) => (denom[i] !== 0 ? d[i] / denom[i] : null);
  const kx = solve(0);
  const ky = solve(1);
  const k = kx ?? ky;
  if (kx !== null && ky !== null && kx !== ky) {
    throw new Error(`corner displacement factor disagrees between axes for ${cornerType}: x gives ${kx}, y gives ${ky}`);
  }
  cornerFactorCache.set(cornerType, k);
  return k;
}

// A closed outline's side lengths, plus the displacement each corner
// contributes along its two headings, must sum to zero on both axes.
// Checking this before building is what makes enumeration fast; every
// tuple that survives is still built and validated by isClosedCircuit (via
// buildLoop). This is not a breach of the no-parallel-maths rule: it
// computes no mat counts, barrier counts or areas, only which candidates
// are worth building.
//
// Each corner between side i and side i+1 (cyclically) advances the walk
// by `k` along heading[i] (finishing the turn into the corner) and `k`
// along heading[i+1] (leaving it) — see cornerDisplacementFactor. Summed
// cyclically over all corners, corner i's contribution to heading[i] and
// corner i-1's contribution to heading[i] both land on heading[i], so the
// total correction is just `2k` added to every side length before the
// usual sum. For a rectangle the four headings sum to zero on their own,
// so the correction vanishes and the old side-lengths-only check happened
// to still work — which is exactly why it silently failed only on outlines
// with a left turn (every outline except the plain rectangle).
export function closes(signature, sides, cornerType) {
  const k = cornerDisplacementFactor(cornerType);
  let x = 0;
  let y = 0;
  headings(signature).forEach((dir, i) => {
    const n = sides[i] + 2 * k;
    x += STEP[dir][0] * n;
    y += STEP[dir][1] * n;
  });
  return x === 0 && y === 0;
}

// cornerR60 is deliberately excluded. Two R60 corners connect fine
// (placeAgainst succeeds at rot 90/180 with no overlap), but no closed
// R60-only loop exists: checked exhaustively across 16,250 tuples spanning
// every 4- and 6-corner outline with sides to 4, and every rectangle with
// sides to 14 — zero closed. A large corner is a substitution into an
// otherwise-regular layout (the kit supplies only the inside of one
// corner, meant to drop into a base-set loop), not a family you can tile a
// whole circuit from. Enumerating it anyway would only burn budget on
// candidates closes() accepts arithmetically but that can never build.
// Modelling substitution is a different feature and out of scope here; see
// test/generate.test.js's pinning test for the evidence trail.
function cornerTypesFor(stock) {
  return stock.mats.quarterRound > 0 ? ['cornerR30'] : [];
}

// Rotate an array left by n (mirrors the string `rotate` helper above, for
// side-length tuples).
const rotateArr = (arr, n) => arr.slice(n).concat(arr.slice(0, n));

// Every alternate `sides` array that pairs with this EXACT `signature`
// string (not a rotation or mirror of it — the one generateLayouts is
// actually iterating over) and describes the same physical loop. Other
// equivalent pairs exist under a rotated or mirrored signature string, but
// those are never tried as `signature` by generateLayouts, so they need no
// entry here — nothing would ever duplicate them.
//
// Two families, each derived by tracing what "start the walk at a
// different corner" and "walk the mirror image clockwise" actually do to
// the (length, turn) legs — not assumed:
//   - Rotation: (rotate(signature, k), rotate(sides, k)) for any k, kept
//     only when that rotation of the signature string equals the
//     signature itself (e.g. every k, for the fully-symmetric rectangle;
//     only k=0 for a generic asymmetric outline).
//   - Mirror: reflecting the shape and re-walking it clockwise reverses
//     the leg order. Because a leg's length sits *before* its turn, a
//     backward walk reaches the *previous* turn first, so the reversed
//     legs are (rotate(reverse(signature), 1), reverseArray(sides)) — a
//     plain reversal of sides, paired with the turn string reversed AND
//     rotated one further step so each length re-matches the correct
//     turn. That pair is then subject to the same rotation freedom.
// Verified against buildLoop + canonicalLayoutKey directly (grouping real
// build results by canonical key and checking every group has exactly one
// tuple this function calls canonical) before trusting it algebraically —
// two similar derivations in this area were wrong before this one.
function equivalentSidesFor(signature, sides) {
  const n = signature.length;
  const candidates = [];
  for (let k = 0; k < n; k++) {
    if (rotate(signature, k) === signature) candidates.push(rotateArr(sides, k));
  }
  const mirroredSignature = rotate(reverse(signature), 1);
  const mirroredSides = [...sides].reverse();
  for (let k = 0; k < n; k++) {
    if (rotate(mirroredSignature, k) === signature) candidates.push(rotateArr(mirroredSides, k));
  }
  return candidates;
}

const lexLess = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
};

// True when `sides` is the lexicographically smallest of every equivalent
// representation sharing this `signature` string — the one tuple among its
// rotation/mirror family that generateLayouts should actually build.
// Skipping the rest is a pure performance optimisation: canonicalLayoutKey
// still dedupes the final results either way (see `seen` below), so this
// only changes how many times buildLoop runs, never what it's allowed to
// find. `sides` itself is always among its own candidates (k=0 rotation),
// so this never rejects every candidate.
function isCanonicalTuple(signature, sides) {
  for (const candidate of equivalentSidesFor(signature, sides)) {
    if (lexLess(candidate, sides)) return false;
  }
  return true;
}

// Bounded memo of generateLayouts, keyed by stock contents plus the options
// that affect its result — not by object identity. stockFromKits and
// abundantStock (below) each build a fresh object on every call, so keying
// on identity would miss almost every real repeat call; the inventory
// itself rarely changes between dialog opens, and the abundant stock is
// byte-identical on every call (see abundantStock's own comment), so a
// content key turns both into cache hits. JSON.stringify is a stable key
// here specifically because every stock object in this codebase is built by
// emptyStock() (fixed key order via MAT_PARTS/BARRIER_PARTS) plus in-place
// value writes — callers never add or delete a key, so two stocks with
// equal contents always serialize identically. opts is resolved to its
// defaults before keying, so a caller that omits an option and one that
// passes it explicitly at the default hit the same entry.
//
// Evicted oldest-first once GENERATE_CACHE_LIMIT entries exist. The
// inventory changes rarely enough that a handful of entries covers a whole
// session (current owned stock/opts + the one abundant configuration
// outOfReach uses); an unbounded cache would otherwise grow with every
// distinct (stock, opts) pair ever tried, including in tests.
const GENERATE_CACHE_LIMIT = 8;
const generateCache = new Map();

function resolveGenerateOpts(opts) {
  const {
    maxCorners = 8, maxSide = 12, budget = 20000, room = null,
    skipTupleDedup = false, maxVariantsPerCharacter = 50, skipCornerCountStop = false,
  } = opts;
  return { maxCorners, maxSide, budget, room, skipTupleDedup, maxVariantsPerCharacter, skipCornerCountStop };
}

function generateCacheKey(stock, resolvedOpts) {
  return JSON.stringify([stock, resolvedOpts]);
}

// True when generateLayouts(stock, opts) is already cached and would return
// without doing any real work. Exists so a caller (the presets dialog) can
// decide whether to show a loading skeleton BEFORE paying for the
// computation — timing the call itself would mean a cold call already ran
// to completion by the time the caller learned it was slow, and the
// skeleton would never get a chance to paint. Never mutates the cache.
export function hasCachedLayouts(stock, opts = {}) {
  return generateCache.has(generateCacheKey(stock, resolveGenerateOpts(opts)));
}

// Enumerate every buildable, affordable layout the given stock can pay for.
// Walks each distinct outline (turnSignatures) and every side-length tuple
// up to maxSide, arithmetically pre-filtering with closes() before paying
// the cost of actually building a candidate with buildLoop, and skipping
// any tuple that isn't the canonical representative of its own
// rotation/mirror family (isCanonicalTuple) before that. Every survivor is
// still built from real pieces, validated internally by buildLoop, and
// checked against stock via billOfMaterials/diffStock — no mat, barrier or
// area maths happens in this file.
//
// opts: { maxCorners = 8, maxSide = 12, budget = 20000, room = null,
// skipTupleDedup = false, maxVariantsPerCharacter = 50,
// skipCornerCountStop = false }. `skipTupleDedup` disables the
// isCanonicalTuple pre-filter — it exists purely so a test can compare
// the fast and slow paths and prove the filter drops no distinct layout;
// leave it off.
//
// `maxCorners` defaults to 8, not higher, for a concrete reason: a
// 10-corner outline needs ten quarter-round mats, so it is never
// affordable on fewer than two starter sets (one ships six) — and even at
// two starter sets nothing 10-corner turned out to be affordable, with the
// search burning 19,600 examined candidates to confirm it (see
// test/generate.test.js). Ten sides is where the tuple space stops being
// bounded in any useful way: corners=4/6/8 together finish in a few
// hundred examined candidates, but corners=10 alone can exhaust the whole
// default budget without completing. So exploring it by default costs
// everything and returns nothing; `maxCorners` stays a plain option so
// someone who deliberately wants to look can raise it, but a default
// suggestion run should not spend a user's time on it. Whatever this
// leaves unexplored is reported, never silently dropped — see
// `unexploredCorners` below.
//
// `maxVariantsPerCharacter` bounds how many size/proportion variants of
// the SAME character — the same (signature, cornerType) pair, i.e. the
// same outline and corner feel — are kept, not how many layouts overall
// are kept. The UI groups by character and shows a handful at a time, so
// unlike `budget` (a global, roughly-honest "stop somewhere" limit) this
// is a real bound on what would otherwise be redundant near-duplicate
// sizes of one shape: it prunes the search for that character as soon as
// the cap is hit rather than continuing to examine (and discard) more of
// its variants, which is what makes a larger inventory's much bigger
// affordable space finish well inside the default budget instead of
// trading truncation for a long wait. Characters are never dropped, only
// their size variants past the cap — reported via `cappedCharacters` so a
// caller can tell variants were trimmed rather than exhaustive.
//
// `skipCornerCountStop` disables the "stop climbing corner counts once one
// yields nothing" optimisation below — again purely for a test to verify
// it against the unoptimised search; leave it off.
//
// Returns { results, examined, stopped, cappedCharacters, unexploredCorners }.
// `stopped` is true, and `examined` reports how many candidates were
// checked, whenever the budget is hit — so a caller can never mistake a
// truncated run for a complete one. `cappedCharacters` counts how many
// (signature, cornerType) characters hit `maxVariantsPerCharacter` —
// silence about that is exactly what would misrepresent a capped run as
// exhaustive, so it's always reported, never just implied by `stopped`.
// `unexploredCorners` names the corner counts that the stock could afford
// by mat count alone but that `maxCorners` kept the search from ever
// trying — as opposed to corner counts excluded because the stock
// genuinely cannot pay for them, which are not "unexplored" in this
// sense, just impossible regardless of `maxCorners`. (These counts are
// for cornerR30, the only corner type the outer loop below ever tries —
// see cornerTypesFor above for why cornerR60 is excluded. The field name
// has no cornerType suffix only because there is currently just the one
// to report.)
export function generateLayouts(stock, opts = {}) {
  const resolvedOpts = resolveGenerateOpts(opts);
  const {
    maxCorners, maxSide, budget, room,
    skipTupleDedup, maxVariantsPerCharacter, skipCornerCountStop,
  } = resolvedOpts;
  const cacheKey = generateCacheKey(stock, resolvedOpts);
  if (generateCache.has(cacheKey)) return generateCache.get(cacheKey);

  const totalMats = stock.mats.square + stock.mats.quarterRound + stock.mats.arcLarge;
  // Each straight is 2 mats, so the straights alone cannot exceed this.
  const maxStraights = Math.floor(totalMats / 2);

  const results = [];
  const seen = new Set();
  const variantCounts = new Map();
  const cappedCharacterKeys = new Set();
  const unexploredCornersSet = new Set();
  let examined = 0;
  let stopped = false;

  for (const cornerType of cornerTypesFor(stock)) {
    // Every corner costs exactly one of each mat kind the corner piece
    // itself uses (e.g. one quarter-round per corner for cornerR30), no
    // matter how long the sides are. A corner count needing more of any
    // such mat than the stock has is unaffordable before a single tuple is
    // tried — reading that cost from computeMetrics (rather than the
    // piece's own mats table, which this file must not reach into
    // directly) keeps this in step with the engine's own accounting. This
    // is the same category of bound as maxStraights above: inventory
    // arithmetic, not mat/area maths recomputed from geometry.
    const perCorner = computeMetrics(createLayout({ pieces: [{ type: cornerType, x: 0, y: 0, rot: 0 }] })).mats;
    // Affordability by mat count alone, WITHOUT the maxCorners cap — used
    // only to report what the cap hides, never to widen the search itself.
    let trueAffordableCorners = Infinity;
    for (const [kind, needed] of Object.entries(perCorner)) {
      if (needed > 0) trueAffordableCorners = Math.min(trueAffordableCorners, Math.floor((stock.mats[kind] ?? 0) / needed));
    }
    const maxAffordableCorners = Math.min(maxCorners, trueAffordableCorners);
    for (let corners = maxCorners + 2; corners <= trueAffordableCorners; corners += 2) {
      unexploredCornersSet.add(corners);
    }
    for (let corners = 4; corners <= maxAffordableCorners; corners += 2) {
      const resultsBeforeThisCount = results.length;
      for (const signature of turnSignatures(corners)) {
        const sides = new Array(corners).fill(0);
        const characterKey = `${cornerType}:${signature}`;

        const walk = (i, used) => {
          if (stopped) return;
          // Cheap check first: once this character has hit its variant
          // cap, prune the whole remaining subtree for it immediately
          // rather than continuing to enumerate (and discard) more sides
          // tuples that would only ever be rejected at the very end.
          if ((variantCounts.get(characterKey) ?? 0) >= maxVariantsPerCharacter) return;
          if (i === corners) {
            if (!closes(signature, sides, cornerType)) return;
            if (!skipTupleDedup && !isCanonicalTuple(signature, sides)) return;
            if (++examined > budget) { stopped = true; return; }
            const pieces = buildLoop({ signature, sides: [...sides], cornerType });
            if (!pieces) return;
            const layout = createLayout({ pieces });
            const { bbox, matCount, lapMm } = computeMetrics(layout);
            if (room && (bbox.w > room.w || bbox.h > room.h)) return;
            if (diffStock(billOfMaterials(layout), stock).some((r) => r.short > 0)) return;
            // Task 13: a loop that runs back alongside itself (an S-bend, an
            // offset chicane) is allowed through now — it used to be banned
            // outright by rejecting any unjoined piece contact, which also
            // banned the only genuinely interesting tracks this generator
            // can make. That ban is no longer needed: Task 11 (commit
            // 51ceffe) made boundaryEdges wall every unjoined contact
            // unconditionally, so billOfMaterials above already prices the
            // wall between the two lanes correctly, and computeBarriers'
            // rendering already draws it — the "4 wide, no barrier" bug this
            // used to guard against cannot recur regardless of what this
            // file filters. See test/generate.test.js's invariant test for
            // the proof: every unjoined contact edge is in boundaryEdges,
            // over every generated layout, both inventories.
            //
            // What's rejected instead: sub-width notches — slots cut into
            // the outline narrower than the two-mat track width, a 1-mat
            // sliver no driver can use. subWidthNotches reuses model.js's
            // shared outline helper rather than this file computing
            // occupancy geometry itself (the "no parallel geometry maths"
            // rule).
            if (subWidthNotches(layout) > 0) return;
            // Port-closed and overlap-free is not enough: a solid block of
            // mats with a wall round the outside satisfies both while
            // enclosing nothing to drive around. A real track encloses
            // exactly one infield — the closed inner barrier that stops a
            // car cutting the corner. Checked last because it is the one
            // per-candidate flood fill among these checks.
            if (enclosedInfields(layout) !== 1) return;
            const key = canonicalLayoutKey(pieces);
            if (seen.has(key)) return;
            seen.add(key);
            results.push({ pieces, signature, cornerType, sides: [...sides], matCount, lapMm, bbox, key });
            const count = (variantCounts.get(characterKey) ?? 0) + 1;
            variantCounts.set(characterKey, count);
            if (count >= maxVariantsPerCharacter) cappedCharacterKeys.add(characterKey);
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
        if (stopped) break;
      }
      if (stopped) break;
      // Monotonicity assumption, not a proof: a loop with more corners
      // always needs strictly more corner pieces (and so strictly more
      // mats) than one with fewer, for the same cornerType — see
      // maxAffordableCorners above, which already bounds corners on total
      // mat cost alone. So if this corner count ran to completion within
      // budget and still produced not one affordable result, no larger
      // corner count can either; climbing further would only rediscover
      // that same unaffordability, exactly the waste maxAffordableCorners
      // already cuts for the coarser "too many mats overall" case. Only
      // trusted when the count actually finished (not `stopped` — a
      // budget cutoff mid-count means "didn't get far enough", not "zero
      // exists"). skipCornerCountStop exists so a test can verify this
      // against the unoptimised search rather than take it on trust.
      if (!skipCornerCountStop && results.length === resultsBeforeThisCount) break;
    }
  }

  const output = {
    results,
    examined,
    stopped,
    cappedCharacters: cappedCharacterKeys.size,
    unexploredCorners: [...unexploredCornersSet].sort((a, b) => a - b),
  };
  generateCache.set(cacheKey, output);
  if (generateCache.size > GENERATE_CACHE_LIMIT) {
    generateCache.delete(generateCache.keys().next().value);
  }
  return output;
}

// The single place the corner-type-to-feel mapping lives. cornerR60 is
// deliberately excluded from generation (see cornerTypesFor above), so in
// practice every result's cornerType is 'cornerR30' and every feel comes
// out 'tight' — but this stays a lookup table, not an inlined ternary,
// because Task 6 needs the same mapping and must read it from here rather
// than duplicating it.
const CORNER_FEEL = { cornerR30: 'tight', cornerR60: 'sweeping' };

export function cornerFeel(result) {
  return CORNER_FEEL[result.cornerType];
}

const FEEL_LABEL = { tight: 'tight corners', sweeping: 'sweeping corners' };

// Two layouts are the same character when they share both outline and
// corner feel — size and proportion (the side-length tuple) are variants of
// that character, not distinct characters. Sorted by corner count then
// name; each character's variants are sorted by matCount descending so
// `best` (the biggest, most mat-efficient build) is variants[0].
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
    // matCount/lapMm frequently tie among a character's variants (e.g. 19
    // L-shape variants tied on both for a single starter set), so without a
    // final tiebreak the order among ties would rest on Array.prototype.sort
    // stability plus generateLayouts' internal search order — deterministic
    // today, but an accident rather than a documented rule, and the UI pages
    // through these. `key` is unique per result (see canonicalLayoutKey), so
    // this makes the order a total, intentional one.
    c.variants.sort((a, b) => b.matCount - a.matCount || b.lapMm - a.lapMm || a.key.localeCompare(b.key));
    c.best = c.variants[0];
    c.label = `${c.name}, ${FEEL_LABEL[c.feel]}`;
  }
  // feel is a tiebreak after corners/name for the same reason: currently
  // unreachable (cornerR60 never appears in real results, see
  // cornerTypesFor above), but Task 6 makes feel a real discriminator, and
  // leaving two same-corners/same-name characters to fall back on insertion
  // order would be the same latent gap as the untested half of the group key.
  characters.sort((a, b) => a.corners - b.corners || a.name.localeCompare(b.name) || a.feel.localeCompare(b.feel));
  return characters;
}

// Min-max normalise `values` (parallel to `results`) to 0..1. A candidate
// set with no spread on this dimension (every value equal) normalises to a
// flat 0.5 for everyone — not 0 or 1, either of which would silently bias
// the overall score for a dimension that in truth discriminates nobody.
function normalise(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

// Three user-chosen, equally-weighted criteria (Task 13), each normalised
// to 0..1 across THIS candidate set before summing:
//   lapPerMat  — (lapMm / 1000) / matCount: metres of driving per mat spent.
//   technical  — mean of two normalised parts: how many unjoined contact
//                edges a layout has (chicanes — the track running back past
//                itself) and how many 'L' turns its signature has (direction
//                reversals). Both read "more of this shape's own character",
//                not a defect — unjoinedContacts is safe to read here
//                because Task 13 stopped treating it as a rejection signal,
//                not because it stopped meaning what it always meant.
//   fit        — how well bbox fits `room` if one is set (occupied area
//                over room area — every candidate already satisfies
//                bbox <= room, so this is a fraction of the room actually
//                used); otherwise squareness, min(w,h)/max(w,h).
// Returns `results` with each entry annotated { ...result, score,
// components: { lapPerMat, technical, fit } }. Does not mutate `results`.
//
// The normalisation is relative to THIS candidate set, so a score is only
// meaningful when comparing results from the SAME generateLayouts call —
// never compare scores across separate calls (different stock, different
// room, different inventory): a 0.8 in one set and a 0.8 in another do not
// mean the same thing.
export function scoreLayouts(results, { room = null } = {}) {
  const lapPerMat = normalise(results.map((r) => (r.lapMm / 1000) / r.matCount));

  const unjoinedCounts = results.map((r) => unjoinedContacts(createLayout({ pieces: r.pieces })).length);
  const leftTurnCounts = results.map((r) => [...r.signature].filter((c) => c === 'L').length);
  const normUnjoined = normalise(unjoinedCounts);
  const normLeftTurns = normalise(leftTurnCounts);
  const technical = results.map((_, i) => (normUnjoined[i] + normLeftTurns[i]) / 2);

  const rawFit = results.map((r) => (room
    ? (r.bbox.w * r.bbox.h) / (room.w * room.h)
    : Math.min(r.bbox.w, r.bbox.h) / Math.max(r.bbox.w, r.bbox.h)));
  const fit = normalise(rawFit);

  return results.map((r, i) => ({
    ...r,
    score: lapPerMat[i] + technical[i] + fit[i],
    components: { lapPerMat: lapPerMat[i], technical: technical[i], fit: fit[i] },
  }));
}

// A stock nothing realistic is ever short against. Used to ask "what is
// constructible at all?" so that anything constructible-but-absent from
// YOUR results is blocked by inventory, and anything absent from both is
// blocked by geometry. diffStock's `used - owned` stays <= 0 against this
// for any candidate generateLayouts can actually produce.
//
// This is a large FINITE number, not Infinity. Infinity was tried first and
// breaks generateLayouts: `trueAffordableCorners` divides stock mat counts
// by a corner's own mat cost, so Infinity/n stays Infinity, and the loop a
// few lines later that walks from `maxCorners + 2` up to
// `trueAffordableCorners` to populate `unexploredCorners` then never
// reaches its own bound — confirmed by running it, which throws
// `RangeError: Set maximum size exceeded` rather than looping forever
// silently. 100,000 of each part is comfortably above anything
// generateLayouts can spend within any maxCorners/maxSide a caller would
// plausibly pass, while keeping that loop's iteration count in the tens of
// thousands instead of unbounded.
const ABUNDANT = 100_000;
function abundantStock() {
  const stock = emptyStock();
  for (const part of MAT_PARTS) stock.mats[part] = ABUNDANT;
  for (const part of BARRIER_PARTS) stock.barriers[part] = ABUNDANT;
  stock.joints.a = ABUNDANT;
  stock.joints.b = ABUNDANT;
  return stock;
}

// What you cannot build, and why. Replaces a what-if panel: for each
// character that generateLayouts(stock) does not reach, says whether a
// purchase would unlock it (`reason: 'stock'`, with the largest real
// shortfall from diffStock as `missing`) or whether no inventory ever could
// (`reason: 'geometry'`, `missing: null`). Every 'stock' reason is
// established by pricing a real built example through billOfMaterials +
// diffStock — never by a formula — and every 'geometry' reason is read from
// cornerTypesFor, the one place that owns which corner types are excluded
// from generation at all.
//
// Both enumerations here (against `stock` and against the abundant stock)
// share generateLayouts' own budget, so either can be truncated the same
// way a direct generateLayouts call can. `stopped`/`examined` surface that
// rather than silently shortening the blocked list — a truncated "what is
// constructible" pass would otherwise read to the caller as "nothing else
// is out of reach".
export function outOfReach(stock, opts = {}) {
  // The owned run stays on the caller's own opts (not a copy) so that a
  // caller who already called generateLayouts(stock, opts) directly for the
  // same reason hits generateCache here instead of paying for the same
  // enumeration twice.
  const mine = generateLayouts(stock, opts);
  const reachable = new Set(groupByCharacter(mine.results).map((c) => c.key));

  // The abundant run is forced to maxSide: 8 regardless of the caller's
  // opts — it names which CHARACTERS (outlines) exist at all, not which
  // sizes, and 8 finds the same six characters as 12 does (verified: at 6 it
  // loses "8-corner shape 1"; at 12 it finds nothing extra). That cuts this
  // call from ~4.3s to ~0.9s at two starter kits. Every other opt is still
  // taken from the caller (maxCorners, budget, etc. all still matter to
  // which characters even get explored).
  const everything = generateLayouts(abundantStock(), { ...opts, maxSide: 8 });

  const blocked = [];

  // 1. Constructible, but not with what you own. Price the cheapest variant
  //    of each character — `best` is the largest, so take the last variant,
  //    which is the smallest and therefore the easiest to afford.
  for (const character of groupByCharacter(everything.results)) {
    // Defensive: in every scenario checked, a reachable character's
    // cheapest-abundant variant was never itself short against the real
    // stock, so `rows.length === 0` below already excludes it without this
    // guard's help. Kept anyway as cheap insurance against ever reporting a
    // buildable character as out of reach — no leak has been observed.
    if (reachable.has(character.key)) continue;
    const cheapest = character.variants[character.variants.length - 1];
    const rows = diffStock(billOfMaterials(createLayout({ pieces: cheapest.pieces })), stock)
      .filter((r) => r.short > 0)
      .sort((a, b) => b.short - a.short);
    if (rows.length === 0) continue;   // affordable after all; not blocked
    blocked.push({
      key: character.key,
      name: character.name,
      corners: character.corners,
      feel: character.feel,
      reason: 'stock',
      missing: rows[0],
    });
  }

  // 2. Corner families no inventory can close a loop with. Read the
  //    exclusion from cornerTypesFor, the one place that owns it, rather
  //    than restating which types those are.
  const usable = new Set(cornerTypesFor(abundantStock()));
  for (const type of PIECE_TYPES) {
    if (usable.has(type) || !PIECES[type].label.startsWith('Corner')) continue;
    const feel = CORNER_FEEL[type];
    if (!feel || blocked.some((b) => b.feel === feel)) continue;
    blocked.push({
      key: `*|${feel}`,
      name: 'Any outline',
      corners: null,
      feel,
      reason: 'geometry',
      missing: null,
    });
  }

  return {
    blocked,
    stopped: mine.stopped || everything.stopped,
    examined: mine.examined + everything.examined,
  };
}
