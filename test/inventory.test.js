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

// I6: recommendKit already returned null for "nothing short" (asserted
// above) — pin the OTHER null case too, where something is short but no
// single kit's stock clears it. Checked headlessly first: the biggest
// single kit's straight-barrier count is 87031's 72, so 60 (an earlier
// candidate figure) is actually clearable by 87031 alone and would NOT
// pin this branch — 100 straights against empty stock exceeds every kit's
// count on its own and reliably has no single-kit candidate.
test('a shortfall no single kit can clear recommends nothing', () => {
  const rows = diffStock(
    { mats: {}, barriers: { straight: 100 }, joints: { a: 0, b: 0 } },
    emptyStock(),
  );
  assert.ok(rows.some((r) => r.short > 0));
  assert.equal(recommendKit(rows), null);
});
