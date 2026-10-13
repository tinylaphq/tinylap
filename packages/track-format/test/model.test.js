// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout, cellKey, parseCellKey, occupancy, findOverlaps, occupiedSet, edgeId, portKey, matchPorts, openEdgeIds, isClosedCircuit, boundaryEdges, arcEdgeIds, computeBarriers, computeMetrics, placeAgainst, openPorts, enclosedInfields, maxTrackDepth, unjoinedContacts, subWidthNotches } from '../model.js';
import { MAT_MM } from '../geometry.js';
import { stockL } from '../reference-layouts.js';
import { fourCornerLoop, rectangularRing } from './fixtures.js';

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

// I6: cornerR60 was never exercised through the boundary walk. R60 is the
// provisional piece (spec §13.1), and the Large Corner kit (87033-02) is
// exactly the purchase this app's recommendation exists to advise on, so
// getting computeBarriers right for it matters more than for any other
// single piece. R60 is the provisional piece (spec 13.1) and the Large
// Corner kit is exactly the purchase this app advises, so it needs real
// coverage.
//
// The zero-cap assertion is the load-bearing one. The large corner sweeps
// the INSIDE of the turn: its two shaped mats flank the empty infield cell
// and their cut corners form one continuous arc around it, leaving no
// sharp apex to close. That is corroborated by the kit contents —
// 87033-02 ships two shaped mats and two curve halves per corner and *no
// corner caps at all*, which it would have to if the inner corner were a
// capped apex. An earlier model put the arc on the outside and needed a
// cap borrowed from the base set; if this assertion ever goes back to 1,
// the geometry has regressed to that reading.
test('a lone R60 corner sweeps its inside and rounds its outside, with no cap', () => {
  const l = createLayout({ pieces: [{ type: 'cornerR60', x: 0, y: 0, rot: 0 }] });
  const { counts } = computeBarriers(l);
  assert.deepEqual(counts, { straight: 4, curve: 1, curveLarge: 2, cornerCap: 0 });
  // The split between kit and base set is the check that matters: the kit
  // supplies only the two shaped mats and the two large curve halves, and
  // 87033-02 ships exactly four corners' worth of those and nothing else.
  const { mats } = computeMetrics(l);
  assert.deepEqual(mats, { square: 5, quarterRound: 1, arcLarge: 2 });
});

// I6, revised by task 11: this fixture used to exercise the arc-skip branch
// (computeBarriers's `if (!claimed.every(...)) continue;`) — butting a
// straight against an R30 corner's outer arc edge used to leave that edge
// off the occupied-cell boundary (both neighbouring cells were occupied,
// by different, unjoined pieces), so the arc's claim failed and it was
// skipped. That was actually two instances of the same bug task 11 fixes:
// the corner and the straight share TWO edges (H:0:2, under the arc, and
// H:1:2, next to it), and neither had a wall at all — verified headlessly
// via unjoinedContacts(layout), which reports exactly ['H:0:2', 'H:1:2'].
// Task 11 wires those into boundaryEdges as unjoined-contact walls, so both
// of the arc's claimed edges (H:0:2 and V:0:1) are now present and the arc
// IS claimed: curve goes back to 1, and H:1:2 — previously missing
// entirely — now correctly counts as a straight.
//
// This also resolves the "known consequence" flagged by the original I6
// comment: computeMetrics.mats always counted the corner's quarterRound
// mat regardless of whether its arc barrier was walled, which used to
// disagree with a curve count of 0 here. Now mats and barriers agree.
//
// Task 13, revised again: H:1:2 is an unjoined CONTACT edge (both pieces
// touch there without joining), not plain outline, so it now carries two
// straight barriers rather than one — each piece mounts its own wall on
// its own tile; there is no shared barrier (see computeBarriers). H:0:2 is
// claimed by the arc instead and so never reaches the straight count at
// all, doubled or not. straight is 5: three plain outline edges at 1 each,
// plus H:1:2 at 2.
//
// The arc-skip branch itself is no longer exercised by any fixture in this
// suite — the only way left to hit it is a matched port that happens to
// coincide with one of an arc's own edges, which no piece definition
// produces. Left in place as defensive code, not dead-code-eliminated.
test('a piece butted against a corner arc\'s outer edge now gets both edges walled, arc included', () => {
  const l = createLayout({ pieces: [
    { type: 'cornerR30', x: 0, y: 0, rot: 0 },
    { type: 'straight', x: 0, y: 2, rot: 0 },
  ] });
  assert.deepEqual(findOverlaps(l), []);
  assert.deepEqual(unjoinedContacts(l).sort(), ['H:0:2', 'H:1:2']);
  const { counts } = computeBarriers(l);
  // Four, not five. H:0:2 and H:1:2 are the STRAIGHT's own N port — an
  // opening in its wall — so the straight contributes nothing there and
  // only the corner's flank is walled. The arc then takes H:0:2, leaving
  // H:1:2 plus the corner's V:0:0 and the straight's V:0:2 and V:2:2.
  // An earlier revision counted these edges twice (treating any unjoined
  // contact as two walls regardless of ports) and a still earlier one
  // counted them zero times; both were wrong.
  assert.deepEqual(counts, { straight: 4, curve: 1, curveLarge: 0, cornerCap: 0 });
});

test('an arc takes one wall off a shared edge, not both', () => {
  // The bug commit 56a9f68 was named for, which until now had no test that
  // could fail: computeBarriers deleted an edge outright when an arc
  // claimed it, so on an edge carrying TWO walls the neighbouring piece's
  // straight wall vanished from both the count and straightEdgeIds — the
  // gap the owner reported where a straight met a corner.
  //
  // The existing I6 fixture cannot catch it: there the shared edge carries
  // only one wall, and deleting it is indistinguishable from decrementing
  // it. This one needs an edge that is both an arc edge AND a two-wall
  // contact, which is what the R30's SW arc against this straight gives.
  const layout = createLayout({ pieces: [
    { type: 'cornerR30', x: 0, y: 0, rot: 0 },
    { type: 'straight', x: 0, y: 2, rot: 90 },
  ] });
  assert.deepEqual(findOverlaps(layout), []);
  const { counts, straightEdgeIds } = computeBarriers(layout);
  // The arc takes its side of H:0:2; the straight's own wall stays.
  assert.ok(straightEdgeIds.includes(edgeId([0, 2], 'N')),
    'the straight lost its wall on the edge the arc claimed');
  assert.equal(counts.straight, 4);
  assert.equal(counts.curve, 1);
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

test('a real track encloses exactly one infield', () => {
  assert.equal(enclosedInfields(createLayout({ pieces: stockL() })), 1);
  assert.equal(enclosedInfields(createLayout({ pieces: rectangularRing() })), 1);
});

test('a solid block of mats encloses no infield at all', () => {
  // Four corners butted together: port-closed and overlap-free, but a 4x4
  // field with a wall round it — the case the user reported. This is the
  // same fixture already proven closed and overlap-free above.
  const layout = createLayout({ pieces: fourCornerLoop() });
  assert.equal(enclosedInfields(layout), 0);
  // It really is closed — this is precisely why isClosedCircuit is not enough.
  assert.equal(isClosedCircuit(layout), true);
});

test('a real track is exactly two mats wide', () => {
  assert.equal(maxTrackDepth(createLayout({ pieces: stockL() })), 2);
  assert.equal(maxTrackDepth(createLayout({ pieces: rectangularRing() })), 2);
});

// Task 9's enclosedInfields === 1 check is necessary but not sufficient: a
// loop that runs back alongside itself can be four mats wide (a thick slab
// with a small hole in it) and still enclose exactly one infield. This
// fixture is a real generator output, not hand-invented geometry — pulled
// from generateLayouts(stockFromKits({'87033':2}), { maxSide: 10 }).results
// before the maxTrackDepth filter existed (it was 1 of 44 depth-4 results
// out of 299, see test/generate.test.js and task-10-report.md).
function fourMatSlab() {
  return [
    { type: 'cornerR30', x: 0, y: 0, rot: 0 },
    { type: 'cornerR30', rot: 180, x: 0, y: -2 },
    { type: 'cornerR30', rot: 90, x: -2, y: -2 },
    { type: 'cornerR30', rot: 270, x: -2, y: 0 },
    { type: 'cornerR30', rot: 0, x: -4, y: 0 },
    { type: 'straight', rot: 0, x: -4, y: -1 },
    { type: 'straight', rot: 0, x: -4, y: -2 },
    { type: 'straight', rot: 0, x: -4, y: -3 },
    { type: 'cornerR30', rot: 90, x: -4, y: -5 },
    { type: 'straight', rot: 90, x: -2, y: -5 },
    { type: 'straight', rot: 90, x: -1, y: -5 },
    { type: 'straight', rot: 90, x: 0, y: -5 },
    { type: 'straight', rot: 90, x: 1, y: -5 },
    { type: 'cornerR30', rot: 180, x: 2, y: -5 },
    { type: 'straight', rot: 0, x: 2, y: -3 },
    { type: 'straight', rot: 0, x: 2, y: -2 },
    { type: 'straight', rot: 0, x: 2, y: -1 },
    { type: 'cornerR30', rot: 270, x: 2, y: 0 },
  ];
}

test('a four-mat-wide slab with one hole passes the infield check but fails the width check', () => {
  const layout = createLayout({ pieces: fourMatSlab() });
  assert.equal(enclosedInfields(layout), 1);
  assert.equal(maxTrackDepth(layout), 4);
});

test('a real track has no unjoined piece contacts', () => {
  assert.deepEqual(unjoinedContacts(createLayout({ pieces: stockL() })), []);
  assert.deepEqual(unjoinedContacts(createLayout({ pieces: rectangularRing() })), []);
});

// Barriers belong to the pieces, not the outline: a straight carries a
// barrier down each long side. Two of the slab's own straight runs sit
// edge-adjacent without ever connecting through a matched port, so the
// shared edge between them has no barrier at all — the same fixture the
// width check catches, caught here for a different, more direct reason.
test('the four-mat-wide slab has unjoined piece contacts', () => {
  const layout = createLayout({ pieces: fourMatSlab() });
  assert.ok(unjoinedContacts(layout).length > 0);
});

// Task 13: a real generator output with exactly one sub-width notch — the
// "8-corner shape 1" candidate (signature LLRRRRRR, sides
// [0,1,0,1,3,7,3,1], cornerR30) pulled from
// generateLayouts(stockFromKits({'87033':2})).results before the notch
// filter existed. Deliberately NOT the doubled-back case: zero unjoined
// contacts, one enclosed infield, a valid closed circuit — this is the
// "rectangle with a pimple" bug entirely on its own, a single loop whose
// own outline pinches to one mat wide at one point. See
// test/generate.test.js for the same fixture rebuilt via buildLoop and
// proven rejected by generateLayouts.
function eightCornerPimple() {
  return [
    { type: 'cornerR30', x: 0, y: 0, rot: 0 },
    { type: 'cornerR30', rot: 180, x: 0, y: -2 },
    { type: 'straight', rot: 90, x: -1, y: -2 },
    { type: 'cornerR30', rot: 90, x: -3, y: -2 },
    { type: 'cornerR30', rot: 270, x: -3, y: 0 },
    { type: 'straight', rot: 90, x: -4, y: 0 },
    { type: 'cornerR30', rot: 0, x: -6, y: 0 },
    { type: 'straight', rot: 0, x: -6, y: -1 },
    { type: 'straight', rot: 0, x: -6, y: -2 },
    { type: 'straight', rot: 0, x: -6, y: -3 },
    { type: 'cornerR30', rot: 90, x: -6, y: -5 },
    { type: 'straight', rot: 90, x: -4, y: -5 },
    { type: 'straight', rot: 90, x: -3, y: -5 },
    { type: 'straight', rot: 90, x: -2, y: -5 },
    { type: 'straight', rot: 90, x: -1, y: -5 },
    { type: 'straight', rot: 90, x: 0, y: -5 },
    { type: 'straight', rot: 90, x: 1, y: -5 },
    { type: 'straight', rot: 90, x: 2, y: -5 },
    { type: 'cornerR30', rot: 180, x: 3, y: -5 },
    { type: 'straight', rot: 0, x: 3, y: -3 },
    { type: 'straight', rot: 0, x: 3, y: -2 },
    { type: 'straight', rot: 0, x: 3, y: -1 },
    { type: 'cornerR30', rot: 270, x: 3, y: 0 },
    { type: 'straight', rot: 90, x: 2, y: 0 },
  ];
}

// Calibration (the brief's explicit requirement): both real, physically-
// built layouts must score zero sub-width notches. Mutation-tested against
// a scratch copy using morphological OPENING instead of CLOSING (the
// disproved first attempt) — opening scores 0 on every one of these three
// fixtures INCLUDING the pimple, since opening detects thin TRACK and this
// track is two mats wide everywhere; only closing (detecting thin GAPS)
// tells the pimple apart from the two real tracks. So this test can fail
// two different ways: a regression to opening fails the third assertion,
// and a broken closing (e.g. wrong structuring element, or missing the
// origin so it stops being extensive) can just as easily fail the first two.
test('a sub-width notch is detected; real tracks score zero', () => {
  assert.equal(subWidthNotches(createLayout({ pieces: stockL() })), 0);
  assert.equal(subWidthNotches(createLayout({ pieces: rectangularRing() })), 0);

  const pimple = createLayout({ pieces: eightCornerPimple() });
  assert.deepEqual(findOverlaps(pimple), []);
  assert.equal(isClosedCircuit(pimple), true, 'fixture must be a valid closed circuit');
  assert.equal(enclosedInfields(pimple), 1, 'fixture must be a valid single-infield track');
  assert.deepEqual(unjoinedContacts(pimple), [], 'fixture is the pimple case, not the doubled-back case');
  assert.equal(subWidthNotches(pimple), 1, 'expected exactly one sub-width notch');
});

// Task 11 safety property: both real tracks have zero unjoined contacts
// (proven above), so walling unjoined contacts must not change their
// barrier counts at all. Pinned to the exact figures measured on the code
// before task 11's fix, not to whatever boundaryEdges happens to produce
// now — that is what makes this an invariance proof rather than a tautology.
test('walling unjoined contacts leaves both real tracks\' barrier counts untouched', () => {
  assert.deepEqual(computeBarriers(createLayout({ pieces: stockL() })).counts, {
    straight: 36, curve: 6, curveLarge: 0, cornerCap: 6,
  });
  assert.deepEqual(computeBarriers(createLayout({ pieces: rectangularRing() })).counts, {
    straight: 40, curve: 4, curveLarge: 0, cornerCap: 4,
  });
});

// A straight is two mats wide and one long with N/S ports, so these sit
// side by side and do not connect. Each piece mounts its OWN wall on its
// own tile at that seam — there is no shared barrier between two lanes
// that merely touch without joining (real halves don't share hardware; the
// user, who owns the physical kit, corrected an earlier "shared barrier"
// assumption here). So the shared edge carries TWO barriers, not one: this
// pair's own two long sides (2) plus both of the seam's own halves (2) is
// 4, not the 3 a shared-barrier model would give.
test('two pieces touching without a join get a wall on each side of the seam', () => {
  const layout = createLayout({ pieces: [
    { type: 'straight', x: 0, y: 0, rot: 0 },
    { type: 'straight', x: 2, y: 0, rot: 0 },
  ] });
  assert.equal(matchPorts(layout).matched.size, 0, 'fixture must be unjoined');
  assert.ok(boundaryEdges(layout).has(edgeId([1, 0], 'E')), 'shared edge must be walled');
  assert.equal(computeBarriers(layout).counts.straight, 4);
});

// Stacked along the travel axis: these DO connect, so the shared edge
// stays open and the count must not move. This is the guard that matters:
// if it moves, the fix is walling joins it should not.
test('joining two pieces end to end adds no wall between them', () => {
  const layout = createLayout({ pieces: [
    { type: 'straight', x: 0, y: 0, rot: 0 },
    { type: 'straight', x: 0, y: 1, rot: 0 },
  ] });
  assert.equal(matchPorts(layout).matched.size, 1, 'fixture must be joined');
  assert.equal(computeBarriers(layout).counts.straight, 4);
});
