import test from 'node:test';
import assert from 'node:assert/strict';
import { turnSignatures, outlineName, buildLoop, canonicalLayoutKey, generateLayouts, closes } from '../js/generate.js';
import { createLayout, isClosedCircuit, findOverlaps, occupiedSet } from '../js/model.js';
import { stockFromKits, billOfMaterials, diffStock } from '../js/inventory.js';
import { stockL } from '../js/presets.js';

test('four corners give exactly one outline: the rectangle', () => {
  assert.deepEqual(turnSignatures(4), ['RRRR']);
});

test('six corners give exactly one outline: the L', () => {
  const sigs = turnSignatures(6);
  assert.equal(sigs.length, 1);
  assert.equal(sigs[0].length, 6);
  assert.equal([...sigs[0]].filter((c) => c === 'R').length, 5);
  assert.equal([...sigs[0]].filter((c) => c === 'L').length, 1);
});

test('eight corners give several distinct outlines', () => {
  const sigs = turnSignatures(8);
  // Confirmed independently by Burnside's lemma, not just by running this
  // module: n=8 has exactly 4 classes, n=10 has exactly 8.
  assert.equal(sigs.length, 4);
  for (const s of sigs) {
    assert.equal(s.length, 8);
    assert.equal([...s].filter((c) => c === 'R').length, 6);
  }
  assert.equal(new Set(sigs).size, sigs.length, 'no duplicates');
  assert.equal(turnSignatures(10).length, 8);
});

test('odd or too-small corner counts yield nothing', () => {
  assert.deepEqual(turnSignatures(3), []);
  assert.deepEqual(turnSignatures(5), []);
  assert.deepEqual(turnSignatures(2), []);
});

test('the two small outlines have friendly names', () => {
  assert.equal(outlineName('RRRR'), 'Rectangle');
  assert.equal(outlineName(turnSignatures(6)[0]), 'L-shape');
});

test('larger outlines fall back to an honest generic name', () => {
  // We do not claim to know which 8-corner class is "the T" and which is
  // "the U" — naming them would be inventing knowledge we have not verified.
  assert.match(outlineName(turnSignatures(8)[0]), /8-corner shape/);
});

test('a rectangle outline with equal sides closes', () => {
  const pieces = buildLoop({ signature: 'RRRR', sides: [3, 5, 3, 5], cornerType: 'cornerR30' });
  assert.ok(pieces, 'expected a closed loop');
  const l = createLayout({ pieces });
  assert.deepEqual(findOverlaps(l), []);
  assert.equal(isClosedCircuit(l), true);
});

test('the built rectangle is the 7x9 ring the rest of the suite already trusts', () => {
  const pieces = buildLoop({ signature: 'RRRR', sides: [3, 5, 3, 5], cornerType: 'cornerR30' });
  assert.equal(occupiedSet(createLayout({ pieces })).size, 48);
});

test('a rectangle outline with mismatched sides does not close', () => {
  assert.equal(buildLoop({ signature: 'RRRR', sides: [3, 5, 4, 5], cornerType: 'cornerR30' }), null);
});

test('zero-length sides are allowed: four corners butted together close', () => {
  const pieces = buildLoop({ signature: 'RRRR', sides: [0, 0, 0, 0], cornerType: 'cornerR30' });
  assert.ok(pieces);
  assert.equal(occupiedSet(createLayout({ pieces })).size, 16);
});

test('an L outline (with its one left turn) closes', () => {
  const pieces = buildLoop({
    signature: turnSignatures(6)[0],
    sides: [0, 0, 0, 3, 2, 1],
    cornerType: 'cornerR30',
  });
  assert.ok(pieces, 'expected a closed loop');
  const l = createLayout({ pieces });
  assert.deepEqual(findOverlaps(l), []);
  assert.equal(isClosedCircuit(l), true);
  assert.equal(occupiedSet(l).size, 36);
});

test('a rectangle and its quarter turn share a canonical key', () => {
  const a = buildLoop({ signature: 'RRRR', sides: [3, 5, 3, 5], cornerType: 'cornerR30' });
  const b = buildLoop({ signature: 'RRRR', sides: [5, 3, 5, 3], cornerType: 'cornerR30' });
  assert.ok(a && b);
  assert.equal(canonicalLayoutKey(a), canonicalLayoutKey(b));
});

test('a translated layout shares a canonical key', () => {
  const a = buildLoop({ signature: 'RRRR', sides: [3, 5, 3, 5], cornerType: 'cornerR30' });
  const moved = a.map((p) => ({ ...p, x: p.x + 7, y: p.y - 3 }));
  assert.equal(canonicalLayoutKey(a), canonicalLayoutKey(moved));
});

test('genuinely different layouts have different keys', () => {
  const rect = buildLoop({ signature: 'RRRR', sides: [3, 5, 3, 5], cornerType: 'cornerR30' });
  const bigger = buildLoop({ signature: 'RRRR', sides: [4, 5, 4, 5], cornerType: 'cornerR30' });
  assert.ok(rect && bigger);
  assert.notEqual(canonicalLayoutKey(rect), canonicalLayoutKey(bigger));
});

test('a starter set generates layouts, all of them buildable', () => {
  const stock = stockFromKits({ '87033': 1 });
  const { results } = generateLayouts(stock, { maxSide: 10 });
  assert.ok(results.length > 0, 'expected some layouts');
  for (const r of results) {
    const l = createLayout({ pieces: r.pieces });
    assert.deepEqual(findOverlaps(l), [], `${r.key} overlaps`);
    assert.equal(isClosedCircuit(l), true, `${r.key} is not closed`);
    const short = diffStock(billOfMaterials(l), stock).filter((row) => row.short > 0);
    assert.deepEqual(short, [], `${r.key} exceeds stock`);
  }
});

test('results are deduplicated', () => {
  const { results } = generateLayouts(stockFromKits({ '87033': 1 }), { maxSide: 10 });
  const keys = results.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('the stock L is among the generated results', () => {
  const { results } = generateLayouts(stockFromKits({ '87033': 1 }), { maxSide: 10 });
  const target = canonicalLayoutKey(stockL());
  assert.ok(results.some((r) => r.key === target), 'the trusted stock-L fixture was not generated');
});

test('a room boundary shrinks the result set', () => {
  const stock = stockFromKits({ '87033': 1 });
  const all = generateLayouts(stock, { maxSide: 10 });
  const small = generateLayouts(stock, { maxSide: 10, room: { w: 7, h: 7 } });
  assert.ok(small.results.length < all.results.length);
  for (const r of small.results) {
    assert.ok(r.bbox.w <= 7 && r.bbox.h <= 7, `${r.key} does not fit the room`);
  }
});

test('hitting the budget is reported, never silent', () => {
  const out = generateLayouts(stockFromKits({ '87031': 4 }), { maxSide: 14, budget: 200 });
  assert.equal(out.stopped, true);
  assert.ok(out.examined >= 200);
});

test('closes() never rejects a tuple that buildLoop can actually build', () => {
  // The pre-filter is a performance optimisation; it must never lose a
  // layout. This exhaustively cross-checks it against the builder for
  // small tuples, across every outline — not just the rectangle, whose
  // symmetric headings hide errors in the corner-displacement term.
  for (const corners of [4, 6]) {
    for (const signature of turnSignatures(corners)) {
      const max = 3;
      const tuples = [];
      const walk = (i, acc) => {
        if (i === corners) { tuples.push([...acc]); return; }
        for (let n = 0; n <= max; n++) walk(i + 1, [...acc, n]);
      };
      walk(0, []);
      for (const sides of tuples) {
        if (buildLoop({ signature, sides, cornerType: 'cornerR30' })) {
          assert.ok(closes(signature, sides, 'cornerR30'),
            `closes() rejected a buildable tuple: ${signature} ${sides}`);
        }
      }
    }
  }
});

test('deduplicating tuples before building loses no layouts', () => {
  // The tuple-level canonical filter is an optimisation. It must produce
  // exactly the same set of layouts as building everything and collapsing
  // afterwards -- if it ever prunes a distinct shape, the suggestion list
  // silently loses options and nothing else would notice.
  const stock = stockFromKits({ '87033': 1 });
  const fast = new Set(generateLayouts(stock, { maxSide: 6 }).results.map((r) => r.key));
  const slow = new Set(generateLayouts(stock, { maxSide: 6, skipTupleDedup: true }).results.map((r) => r.key));
  assert.deepEqual([...fast].sort(), [...slow].sort());
});
