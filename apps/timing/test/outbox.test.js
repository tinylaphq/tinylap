// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryOutbox, openOutbox } from '../js/outbox.js';

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
