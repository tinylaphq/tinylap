import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../js/presets.js';
import { createLayout, findOverlaps, isClosedCircuit } from '../js/model.js';

test('every preset is a valid, closed, non-overlapping circuit', () => {
  // Correction 3: only the derived reference ring ships in this task
  // (correction 2), so the minimum count is 1, not 2 — Task 16 adds the
  // second preset and can tighten this back up.
  assert.ok(PRESETS.length >= 1);
  for (const preset of PRESETS) {
    const l = createLayout({ pieces: preset.pieces });
    assert.deepEqual(findOverlaps(l), [], `${preset.id} overlaps`);
    assert.equal(isClosedCircuit(l), true, `${preset.id} is not closed`);
  }
});

test('every preset is uniquely identified and attributed', () => {
  const ids = PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of PRESETS) {
    assert.ok(p.name.length > 0);
    // Correction 3: the 7x9 ring is not an official Kyosho plan, so its
    // source must not be forced to look like a Kyosho part number. Only
    // require a non-empty attribution string.
    assert.equal(typeof p.source, 'string');
    assert.ok(p.source.length > 0);
  }
});
