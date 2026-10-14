// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// GET /invite/:token: join a club from its invite link (spec §6). Signed
// out, it sends you through sign-in or sign-up and back here (`next`). An
// expired, used or revoked link says so and what to do instead.
import { escapeHtml, layout } from './layout.js';

/**
 * @param {{
 *   token: string,
 *   found: { workspace: { id: string, name: string }, problem: string | null } | null,
 *   user: { name: string } | null,
 *   member: boolean,
 * }} view
 */
export function invitePage({ token, found, user, member }) {
  if (!found || found.problem) {
    return layout({
      title: 'Invite link',
      heading: 'This invite does not work',
      body: `
<div class="card-static stack-md">
  <p class="status status-error" role="alert">${escapeHtml(found?.problem ?? 'This invite link is not valid.')}</p>
  <p>Ask ${found ? `someone in <strong>${escapeHtml(found.workspace.name)}</strong>` : 'the club'} for a new invite link.</p>
</div>
<ul class="accounts-links"><li><a href="/clubs">Your clubs</a></li></ul>`,
    });
  }
  const club = escapeHtml(found.workspace.name);
  const clubPath = `/clubs/${encodeURIComponent(found.workspace.id)}`;
  if (!user) {
    const next = `?next=${encodeURIComponent(`/invite/${token}`)}`;
    return layout({
      title: `Join ${found.workspace.name}`,
      lede: `You were invited to the TinyLap club <strong>${club}</strong>. Sign in to join it.`,
      body: `
<div class="card-static stack-md">
  <a class="btn btn-primary btn-block" href="/sign-in${next}">Sign in to join</a>
  <a class="btn btn-outline btn-block" href="/sign-up${next}">Create an account</a>
</div>`,
    });
  }
  if (member) {
    return layout({
      title: found.workspace.name,
      heading: `You are in ${found.workspace.name}`,
      body: `
<div class="card-static stack-md">
  <p>You are already a member, so this link changes nothing.</p>
  <a class="btn btn-primary btn-block" href="${clubPath}">Open the club</a>
</div>`,
    });
  }
  return layout({
    title: `Join ${found.workspace.name}`,
    lede: `You were invited to the TinyLap club <strong>${club}</strong>.`,
    script: 'club.js',
    data: { page: 'invite', token },
    body: `
<form class="card-static stack-md" id="join" novalidate>
  <p>Its members will see your name, ${escapeHtml(user.name)}, and you will see the club's tracks.</p>
  <button type="submit" class="btn btn-primary btn-block">Join ${club}</button>
  <p class="status" id="status" role="status" hidden></p>
</form>
<ul class="accounts-links"><li><a href="/clubs">Not now</a></li></ul>`,
  });
}
