// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutFromData, SUPPORTED_VERSION, stockL, isTrack, layoutFromHtml, extractLayoutJson, SUPPORTED_VERSIONS, createLayout } from '../index.js';

const valid = () => ({ version: 1, unit: 'mat', room: { w: 10, h: 12 }, pieces: stockL() });

test('valid data rebuilds the same layout', () => {
  const layout = layoutFromData(valid());
  assert.deepEqual(layout, { version: 2, unit: 'mat', room: { w: 10, h: 12 }, pieces: stockL() });
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

const TRACK = { id: '0f8c2a4e-5b1d-4c3a-9e7f-2d6b8a1c3e5f', shape: 'c30:1:example' };

test('version 1 data is read and upgraded to version 2', () => {
  const layout = layoutFromData(valid());
  assert.equal(layout.version, 2);
  assert.equal('track' in layout, false);
});

test('a version 2 track block survives reading', () => {
  const layout = layoutFromData({ ...valid(), version: 2, track: { ...TRACK, extra: 1 } });
  assert.deepEqual(layout.track, TRACK);
});

test('a damaged track block is dropped, not fatal', () => {
  for (const track of [
    null, 'x', 42, {}, { id: TRACK.id }, { shape: TRACK.shape },
    { ...TRACK, id: TRACK.id.toUpperCase() }, { ...TRACK, id: 'not-a-uuid' },
    { ...TRACK, shape: 'other:1:x' }, { ...TRACK, shape: 7 },
  ]) {
    const layout = layoutFromData({ ...valid(), version: 2, track });
    assert.equal('track' in layout, false, JSON.stringify(track));
  }
});

test('only versions 1 and 2 are read', () => {
  assert.deepEqual(SUPPORTED_VERSIONS, [1, 2]);
  assert.throws(() => layoutFromData({ ...valid(), version: 3 }), /newer planner/);
});

test('isTrack accepts exactly a lowercase uuid and a c30 shape', () => {
  assert.equal(isTrack(TRACK), true);
  assert.equal(isTrack({ ...TRACK, id: TRACK.id.toUpperCase() }), false);
  assert.equal(isTrack(undefined), false);
});

test('new layouts are version 2', () => {
  assert.equal(createLayout().version, 2);
});

test('layouts are read out of an exported html file', () => {
  const html = `<html><script type="application/json" id="layout">${JSON.stringify({ ...valid(), version: 2, track: TRACK })}</script></html>`;
  assert.deepEqual(extractLayoutJson(html).track, TRACK);
  assert.deepEqual(layoutFromHtml(html).track, TRACK);
  assert.throws(() => layoutFromHtml('<html></html>'), /no layout data/);
  assert.throws(() => layoutFromHtml('<script id="layout">{nope</script>'), /not valid JSON/);
});
