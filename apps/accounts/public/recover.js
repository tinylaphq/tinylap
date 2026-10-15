// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// /recover: a recovery code signs in with a restricted session; the only
// way on is to add a passkey, which lifts the restriction.
import { api, authorizeUrl, onSubmit, PageError, registerPasskey, show, stepTo } from './webauthn.js';

const $ = (id) => /** @type {any} */ (document.getElementById(id));

const codeForm = $('code-form');
const passkeyForm = $('passkey-form');
let name = document.body.dataset.name ?? '';

function toPasskeyStep() {
  codeForm.hidden = true;
  passkeyForm.hidden = false;
  stepTo('passkey');
}

onSubmit(codeForm, $('status'), async () => {
  const code = $('code').value.trim();
  if (!code) {
    $('code').focus();
    throw new PageError('Type one of your recovery codes first.');
  }
  const result = await api('/recover', { method: 'POST', body: { code } });
  name = result?.user?.name ?? '';
  $('code').value = '';
  toPasskeyStep();
});

onSubmit(passkeyForm, $('passkey-status'), async () => {
  show($('passkey-status'), 'Waiting for your passkey', 'info');
  await registerPasskey(name ? { name } : {});
  const next = authorizeUrl();
  if (next) {
    location.assign(next);
    return;
  }
  passkeyForm.hidden = true;
  $('done').hidden = false;
});
