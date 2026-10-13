// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { outlineFamily, availableFamilies, orderSuggestions } from '../js/suggestions.js';
import { generateLayouts, scoreLayouts } from '../js/generate.js';
import { stockFromKits } from '../js/inventory.js';

const twoKits = () => scoreLayouts(
  generateLayouts(stockFromKits({ '87033': 2 }), { maxSide: 10 }).results, { room: null });
const oneKit = () => scoreLayouts(
  generateLayouts(stockFromKits({ '87033': 1 }), { maxSide: 10 }).results, { room: null });

test('a character name collapses to the shape family the chips offer', () => {
  assert.equal(outlineFamily('Rectangle'), 'Rectangle');
  assert.equal(outlineFamily('L-shape'), 'L-shape');
  assert.equal(outlineFamily('L-shape with chicane'), 'L-shape');
  assert.equal(outlineFamily('8-corner shape 3 with chicane'), '8-corner');
  assert.equal(outlineFamily('8-corner shape 1'), '8-corner');
});

test('only families that actually have layouts get a chip', () => {
  // One starter set cannot afford an 8-corner shape, so offering that chip
  // would be offering a button that always yields nothing.
  assert.deepEqual(availableFamilies(oneKit()), ['Rectangle', 'L-shape']);
  assert.deepEqual(availableFamilies(twoKits()), ['Rectangle', 'L-shape', '8-corner']);
});

test('the shape filter keeps only that family', () => {
  const pool = orderSuggestions(twoKits(), { shape: 'L-shape' });
  assert.ok(pool.length > 0, 'fixture is only meaningful if L-shapes exist');
  for (const r of pool) assert.equal(outlineFamily(r.characterName), 'L-shape');
});

test('turning chicanes off removes every layout that doubles back', () => {
  const all = orderSuggestions(twoKits(), { chicanes: true });
  const none = orderSuggestions(twoKits(), { chicanes: false });
  assert.ok(none.length < all.length, 'fixture is only meaningful if some have chicanes');
  for (const r of none) assert.equal(r.chicane, false);
  // and it must not silently drop a whole family that has non-chicane members
  assert.ok(none.some((r) => outlineFamily(r.characterName) === 'Rectangle'));
});

test('filters compose rather than overriding each other', () => {
  const pool = orderSuggestions(twoKits(), { shape: '8-corner', chicanes: false });
  for (const r of pool) {
    assert.equal(outlineFamily(r.characterName), '8-corner');
    assert.equal(r.chicane, false);
  }
});

test('each sort is the order it claims, strictly', () => {
  const byLap = orderSuggestions(twoKits(), { sort: 'lap' });
  for (let i = 1; i < byLap.length; i++) assert.ok(byLap[i - 1].lapMm >= byLap[i].lapMm);

  const byMats = orderSuggestions(twoKits(), { sort: 'mats' });
  for (let i = 1; i < byMats.length; i++) assert.ok(byMats[i - 1].matCount <= byMats[i].matCount);

  const bySize = orderSuggestions(twoKits(), { sort: 'size' });
  const area = (r) => r.bbox.w * r.bbox.h;
  for (let i = 1; i < bySize.length; i++) assert.ok(area(bySize[i - 1]) <= area(bySize[i]));
});

test('best spreads the shapes; a plain sort does not', () => {
  // BEST exists to stop page one being five of the same shape. The strict
  // sorts deliberately do not do that — what you click is what you get.
  const best = orderSuggestions(twoKits(), { sort: 'best' }).slice(0, 5);
  assert.equal(new Set(best.map((r) => r.characterName)).size, 5, 'best repeated a character on page one');

  const byMats = orderSuggestions(twoKits(), { sort: 'mats' }).slice(0, 5);
  for (let i = 1; i < byMats.length; i++) assert.ok(byMats[i - 1].matCount <= byMats[i].matCount);
});

test('every result carries the character it belongs to, so a row can name it', () => {
  for (const r of orderSuggestions(twoKits(), {})) {
    assert.equal(typeof r.characterName, 'string');
    assert.ok(r.characterName.length > 0);
    assert.equal(typeof r.chicane, 'boolean');
  }
});

test('filtering everything out gives an empty pool, not a throw', () => {
  // One starter set has no 8-corner layouts at all.
  assert.deepEqual(orderSuggestions(oneKit(), { shape: '8-corner' }), []);
  assert.deepEqual(orderSuggestions([], {}), []);
});

test('ordering never invents or loses a layout', () => {
  const results = twoKits();
  const pool = orderSuggestions(results, {});
  assert.equal(pool.length, results.length);
  assert.deepEqual(new Set(pool.map((r) => r.key)), new Set(results.map((r) => r.key)));
});
