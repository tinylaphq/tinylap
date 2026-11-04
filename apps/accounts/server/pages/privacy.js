// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// GET /privacy (spec §12): what TinyLap stores, how to export it and how to
// delete it. The operator line is a placeholder until the legal check
// (issue #8).
import { escapeHtml, layout } from './layout.js';

/** @param {{ plannerExport: string | null }} view */
export function privacyPage({ plannerExport }) {
  return layout({
    title: 'Privacy',
    heading: 'What TinyLap keeps',
    lede: 'As little as an account needs. No email address, no password, no tracking, nothing third-party unless you connect it.',
    wide: true,
    body: `
<section class="stack-md" aria-labelledby="stored-heading">
  <h2 class="h3" id="stored-heading">What is stored</h2>
  <ul class="accounts-list">
    <li class="accounts-row"><span class="accounts-row-main">Your display name<span class="accounts-row-sub">Shown to members of your clubs.</span></span></li>
    <li class="accounts-row"><span class="accounts-row-main">Your passkeys<span class="accounts-row-sub">Only their public halves, a name you give them, and when you added them. The private key never leaves your device or password manager.</span></span></li>
    <li class="accounts-row"><span class="accounts-row-main">Recovery codes<span class="accounts-row-sub">Only a hash of each, and whether it has been used.</span></span></li>
    <li class="accounts-row"><span class="accounts-row-main">Memberships<span class="accounts-row-sub">Your personal space, the clubs you are in, your role in each, and the invite links you made.</span></span></li>
    <li class="accounts-row"><span class="accounts-row-main">Sign-in sessions<span class="accounts-row-sub">One per device you signed in on, with its address and browser, for up to 30 days.</span></span></li>
    <li class="accounts-row"><span class="accounts-row-main">Connected apps<span class="accounts-row-sub">Assistants you allowed to run timing as you: the app, when you allowed it, and its tokens. An app you connect sees your name, your clubs and your role in each, and the timing it reads. Disconnect it on your account page.</span></span></li>
    <li class="accounts-row"><span class="accounts-row-main">Private tracks, in the planner<span class="accounts-row-sub">The tracks and versions you save to your personal space and your clubs. Tracks you share publicly contain no personal data and stay public.</span></span></li>
  </ul>
</section>
<hr class="divider">
<section class="stack-md" aria-labelledby="export-heading">
  <h2 class="h3" id="export-heading">Export it</h2>
  <p>On <a href="/account">your account page</a>, download your account data as JSON${plannerExport ? `, and <a href="${escapeHtml(plannerExport)}">your tracks from the planner</a>` : ''}.</p>
</section>
<hr class="divider">
<section class="stack-md" aria-labelledby="delete-heading">
  <h2 class="h3" id="delete-heading">Delete it</h2>
  <p>Delete your account on <a href="/account">your account page</a>. It removes your name, passkeys, recovery codes, sessions and personal space at once and signs you out everywhere; the planner then deletes your private tracks. Clubs keep the tracks you saved to them. If you own a club, hand it on or delete it first.</p>
</section>
<hr class="divider">
<p class="accounts-hint">Operator: see the project README</p>`,
  });
}
