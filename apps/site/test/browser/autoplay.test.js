// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The hero film in a real browser, served from a built site.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createReadStream, existsSync, mkdtempSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';
import { build } from '../../build.js';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };

/** @type {import('node:http').Server} */
let server;
/** @type {import('playwright-core').Browser} */
let browser;
let base = '';

before(async () => {
  const out = mkdtempSync(join(tmpdir(), 'tinylap-site-'));
  await build(out);
  // Served under /tinylap/, as GitHub Pages serves the repository's site.
  server = createServer((req, res) => {
    const path = join(out, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname.replace(/^\/tinylap\//, '/')));
    const file = existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path;
    if (!existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[/** @type {keyof typeof TYPES} */ (extname(file))] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(null)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  base = `http://127.0.0.1:${address.port}/tinylap/`;
  browser = await chromium.launch({ channel: 'chrome' });
});

after(async () => {
  await browser?.close();
  server?.close();
});

/** The hero's video and its toggle, on a fresh page. */
async function hero(/** @type {'reduce' | 'no-preference'} */ reducedMotion) {
  const context = await browser.newContext({ reducedMotion });
  const page = await context.newPage();
  await page.goto(base);
  await page.locator('tl-autoplay .autoplay-toggle').waitFor();
  const video = page.locator('tl-autoplay video');
  const state = () => video.evaluate((/** @type {HTMLVideoElement} */ v) => ({ paused: v.paused, controls: v.controls }));
  return { page, context, toggle: page.locator('tl-autoplay .autoplay-toggle'), state };
}

test('plays by itself', async () => {
  const { context, toggle, state } = await hero('no-preference');
  await toggle.locator('xpath=self::*[@aria-pressed="true"]').waitFor();
  assert.deepEqual(await state(), { paused: false, controls: false });
  assert.equal(await toggle.getAttribute('aria-label'), 'Play animation');
  await context.close();
});

test('pauses and plays on click', async () => {
  const { context, toggle, state } = await hero('no-preference');
  await toggle.locator('xpath=self::*[@aria-pressed="true"]').waitFor();
  await toggle.click();
  await toggle.locator('xpath=self::*[@aria-pressed="false"]').waitFor();
  assert.equal((await state()).paused, true);
  await toggle.click();
  await toggle.locator('xpath=self::*[@aria-pressed="true"]').waitFor();
  assert.equal((await state()).paused, false);
  await context.close();
});

test('stays still with reduced motion', async () => {
  const { page, context, toggle, state } = await hero('reduce');
  await page.waitForTimeout(500);
  assert.deepEqual(await state(), { paused: true, controls: false });
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  await context.close();
});

test('the page fits a phone', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(base);
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  assert.ok(scroll <= client, `page is ${scroll}px wide in a ${client}px window`);
  await context.close();
});
