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

const KEYS = `k1:${Buffer.alloc(32, 7).toString('base64')}`;
const LOGIN = { TINYLAP_ISSUER: 'http://127.0.0.1:1', TINYLAP_CLIENT_ID: 'planner', TINYLAP_CLIENT_SECRET: 's', TINYLAP_TOKEN_KEYS: KEYS, TINYLAP_FEED_TOKEN: 'f' };

test('with TINYLAP_ISSUER set, missing or bad log-in settings stop the server at startup', async () => {
  const cases = [
    [{ TINYLAP_CLIENT_SECRET: '' }, /log-in also needs TINYLAP_CLIENT_SECRET/],
    [{ TINYLAP_TOKEN_KEYS: '' }, /log-in also needs TINYLAP_TOKEN_KEYS/],
    [{ TINYLAP_FEED_TOKEN: '', TINYLAP_CLIENT_ID: '' }, /log-in also needs TINYLAP_CLIENT_ID, TINYLAP_FEED_TOKEN/],
    [{ TINYLAP_TOKEN_KEYS: 'k1:short' }, /TINYLAP_TOKEN_KEYS: /],
    [{ TINYLAP_ISSUER: 'ftp://accounts.test' }, /log-in: /],
  ];
  for (const [env, message] of cases) {
    const child = run({ ...LOGIN, ...env, PORT: '0' });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    const [code] = await once(child, 'exit');
    assert.equal(code, 1, JSON.stringify(env));
    assert.match(err, message, JSON.stringify(env));
  }
});

test('/auth/me says whether log-in is set up', async () => {
  for (const [env, available] of [[{}, false], [LOGIN, true]]) {
    const port = await freePort();
    const child = run({ ...env, PORT: String(port) });
    child.stdout.setEncoding('utf8');
    child.stderr.resume();
    await new Promise((resolve) => child.stdout.on('data', (d) => d.includes('planner on') && resolve()));
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/auth/me`)).json(), { loggedIn: false, available });
    child.kill('SIGTERM');
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
  }
});
