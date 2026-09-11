import test from 'node:test';
import assert from 'node:assert/strict';
import { turnSignatures, outlineName, buildLoop, canonicalLayoutKey, generateLayouts, closes, groupByCharacter, outOfReach, scoreLayouts } from '../js/generate.js';
import { createLayout, isClosedCircuit, findOverlaps, occupiedSet, enclosedInfields, unjoinedContacts, maxTrackDepth, subWidthNotches, boundaryEdges } from '../js/model.js';
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

test('every generated layout is a real track, not a solid field of mats', () => {
  for (const kits of [{ '87033': 1 }, { '87033': 2 }]) {
    const { results } = generateLayouts(stockFromKits(kits), { maxSide: 10 });
    assert.ok(results.length > 0, 'fixture is only meaningful if something generates');
    for (const r of results) {
      assert.equal(enclosedInfields(createLayout({ pieces: r.pieces })), 1,
        `${kits['87033']} kit(s): a result encloses the wrong number of infields`);
    }
  }
});

// Task 13 (user approved, "the suggestions are mostly garbage"): the ban on
// any unjoined piece contact used to sit here and reject 20 of 41 one-kit
// results and 180 of 300 two-kit results — including every S-bend and
// offset chicane, the only genuinely interesting tracks this generator can
// make. That ban is GONE. It is not replaced by weakening it or moving it
// -- the two invariant tests below are what actually protects the user's
// original complaint now: enclosedInfields === 1 (kept, above) and every
// unjoined contact still carrying a wall (next test). Proving the ban is
// really lifted, not just that this file stopped checking for it:
test('layouts that run back past themselves are allowed through now', () => {
  const { results } = generateLayouts(stockFromKits({ '87033': 2 }), { maxSide: 10 });
  const withContact = results.filter(
    (r) => unjoinedContacts(createLayout({ pieces: r.pieces })).length > 0,
  );
  assert.ok(withContact.length > 0,
    'expected at least one chicane/double-back layout now the contact ban is gone');
});

// The replacement for the ban above: every unjoined inter-piece contact
// edge must appear in boundaryEdges(layout). This is the actual guarantee
// against the user's original two bug reports (a 4-wide open field with no
// barrier down the middle) — it is a property of the barrier model
// (Task 11, commit 51ceffe), not a restriction on which shapes the
// generator offers, so it holds regardless of whether a given layout has
// any contacts to begin with. Mutation-tested: reverting boundaryEdges to
// its pre-Task-11 behaviour (stop walling unjoined contacts) makes this
// fail on every one of the 776 contact edges across both inventories below
// — verified against a scratch copy, not asserted on faith.
test('every unjoined inter-piece contact carries a wall', () => {
  for (const kits of [{ '87033': 1 }, { '87033': 2 }]) {
    const { results } = generateLayouts(stockFromKits(kits), { maxSide: 10 });
    assert.ok(results.length > 0, 'fixture is only meaningful if something generates');
    for (const r of results) {
      const l = createLayout({ pieces: r.pieces });
      const edges = boundaryEdges(l);
      for (const id of unjoinedContacts(l)) {
        assert.ok(edges.has(id),
          `${kits['87033']} kit(s): ${r.key} has an unwalled unjoined contact at ${id}`);
      }
    }
  }
});

// maxTrackDepth <= 2 is no longer true of every generated layout, and
// legitimately so: a doubled-back pair of lanes is four mats deep across
// the pair, with a wall down the middle (see the invariant test above) —
// not the unbarriered 4-wide slab the old bound was guarding against.
// maxTrackDepth itself stays a useful MEASUREMENT (see model.js), just not
// a bound enforced here any more.
test('every generated layout has zero sub-width notches', () => {
  for (const kits of [{ '87033': 1 }, { '87033': 2 }]) {
    const { results } = generateLayouts(stockFromKits(kits), { maxSide: 10 });
    assert.ok(results.length > 0, 'fixture is only meaningful if something generates');
    for (const r of results) {
      assert.equal(subWidthNotches(createLayout({ pieces: r.pieces })), 0,
        `${kits['87033']} kit(s): ${r.key} has a sub-width notch`);
    }
  }
});

// The test above can't fail on its own at these two inventories' default
// variant cap — the notch-bearing candidates the search finds happen to
// sit past the cap. This pins one down directly instead: a real candidate
// generateLayouts(stockFromKits({'87033':2})) reaches (LLRRRRRR,
// sides [0,1,0,1,3,7,3,1], cornerR30 — an "8-corner shape 1"), closed,
// one infield, ZERO unjoined contacts (the pimple bug is not the
// doubled-back case), affordable, and with exactly one sub-width notch.
// Confirmed by removing the filter on a scratch copy: with it gone this
// exact key IS among the results; with it in place (here) it is not.
test('a known sub-width-notch candidate is rejected, not merely rare', () => {
  const pimple = buildLoop({
    signature: 'LLRRRRRR',
    sides: [0, 1, 0, 1, 3, 7, 3, 1],
    cornerType: 'cornerR30',
  });
  assert.ok(pimple, 'expected this tuple to close');
  const l = createLayout({ pieces: pimple });
  assert.equal(isClosedCircuit(l), true, 'fixture must be a valid closed circuit');
  assert.equal(enclosedInfields(l), 1, 'fixture must be a valid single-infield track');
  assert.deepEqual(unjoinedContacts(l), [], 'fixture is the pimple case, not the doubled-back case');
  assert.equal(subWidthNotches(l), 1, 'fixture must actually have the notch this test is about');
  assert.ok(
    diffStock(billOfMaterials(l), stockFromKits({ '87033': 2 })).every((row) => row.short === 0),
    'fixture must be affordable, or its absence from results would be explained by stock, not the notch filter',
  );

  const { results } = generateLayouts(stockFromKits({ '87033': 2 }), { maxSide: 10 });
  const key = canonicalLayoutKey(pimple);
  assert.ok(!results.some((r) => r.key === key), 'the notch filter should have rejected this candidate');
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

// generateLayouts memoises by stock CONTENTS, not object identity (see the
// cache comment in generate.js) — stockFromKits builds a fresh object every
// call, so a cache keyed on identity would never hit for a real repeat open
// of the presets dialog.
test('the memo treats equal-but-not-identical stock objects as the same call', () => {
  const a = stockFromKits({ '87033': 1 });
  const b = stockFromKits({ '87033': 1 });
  assert.notEqual(a, b, 'fixture is only meaningful if the two stocks are distinct objects');
  const keysA = generateLayouts(a, { maxSide: 8 }).results.map((r) => r.key).sort();
  const keysB = generateLayouts(b, { maxSide: 8 }).results.map((r) => r.key).sort();
  assert.deepEqual(keysB, keysA);
});

// This is the half that actually matters: a cache bug here would show the
// user suggestions for an inventory they no longer have. It is not enough
// for a different stock to return a different-SIZED result — membership can
// diverge while a count coincidentally matches (that has already bitten
// this project once) — so this checks actual key membership, and then
// specifically re-queries the SMALLER stock after the cache has already been
// warmed by the LARGER one, to prove the smaller query doesn't leak the
// larger one's (cached) answer.
test('the memo never serves one stock\'s results for a different stock', () => {
  const rich = stockFromKits({ '87033': 2 });
  const poor = stockFromKits({ '87033': 1 });

  // Warm the cache with the richer stock first.
  const richKeys = new Set(generateLayouts(rich, { maxSide: 8 }).results.map((r) => r.key));

  // Now query the poorer stock. If the cache ignored stock contents this
  // could wrongly hand back the richer stock's (already-cached) answer.
  const poorResults = generateLayouts(poor, { maxSide: 8 }).results;
  const poorKeys = new Set(poorResults.map((r) => r.key));

  assert.ok(richKeys.size > 0 && poorKeys.size > 0, 'fixture is only meaningful if both sides produce something');
  assert.notDeepEqual([...poorKeys].sort(), [...richKeys].sort());
  assert.ok([...richKeys].some((k) => !poorKeys.has(k)), 'two kits must unlock at least one layout one kit cannot build');

  // Independently verify every "poor" result really is buildable from the
  // poor stock — not merely different from rich's set by accident, but
  // actually correct for the stock just queried.
  for (const r of poorResults) {
    const short = diffStock(billOfMaterials(createLayout({ pieces: r.pieces })), poor).filter((row) => row.short > 0);
    assert.deepEqual(short, [], `${r.key} is not actually buildable from the poorer stock just queried`);
  }
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

test('generation uses regular corners only; large corners cannot tile a loop', () => {
  // A large corner is a substitution into an otherwise-regular layout, not
  // a family of its own: two R60 corners connect fine, but no closed
  // R60-only loop exists -- none found across 16,250 tuples covering every
  // 4- and 6-corner outline with sides to 4, nor any rectangle with sides
  // to 14. Enumerating them only burns budget on candidates that can never
  // close. Reinstating cornerR60 needs that result overturned first.
  const stock = stockFromKits({ '87033': 1, '87033-02': 1 });
  const { results } = generateLayouts(stock, { maxSide: 8 });
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => r.cornerType === 'cornerR30'));
});

test('stopping corner-count climbs early loses no layouts', () => {
  // The monotonicity assumption -- more corners always costs strictly more
  // mats, so an unaffordable corner count means every larger one is too --
  // is an assumption, not a proof, so it gets the same treatment as the
  // tuple-dedup optimisation: run it against the unoptimised search and
  // require an identical set of layout keys.
  //
  // This has to satisfy two things at once, or it proves nothing:
  //  1. More than one corner count must actually contribute results.
  //     Otherwise a stop firing anywhere at or after the first productive
  //     count -- whether for the right reason (a later count truly empty)
  //     or a wrong one (e.g. stopping unconditionally after any completed
  //     count) -- yields the same result set, and the key-set assertion
  //     below could not tell a correct stop from a broken one.
  //  2. A later count must genuinely be empty, so the real stop actually
  //     fires and skips real work -- otherwise the `examined` assertion
  //     (which is what proves the optimisation engages at all, as opposed
  //     to both runs coincidentally doing the same thing) would fail even
  //     against correct code.
  // Two starter sets afford up to 12 corners by mat count, and a 7x7 room
  // is small enough that nothing past corners=6 ever fits, while both
  // corners=4 and corners=6 do produce results (6 and 1 respectively,
  // measured). So corners=8 cleanly finds zero and the real stop skips
  // corners=10 for real (examined 127 vs 712, unoptimised, in manual
  // measurement) -- while a stop that wrongly breaks after corners=4
  // would lose the single corners=6 result, which this test would catch.
  const stock = stockFromKits({ '87033': 2 });
  const opts = { maxSide: 2, maxCorners: 10, room: { w: 7, h: 7 } };
  const withStop = generateLayouts(stock, opts);
  const withoutStop = generateLayouts(stock, { ...opts, skipCornerCountStop: true });
  assert.ok(withStop.examined < withoutStop.examined, 'the stop should have skipped real work');
  assert.deepEqual(
    [...new Set(withStop.results.map((r) => r.key))].sort(),
    [...new Set(withoutStop.results.map((r) => r.key))].sort(),
  );
});

test('unexploredCorners names counts skipped by the cap, not by unaffordability', () => {
  // A single starter set only ever affords up to 6 corners (6 quarter-round
  // mats), so nothing beyond that is "unexplored because of the cap" -- it
  // is simply impossible regardless of maxCorners.
  const single = generateLayouts(stockFromKits({ '87033': 1 }), { maxSide: 10 });
  assert.deepEqual(single.unexploredCorners, []);

  // Two starter sets afford up to 12 corners (12 quarter-round mats) but
  // the default maxCorners (8) stops the search well short of that --
  // 10 and 12 must be named, not silently dropped.
  const double = generateLayouts(stockFromKits({ '87033': 2 }), { maxSide: 10 });
  assert.deepEqual(double.unexploredCorners, [10, 12]);
});

test('a starter set yields exactly two characters: rectangle and L', () => {
  const { results } = generateLayouts(stockFromKits({ '87033': 1 }), { maxSide: 10 });
  const chars = groupByCharacter(results);
  assert.equal(chars.length, 2, chars.map((c) => c.name).join(', '));
  assert.deepEqual(chars.map((c) => c.name).sort(), ['L-shape', 'Rectangle']);
  for (const c of chars) assert.equal(c.feel, 'tight');
});

test('every character keeps its variants, best first by mat count', () => {
  const { results } = generateLayouts(stockFromKits({ '87033': 1 }), { maxSide: 10 });
  for (const c of groupByCharacter(results)) {
    assert.ok(c.variants.length >= 1);
    assert.equal(c.best, c.variants[0]);
    for (let i = 1; i < c.variants.length; i++) {
      assert.ok(c.variants[i - 1].matCount >= c.variants[i].matCount);
    }
  }
});

test('variants and characters are different things: many variants, few characters', () => {
  const { results } = generateLayouts(stockFromKits({ '87033': 1 }), { maxSide: 10 });
  const chars = groupByCharacter(results);
  const variants = chars.reduce((n, c) => n + c.variants.length, 0);
  assert.equal(variants, results.length);
  assert.ok(variants > chars.length, 'expected size variants to outnumber characters');
});

test('same outline but different corner feel is two characters, not one', () => {
  // cornerR60 is never actually generated (see cornerTypesFor), so this is
  // untestable through generateLayouts -- every real result is 'tight'. But
  // groupByCharacter takes plain result objects, so hand-construct two that
  // share an outline (same signature, so same outlineName) and differ only
  // in cornerType, and confirm the group key treats that as two characters.
  // Guards the brief's headline rule -- "same outline AND corner feel" --
  // which a key of `${name}` alone (dropping feel) would silently violate
  // while still passing every other test in this file.
  const rectA = { signature: 'RRRR', cornerType: 'cornerR30', matCount: 10, lapMm: 100, key: 'a' };
  const rectB = { signature: 'RRRR', cornerType: 'cornerR60', matCount: 12, lapMm: 120, key: 'b' };
  const chars = groupByCharacter([rectA, rectB]);
  assert.equal(chars.length, 2);
  assert.deepEqual(chars.map((c) => c.feel).sort(), ['sweeping', 'tight']);
  for (const c of chars) {
    assert.equal(c.name, 'Rectangle');
    assert.equal(c.variants.length, 1);
  }
});

test('a starter set cannot reach 8-corner shapes, and names the part that blocks it', () => {
  const { blocked } = outOfReach(stockFromKits({ '87033': 1 }), { maxSide: 8 });
  const eight = blocked.find((b) => b.corners === 8);
  assert.ok(eight, 'expected 8-corner shapes to be reported as out of reach');
  assert.equal(eight.reason, 'stock');
  assert.ok(eight.missing.short > 0);
  assert.match(eight.missing.label, /mat|barrier|joint/i);
});

test('what a starter set already builds is not reported as out of reach', () => {
  const stock = stockFromKits({ '87033': 1 });
  const reachable = new Set(
    groupByCharacter(generateLayouts(stock, { maxSide: 8 }).results).map((c) => c.key),
  );
  assert.ok(reachable.size > 0, 'fixture is only meaningful if something is reachable');
  for (const b of outOfReach(stock, { maxSide: 8 }).blocked) {
    assert.ok(!reachable.has(b.key), `${b.key} is buildable but was reported blocked`);
  }
});

test('sweeping corners are blocked by geometry, not by inventory', () => {
  // Owning the large corner kit must NOT flip this to reachable: no closed
  // loop of R60 corners exists at any inventory. See cornerTypesFor.
  for (const kits of [{ '87033': 1 }, { '87033': 1, '87033-02': 1 }, { '87033': 4 }]) {
    const sweeping = outOfReach(stockFromKits(kits), { maxSide: 8 }).blocked
      .find((b) => b.feel === 'sweeping');
    assert.ok(sweeping, `expected sweeping to be reported for ${JSON.stringify(kits)}`);
    assert.equal(sweeping.reason, 'geometry');
    assert.equal(sweeping.missing, null);
  }
});

test('a stock-blocked shape becomes reachable once the missing part is owned', () => {
  const one = stockFromKits({ '87033': 1 });
  const blocked = outOfReach(one, { maxSide: 8 }).blocked.filter((b) => b.reason === 'stock');
  assert.ok(blocked.length > 0, 'fixture is only meaningful if something is stock-blocked');
  const rich = groupByCharacter(
    generateLayouts(stockFromKits({ '87033': 4 }), { maxSide: 8 }).results,
  );
  const richKeys = new Set(rich.map((c) => c.key));
  assert.ok(
    blocked.some((b) => richKeys.has(b.key)),
    'no stock-blocked character was unlocked by more kits — the reason is not actionable',
  );
});

test('a stock-blocked shape reports the cheapest variant\'s shortfall, not any variant\'s', () => {
  // outOfReach must price the character's cheapest-to-unlock variant. A
  // regression that priced the most expensive variant instead would still
  // satisfy every other test here (reason 'stock', missing.short > 0, a
  // mat/barrier/joint label) while handing the UI a wildly inflated
  // shopping number. Pin the actual value against an independent
  // computation over every variant of the character, not just one.
  const stock = stockFromKits({ '87033': 1 });
  const blocked = outOfReach(stock, { maxSide: 8 }).blocked.filter((b) => b.reason === 'stock');
  assert.ok(blocked.length > 0, 'fixture is only meaningful if something is stock-blocked');

  // A stock rich enough to surface every variant of each blocked character
  // (matching generateLayouts' own maxVariantsPerCharacter cap), so the
  // comparison below is over the same variant set outOfReach itself sees.
  const rich = groupByCharacter(generateLayouts(stockFromKits({ '87033': 20 }), { maxSide: 8 }).results);
  const byKey = new Map(rich.map((c) => [c.key, c]));

  for (const b of blocked) {
    const character = byKey.get(b.key);
    assert.ok(character, `${b.key} has no variants in the rich fixture to check against`);
    const shortfalls = character.variants.map((variant) => {
      const rows = diffStock(billOfMaterials(createLayout({ pieces: variant.pieces })), stock)
        .filter((r) => r.short > 0)
        .sort((a, c) => c.short - a.short);
      return rows.length === 0 ? 0 : rows[0].short;
    });
    const min = Math.min(...shortfalls);
    const max = Math.max(...shortfalls);
    assert.notEqual(
      min, max,
      `${b.key}'s variants must discriminate (min vs. max shortfall) for this test to be able to fail`,
    );
    assert.equal(
      b.missing.short, min,
      `${b.key} reported missing.short=${b.missing.short}, but the true cheapest variant needs only ${min} (worst variant needs ${max})`,
    );
  }
});

// Task 13: the user chose three equally-weighted, 0..1-normalised criteria
// (lapPerMat, technical, fit). Every component and the score itself must
// stay in range, and score must actually BE the sum of the three
// components — not an average or some other combination — since a caller
// reading `components` and a caller reading `score` must agree on what the
// number means.
test('scoreLayouts keeps every component and the score in a sane, summed range', () => {
  const { results } = generateLayouts(stockFromKits({ '87033': 1 }), { maxSide: 10 });
  const scored = scoreLayouts(results, {});
  assert.equal(scored.length, results.length);
  for (const r of scored) {
    for (const [name, v] of Object.entries(r.components)) {
      assert.ok(v >= 0 && v <= 1, `${name}=${v} is outside 0..1`);
    }
    const summed = r.components.lapPerMat + r.components.technical + r.components.fit;
    assert.ok(Math.abs(summed - r.score) < 1e-9, 'score must be the sum of its components');
  }
  // The fixture is only meaningful if at least one component actually
  // discriminates real candidates apart, rather than every value landing
  // on the flat 0.5 a set with no spread would produce.
  assert.ok(new Set(scored.map((r) => r.components.lapPerMat)).size > 1,
    'expected lapPerMat to discriminate across a real one-kit candidate set');
});

// Independently rechecks scoreLayouts' output against a from-scratch
// reimplementation of the stated formula (lapPerMat and fit: min-max
// normalised raw values; technical: the MEAN of two separately normalised
// parts), over a large, real, two-kit result set — not a synthetic
// fixture, so this also proves the formula holds up across genuinely
// different candidates, not just two hand-picked ones.
test('scoreLayouts\' components match an independent recomputation of the stated formula', () => {
  const { results } = generateLayouts(stockFromKits({ '87033': 2 }), { maxSide: 10 });
  const scored = scoreLayouts(results, { room: null });

  const normalise = (values) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max === min) return values.map(() => 0.5);
    return values.map((v) => (v - min) / (max - min));
  };

  const rawLapPerMat = results.map((r) => (r.lapMm / 1000) / r.matCount);
  const rawUnjoined = results.map((r) => unjoinedContacts(createLayout({ pieces: r.pieces })).length);
  const rawLeftTurns = results.map((r) => [...r.signature].filter((c) => c === 'L').length);
  const rawSquareness = results.map((r) => Math.min(r.bbox.w, r.bbox.h) / Math.max(r.bbox.w, r.bbox.h));

  const nLap = normalise(rawLapPerMat);
  const nUnjoined = normalise(rawUnjoined);
  const nLeftTurns = normalise(rawLeftTurns);
  const nFit = normalise(rawSquareness);

  assert.ok(new Set(rawUnjoined).size > 1,
    'expected the two-kit set to include both chicane and non-chicane layouts');

  scored.forEach((r, i) => {
    assert.ok(Math.abs(r.components.lapPerMat - nLap[i]) < 1e-9, `${r.key} lapPerMat`);
    const expectedTechnical = (nUnjoined[i] + nLeftTurns[i]) / 2;
    assert.ok(Math.abs(r.components.technical - expectedTechnical) < 1e-9, `${r.key} technical`);
    assert.ok(Math.abs(r.components.fit - nFit[i]) < 1e-9, `${r.key} fit (no room -> squareness)`);
  });
});

// Same recheck, with a room set: fit switches from squareness to how much
// of the room's floor area the bbox actually uses.
test('scoreLayouts\' fit rewards floor usage, not squareness, once a room is set', () => {
  const room = { w: 8, h: 8 };
  const { results } = generateLayouts(stockFromKits({ '87033': 1 }), { maxSide: 10, room });
  assert.ok(results.length > 1, 'fixture needs more than one room-constrained result to discriminate');
  const scored = scoreLayouts(results, { room });

  const rawFit = results.map((r) => (r.bbox.w * r.bbox.h) / (room.w * room.h));
  const min = Math.min(...rawFit);
  const max = Math.max(...rawFit);
  assert.notEqual(min, max, 'fixture is only meaningful if floor usage actually varies');
  scored.forEach((r, i) => {
    const expected = (rawFit[i] - min) / (max - min);
    assert.ok(Math.abs(r.components.fit - expected) < 1e-9, `${r.key} room fit`);
  });
});

// Validation the brief asked for by name: stockL() is a real, hand-built
// Kyosho layout, not generator output. It doesn't have to score first —
// it's small and a plain L — but if the score buries it in the bottom
// quarter of a one-kit run, the score is measuring the wrong thing.
test('stockL does not land in the bottom quarter of a one-kit score', () => {
  const stock = stockFromKits({ '87033': 1 });
  const { results } = generateLayouts(stock, { maxSide: 10 });
  const scored = scoreLayouts(results, { room: null }).sort((a, b) => b.score - a.score);
  const target = canonicalLayoutKey(stockL());
  const rank = scored.findIndex((r) => r.key === target);
  assert.ok(rank >= 0, 'stockL must actually be among the scored one-kit results');
  const fromTop = rank / (scored.length - 1); // 0 = best, 1 = worst
  assert.ok(fromTop <= 0.75,
    `stockL ranked ${rank + 1} of ${scored.length} (bottom quarter) — the score likely favours the wrong thing`);
});
