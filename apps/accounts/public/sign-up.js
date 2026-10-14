// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// /sign-up: display name, passkey (which creates the account and signs in),
// then the recovery codes, shown once. Continuing needs "I've saved them".
// If making the codes fails once the account exists, "Try again" asks for
// the codes only, never a second passkey.
import { api, authorizeUrl, nextPath, onSubmit, PageError, registerPasskey, show, stepTo } from './webauthn.js';

const $ = (id) => /** @type {any} */ (document.getElementById(id));

const nameForm = $('name-form');
const codesForm = $('codes');
const status = $('status');
const codesStatus = $('codes-status');
/** @type {string[]} */
let codes = [];

onSubmit(nameForm, status, async () => {
  const displayName = $('display-name').value.trim();
  if (!displayName) {
    $('display-name').focus();
    throw new PageError('Type a display name first.');
  }
  stepTo('passkey');
  show(status, 'Waiting for your passkey', 'info');
  try {
    await registerPasskey({ context: displayName }, { createSession: true });
  } catch (error) {
    stepTo('name');
    throw error;
  }
  await showCodes();
});

/** Makes the account's recovery codes and shows them; offers "Try again" if that fails. */
async function showCodes() {
  try {
    ({ codes } = await api('/recovery-codes', { method: 'POST', body: {} }));
  } catch (error) {
    nameForm.hidden = true;
    $('codes-retry').hidden = false;
    show($('retry-status'), error instanceof PageError ? `${error.message} Your account and passkey are ready; only the codes are missing.` : 'Your account and passkey are ready, but the recovery codes could not be made.', 'error');
    $('retry').focus();
    return;
  }
  $('codes-retry').hidden = true;
  const list = $('code-list');
  list.replaceChildren(...codes.map((code) => Object.assign(document.createElement('li'), { textContent: code })));
  nameForm.hidden = true;
  codesForm.hidden = false;
  stepTo('codes');
  codesForm.querySelector('h2').focus();
}

$('retry').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await showCodes();
  } finally {
    button.disabled = false;
  }
});

const asText = () => [
  'TinyLap recovery codes',
  '',
  'Each code works once, if you lose your passkey.',
  'Losing every passkey and every recovery code loses the account.',
  '',
  ...codes,
  '',
].join('\n');

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(asText());
    show(codesStatus, 'Copied', 'success');
  } catch {
    show(codesStatus, 'Copying was blocked. Download the file instead.', 'error');
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

$('saved').addEventListener('change', (event) => {
  $('continue').disabled = !event.target.checked;
});

codesForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!$('saved').checked) return;
  codes = [];
  $('code-list').replaceChildren();
  const next = authorizeUrl() ?? nextPath();
  if (next) {
    location.assign(next);
    return;
  }
  codesForm.hidden = true;
  $('done').hidden = false;
});
