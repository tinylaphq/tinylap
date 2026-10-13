import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutFromData, SUPPORTED_VERSION, stockL } from '../index.js';

const valid = () => ({ version: 1, unit: 'mat', room: { w: 10, h: 12 }, pieces: stockL() });

test('valid data rebuilds the same layout', () => {
  const layout = layoutFromData(valid());
  assert.deepEqual(layout, { version: 1, unit: 'mat', room: { w: 10, h: 12 }, pieces: stockL() });
});

test('only the known piece fields survive', () => {
  const data = valid();
  data.pieces[0].extra = 'x';
  assert.equal('extra' in layoutFromData(data).pieces[0], false);
});

test('a newer format version is refused with a readable message', () => {
  assert.throws(() => layoutFromData({ ...valid(), version: SUPPORTED_VERSION + 1 }), /newer planner/);
});

test('inherited object keys are not piece types', () => {
  for (const type of ['__proto__', 'constructor', 'toString']) {
    const data = valid();
    data.pieces[0].type = type;
    assert.throws(() => layoutFromData(data), /Unknown piece type/, type);
  }
});

test('rotations other than quarter turns are refused', () => {
  const data = valid();
  data.pieces[0].rot = 45;
  assert.throws(() => layoutFromData(data), /Unknown rotation/);
});

test('non-finite coordinates and rooms are refused', () => {
  const data = valid();
  data.pieces[0].x = Number.NaN;
  assert.throws(() => layoutFromData(data), /Invalid piece x/);
  assert.throws(() => layoutFromData({ ...valid(), room: { w: Infinity, h: 1 } }), /Invalid room/);
});

test('a missing pieces array is refused', () => {
  assert.throws(() => layoutFromData({ version: 1 }), /no pieces array/);
});
