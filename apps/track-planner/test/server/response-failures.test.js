// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A response that cannot be written answers 500 instead of hanging.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

test('a response whose headers cannot be written is a 500 at once, logged, not a hang', async () => {
  const log = mock.method(console, 'error', () => {});
  const bad = { pattern: /^\/bad-header$/, methods: { GET: () => ({ status: 303, headers: { Location: '/café☃' }, body: '' }) } };
  const server = await startServer({ routes: [bad] });
  try {
    const res = await fetch(`${server.base}/bad-header`, { redirect: 'manual', signal: AbortSignal.timeout(2000) });
    assert.equal(res.status, 500);
    assert.match(res.headers.get('content-type'), /^application\/problem\+json/);
    assert.equal((await res.json()).status, 500);
    assert.equal(log.mock.callCount(), 1);
  } finally {
    log.mock.restore();
    await server.close();
  }
});
