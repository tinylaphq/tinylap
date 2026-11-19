// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// What a confirm dialog asks cannot be taken back, so its button is palace's filled danger button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { accountPage } from '../server/pages/account.js';
import { clubPage } from '../server/pages/club.js';

const user = { id: 'u1', name: 'Ana', createdAt: '2026-01-01T00:00:00Z' };

test('the account page confirms with the filled danger button', () => {
  const html = accountPage({ user, passkeys: [], codesLeft: 10, owned: [], plannerExport: '/export' });
  assert.match(html, /class="btn btn-danger-fill" id="confirm-ok"/);
  assert.match(html, /class="btn btn-danger-fill" id="delete-ok"/);
});

test('the club page confirms with the filled danger button', () => {
  const workspace = /** @type {const} */ ({ id: 'w1', name: 'Club', role: 'owner' });
  const html = clubPage({ user, claims: { workspaces: [{ id: 'w1', role: /** @type {const} */ ('owner') }] }, workspace, members: [{ ...user, role: /** @type {const} */ ('owner') }], invites: [] });
  assert.match(html, /class="btn btn-danger-fill" id="confirm-ok"/);
});
