// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { lanAddress } from '../../server/addresses.js';

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

/** A port free right now, for a run whose decoder address names it. */
async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  server.close();
  await once(server, 'close');
  return port;
}

test("in dev decoders post to this machine's network address, or TINYLAP_DECODER_URL; on a random port it stays on this machine", async () => {
  const port = String(await freePort());
  const lan = lanAddress();
  const cases = [
    [{ PORT: port }, lan ? `timing on http://0.0.0.0:${port}` : 'timing on http://127.0.0.1:', lan ? `decoders post to http://${lan}:${port}` : "decoders can't reach it over Wi-Fi (no network)"],
    [{ TINYLAP_DECODER_URL: 'http://192.168.1.20:8100' }, 'timing on http://0.0.0.0:', 'decoders post to http://192.168.1.20:8100'],
    [{}, 'timing on http://127.0.0.1:', "decoders can't reach it over Wi-Fi (no network)"],
  ];
  for (const [env, listens, decoders] of cases) {
    const child = run({ ...FULL, ...env });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.resume();
    try {
      while (!/timing on http:/.test(out)) await once(child.stdout, 'data');
      assert.ok(out.includes(listens), `${JSON.stringify(env)}: ${out}`);
      assert.ok(out.includes(decoders), `${JSON.stringify(env)}: ${out}`);
    } finally {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  }
});

test('timing refuses a TINYLAP_SIMULATE it does not understand', async () => {
  const child = run({ ...FULL, TINYLAP_SIMULATE: 'amb' });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.match(err, /TINYLAP_SIMULATE:/);
});
