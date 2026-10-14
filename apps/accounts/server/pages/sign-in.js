// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// GET /sign-in: the provider's login page (oauthProvider loginPage). It is
// opened with the provider's signed query, which public/sign-in.js sends
// back as `oauth_query` with the passkey, so the OAuth flow continues.
import { carry, escapeHtml, layout, NOSCRIPT } from './layout.js';

/** @param {URL} url */
export function signInPage(url) {
  const query = escapeHtml(carry(url));
  return layout({
    title: 'Sign in',
    lede: 'With the passkey you made for TinyLap.',
    script: 'sign-in.js',
    body: `
<form class="card-static stack-md" id="sign-in" novalidate>
  <p>Your device asks for your fingerprint, face or screen lock. There is no password and no username to type.</p>
  <button type="submit" class="btn btn-primary btn-block">Sign in with a passkey</button>
  <p class="status" id="status" role="status" hidden></p>
</form>
${NOSCRIPT}
<ul class="accounts-links">
  <li><a href="/recover${query}">Lost your passkey?</a> Use a recovery code.</li>
  <li>New to TinyLap? <a href="/sign-up${query}">Create an account</a></li>
</ul>`,
  });
}
