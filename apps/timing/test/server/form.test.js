// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readForm } from '../../server/form.js';

const requestOf = (body, type = 'application/x-www-form-urlencoded') => {
  const req = Readable.from([Buffer.from(body)]);
  req.headers = { 'content-type': type, 'content-length': String(Buffer.byteLength(body)) };
  return { req, origin: 'http://timing.test' };
};

test('a form body is read as URLSearchParams, repeated fields included', async () => {
  const { form } = await readForm(requestOf('kind=race&roster=a&roster=b&name=Ana+%26+Co'));
  assert.equal(form.get('kind'), 'race');
  assert.deepEqual(form.getAll('roster'), ['a', 'b']);
  assert.equal(form.get('name'), 'Ana & Co');
});

test('other types and big bodies are refused', async () => {
  assert.equal((await readForm(requestOf('{}', 'application/json'))).error.status, 415);
  assert.equal((await readForm(requestOf('a=1'.repeat(10), undefined), 8)).error.status, 413);
});
