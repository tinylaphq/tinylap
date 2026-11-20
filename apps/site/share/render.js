// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Renders card.html into share.png, the page's link preview. The card is laid
// out inside a built site, so it uses the page's own palace, fonts and poster.
// Run by hand after the card or the hero poster changes: node share/render.js
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { build } from '../build.js';

const here = (/** @type {string} */ path) => fileURLToPath(new URL(path, import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'tinylap-share-'));
await build(out);
copyFileSync(here('card.html'), join(out, 'card.html'));
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 400, height: 210 }, deviceScaleFactor: 3 });
await page.goto(pathToFileURL(join(out, 'card.html')).href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: here('../share.png') });
await browser.close();
