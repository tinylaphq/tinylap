// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The planner at phone and tablet widths: the pieces are reachable (not
// squeezed into a sliver), the canvas has room, and nothing makes the page
// scroll sideways.
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

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]]) {
  test(`on a ${name} the pieces and the canvas both have room`, async (t) => {
    const context = await browser.newContext({ baseURL: server.base, viewport });
    t.after(() => context.close());
    const page = await context.newPage();
    await page.goto('/');
    const pieces = page.locator('#palette-list li');
    await pieces.first().waitFor();
    const palette = await page.locator('#palette').boundingBox();
    const piece = await pieces.first().boundingBox();
    // The rail shows whole pieces, not a sliver.
    assert.ok(palette.height >= piece.height, `palette ${palette.height}px tall, a piece ${piece.height}px`);
    assert.ok(piece.y >= palette.y && piece.y + piece.height <= palette.y + palette.height, 'the first piece is inside the rail');
    const canvas = await page.locator('main').boundingBox();
    assert.ok(canvas.height >= viewport.height * 0.5, `canvas ${canvas.height}px tall`);
    assert.ok(canvas.y >= palette.y + palette.height - 1, 'the canvas comes after the pieces');
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(sideways, 0, 'the page does not scroll sideways');
  });
}
