// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A "Sign out" form: ends this browser's accounts session, then reloads.
import { api, onSubmit } from './webauthn.js';

const form = /** @type {HTMLFormElement} */ (document.getElementById('sign-out'));
const status = /** @type {HTMLElement} */ (document.getElementById('status'));

onSubmit(form, status, async () => {
  await api('/sign-out', { method: 'POST', body: {} });
  location.reload();
});
