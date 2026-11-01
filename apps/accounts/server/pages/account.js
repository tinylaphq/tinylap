// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// GET /account (spec §6): passkeys (adding a second is the prominent
// action), recovery codes, sign out everywhere, export, and deleting the
// account. public/account.js sends the requests; destructive ones ask
// first, and the ones that need a fresh session ask for the passkey again.
import { escapeHtml, layout, NOSCRIPT } from './layout.js';
import { day } from './club.js';

/** Ten marks, one per code in a set: filled while the code is unused. */
const codeGauge = (left) => `<span class="accounts-gauge" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<span class="accounts-gauge-mark${i < left ? ' is-left' : ''}"></span>`).join('')}</span>`;

const quoteList = (names) => names.map((n) => `"${escapeHtml(n)}"`).join(', ');

/**
 * @param {{
 *   user: { id: string, name: string, createdAt: string },
 *   passkeys: { id: string, name: string | null, createdAt: string, synced: boolean }[],
 *   codesLeft: number,
 *   owned: string[],
 *   plannerExport: string | null,
 *   connections?: { clientId: string, name: string, host: string, allowedAt: string, lastUsedAt: string | null }[],
 *   disconnected?: string | null,
 * }} view
 */
export function accountPage({ user, passkeys, codesLeft, owned, plannerExport, connections = [], disconnected = null }) {
  const only = passkeys.length <= 1;
  const passkeyRows = passkeys.map((k, i) => `
    <li class="accounts-row" data-passkey="${escapeHtml(k.id)}" data-label="${escapeHtml(k.name ?? `Passkey ${i + 1}`)}">
      <span class="accounts-row-main">${escapeHtml(k.name ?? `Passkey ${i + 1}`)}<span class="accounts-row-sub">Added <time datetime="${escapeHtml(k.createdAt)}">${escapeHtml(day(k.createdAt))}</time>${k.synced ? ', synced by your password manager' : ''}</span></span>
      <span class="accounts-row-actions"><button type="button" class="btn btn-sm btn-outline" data-action="remove"${only ? ' disabled aria-describedby="only-passkey"' : ''}>Remove</button></span>
    </li>`).join('');

  const codesNote = codesLeft === 0
    ? '<p class="status status-warning" role="note">You have no recovery codes left. Make a new set now, or losing your passkeys loses the account.</p>'
    : `<p class="accounts-gauge-row">${codeGauge(codesLeft)}<span><strong>${codesLeft} of 10</strong> codes unused</span></p>`;

  // Plain forms (POST, then a 303 back here): no script needed to disconnect.
  const appRows = connections.map((c) => `
    <li class="accounts-row">
      <span class="accounts-row-main">${escapeHtml(c.name)}<span class="accounts-row-sub">${escapeHtml(c.host)} · allowed <time datetime="${escapeHtml(c.allowedAt)}">${escapeHtml(day(c.allowedAt))}</time>${c.lastUsedAt ? `, last used <time datetime="${escapeHtml(c.lastUsedAt)}">${escapeHtml(day(c.lastUsedAt))}</time>` : ''}</span></span>
      <span class="accounts-row-actions"><form method="post" action="/account/apps/disconnect"><input type="hidden" name="client" value="${escapeHtml(c.clientId)}"><button type="submit" class="btn btn-sm btn-outline">Disconnect</button></form></span>
    </li>`).join('');
  const apps = `
<section class="stack-md" id="apps" aria-labelledby="apps-heading">
  <h2 class="h3" id="apps-heading">Connected apps <span class="accounts-count">${connections.length}</span></h2>
  ${disconnected ? `<p class="status status-success" role="status">${escapeHtml(disconnected)} is disconnected. It can't use your account any more.</p>` : ''}
  ${connections.length
    ? `<ul class="accounts-list">${appRows}
  </ul>
  <p class="accounts-hint">Assistants and other apps you allowed to run timing as you. Disconnecting one stops it at once.</p>`
    : '<p>No apps are connected to your account.</p>'}
</section>
<hr class="divider">`;

  return layout({
    title: 'Your account',
    lede: `Signed in as <strong>${escapeHtml(user.name)}</strong>, with TinyLap since ${escapeHtml(day(user.createdAt))}.`,
    script: 'account.js',
    data: { page: 'account', name: user.name, user: user.id },
    wide: true,
    body: `<p class="accounts-back"><a href="/clubs">Your clubs</a></p>
${NOSCRIPT}
<section class="stack-md" aria-labelledby="passkeys-heading">
  <h2 class="h3" id="passkeys-heading">Passkeys <span class="accounts-count">${passkeys.length}</span></h2>
  <ul class="accounts-list" id="passkeys">${passkeyRows}
  </ul>
  ${only ? '<p class="accounts-hint" id="only-passkey">Your only passkey cannot be removed. Add another one first.</p>' : ''}
  <p class="status" id="passkeys-status" role="status" hidden></p>
  <form class="card-static stack-md accounts-add" id="add-passkey" novalidate>
    <h3 class="accounts-subhead">${only ? 'Add a second passkey' : 'Add a passkey'}</h3>
    <p>${only ? 'With a passkey on a second device, losing one device does not lock you out.' : 'Each device or password manager you sign in with can hold one.'}</p>
    <div>
      <label for="passkey-name">Name it</label>
      <input type="text" id="passkey-name" maxlength="40" placeholder="Work laptop" aria-describedby="passkey-name-hint">
      <p class="accounts-hint" id="passkey-name-hint">Only you see this name. You can leave it empty.</p>
    </div>
    <button type="submit" class="btn btn-primary">Add a passkey</button>
    <p class="status" id="add-status" role="status" hidden></p>
  </form>
</section>
<hr class="divider">
<section class="stack-md" aria-labelledby="codes-heading">
  <h2 class="h3" id="codes-heading">Recovery codes</h2>
  ${codesNote}
  <p>A new set replaces the old one: the codes you saved before stop working.</p>
  <button type="button" class="btn btn-secondary" id="new-codes">Make new recovery codes</button>
  <p class="status" id="new-codes-status" role="status" hidden></p>
  <div class="code-reveal accounts-reveal" id="codes-reveal" hidden tabindex="-1">
    <p class="accounts-reveal-note">Save these now. They are shown only once.</p>
    <ol class="accounts-codes" id="code-list"></ol>
    <div class="accounts-actions">
      <button type="button" class="btn btn-sm btn-secondary" id="copy">Copy</button>
      <button type="button" class="btn btn-sm btn-outline accounts-on-dark" id="download">Download .txt</button>
      <button type="button" class="btn btn-sm btn-outline accounts-on-dark" id="codes-done">I've saved them</button>
    </div>
    <p class="status" id="codes-status" role="status" hidden></p>
  </div>
</section>
<hr class="divider">${apps}
<section class="stack-md" aria-labelledby="sessions-heading">
  <h2 class="h3" id="sessions-heading">Signed-in devices</h2>
  <p>Signs you out of TinyLap on every device and in every app, this one included. Use it if you lost a device or signed in on a computer that is not yours.</p>
  <button type="button" class="btn btn-outline" id="sign-out-everywhere">Sign out everywhere</button>
  <p class="status" id="sessions-status" role="status" hidden></p>
</section>
<hr class="divider">
<section class="stack-md" aria-labelledby="data-heading">
  <h2 class="h3" id="data-heading">Your data</h2>
  <ul class="accounts-list">
    <li class="accounts-row">
      <span class="accounts-row-main">Account<span class="accounts-row-sub">Your name, passkeys (no keys), clubs and invites, as JSON.</span></span>
      <span class="accounts-row-actions"><a class="btn btn-sm btn-outline" href="/api/me/export" download>Download</a></span>
    </li>${plannerExport ? `
    <li class="accounts-row">
      <span class="accounts-row-main">Tracks<span class="accounts-row-sub">Every track and version in your personal space and your clubs, from the planner, as JSON.</span></span>
      <span class="accounts-row-actions"><a class="btn btn-sm btn-outline" href="${escapeHtml(plannerExport)}">Download</a></span>
    </li>` : ''}
  </ul>
  <p class="accounts-hint">What TinyLap keeps and why: <a href="/privacy">Privacy</a>.</p>
</section>
<hr class="divider-danger">
<div class="danger-zone stack-md">
  <h2 class="h3">Delete your account</h2>
  ${owned.length
    ? `<p>You own ${quoteList(owned)}. Transfer ownership or delete ${owned.length === 1 ? 'that club' : 'those clubs'} first, on <a href="/clubs">your clubs</a>.</p>`
    : '<p>Deletes your name, passkeys, recovery codes and your personal space with its tracks, and signs you out everywhere. Clubs you are in keep the tracks you saved to them. This cannot be undone.</p>'}
  <button type="button" class="btn btn-danger btn-block" id="delete-account"${owned.length ? ' disabled' : ''}>Delete account</button>
  <p class="status" id="danger-status" role="status" hidden></p>
</div>
<dialog class="card-static accounts-dialog" id="confirm" aria-labelledby="confirm-text">
  <form method="dialog" class="stack-md">
    <p id="confirm-text"></p>
    <div class="accounts-actions">
      <button type="submit" value="cancel" class="btn btn-outline" id="confirm-cancel">Cancel</button>
      <button type="submit" value="ok" class="btn btn-danger" id="confirm-ok">Confirm</button>
    </div>
  </form>
</dialog>
<dialog class="card-static accounts-dialog" id="delete-dialog" aria-labelledby="delete-text">
  <form method="dialog" class="stack-md" novalidate>
    <p id="delete-text">Delete your account for good? Type your display name, <strong>${escapeHtml(user.name)}</strong>, to confirm.</p>
    <div>
      <label for="delete-name">Display name</label>
      <input type="text" id="delete-name" autocomplete="off" spellcheck="false">
    </div>
    <div class="accounts-actions">
      <button type="submit" value="cancel" class="btn btn-outline" id="delete-cancel">Cancel</button>
      <button type="submit" value="ok" class="btn btn-danger" id="delete-ok" disabled>Delete account</button>
    </div>
  </form>
</dialog>
<dialog class="card-static accounts-dialog accounts-dialog-calm" id="reauth" aria-labelledby="reauth-text">
  <form method="dialog" class="stack-md">
    <p id="reauth-text">Confirm it is you with your passkey. TinyLap asks again when you signed in more than 10 minutes ago, so an old session on a lost device cannot change your account.</p>
    <div class="accounts-actions">
      <button type="submit" value="cancel" class="btn btn-outline" id="reauth-cancel">Cancel</button>
      <button type="submit" value="ok" class="btn btn-primary" id="reauth-ok">Use my passkey</button>
    </div>
  </form>
</dialog>`,
  });
}
