// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryDevices, openDevices } from '../public/devices.js';

test('remember, recall and forget a device\'s decoder, per club or personal space', async () => {
  const devices = memoryDevices();
  assert.equal(await devices.recall('w1', 'serial:1027:24577'), null);
  await devices.remember('w1', 'serial:1027:24577', 'dec_1');
  assert.equal(await devices.recall('w1', 'serial:1027:24577'), 'dec_1');
  assert.equal(await devices.recall('w2', 'serial:1027:24577'), null);
  await devices.remember('w1', 'serial:1027:24577', 'dec_2');
  assert.equal(await devices.recall('w1', 'serial:1027:24577'), 'dec_2');
  await devices.forget('w1', 'serial:1027:24577');
  assert.equal(await devices.recall('w1', 'serial:1027:24577'), null);
});

test('without IndexedDB the devices fall back to memory', async () => {
  const devices = await openDevices('test');
  await devices.remember('w1', 'hid:4292:34489', 'dec_1');
  assert.equal(await devices.recall('w1', 'hid:4292:34489'), 'dec_1');
});
