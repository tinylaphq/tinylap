// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnTo } from '../server/return-to.js';

const FALLBACK = '/clubs/c1/setup#transponders';

test('a path on this site is where the form goes back to', () => {
  for (const path of ['/clubs/c1/board', '/personal/setup#drivers', '/clubs/c1/transponders/new?assigned=0A', '/']) {
    assert.equal(safeReturnTo(path, FALLBACK), path, path);
  }
});

test('anything else goes back to the fallback, never off-site', () => {
  const hostile = [
    undefined, '', 'board', '//evil.example', '//evil.example/x', 'https://evil.example', 'http:/evil.example',
    '/\\evil.example', '\\\\evil.example', '/\\/evil.example', 'javascript:alert(1)', ' /board', '/\tboard', '/board\n',
    `/${'x'.repeat(2048)}`,
  ];
  for (const value of hostile) assert.equal(safeReturnTo(value, FALLBACK), FALLBACK, JSON.stringify(value));
});

test('a path with characters outside ASCII goes back percent-encoded', () => {
  assert.equal(safeReturnTo('/€', FALLBACK), '/%E2%82%AC');
  assert.equal(safeReturnTo('/clubs/c1/board?x=ü#ü', FALLBACK), '/clubs/c1/board?x=%C3%BC#%C3%BC');
});
