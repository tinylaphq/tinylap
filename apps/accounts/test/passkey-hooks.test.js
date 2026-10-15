// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The checks TinyLap adds to @better-auth/passkey's ceremonies, called
// directly: the plugin itself verifies with requireUserVerification: false,
// so these hooks are the only thing enforcing user verification, and the
// only thing keeping account creation inside the plugin's transaction.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { authOptions } from '../server/auth.js';
import { startAccounts } from './helpers.js';

/** @type {Awaited<ReturnType<typeof startAccounts>>} */
let accounts;
/** @type {any} */
let passkeyOptions;
before(async () => {
  accounts = await startAccounts();
  passkeyOptions = /** @type {any} */ (authOptions(accounts.config, accounts.db).plugins.find((p) => p.id === 'passkey')).options;
});
after(() => accounts.close());

const userCount = () => Number(accounts.db.prepare('SELECT COUNT(*) AS n FROM "user"').get().n);

/** A sign-up's verify-registration, as the plugin calls the hook. */
async function registration({ userVerified = true, createSession = true } = {}) {
  const ctx = { body: { createSession }, context: (await accounts.auth.$context) };
  return passkeyOptions.registration.afterVerification({
    ctx,
    verification: { verified: true, registrationInfo: { userVerified } },
    user: { id: 'f'.repeat(32), name: 'Hook', displayName: 'Hook' },
    clientData: {},
    context: 'Hook',
  });
}

test('the passkey plugin is configured with TinyLap hooks', () => {
  assert.equal(typeof passkeyOptions.registration.afterVerification, 'function');
  assert.equal(typeof passkeyOptions.authentication.afterVerification, 'function');
  assert.equal(passkeyOptions.registration.requireSession, false);
});

test('registration without user verification is refused, and creates nobody', async () => {
  const before = userCount();
  await assert.rejects(registration({ userVerified: false }), (/** @type {any} */ error) => error.statusCode === 400 && /did not verify you/.test(error.message));
  assert.equal(userCount(), before);
});

test('authentication without user verification is refused', async () => {
  const hook = passkeyOptions.authentication.afterVerification;
  await assert.rejects(hook({ ctx: {}, verification: { verified: true, authenticationInfo: { userVerified: false } }, clientData: {} }),
    (/** @type {any} */ error) => error.statusCode === 401 && /did not verify you/.test(error.message));
  await hook({ ctx: {}, verification: { verified: true, authenticationInfo: { userVerified: true } }, clientData: {} });
});

test('a sign-up that does not ask for a session is refused, so it never runs outside the transaction', async () => {
  const before = userCount();
  await assert.rejects(registration({ createSession: false }), (/** @type {any} */ error) => error.statusCode === 400 && /createSession/.test(error.message));
  assert.equal(userCount(), before);
});

test('a verified sign-up with a session creates the user and the personal workspace', async () => {
  await registration();
  const user = accounts.db.prepare('SELECT id, name, email FROM "user" WHERE id = ?').get('f'.repeat(32));
  assert.equal(user.name, 'Hook');
  assert.equal(user.email, `${'f'.repeat(32)}@users.invalid`);
  const ws = accounts.db.prepare("SELECT w.kind FROM workspace w JOIN membership m ON m.workspace_id = w.id WHERE m.user_id = ? AND m.role = 'owner'").all(user.id);
  assert.deepEqual(ws.map((w) => w.kind), ['personal']);
});
