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
  // Different device in the same workspace is kept separate
  await devices.remember('w1', 'serial:9999:99999', 'dec_other');
  assert.equal(await devices.recall('w1', 'serial:9999:99999'), 'dec_other');
  assert.equal(await devices.recall('w1', 'serial:1027:24577'), 'dec_2');
  // forget leaves other keys alone
  await devices.forget('w1', 'serial:1027:24577');
  assert.equal(await devices.recall('w1', 'serial:1027:24577'), null);
  assert.equal(await devices.recall('w1', 'serial:9999:99999'), 'dec_other');
});

test('without IndexedDB the devices fall back to memory', async () => {
  const devices = await openDevices('test');
  await devices.remember('w1', 'hid:4292:34489', 'dec_1');
  assert.equal(await devices.recall('w1', 'hid:4292:34489'), 'dec_1');
});

test('the devices are opened once per page: a choice kept in memory survives the next connect', async () => {
  const first = await openDevices('once');
  await first.remember('w1', 'hid:4292:34489', 'dec_1');
  const second = await openDevices('once');
  assert.equal(second, first);
  assert.equal(await second.recall('w1', 'hid:4292:34489'), 'dec_1');
});
