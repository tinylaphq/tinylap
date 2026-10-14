// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// GET /signed-out: where logout ends when no app redirect applies (spec §6).
// A person who is still signed in here (an app asked to log out without a
// valid id_token_hint) is asked to sign out themselves: nobody else can
// end their session with a link.
import { escapeHtml, layout } from './layout.js';

/** @param {{ user: { name: string } | null, deleted: boolean }} view */
export function signedOutPage({ user, deleted }) {
  if (user) {
    return layout({
      title: 'Sign out',
      heading: 'Sign out of TinyLap?',
      lede: `You are still signed in as ${escapeHtml(user.name)}.`,
      script: 'sign-out.js',
      body: `
<form class="card-static stack-md" id="sign-out" novalidate>
  <p>An app asked to sign you out. Signing out here means the next app you open asks for your passkey again.</p>
  <button type="submit" class="btn btn-primary btn-block">Sign out</button>
  <p class="status" id="status" role="status" hidden></p>
</form>
<ul class="accounts-links">
  <li><a href="/account">Stay signed in and go to your account</a></li>
</ul>`,
    });
  }
  return layout({
    title: deleted ? 'Account deleted' : 'Signed out',
    heading: deleted ? 'Your account is deleted' : 'You are signed out',
    lede: deleted ? 'Your name, passkeys and recovery codes are gone, and every device is signed out.' : 'The next time you sign in, TinyLap asks for your passkey.',
    body: `
<div class="card-static stack-md">
  ${deleted ? '<p>You can remove the passkey from your device or password manager too: TinyLap no longer accepts it.</p>' : '<p>You can close this page.</p>'}
  <a href="${deleted ? '/sign-up' : '/sign-in'}" class="btn btn-outline btn-block">${deleted ? 'Create a new account' : 'Sign in again'}</a>
</div>
<ul class="accounts-links">
  <li><a href="/privacy">What TinyLap keeps</a></li>
</ul>`,
  });
}
