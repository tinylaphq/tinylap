// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout } from '@tinylap/track-format';
import { prepareExport, importHtml, carryTrack } from '../js/storage.js';
import { buildLoop } from '../js/generate.js';
import { stockL } from '../js/presets.js';

const closed = () => createLayout({ pieces: stockL() });

test('an exported closed layout carries a track block', () => {
  const { layout, html } = prepareExport(closed());
  assert.ok(layout.track);
  assert.deepEqual(importHtml(html).track, layout.track);
});

test('exporting twice without changes keeps the id', () => {
  const first = prepareExport(closed()).layout;
  assert.equal(prepareExport(first).layout.track.id, first.track.id);
});

test('exporting after a change issues a new id', () => {
  const first = prepareExport(closed()).layout;
  const changed = { ...first, pieces: first.pieces.slice(1) };
  assert.equal(prepareExport(changed).layout.track, undefined, 'opened circuit');
  const grown = buildLoop({ signature: 'RRRR', sides: [3, 5, 3, 5] });
  assert.notEqual(prepareExport({ ...first, pieces: grown }).layout.track.id, first.track.id);
});

test('a change reverted before the next export keeps the id', () => {
  const first = prepareExport(closed()).layout;
  const edited = structuredClone(first);
  edited.pieces[0] = { ...edited.pieces[0], x: edited.pieces[0].x + 1 };
  edited.pieces[0] = { ...edited.pieces[0], x: edited.pieces[0].x - 1 };
  assert.equal(prepareExport(edited).layout.track.id, first.track.id);
});

test('opening a file adopts its track, and re-exporting keeps it', () => {
  const { layout, html } = prepareExport(closed());
  const opened = importHtml(html);
  assert.equal(prepareExport(opened).layout.track.id, layout.track.id);
});

test('undo past an export, carried over, keeps the id when the shape is rebuilt', () => {
  const before = closed();
  const exported = prepareExport(before).layout;
  const carried = carryTrack(before, exported);
  assert.equal(prepareExport(carried).layout.track.id, exported.track.id);
});

test('carryTrack keeps the snapshot\'s own track', () => {
  const exported = prepareExport(closed()).layout;
  const other = prepareExport(createLayout({ pieces: buildLoop({ signature: 'RRRR', sides: [3, 5, 3, 5] }) })).layout;
  assert.equal(carryTrack(exported, other), exported);
});

test('a carried track on a different shape issues a new id at the next export', () => {
  const exported = prepareExport(closed()).layout;
  const other = createLayout({ pieces: buildLoop({ signature: 'RRRR', sides: [3, 5, 3, 5] }) });
  const carried = carryTrack(other, exported);
  assert.notEqual(prepareExport(carried).layout.track.id, exported.track.id);
});
