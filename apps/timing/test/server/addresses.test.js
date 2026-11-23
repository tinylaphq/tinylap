// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The address dev timing gives decoders, and loopback addresses that a decoder
// can't reach over Wi-Fi (dev decoder address spec).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isLoopback, lanAddress } from '../../server/addresses.js';

const lo0 = [{ family: 'IPv4', address: '127.0.0.1', internal: true }];

test("this machine's network address: the first IPv4 that isn't internal", () => {
  assert.equal(lanAddress({
    lo0,
    en0: [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv4', address: '192.168.1.20', internal: false }],
    utun0: [{ family: 'IPv4', address: '10.8.0.2', internal: false }],
  }), '192.168.1.20');
});

test('no network address: only internal ones, or none', () => {
  assert.equal(lanAddress({ lo0 }), null);
  assert.equal(lanAddress({}), null);
});

test('loopback: localhost, 127.0.0.0/8, [::1] and the any-address 0.0.0.0 or [::], and nothing else', () => {
  for (const url of ['http://localhost:8100', 'http://127.0.0.5:8100', 'http://[::1]:8100', 'http://0.0.0.0:8100', 'http://[::]:8100']) assert.equal(isLoopback(url), true, url);
  for (const url of ['http://192.168.1.20:8100', 'http://localhost.example.com', 'https://timing.tinylap.app']) assert.equal(isLoopback(url), false, url);
});
