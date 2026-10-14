// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const MAIN = fileURLToPath(new URL('../../server/main.js', import.meta.url));

const run = (env) => spawn(process.execPath, ['--disable-warning=ExperimentalWarning', MAIN, '--dev'], {
  env: { ...process.env, ...env },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function freePort() {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test('a bad TINYLAP_RATE_LIMIT stops the server at startup', async () => {
  for (const value of ['abc', '-1', '1.5']) {
    const child = run({ TINYLAP_RATE_LIMIT: value, PORT: '0' });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    const [code] = await once(child, 'exit');
    assert.equal(code, 1, value);
    assert.match(err, /TINYLAP_RATE_LIMIT must be a whole number/, value);
  }
});

test('0 is a valid rate limit, and SIGTERM and SIGINT shut the server down cleanly', async () => {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const port = await freePort();
    const child = run({ TINYLAP_RATE_LIMIT: '0', PORT: String(port) });
    child.stdout.setEncoding('utf8');
    await new Promise((resolve) => child.stdout.on('data', (d) => d.includes('planner on') && resolve()));
    assert.equal((await fetch(`http://127.0.0.1:${port}/api`)).status, 200);
    child.kill(signal);
    const [code, sig] = await once(child, 'exit');
    assert.equal(code, 0, `${signal}: ${sig}`);
  }
});
