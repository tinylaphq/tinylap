// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// design.css carries the shared tokens and the base rules the elements need.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../design.css', import.meta.url), 'utf8');

test('the track-surface tokens are there', () => {
  assert.match(css, /--tl-track-mat:/);
});

test('a frame is a block, and a hidden control stays hidden', () => {
  assert.match(css, /tl-frame \{ display: block; \}/);
  assert.match(css, /\[hidden\] \{ display: none !important; \}/);
});
