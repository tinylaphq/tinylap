// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// GET /clubs/:id: members and roles, invites, and the club's settings, each
// shown only to a role that may use it (spec §5). public/club.js does the
// requests; destructive ones ask first in one shared confirm dialog.
import { can } from '@tinylap/auth';
import { escapeHtml, layout } from './layout.js';
import { roleTag } from './clubs.js';

/** "21 Oct 2026", in UTC so the server and the test agree. */
export const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const YOU_ARE = { owner: 'You own this club.', admin: 'You are an admin of this club.', member: 'You are a member of this club.' };

/** One open invite, as the list and public/club.js's template show it. */
export const inviteRow = (invite) => `
    <li class="accounts-row" data-invite="${escapeHtml(invite.id)}">
      <span class="accounts-row-main">${invite.singleUse ? 'Single use' : 'Reusable'}, expires <time datetime="${escapeHtml(invite.expiresAt)}">${escapeHtml(day(invite.expiresAt))}</time>${invite.createdBy ? `<span class="accounts-row-sub">Made by ${escapeHtml(invite.createdBy)}</span>` : ''}</span>
      <span class="accounts-row-actions"><button type="button" class="btn btn-sm btn-outline" data-action="revoke">Revoke</button></span>
    </li>`;

/**
 * @param {{
 *   user: { id: string },
 *   claims: { workspaces: { id: string, role: import('@tinylap/auth').Role }[] },
 *   workspace: { id: string, name: string, role: string },
 *   members: { id: string, name: string, role: string }[],
 *   invites: { id: string, singleUse: boolean, expiresAt: string, createdBy: string | null }[] | null,
 * }} view
 */
export function clubPage({ user, claims, workspace, members, invites }) {
  /** @param {import('@tinylap/auth').Action} action */
  const may = (action) => can(claims, workspace.id, action);
  const memberRows = members.map((m) => {
    const self = m.id === user.id;
    const actions = [];
    if (!self && m.role !== 'owner') {
      if (may('admin.manage')) {
        actions.push(m.role === 'admin'
          ? '<button type="button" class="btn btn-sm btn-outline" data-action="role" data-role="member">Make member</button>'
          : '<button type="button" class="btn btn-sm btn-outline" data-action="role" data-role="admin">Make admin</button>');
      }
      if (m.role === 'admin' ? may('admin.manage') : may('member.remove')) {
        actions.push('<button type="button" class="btn btn-sm btn-danger" data-action="remove">Remove</button>');
      }
    }
    return `
    <li class="accounts-row" data-user="${escapeHtml(m.id)}" data-name="${escapeHtml(m.name)}">
      <span class="accounts-row-main">${escapeHtml(m.name)}${self ? ' <span class="accounts-you">(you)</span>' : ''}</span>
      ${roleTag(m.role)}
      ${actions.length ? `<span class="accounts-row-actions">${actions.join('')}</span>` : ''}
    </li>`;
  }).join('');

  const others = members.filter((m) => m.id !== user.id);
  const sections = [`
<section class="stack-md" aria-labelledby="members-heading">
  <h2 class="h3" id="members-heading">Members <span class="accounts-count">${members.length}</span></h2>
  <ul class="accounts-list" id="members">${memberRows}
  </ul>
  <p class="status" id="members-status" role="status" hidden></p>
</section>`];

  if (invites) {
    sections.push(`
<hr class="divider">
<section class="stack-md" aria-labelledby="invites-heading">
  <h2 class="h3" id="invites-heading">Invite people</h2>
  <form class="card-static stack-md" id="create-invite" novalidate>
    <p>Anyone with the link can join as a member until it expires. Send it the way you would send a key.</p>
    <div class="accounts-fields">
      <label class="accounts-check"><input type="checkbox" id="single-use" checked> Single use</label>
      <div class="accounts-field">
        <label for="ttl">Expires after</label>
        <select id="ttl">
          <option value="1">1 day</option>
          <option value="7" selected>7 days</option>
          <option value="30">30 days</option>
        </select>
      </div>
    </div>
    <button type="submit" class="btn btn-primary">Create invite link</button>
    <p class="status" id="invite-status" role="status" hidden></p>
  </form>
  <div class="code-reveal accounts-reveal" id="new-invite" hidden tabindex="-1">
    <p class="accounts-reveal-note">Copy this link now. It is shown only once.</p>
    <code id="invite-link"></code>
    <p class="accounts-reveal-meta" id="invite-expiry"></p>
    <div class="accounts-actions">
      <button type="button" class="btn btn-sm btn-secondary" id="copy-invite">Copy link</button>
    </div>
    <p class="status" id="copy-status" role="status" hidden></p>
  </div>
  <h3 class="accounts-subhead">Open invites</h3>
  <ul class="accounts-list" id="invites">${invites.map(inviteRow).join('')}
  </ul>
  <p class="empty" id="no-invites"${invites.length ? ' hidden' : ''}>No open invites.</p>
  <template id="invite-row">${inviteRow({ id: '', singleUse: true, expiresAt: new Date(0).toISOString(), createdBy: null })}</template>
</section>`);
  }

  if (may('club.manage')) {
    sections.push(`
<hr class="divider">
<section class="stack-md" aria-labelledby="settings-heading">
  <h2 class="h3" id="settings-heading">Club settings</h2>
  <form class="card-static stack-md" id="rename" novalidate>
    <div>
      <label for="club-name">Club name</label>
      <input type="text" id="club-name" maxlength="60" required value="${escapeHtml(workspace.name)}">
    </div>
    <button type="submit" class="btn btn-secondary">Rename club</button>
    <p class="status" id="rename-status" role="status" hidden></p>
  </form>
  <form class="card-static stack-md" id="transfer" novalidate>
    <div>
      <label for="new-owner">Transfer ownership to</label>
      <select id="new-owner"${others.length ? '' : ' disabled'}>
${others.map((m) => `        <option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('\n')}
      </select>
      <p class="accounts-hint">${others.length ? 'They become the owner and you become an admin.' : 'Invite someone first: only a member can take over.'}</p>
    </div>
    <button type="submit" class="btn btn-outline"${others.length ? '' : ' disabled'}>Transfer ownership</button>
    <p class="status" id="transfer-status" role="status" hidden></p>
  </form>
</section>`);
  }

  sections.push(`
<hr class="divider-danger">
<div class="danger-zone stack-md">
${may('club.manage') ? `  <h2 class="h3">Delete this club</h2>
  <p>Members lose access to its tracks at once, and the tracks are deleted. This cannot be undone.</p>
  <button type="button" class="btn btn-danger btn-block" id="delete-club">Delete club</button>` : `  <h2 class="h3">Leave this club</h2>
  <p>The club keeps the tracks you saved to it. Copy any you want to your personal workspace first.</p>
  <button type="button" class="btn btn-danger btn-block" id="leave-club">Leave club</button>`}
  <p class="status" id="danger-status" role="status" hidden></p>
</div>`);

  return layout({
    title: workspace.name,
    lede: YOU_ARE[workspace.role] ?? '',
    script: 'club.js',
    data: { page: 'club', club: workspace.id, name: workspace.name, self: user.id },
    wide: true,
    body: `<p class="accounts-back"><a href="/clubs">All your clubs</a></p>
${sections.join('\n')}
<dialog class="card-static accounts-dialog" id="confirm" aria-labelledby="confirm-text">
  <form method="dialog" class="stack-md">
    <p id="confirm-text"></p>
    <div class="accounts-actions">
      <button type="submit" value="cancel" class="btn btn-outline" id="confirm-cancel">Cancel</button>
      <button type="submit" value="ok" class="btn btn-danger" id="confirm-ok">Confirm</button>
    </div>
  </form>
</dialog>`,
  });
}
