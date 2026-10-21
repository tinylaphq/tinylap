// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readSimulate } from '../../server/simulate.js';
import { startTiming } from './helpers.js';

let app;
let member;
before(async () => {
  app = await startTiming();
  member = await app.login(await app.signUp('Ana'));
});
after(() => app.close());

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
