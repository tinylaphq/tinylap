// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// GET /clubs: the signed-in user's workspaces, and a form to start a club.
// public/club.js sends the form; the list is rendered here.
import { CLUB_QUOTA } from '../workspaces.js';
import { escapeHtml, layout } from './layout.js';

export const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member' };

/** A role as a tag: the owner's dark, an admin's outlined in purple, a member's plain. */
export const roleTag = (role) => `<span class="tag accounts-role accounts-role-${escapeHtml(role)}">${ROLE_LABEL[role] ?? escapeHtml(role)}</span>`;

/**
 * @param {{ user: { name: string }, workspaces: { id: string, kind: string, name: string, role: string }[] }} view
 */
export function clubsPage({ user, workspaces }) {
  const personal = workspaces.filter((w) => w.kind === 'personal');
  const clubs = workspaces.filter((w) => w.kind === 'club');
  const owned = clubs.filter((w) => w.role === 'owner').length;
  const items = [
    ...personal.map((w) => `
  <li class="accounts-workspace">
    <span class="accounts-workspace-name">${escapeHtml(w.name)}</span>
    <span class="accounts-workspace-meta">Personal, only you</span>
  </li>`),
    ...clubs.map((w) => `
  <li class="accounts-workspace">
    <a class="accounts-workspace-name" href="/clubs/${encodeURIComponent(w.id)}">${escapeHtml(w.name)}</a>
    ${roleTag(w.role)}
  </li>`),
  ].join('');
  return layout({
    title: 'Your clubs',
    lede: `Signed in as ${escapeHtml(user.name)}. Tracks you save go to one of these workspaces.`,
    script: 'club.js',
    data: { page: 'clubs' },
    wide: true,
    body: `<p class="accounts-back"><a href="/account">Your account</a></p>
<section class="stack-md" aria-labelledby="ws-heading">
  <h2 class="h3" id="ws-heading">Workspaces</h2>
  <ul class="accounts-list accounts-workspaces">${items}
  </ul>
  ${clubs.length ? '' : '<p class="empty">You are not in a club yet. Start one below, or open an invite link a club sent you.</p>'}
</section>
<hr class="divider">
<form class="card-static stack-md" id="create-club" novalidate>
  <h2 class="h3">Start a club</h2>
  <div>
    <label for="club-name">Club name</label>
    <input type="text" id="club-name" name="name" maxlength="60" required aria-describedby="club-hint">
    <p class="accounts-hint" id="club-hint">You become its owner and can invite members. You own ${owned} of at most ${CLUB_QUOTA} clubs.</p>
  </div>
  <button type="submit" class="btn btn-primary"${owned >= CLUB_QUOTA ? ' disabled' : ''}>Create club</button>
  <p class="status" id="status" role="status" hidden></p>
</form>`,
  });
}
