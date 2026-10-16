// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The shared account menu (tl-menu) against the planner's own handlers: the
// canvas's drag handles stop pointerdown, and Escape also means "drop the
// selection". The menu is shown by hand here, as if signed in; the library
// test covers the signed-in flow.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { launchOptions } from '../../../accounts/playwright.config.js';
import { startServer } from '../server/helpers.js';

/** @type {import('playwright-core').Browser} */
let browser;
let server;

before(async () => {
  server = await startServer();
  browser = await chromium.launch(launchOptions);
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function planner(t) {
  const context = await browser.newContext({ baseURL: server.base, viewport: { width: 1280, height: 800 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto('/');
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('#account, #account .nav-account')) /** @type {HTMLElement} */ (el).hidden = false;
  });
  await page.locator('#btn-presets').click();
  await page.locator('#presets-list button[data-preset-id]').first().click();
  await page.locator('.mat').first().waitFor();
  return page;
}

const menuOpen = (page) => page.locator('#account details').evaluate((d) => /** @type {HTMLDetailsElement} */ (d).open);

test('Escape closes the menu without also dropping the canvas selection', async (t) => {
  const page = await planner(t);
  await page.locator('.mat').first().click();
  const selected = await page.locator('.mat.selected').count();
  assert.ok(selected > 0, 'a piece is selected');
  await page.locator('#account summary').click();
  await page.keyboard.press('Escape');
  assert.equal(await menuOpen(page), false);
  assert.equal(await page.locator('.mat.selected').count(), selected, 'the selection stays');
});

test('a press on a drag handle, which stops the event, still closes the menu', async (t) => {
  const page = await planner(t);
  // The stock layout is a closed loop; taking one piece out opens two ends, with drag handles.
  await page.locator('.mat').first().click();
  await page.keyboard.press('Delete');
  const handle = page.locator('.port-handle').first();
  await handle.waitFor();
  await page.locator('#account summary').click();
  assert.equal(await menuOpen(page), true);
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  assert.equal(await menuOpen(page), false);
});
