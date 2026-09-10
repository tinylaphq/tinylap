import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout, cellKey, parseCellKey, occupancy, findOverlaps, occupiedSet, edgeId, portKey, matchPorts, openEdgeIds, isClosedCircuit, boundaryEdges, arcEdgeIds, computeBarriers, computeMetrics, placeAgainst, openPorts, enclosedInfields, maxTrackDepth, unjoinedContacts } from '../js/model.js';
import { MAT_MM } from '../js/geometry.js';
import { stockL } from '../js/presets.js';
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
  assert.deepEqual(counts, { straight: 4, curve: 1, curveLarge: 0, cornerCap: 0 });
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
// side by side and do not connect. Each walls its own E/W edge, and the
// shared edge must carry one barrier serving both lanes.
test('two pieces touching without a join still get a wall between them', () => {
  const layout = createLayout({ pieces: [
    { type: 'straight', x: 0, y: 0, rot: 0 },
    { type: 'straight', x: 2, y: 0, rot: 0 },
  ] });
  assert.equal(matchPorts(layout).matched.size, 0, 'fixture must be unjoined');
  assert.ok(boundaryEdges(layout).has(edgeId([1, 0], 'E')), 'shared edge must be walled');
  assert.equal(computeBarriers(layout).counts.straight, 3);
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
