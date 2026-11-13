// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// TinyLap's CSS has no raw shadow offsets: a box-shadow's offset is one of
// palace-ui's --p-shadow-* sizes. `none` and inset indicator lines (a tab's
// underline, a chip's bar) are not offset shadows and stay allowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SKIP = new Set(['node_modules', 'dist', 'test', '.turbo']);

function* sources(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.(css|html|js)$/.test(entry.name)) yield path;
  }
}

/** Splits a value at its top-level commas. */
function layers(value) {
  const out = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')') depth--;
    else if (value[i] === ',' && depth === 0) { out.push(value.slice(from, i)); from = i + 1; }
  }
  out.push(value.slice(from));
  return out.map((s) => s.trim());
}

/** The raw-offset layers of every `box-shadow:` declaration in `source`. */
export function rawOffsets(source) {
  const found = [];
  for (const [, value] of source.matchAll(/box-shadow\s*:\s*([^;}\n]+)/g)) {
    for (const layer of layers(value)) {
      if (layer === 'none' || /^(?:inherit|initial|unset|revert)$/.test(layer) || /^inset\b/.test(layer) || /^var\(--p-shadow-(?:xs|sm|md|lg)\)/.test(layer)) continue;
      found.push(layer);
    }
  }
  return found;
}

test('the finder reads offsets', () => {
  assert.deepEqual(rawOffsets('a { box-shadow: 8px 8px 0 red; }'), ['8px 8px 0 red']);
  assert.deepEqual(rawOffsets('a { box-shadow: var(--p-shadow-md) var(--p-text), 2px 2px 0 rgb(0, 0, 0); }'), ['2px 2px 0 rgb(0, 0, 0)']);
  assert.deepEqual(rawOffsets('a { box-shadow: var(--p-shadow-lg) var(--p-text), inset 0 -3px 0 red; box-shadow: none; }'), []);
  assert.deepEqual(rawOffsets('a { box-shadow: 0 0 4px red; }'), ['0 0 4px red']);
});

test('no box-shadow in the apps or the design package has a raw offset', () => {
  const found = [];
  for (const dir of ['apps', 'packages/design']) {
    for (const path of sources(join(root, dir))) {
      for (const layer of rawOffsets(readFileSync(path, 'utf8'))) found.push(`${path.slice(root.length)}: ${layer}`);
    }
  }
  assert.deepEqual(found, [], 'use --p-shadow-xs, -sm, -md or -lg');
});
