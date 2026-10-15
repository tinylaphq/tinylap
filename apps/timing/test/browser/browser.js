// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Google Chrome through playwright-core, as the planner's browser tests use
// it. A logged-in page gets the session cookie from a login made over HTTP
// (startTiming's login), so no passkey is needed here.
import { chromium } from 'playwright-core';
import { launchOptions } from '../../../accounts/playwright.config.js';

export const openBrowser = () => chromium.launch(launchOptions);

/** A page as `who` (a login from startTiming, or null), collecting script errors and CSP violations. */
export async function pageAs(browser, app, who, { viewport = { width: 1280, height: 800 } } = {}) {
  const context = await browser.newContext({ baseURL: app.base, viewport });
  if (who) {
    // The app sets a Secure __Host- cookie; Playwright takes it for a plain-http host by domain and path, not url.
    const cookies = [...who.jar.cookies].map(([name, value]) => ({ name, value, domain: new URL(app.base).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }));
    await context.addCookies(cookies);
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
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
