// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importHtml } from '../js/storage.js';
import { stockL } from '../js/presets.js';

// Exported by the planner as it was before the monorepo split. Files people
// already saved must keep opening.
const html = readFileSync(new URL('./fixtures/live-export.html', import.meta.url), 'utf8');

test('a layout exported before the package split still imports', () => {
  const layout = importHtml(html);
  assert.deepEqual(layout.room, { w: 10, h: 12 });
  assert.deepEqual(layout.pieces, stockL());
  assert.equal(layout.version, 2);
  assert.equal('track' in layout, false);
});
