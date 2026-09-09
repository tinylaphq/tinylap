import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../js/presets.js';
import {
  createLayout, findOverlaps, isClosedCircuit, computeBarriers, computeMetrics,
} from '../js/model.js';
import { KITS, billOfMaterials } from '../js/inventory.js';

// Task 16: reconcile the stock L against the 87033 contents (spec 13.2).
//
// Correction: this suite originally only asserted the L topology's certain
// invariants (closed circuit, 6 quarter-rounds/caps/curves) and reported
// the mat/straight counts without asserting them, because the initial
// analysis in spec 13.2 concluded the 87033 figures could not all hold at
// once for a real 2-mat-wide L ring. That analysis was wrong — see the
// Task 16 result in spec 13.2. The constructed ring below matches the
// 87033 kit's contents exactly (mats, straights, bounding box and joints),
// so those figures are now asserted, not just reported.
//
// This proves the 87033 figures are jointly achievable, and that *this*
// construction achieves them — not that it is the exact layout Kyosho
// drew in the manual. See spec 13.2 for that caveat.

const stockL = () => createLayout({ pieces: PRESETS.find((p) => p.id === 'stock-l').pieces });

test('the stock L is a closed circuit with no overlaps', () => {
  const layout = stockL();
  assert.deepEqual(findOverlaps(layout), []);
  assert.equal(isClosedCircuit(layout), true);
});

test('an L ring needs six quarter-round mats, as the box ships', () => {
  const { mats } = computeMetrics(stockL());
  assert.equal(mats.quarterRound, 6);
});

test('an L ring needs six corner caps and six curve barriers, as the box ships', () => {
  const { counts } = computeBarriers(stockL());
  assert.equal(counts.cornerCap, 6);
  assert.equal(counts.curve, 6);
});

test('the stock L derives the 87033 kit contents exactly', () => {
  const layout = stockL();
  const { counts } = computeBarriers(layout);
  const { mats, bbox, matCount } = computeMetrics(layout);
  const { joints } = billOfMaterials(layout);
  const kit = KITS['87033'];

  // The figures below (bbox, matCount, mats.square, counts.straight,
  // joints) are the ones reconciled against the 87033 kit contents — kept
  // available here for whoever next needs to eyeball them, but not printed
  // on every passing run.

  assert.equal(bbox.w, 7);
  assert.equal(bbox.h, 9);
  assert.equal(matCount, 48);
  assert.equal(mats.square, kit.mats.square);
  assert.equal(counts.straight, kit.barriers.straight);
  assert.equal(joints.a, kit.joints.a);
  assert.equal(joints.b, kit.joints.b);
});
