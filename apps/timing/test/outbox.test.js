// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryOutbox, openOutbox } from '../public/outbox.js';

const p = (t, transponder = '0A', boot = 'b00tb00t', decoder = 'd1') => ({ decoder, boot, transponder, t });

test('the memory outbox keeps one copy and drops exactly the passings it is given', async () => {
  const box = memoryOutbox();
  await box.add(p(1000));
  await box.add(p(1000));
  await box.add(p(9000));
  await box.add(p(500, '0B'));
  await box.add(p(100, '0A', 'otherboot'));
  assert.equal(await box.count(), 4);
  await box.remove([p(1000), p(500, '0B')]);
  assert.deepEqual((await box.list()).map((x) => [x.boot, x.transponder, x.t]), [['b00tb00t', '0A', 9000], ['otherboot', '0A', 100]]);
});

test('without IndexedDB the outbox falls back to memory', async () => {
  const box = await openOutbox('test');
  await box.add(p(1));
  assert.equal(await box.count(), 1);
});

test('an IndexedDB open that never answers falls back to memory after about 1 s', async (t) => {
  const real = globalThis.indexedDB;
  globalThis.indexedDB = /** @type {any} */ ({ open: () => ({}) });
  t.after(() => { globalThis.indexedDB = real; });
  const started = Date.now();
  const box = await openOutbox('hung');
  assert.ok(Date.now() - started < 3000);
  await box.add({ decoder: 'd', boot: 'b00tb00t', transponder: '0A', t: 1 });
  assert.equal(await box.count(), 1);
});

test('a blocked IndexedDB open falls back to memory at once', async (t) => {
  const real = globalThis.indexedDB;
  globalThis.indexedDB = /** @type {any} */ ({ open: () => {
    const request = {};
    setTimeout(() => request.onblocked?.(), 0);
    return request;
  } });
  t.after(() => { globalThis.indexedDB = real; });
  const started = Date.now();
  const box = await openOutbox('blocked');
  assert.ok(Date.now() - started < 500);
  assert.equal(await box.count(), 0);
});
