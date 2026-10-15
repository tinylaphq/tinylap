// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Browser settings for test/browser (run with `pnpm test:browser`). The
// tests use playwright-core under node:test, not the Playwright test
// runner, so this module is only the shared launch options: the installed
// Google Chrome (`npx playwright-core install chrome` where there is none),
// headless.

/** @type {import('playwright-core').LaunchOptions} */
export const launchOptions = { channel: 'chrome', headless: true };

/** The CDP virtual authenticator every test page gets: a platform passkey with user verification. */
export const authenticatorOptions = /** @type {const} */ ({
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
});
