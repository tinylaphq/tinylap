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
