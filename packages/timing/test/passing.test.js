// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOT_ID, MAX_BATCH, passingKey, randomBoot, readBatch, transponderCode } from '../index.js';

test('transponder codes are upper-case hex', () => {
  assert.equal(transponderCode('4a1f'), '4A1F');
  assert.equal(transponderCode(' 07 '), '07');
  assert.equal(transponderCode('xyz'), null);
  assert.equal(transponderCode(''), null);
  assert.equal(transponderCode(42), null);
  assert.equal(transponderCode('1'.repeat(17)), null);
});

test('the same passing has the same key, whichever way it came', () => {
  const p = { decoder: 'd1', boot: 'b00tb00t', transponder: '4A', t: 1234 };
  assert.equal(passingKey(p), passingKey({ ...p }));
  assert.notEqual(passingKey(p), passingKey({ ...p, t: 1235 }));
  assert.notEqual(passingKey(p), passingKey({ ...p, boot: 'b00tb00u' }));
});

test('a valid batch is read and normalised', () => {
  const result = readBatch({ boot: 'b00tb00t', passings: [{ transponder: '4a', t: 0 }, { transponder: '4A', t: 5000 }] });
  assert.deepEqual(result, { ok: true, batch: { boot: 'b00tb00t', passings: [{ transponder: '4A', t: 0 }, { transponder: '4A', t: 5000 }] } });
});

test('a bad batch says what is wrong', () => {
  const bad = (value, pattern) => {
    const result = readBatch(value);
    assert.equal(result.ok, false);
    assert.match(/** @type {any} */ (result).error, pattern);
  };
  bad(null, /JSON object/);
  bad([], /JSON object/);
  bad({ boot: 'short', passings: [{ transponder: '4A', t: 1 }] }, /boot/);
  bad({ boot: 'b00tb00t', passings: [] }, /non-empty/);
  bad({ boot: 'b00tb00t', passings: [{ transponder: 'zz', t: 1 }] }, /passings\[0\]\.transponder/);
  bad({ boot: 'b00tb00t', passings: [{ transponder: '4A', t: -1 }] }, /passings\[0\]\.t/);
  bad({ boot: 'b00tb00t', passings: [{ transponder: '4A', t: 1.5 }] }, /passings\[0\]\.t/);
  bad({ boot: 'b00tb00t', passings: [{ transponder: '4A', t: '1' }] }, /passings\[0\]\.t/);
  bad({ boot: 'b00tb00t', passings: Array.from({ length: MAX_BATCH + 1 }, (_, t) => ({ transponder: '4A', t })) }, /at most 500/);
});

test('random boots are valid and differ', () => {
  const a = randomBoot();
  assert.match(a, BOOT_ID);
  assert.equal(a.length, 11);
  assert.notEqual(a, randomBoot());
});
