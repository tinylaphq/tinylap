// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// Moved from apps/track-planner/test/server/units.test.js with the limiter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimiter, clientBucket } from '../index.js';

test('the rate limiter allows the limit per window, per client', () => {
  let t = 0;
  const limiter = rateLimiter({ limit: 2, windowMs: 1000, now: () => t });
  assert.equal(limiter.take('a'), 0);
  assert.equal(limiter.take('a'), 0);
  assert.equal(limiter.take('a'), 1);
  assert.equal(limiter.take('b'), 0);
  t = 1000;
  assert.equal(limiter.take('a'), 0);
});

test('ipv6 clients are limited by their /64, ipv4 as it is', () => {
  assert.equal(clientBucket('2001:db8:0:1::1'), clientBucket('2001:db8:0:1:ffff:ffff:ffff:ffff'));
  assert.equal(clientBucket('2001:0DB8:0:1::1'), clientBucket('2001:db8:0:1::2'));
  assert.notEqual(clientBucket('2001:db8:0:1::1'), clientBucket('2001:db8:0:2::1'));
  assert.equal(clientBucket('fe80::1%eth0'), clientBucket('fe80::2'));
  assert.equal(clientBucket('203.0.113.7'), '203.0.113.7');
  assert.equal(clientBucket('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(clientBucket('::ffff:cb00:7107'), '203.0.113.7');
  assert.equal(clientBucket('unknown'), 'unknown');
  assert.equal(clientBucket('not an address'), 'not an address');
});

test('the rate limiter forgets expired windows on every take, and on a timer', async () => {
  let t = 0;
  const limiter = rateLimiter({ limit: 1, windowMs: 1000, now: () => t, sweepMs: 10 });
  limiter.take('a');
  limiter.take('b');
  assert.equal(limiter.size, 2);
  t = 1000;
  limiter.take('c');
  assert.equal(limiter.size, 1, 'a and b were held past their window');
  t = 2000;
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(limiter.size, 0, 'the sweep forgets a quiet address');
  limiter.stop();
});
