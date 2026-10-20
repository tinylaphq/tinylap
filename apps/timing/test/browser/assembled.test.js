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
    assert.ok(css.length, `${screen}: no stylesheets`);
    assert.ok(css.every((href) => new URL(href).pathname.startsWith(`/v/${SHA}/`)), `${screen}: ${css.join(', ')}`);
    const scripts = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map((el) => /** @type {HTMLScriptElement} */ (el).src));
    assert.ok(scripts.every((src) => new URL(src).pathname.startsWith(`/v/${SHA}/`)), `${screen}: ${scripts.join(', ')}`);
    if (screen === 'board') {
      for (const path of ['public/elements/board.js', 'public/elements/countdown.js', 'pkg/design/elements/relative-time.js']) assert.ok(scripts.some((src) => new URL(src).pathname === `/v/${SHA}/${path}`), `the board loads ${path}`);
      assert.equal(await page.evaluate(() => ['tl-board', 'tl-countdown', 'tl-relative-time'].every((name) => customElements.get(name))), true, 'and defines all three');
    }
    if (screen === 'setup') {
      for (const name of ['frame', 'copy']) assert.ok(scripts.some((src) => new URL(src).pathname === `/v/${SHA}/pkg/design/elements/${name}.js`), `setup loads ${name}.js`);
      assert.equal(await page.evaluate(() => Boolean(customElements.get('tl-frame') && customElements.get('tl-copy'))), true, 'and defines both');
    }
    if (screen === 'tap') {
      assert.ok(scripts.some((src) => new URL(src).pathname === `/v/${SHA}/public/elements/tap.js`), 'tap loads public/elements/tap.js');
      assert.equal(await page.evaluate(() => Boolean(customElements.get('tl-tap'))), true, 'and defines tl-tap');
    }
    if (screen === 'bridge') {
      assert.ok(scripts.length, 'the bridge loads a script');
      assert.ok(scripts.some((src) => new URL(src).pathname === `/v/${SHA}/public/elements/bridge.js`), 'the bridge loads public/elements/bridge.js');
      assert.equal(await page.evaluate(() => Boolean(customElements.get('tl-bridge'))), true, 'and defines tl-bridge');
      const map = JSON.parse(await page.locator('script[type="importmap"]').innerText());
      const urls = Object.values(map.imports ?? {});
      assert.ok(urls.length, 'the import map has entries');
      assert.ok(urls.every((url) => new URL(url, page.url()).pathname.startsWith(`/v/${SHA}/`)), `import map: ${urls.join(', ')}`);
    }
  }
  assert.deepEqual(failed, []);
  assert.deepEqual(errors, []);
});
