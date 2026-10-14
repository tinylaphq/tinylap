// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { prefersHtml, mediaType, matchesEtag } from '../../server/negotiate.js';
import { openStore } from '../../server/store.js';
import { PROBLEMS } from '../../server/problems.js';

const CHROME = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

test('a browser navigation prefers html; fetch, curl and no header get json', () => {
  assert.equal(prefersHtml(CHROME), true);
  assert.equal(prefersHtml('*/*'), false);
  assert.equal(prefersHtml(undefined), false);
  assert.equal(prefersHtml(''), false);
  assert.equal(prefersHtml('application/json'), false);
});

test('q-values decide, and the most specific range wins', () => {
  assert.equal(prefersHtml('application/json;q=0.5, text/html'), true);
  assert.equal(prefersHtml('text/html;q=0.4, application/json;q=0.6'), false);
  assert.equal(prefersHtml('text/*, application/json;q=0.9'), true);
  assert.equal(prefersHtml('text/html;q=0, */*'), false);
});

test('media types lose their parameters and case', () => {
  assert.equal(mediaType('Application/JSON; charset=utf-8'), 'application/json');
  assert.equal(mediaType(undefined), '');
});

test('etags match exactly, in lists, weakly, or by star', () => {
  const req = (value) => ({ headers: { 'if-none-match': value } });
  assert.equal(matchesEtag(req('"a"'), '"a"'), true);
  assert.equal(matchesEtag(req('"b", "a"'), '"a"'), true);
  assert.equal(matchesEtag(req('W/"a"'), '"a"'), true);
  assert.equal(matchesEtag(req('*'), '"a"'), true);
  assert.equal(matchesEtag(req('"ab"'), '"a"'), false);
  assert.equal(matchesEtag({ headers: {} }, '"a"'), false);
});

test('the store keeps one row per key and lists by shape, newest first', () => {
  const store = openStore(':memory:');
  assert.equal(store.put({ key: 'k1', json: '{"a":1}', shapeKey: 's', trackId: 't1' }), true);
  assert.equal(store.put({ key: 'k1', json: '{"a":1}', shapeKey: 's', trackId: 't1' }), false);
  store.put({ key: 'k2', json: '{}', shapeKey: 's', trackId: 't2' });
  store.put({ key: 'k3', json: '{}', shapeKey: null, trackId: null });
  assert.equal(store.get('k1'), '{"a":1}');
  assert.equal(store.get('nope'), null);
  const listed = store.listByShape('s');
  assert.deepEqual(listed.map((r) => r.key).sort(), ['k1', 'k2']);
  assert.deepEqual(Object.keys(listed[0]), ['key', 'trackId', 'createdAt']);
  assert.equal(Object.getPrototypeOf(listed[0]), Object.prototype);
  assert.deepEqual(store.listByShape('none'), []);
  store.close();
});

test('every problem type has a status, a title and a description', () => {
  assert.deepEqual(Object.keys(PROBLEMS).sort(), [
    'invalid-layout', 'method-not-allowed', 'not-found', 'rate-limited',
    'too-large', 'track-mismatch', 'unavailable', 'unsupported-media-type',
  ]);
  for (const p of Object.values(PROBLEMS)) {
    assert.equal(typeof p.status, 'number');
    assert.ok(p.title && p.description);
  }
});
