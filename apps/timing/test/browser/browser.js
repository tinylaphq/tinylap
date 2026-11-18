// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Google Chrome through playwright-core, as the planner's browser tests use
// it. A logged-in page gets the session cookie from a login made over HTTP
// (startTiming's login), so no passkey is needed here.
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { launchOptions } from '../../../accounts/playwright.config.js';

/**
 * How long a new Chrome gets to start, and then to open its first page. One that works does each in a second or two,
 * even under load; three tries fit in a test's 60 s, which a before hook's time counts against.
 */
const START_MS = 10_000;
const LAUNCHES = 3;

/** The processes this one started. */
function children() {
  try {
    return execFileSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

/** Whether `browser` opens and closes a page within START_MS. */
async function answers(browser) {
  let timer;
  const check = (async () => {
    const context = await browser.newContext();
    await context.newPage();
    await context.close();
    return true;
  })();
  check.catch(() => {});
  try {
    return await Promise.race([check, new Promise((done) => { timer = setTimeout(() => done(false), START_MS); })]);
  } finally {
    clearTimeout(timer);
  }
}

/** A new Chrome that has opened a page, or null when it didn't start or open one within START_MS each. */
async function launched() {
  const before = new Set(children());
  const browser = await chromium.launch({ ...launchOptions, timeout: START_MS }).catch((error) => {
    if (error?.name === 'TimeoutError') return null;
    throw error;
  });
  if (browser && await answers(browser)) return browser;
  for (const pid of children().filter((p) => !before.has(p))) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* gone already */ }
  }
  return null;
}

/**
 * A Chrome that has opened a page. On macOS, now and then a new Chrome's main thread blocks for good in
 * RunningBoard (rbs_acquire_appnap_assertion, waiting on runningboardd) as it starts: it never opens a page, so
 * every test of the file would wait out its timeout. Such a Chrome is killed and another launched.
 */
export async function openBrowser() {
  for (let launch = 1; ; launch += 1) {
    const browser = await launched();
    if (browser) return browser;
    if (launch === LAUNCHES) throw new Error(`Chrome didn't start and open a page within ${START_MS} ms, ${LAUNCHES} launches in a row`);
    console.warn(`Chrome didn't start and open a page within ${START_MS} ms (launch ${launch}); killed it and launching another`);
  }
}

/** A page as `who` (a login from startTiming, or null), collecting script errors and CSP violations. */
export async function pageAs(browser, app, who, { viewport = { width: 1280, height: 800 }, javaScriptEnabled = true, timezoneId } = {}) {
  const context = await browser.newContext({ baseURL: app.base, viewport, javaScriptEnabled, timezoneId });
  if (who) {
    // The app sets a Secure __Host- cookie; Playwright takes it for a plain-http host by domain and path, not url.
    const cookies = [...who.jar.cookies].map(([name, value]) => ({ name, value, domain: new URL(app.base).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }));
    await context.addCookies(cookies);
  }
  const page = await context.newPage();
  const errors = [];
  // Chrome reports a cross-fade it gave up on as a page error, though the
  // page is fine: the navigation simply happens without it.
  page.on('pageerror', (error) => { if (!/ViewTransition opt-in disabled/.test(error.message)) errors.push(error.message); });
  page.on('console', (message) => {
    if (message.type() === 'error' && !/status of 40[134]/.test(message.text())) errors.push(message.text());
  });
  return { context, page, errors };
}

/** Posts passings as a decoder. */
export const postPassings = (app, decoder, passings, boot = 'b00tb00t') => fetch(`${app.base}/decoders/${decoder.id}/passings`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${decoder.token}` },
  body: JSON.stringify({ boot, passings }),
});
