// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const MAIN = fileURLToPath(new URL('../../server/main.js', import.meta.url));
const FULL = {
  TINYLAP_ISSUER: 'http://127.0.0.1:9', TINYLAP_CLIENT_ID: 'timing-dev', TINYLAP_CLIENT_SECRET: 'dev',
  TINYLAP_FEED_TOKEN: 'dev', TINYLAP_TOKEN_KEYS: `k1:${Buffer.alloc(32, 1).toString('base64')}`,
  TINYLAP_PLANNER_URL: 'http://127.0.0.1:9', PORT: '0',
};
const run = (env) => spawn(process.execPath, ['--disable-warning=ExperimentalWarning', MAIN, '--dev'], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });

test('timing refuses to start without its configuration, and names what is missing', async () => {
  const partial = { ...FULL };
  delete partial.TINYLAP_PLANNER_URL;
  const child = run(partial);
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.match(err, /TINYLAP_PLANNER_URL/);
});

test('with its configuration it starts and stops cleanly on SIGTERM', async () => {
  const child = run(FULL);
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.resume();
  while (!/timing on http:/.test(out)) await once(child.stdout, 'data');
  child.kill('SIGTERM');
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
});
