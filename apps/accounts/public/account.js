// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// /account: add and remove passkeys, make new recovery codes, sign out
// everywhere, delete the account. Destructive actions ask first. When the
// server answers "reauthenticate" (the session is older than 10 minutes),
// the page asks for the passkey once, which signs in afresh, and then
// retries the action.
import { api, isReauthenticate, PageError, registerPasskey, show, signInWithPasskey } from './webauthn.js';

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const { name: displayName, user: userId } = document.body.dataset;

/**
 * Opens one of the page's dialogs; resolves true if the person confirmed.
 * @param {string} id @param {string} cancelId
 */
function ask(id, cancelId) {
  const dialog = $(id);
  dialog.returnValue = '';
  dialog.showModal();
  $(cancelId).focus();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
  });
}

/** @param {string} text @param {string} action the confirm button's label */
function confirmAction(text, action) {
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = action;
  return ask('confirm', 'confirm-cancel');
}

/**
 * Runs `run`; if the server wants a fresh sign-in, asks for the passkey
 * and runs it once more.
 * @template T @param {() => Promise<T>} run @returns {Promise<T | undefined>}
 */
async function fresh(run) {
  try {
    return await run();
  } catch (error) {
    if (!isReauthenticate(error)) throw error;
  }
  if (!(await ask('reauth', 'reauth-cancel'))) return undefined;
  const result = await signInWithPasskey(null);
  if (result?.user?.id && result.user.id !== userId) {
    // A passkey of another account: that account is now signed in here.
    location.reload();
    return undefined;
  }
  return run();
}

/** Runs a button's action with the button disabled, reporting errors in `status`. */
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

// Passkeys
$('add-passkey').addEventListener('submit', (event) => {
  event.preventDefault();
  const button = event.target.querySelector('button[type=submit]');
  act(button, $('add-status'), async () => {
    show($('add-status'), 'Waiting for your passkey', 'info');
    const name = $('passkey-name').value.trim();
    const done = await fresh(() => registerPasskey({ name: displayName }, { name }));
    if (done === undefined) {
      $('add-status').hidden = true;
      return;
    }
    location.reload();
  });
});

$('passkeys').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="remove"]');
  if (!button) return;
  const row = button.closest('[data-passkey]');
  act(button, $('passkeys-status'), async () => {
    if (!(await confirmAction(`Remove ${row.dataset.label}? That device or password manager can no longer sign you in.`, 'Remove passkey'))) return;
    const done = await fresh(() => api(`/api/me/passkeys/${encodeURIComponent(row.dataset.passkey)}`, { method: 'DELETE' }).then(() => true));
    if (done) location.reload();
  });
});

// Recovery codes, shown once
/** @type {string[]} */
let codes = [];
const asText = () => [
  'TinyLap recovery codes',
  '',
  'Each code works once, if you lose your passkey.',
  'Losing every passkey and every recovery code loses the account.',
  '',
  ...codes,
  '',
].join('\n');

$('new-codes').addEventListener('click', (event) => act(event.currentTarget, $('new-codes-status'), async () => {
  if (!(await confirmAction('Make a new set of recovery codes? The codes you saved before stop working at once.', 'Make new codes'))) return;
  const result = await fresh(() => api('/recovery-codes', { method: 'POST', body: {} }));
  if (!result) return;
  ({ codes } = result);
  $('code-list').replaceChildren(...codes.map((code) => Object.assign(document.createElement('li'), { textContent: code })));
  $('codes-status').hidden = true;
  $('new-codes-status').hidden = true;
  $('codes-reveal').hidden = false;
  $('codes-reveal').focus();
}));

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(asText());
    show($('codes-status'), 'Copied', 'success');
  } catch {
    show($('codes-status'), 'Copying was blocked. Download the file instead.', 'error');
  }
});

$('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([asText()], { type: 'text/plain' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'tinylap-recovery-codes.txt' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('codes-done').addEventListener('click', () => {
  codes = [];
  location.reload();
});

// Sign out everywhere
$('sign-out-everywhere').addEventListener('click', (event) => act(event.currentTarget, $('sessions-status'), async () => {
  if (!(await confirmAction('Sign out of TinyLap on every device and in every app, this one included?', 'Sign out everywhere'))) return;
  await api('/api/me/sign-out-everywhere', { method: 'POST' });
  location.assign('/signed-out');
}));

// Delete the account: type the display name to confirm.
const deleteButton = $('delete-account');
$('delete-name').addEventListener('input', (event) => {
  $('delete-ok').disabled = event.target.value.trim() !== displayName;
});
deleteButton.addEventListener('click', () => act(deleteButton, $('danger-status'), async () => {
  $('delete-name').value = '';
  $('delete-ok').disabled = true;
  if (!(await ask('delete-dialog', 'delete-cancel'))) return;
  if ($('delete-name').value.trim() !== displayName) return;
  const done = await fresh(() => api('/api/me', { method: 'DELETE' }).then(() => true));
  if (done) location.assign('/signed-out?deleted');
}));
