// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A local TinyLap for trying a real decoder on the bench: accounts and timing
// in one process, in memory, and a Chrome window signed in on the Bridge page.
//   pnpm --filter @tinylap/timing-app bench
// The server's log, decoder-log lines included, goes to stdout. Stop with Ctrl-C.
import { chromium } from 'playwright-core';
import { startTiming } from './server/helpers.js';
import { pageAs } from './browser/browser.js';

const app = await startTiming({ log: (/** @type {string} */ line) => console.log(new Date().toISOString(), line) });
const member = await app.login(await app.signUp('Bench'));
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const { page, errors } = await pageAs(browser, app, member);
await page.goto('/personal/bridge');
console.log(`Timing on ${app.base}, signed in as Bench.`);
setInterval(() => {
  for (const error of errors.splice(0)) console.log('[page error]', error);
}, 1000);
browser.on('disconnected', async () => {
  await app.close();
  process.exit(0);
});
