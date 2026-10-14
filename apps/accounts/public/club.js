// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The clubs pages: /clubs (start a club), /clubs/:id (members, invites,
// settings) and /invite/:token (join). The server renders what the
// viewer's role may do; this sends the requests. Destructive actions ask
// first in the page's confirm dialog. A change reloads the page, except a
// new invite, whose link is shown once and must not be lost.
import { api, onSubmit, PageError, show } from './webauthn.js';

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const { page, club, name: clubName } = document.body.dataset;
const base = club ? `/api/clubs/${encodeURIComponent(club)}` : '';

/** "21 Oct 2026", as the server writes it. */
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Asks in the confirm dialog; resolves true if the person confirmed.
 * @param {string} text @param {string} action the confirm button's label
 */
function confirmAction(text, action) {
  const dialog = $('confirm');
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = action;
  dialog.returnValue = '';
  dialog.showModal();
  $('confirm-cancel').focus();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
  });
}

/** Runs a button's request with the button disabled, reporting errors in `status`. */
async function act(button, status, run) {
  button.disabled = true;
  try {
    await run();
  } catch (error) {
    show(status, error instanceof PageError ? error.message : 'Something went wrong. Try again.', 'error');
    if (!(error instanceof PageError)) console.error(error);
  } finally {
    button.disabled = false;
  }
}

if (page === 'clubs') {
  onSubmit($('create-club'), $('status'), async () => {
    const name = $('club-name').value.trim();
    if (!name) {
      $('club-name').focus();
      throw new PageError('Type a club name first.');
    }
    const created = await api('/api/clubs', { method: 'POST', body: { name } });
    location.assign(`/clubs/${encodeURIComponent(created.id)}`);
  });
}

if (page === 'club') {
  $('members').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const row = button.closest('[data-user]');
    const { user, name } = row.dataset;
    const status = $('members-status');
    act(button, status, async () => {
      if (button.dataset.action === 'role') {
        await api(`${base}/members/${encodeURIComponent(user)}`, { method: 'PATCH', body: { role: button.dataset.role } });
      } else {
        if (!(await confirmAction(`Remove ${name} from ${clubName}? They lose access to the club's tracks.`, 'Remove'))) return;
        await api(`${base}/members/${encodeURIComponent(user)}`, { method: 'DELETE' });
      }
      location.reload();
    });
  });

  const inviteForm = $('create-invite');
  if (inviteForm) {
    onSubmit(inviteForm, $('invite-status'), async () => {
      const { link, invite } = await api(`${base}/invites`, {
        method: 'POST',
        body: { singleUse: $('single-use').checked, ttlDays: Number($('ttl').value) },
      });
      $('invite-link').textContent = link;
      $('invite-expiry').textContent = `${invite.singleUse ? 'Single use' : 'Reusable'}, expires ${day(invite.expiresAt)}.`;
      $('copy-status').hidden = true;
      $('new-invite').hidden = false;
      $('new-invite').focus();
      const row = $('invite-row').content.firstElementChild.cloneNode(true);
      row.dataset.invite = invite.id;
      row.querySelector('.accounts-row-main').firstChild.textContent = `${invite.singleUse ? 'Single use' : 'Reusable'}, expires `;
      const time = row.querySelector('time');
      time.dateTime = invite.expiresAt;
      time.textContent = day(invite.expiresAt);
      if (invite.createdBy) time.after(Object.assign(document.createElement('span'), { className: 'accounts-row-sub', textContent: `Made by ${invite.createdBy}` }));
      $('invites').prepend(row);
      $('no-invites').hidden = true;
    });

    $('copy-invite').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText($('invite-link').textContent);
        show($('copy-status'), 'Copied', 'success');
      } catch {
        show($('copy-status'), 'Copying was blocked. Select the link and copy it by hand.', 'error');
      }
    });

    $('invites').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action="revoke"]');
      if (!button) return;
      const row = button.closest('[data-invite]');
      act(button, $('invite-status'), async () => {
        await api(`${base}/invites/${encodeURIComponent(row.dataset.invite)}`, { method: 'DELETE' });
        row.remove();
        $('no-invites').hidden = $('invites').children.length > 0;
        show($('invite-status'), 'Invite revoked. Its link no longer works.', 'success');
      });
    });
  }

  const rename = $('rename');
  if (rename) {
    onSubmit(rename, $('rename-status'), async () => {
      await api(base, { method: 'PATCH', body: { name: $('club-name').value } });
      location.reload();
    });
  }

  const transfer = $('transfer');
  if (transfer) {
    onSubmit(transfer, $('transfer-status'), async () => {
      const select = $('new-owner');
      const to = select.selectedOptions[0];
      if (!to) throw new PageError('Choose a member first.');
      if (!(await confirmAction(`Make ${to.textContent} the owner of ${clubName}? You become an admin and cannot undo this yourself.`, 'Transfer ownership'))) return;
      await api(`${base}/transfer`, { method: 'POST', body: { userId: to.value } });
      location.reload();
    });
  }

  const remove = $('delete-club');
  if (remove) {
    remove.addEventListener('click', () => act(remove, $('danger-status'), async () => {
      if (!(await confirmAction(`Delete ${clubName} for everyone? Its tracks are deleted too. This cannot be undone.`, 'Delete club'))) return;
      await api(base, { method: 'DELETE' });
      location.assign('/clubs');
    }));
  }

  const leave = $('leave-club');
  if (leave) {
    leave.addEventListener('click', () => act(leave, $('danger-status'), async () => {
      if (!(await confirmAction(`Leave ${clubName}? You need a new invite to come back.`, 'Leave club'))) return;
      await api(`${base}/leave`, { method: 'POST' });
      location.assign('/clubs');
    }));
  }
}

if (page === 'invite') {
  onSubmit($('join'), $('status'), async () => {
    const { workspace } = await api('/api/invites/redeem', { method: 'POST', body: { token: document.body.dataset.token } });
    location.assign(`/clubs/${encodeURIComponent(workspace.id)}`);
  });
}
