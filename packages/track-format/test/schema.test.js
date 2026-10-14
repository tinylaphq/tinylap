// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import schema from '../layout.schema.json' with { type: 'json' };
import { PIECES, createLayout, assignTrack, rectangularRing, stockL, extractLayoutJson } from '../index.js';

const validate = new Ajv({ allErrors: true }).compile(schema);
const ok = (data) => assert.ok(validate(data), JSON.stringify(validate.errors));

test('every reference layout, with and without a track, is valid', () => {
  for (const pieces of [rectangularRing(), stockL()]) {
    ok(createLayout({ pieces }));
    ok(assignTrack(createLayout({ pieces, room: { w: 12, h: 15 } })));
  }
});

test('the v1 golden export is valid', () => {
  const html = readFileSync(new URL('../../../apps/track-planner/test/fixtures/live-export.html', import.meta.url), 'utf8');
  ok(extractLayoutJson(html));
});

test('broken layouts are rejected', () => {
  for (const bad of [
    { version: 2, unit: 'mat', room: null },
    { version: 3, unit: 'mat', room: null, pieces: [] },
    { version: 2, unit: 'mat', room: null, pieces: [{ type: 'hairpin', x: 0, y: 0, rot: 0 }] },
    { version: 2, unit: 'mat', room: null, pieces: [{ type: 'straight', x: 0, y: 0, rot: 45 }] },
    { version: 2, unit: 'mat', room: null, pieces: [], track: { id: 'nope', shape: 'c30:1:x' } },
  ]) assert.equal(validate(bad), false, JSON.stringify(bad));
});

test('the schema lists exactly the known piece types', () => {
  assert.deepEqual(schema.$defs.piece.properties.type.enum, Object.keys(PIECES));
});
