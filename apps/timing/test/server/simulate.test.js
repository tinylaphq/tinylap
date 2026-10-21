// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { appDir, startTiming } from './helpers.js';
import { isInstallPath, readSimulate } from '../../server/simulate.js';

let app;
let member;
before(async () => {
  app = await startTiming();
  member = await app.login(await app.signUp('Ana'));
});
// install.js arrives with the simulators; a stand-in lets the gate be tested against a file that exists.
const FIXTURE = `${appDir}/public/sim/install.js`;
const planted = !existsSync(FIXTURE);
before(() => {
  if (planted) {
    writeFileSync(FIXTURE, '// test stand-in\n');
  }
});
after(() => {
  if (planted) rmSync(FIXTURE, { force: true });
  return app.close();
});

test('readSimulate takes <model>[,fast], and nothing else', () => {
  for (const value of ['tinylap', 'zround,fast', 'easylap', 'easylap,fast']) assert.equal(readSimulate(value), value);
  assert.equal(readSimulate(undefined), null);
  assert.equal(readSimulate(''), null);
  for (const value of ['amb', 'zround,slow', ' tinylap', 'TinyLap']) assert.throws(() => readSimulate(value), /<model>\[,fast\]/);
});

const page = async (path = '/personal/bridge') => (await app.api(member, 'GET', path, undefined, { accept: 'text/html' })).text();
const INSTALL = '<script type="module" src="/public/sim/install.js" data-model="zround,fast"></script>';

test('the install script is on the bridge page exactly while the setting is on, after the import map and before tl-bridge', async () => {
  assert.doesNotMatch(await page(), /sim\/install\.js/);
  assert.equal((await fetch(`${app.base}/public/sim/install.js`)).status, 404, 'not served while off');
  app.simulate = 'zround,fast';
  try {
    const body = await page();
    const at = body.indexOf(INSTALL);
    assert.ok(at > body.indexOf('<script type="importmap">') && at < body.indexOf('/public/elements/bridge.js'));
    assert.doesNotMatch(await page('/personal/setup'), /sim\/install\.js/, 'only pages with the import map');
    assert.throws(() => { app.simulate = 'amb'; });
  } finally {
    app.simulate = null;
  }
  assert.doesNotMatch(await page(), /sim\/install\.js/);
});

const VARIANTS = ['/public/sim/install.js', '/public/sim//install.js', '/public//sim/install.js', '/public/sim/install%2Ejs', '/public/sim/../sim/install.js', '/public/sim/INSTALL.js'];

test('the gate holds for every spelling that reaches the file: 404 while off, served while on', async () => {
  for (const path of VARIANTS) assert.equal((await fetch(`${app.base}${path}`)).status, 404, `${path} off`);
  app.simulate = 'tinylap';
  try {
    for (const path of VARIANTS.slice(0, 5)) assert.equal((await fetch(`${app.base}${path}`)).status, 200, `${path} on`);
  } finally {
    app.simulate = null;
  }
});

test('isInstallPath sees through decoding, repeated slashes, dot segments, case and the /v/<sha>/ prefix', () => {
  for (const path of [...VARIANTS, '/v/abc123/public/sim/install.js', '/v/abc123/public/sim//install%2ejs']) assert.equal(isInstallPath(path), true, path);
  for (const path of ['/public/sim/other.js', '/public/elements/bridge.js', '/public/sim/install.json', '/x/public/sim/install.js', '/%E0%A4%A']) assert.equal(isInstallPath(path), false, path);
});
