// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// GET /recover (spec §6): one recovery code, then a passkey, which is not
// optional: until it exists, the session can do nothing else. A recovery
// session that reloads the page lands on the passkey step.
import { carry, escapeHtml, layout, NOSCRIPT } from './layout.js';
import { progress } from './sign-up.js';

/**
 * @param {URL} url
 * @param {{ name: string } | null} recovering the user of a recovery session, if this is one
 */
export function recoverPage(url, recovering) {
  const query = escapeHtml(carry(url));
  return layout({
    title: 'Recover your account',
    lede: 'With one of the recovery codes you saved when you signed up.',
    script: 'recover.js',
    data: recovering ? { step: 'passkey', name: recovering.name } : { step: 'code' },
    body: `
${progress([{ id: 'code', label: 'Recovery code' }, { id: 'passkey', label: 'New passkey' }], recovering ? 1 : 0)}
<form class="card-static stack-md" id="code-form"${recovering ? ' hidden' : ''} novalidate>
  <div>
    <label for="code">Recovery code</label>
    <input type="text" id="code" name="code" class="accounts-mono" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" required aria-describedby="code-hint">
    <p class="accounts-hint" id="code-hint">It looks like <span class="accounts-mono">Ab3x-9Qz.k2…</span>, with one dot. Each code works once.</p>
  </div>
  <button type="submit" class="btn btn-primary btn-block">Use this code</button>
  <p class="status" id="status" role="status" hidden></p>
</form>
<form class="card-static stack-md" id="passkey-form"${recovering ? '' : ' hidden'} novalidate>
  <h2 class="h3">Add a passkey</h2>
  <p>Your code worked. Before anything else, create a passkey on this device: until you do, your account stays locked.</p>
  <button type="submit" class="btn btn-primary btn-block">Create a passkey</button>
  <p class="status" id="passkey-status" role="status" hidden></p>
</form>
<div class="card-static stack-md" id="done" hidden>
  <p class="status status-success" role="status">Passkey added</p>
  <p>You are signed in. If you have few recovery codes left, make a new set from your account.</p>
</div>
${NOSCRIPT}
<ul class="accounts-links">
  <li>Found your passkey? <a href="/sign-in${query}">Sign in</a></li>
</ul>`,
  });
}
