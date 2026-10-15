// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Recovery codes (spec §4, §6): ten per set, shown once as
// <lookup_id>.<secret>, stored as SHA-256 only, spent exactly once.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryCodes, spendRecoveryCode } from '../server/recovery.js';
import { createTestUser, startAccounts } from './helpers.js';

/** @type {Awaited<ReturnType<typeof startAccounts>>} */
let accounts;
before(async () => {
  accounts = await startAccounts();
});
after(() => accounts.close());

const CODE = /^[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{22,}$/;

test('a set has ten distinct codes in the lookup.secret form', async () => {
  const user = await createTestUser(accounts.auth, 'Ayrton');
  const codes = createRecoveryCodes(accounts.db, user.id);
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) assert.match(code, CODE);
  assert.equal(new Set(codes.map((c) => c.split('.')[0])).size, 10, 'distinct lookup ids');
});

test('a code spends exactly once', async () => {
  const user = await createTestUser(accounts.auth, 'Alain');
  const [code] = createRecoveryCodes(accounts.db, user.id);
  assert.equal(spendRecoveryCode(accounts.db, code), user.id);
  assert.equal(spendRecoveryCode(accounts.db, code), null);
});

test('two concurrent spends of one code give one user id and one null', async () => {
  const user = await createTestUser(accounts.auth, 'Nigel');
  const [code] = createRecoveryCodes(accounts.db, user.id);
  const results = await Promise.all([
    Promise.resolve().then(() => spendRecoveryCode(accounts.db, code)),
    Promise.resolve().then(() => spendRecoveryCode(accounts.db, code)),
  ]);
  assert.deepEqual(results.toSorted(), [null, user.id].toSorted());
});

test('a wrong secret for a valid lookup id gives null, and leaves the code usable', async () => {
  const user = await createTestUser(accounts.auth, 'Michael');
  const [code] = createRecoveryCodes(accounts.db, user.id);
  const [lookup, secret] = code.split('.');
  const wrong = `${lookup}.${secret.slice(0, -1)}${secret.endsWith('A') ? 'B' : 'A'}`;
  assert.equal(spendRecoveryCode(accounts.db, wrong), null);
  assert.equal(spendRecoveryCode(accounts.db, `${lookup}.short`), null);
  assert.equal(spendRecoveryCode(accounts.db, code), user.id);
});

test('malformed input gives null', () => {
  for (const input of ['', 'nodot', '.', 'a.b.c', null, undefined, 42]) {
    assert.equal(spendRecoveryCode(accounts.db, /** @type {any} */ (input)), null);
  }
});

test('a new set invalidates the old one', async () => {
  const user = await createTestUser(accounts.auth, 'Mika');
  const old = createRecoveryCodes(accounts.db, user.id);
  const fresh = createRecoveryCodes(accounts.db, user.id);
  for (const code of old) assert.equal(spendRecoveryCode(accounts.db, code), null);
  assert.equal(spendRecoveryCode(accounts.db, fresh[0]), user.id);
  const rows = accounts.db.prepare('SELECT COUNT(*) AS n FROM recovery_code WHERE user_id = ?').get(user.id);
  assert.equal(rows.n, 10, 'only the current set is kept');
});

test('a set belongs to its user only', async () => {
  const a = await createTestUser(accounts.auth, 'Jim');
  const b = await createTestUser(accounts.auth, 'Jackie');
  createRecoveryCodes(accounts.db, a.id);
  const bCodes = createRecoveryCodes(accounts.db, b.id);
  createRecoveryCodes(accounts.db, a.id);
  assert.equal(spendRecoveryCode(accounts.db, bCodes[1]), b.id, "a's new set left b's alone");
});

test('only SHA-256 hashes are stored, never the secret', async () => {
  const user = await createTestUser(accounts.auth, 'Graham');
  const codes = createRecoveryCodes(accounts.db, user.id);
  const dump = JSON.stringify(accounts.db.prepare('SELECT * FROM recovery_code').all());
  for (const code of codes) {
    const [lookup, secret] = code.split('.');
    assert.ok(dump.includes(lookup), 'the lookup id is stored');
    assert.ok(!dump.includes(secret), 'the secret is not');
  }
  for (const row of accounts.db.prepare('SELECT secret_hash FROM recovery_code WHERE user_id = ?').all(user.id)) {
    assert.match(String(row.secret_hash), /^[0-9a-f]{64}$/);
  }
});
