// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// GET /sign-up (spec §6): display name, then a passkey, then ten recovery
// codes shown once, confirmed with "I've saved them". One step is visible
// at a time; public/sign-up.js moves between them.
import { carry, escapeHtml, layout, NOSCRIPT } from './layout.js';

export const LOSS_WARNING = 'Losing every passkey and every recovery code loses this account. Nobody can restore it.';

/** The three steps, shown as a progress list above the form. */
export function progress(steps, current) {
  return `<ol class="accounts-progress" aria-label="Steps">
${steps.map((s, i) => `  <li data-step="${s.id}"${i === current ? ' aria-current="step"' : ''}><span class="step-num">${i + 1}</span>${s.label}</li>`).join('\n')}
</ol>`;
}

/** The recovery codes step, shared with the account page later. */
export const CODES_STEP = `
<form class="card-static stack-md" id="codes" hidden novalidate>
  <h2 class="h3" tabindex="-1">Save your recovery codes</h2>
  <p>If you lose your passkey, one of these codes lets you back in. Each works once. This is the only time they are shown.</p>
  <div class="code-reveal">
    <ol class="accounts-codes" id="code-list"></ol>
    <div class="accounts-actions">
      <button type="button" class="btn btn-sm btn-secondary" id="copy">Copy</button>
      <button type="button" class="btn btn-sm btn-outline accounts-on-dark" id="download">Download .txt</button>
    </div>
  </div>
  <label class="accounts-check"><input type="checkbox" id="saved"> I've saved them</label>
  <button type="submit" class="btn btn-primary btn-block" id="continue" disabled>Continue</button>
  <p class="status" id="codes-status" role="status" hidden></p>
</form>`;

/**
 * @param {URL} url
 * @param {{ name: string } | null} signedIn a signed-in user, who gets no second account here
 */
export function signUpPage(url, signedIn) {
  const query = escapeHtml(carry(url));
  if (signedIn) {
    return layout({
      title: 'Create an account',
      heading: 'You are signed in',
      lede: `As ${escapeHtml(signedIn.name)}.`,
      script: 'sign-out.js',
      body: `
<form class="card-static stack-md" id="sign-out" novalidate>
  <p>To create another account, sign out first.</p>
  <button type="submit" class="btn btn-outline btn-block">Sign out</button>
  <p class="status" id="status" role="status" hidden></p>
</form>`,
    });
  }
  return layout({
    title: 'Create an account',
    lede: 'A name, a passkey and ten recovery codes. That is all TinyLap keeps.',
    script: 'sign-up.js',
    body: `
${progress([{ id: 'name', label: 'Name' }, { id: 'passkey', label: 'Passkey' }, { id: 'codes', label: 'Recovery codes' }], 0)}
<form class="card-static stack-md" id="name-form" novalidate>
  <div>
    <label for="display-name">Display name</label>
    <input type="text" id="display-name" name="displayName" maxlength="40" autocomplete="nickname" required aria-describedby="name-hint">
    <p class="accounts-hint" id="name-hint">Members of your clubs see this name. Up to 40 characters.</p>
  </div>
  <p class="status status-warning" role="note">${LOSS_WARNING}</p>
  <button type="submit" class="btn btn-primary btn-block">Create a passkey</button>
  <p class="status" id="status" role="status" hidden></p>
</form>
${CODES_STEP}
<div class="card-static stack-md" id="done" hidden>
  <p class="status status-success" role="status">Your account is ready</p>
  <p>You are signed in. You can close this page.</p>
</div>
${NOSCRIPT}
<ul class="accounts-links">
  <li>Already have an account? <a href="/sign-in${query}">Sign in</a></li>
</ul>`,
  });
}
