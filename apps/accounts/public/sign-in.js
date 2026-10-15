// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// /sign-in: one passkey ceremony. Opened by the OAuth provider, the answer
// is a redirect back to the client (the provider continues the flow when
// the request carries its signed query as oauth_query).
import { nextPath, oauthQuery, onSubmit, show, signInWithPasskey } from './webauthn.js';

const form = /** @type {HTMLFormElement} */ (document.getElementById('sign-in'));
const status = /** @type {HTMLElement} */ (document.getElementById('status'));

onSubmit(form, status, async () => {
  show(status, 'Waiting for your passkey', 'info');
  const result = await signInWithPasskey(oauthQuery());
  if (result?.redirect && typeof result.url === 'string') {
    show(status, 'Signed in. Taking you back', 'success');
    location.assign(result.url);
    return;
  }
  show(status, `Signed in as ${result?.user?.name ?? 'you'}`, 'success');
  const next = nextPath();
  if (next) location.assign(next);
});
