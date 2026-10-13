// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { stripComments } from '../js-source.js';

test('removes a JSDoc @import', () => {
  const out = stripComments("/** @import { Layout } from '@tinylap/track-format/types' */\nconst a = 1;");
  assert.doesNotMatch(out, /import|track-format/);
  assert.match(out, /const a = 1;/);
});

test('removes a line comment', () => {
  assert.doesNotMatch(stripComments("// import x from 'y'\nconst a = 1;"), /import|'y'/);
});

test('keeps // inside a string', () => {
  const src = "const u = 'http://example.com/a';";
  assert.equal(stripComments(src), src);
});

test('keeps comment-like text inside a template literal', () => {
  const src = 'const t = `/* not a comment */`;';
  assert.equal(stripComments(src), src);
});

test('keeps an escaped quote inside a string', () => {
  const src = "const s = 'it\\'s // fine';";
  assert.equal(stripComments(src), src);
});

test('keeps real imports and re-exports', () => {
  const src = "import { a } from './b.js';\nexport * from './c.js';";
  assert.equal(stripComments(src), src);
});

test('preserves the line count', () => {
  const src = "a;\n/**\n * x\n * y\n */\nb; // tail\nc;";
  assert.equal(stripComments(src).split('\n').length, src.split('\n').length);
});
