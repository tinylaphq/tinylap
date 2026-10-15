// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The app as production serves it: assets under /v/<build>/, every page
// loading them without a 404 or a CSP violation.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../../../../tools/assemble.js';
import { appDir, startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

const SHA = 'abc1234';
let app;
let browser;
let member;

before(async () => {
  const root = mkdtempSync(join(tmpdir(), 'timing-assembled-'));
  assemble(appDir, root, SHA);
  app = await startTiming({ root, build: SHA });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  await app.form(member, '/personal/drivers', { name: 'Ana' });
});
after(async () => {
  await browser?.close();
  await app?.close();
});

test('every screen loads its assets from /v/<build>/', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  const failed = [];
  page.on('response', (res) => { if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`); });
  for (const screen of ['board', 'race', 'tap', 'setup', 'bridge']) {
    await page.goto(`/personal/${screen}`);
    await page.locator('main h1, main .board-title').first().waitFor();
    const css = await page.evaluate(() => [...document.styleSheets].map((s) => s.href).filter(Boolean));
    assert.ok(css.every((href) => new URL(href).pathname.startsWith(`/v/${SHA}/`)), `${screen}: ${css.join(', ')}`);
  }
  assert.deepEqual(failed, []);
  assert.deepEqual(errors, []);
});
