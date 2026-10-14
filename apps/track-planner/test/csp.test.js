// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The planner's CSP allows scripts from its own origin and the inline import
// map by hash, nothing else. These checks catch what would silently break
// in a browser: another inline script, an inline handler, eval.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { plannerCsp } from '../server/static.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('the policy allows exactly the import map by hash', () => {
  const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1];
  const hash = createHash('sha256').update(map).digest('base64');
  assert.match(plannerCsp(html), new RegExp(`script-src 'self' 'sha256-${hash.replace(/[+/=]/g, '\\$&')}'`));
});

test('index.html has no other inline script and no inline handlers', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
  for (const attrs of scripts) assert.ok(/type="importmap"/.test(attrs) || /\bsrc=/.test(attrs), attrs);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
});

test('the app code uses no eval and writes no inline handlers', () => {
  const dir = new URL('../js/', import.meta.url);
  for (const name of readdirSync(dir)) {
    const code = readFileSync(new URL(name, dir), 'utf8');
    assert.doesNotMatch(code, /\beval\(|new Function\(/, name);
    assert.doesNotMatch(code, /<[a-z][^>]*\son[a-z]+=/i, name);
  }
});
