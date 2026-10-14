// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Recovery codes (spec §4, §6). A user has one set of ten; each is shown
// once as `<lookup_id>.<secret>`. The lookup id (6 random bytes) finds the
// row; only the SHA-256 of the secret (16 random bytes) is stored and it is
// compared in constant time. Spending is one UPDATE … WHERE used_at IS NULL,
// so a code is spent at most once however many requests race for it.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SET_SIZE = 10;
const LOOKUP = /^[A-Za-z0-9_-]{8}$/;
const SECRET = /^[A-Za-z0-9_-]{22,64}$/;

const sha256 = (text) => createHash('sha256').update(text).digest();

/**
 * Replaces the user's codes with a fresh set and returns it. The old set
 * stops working at once. Runs in a savepoint, so it also nests inside an
 * open transaction.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} userId
 * @returns {string[]}
 */
export function createRecoveryCodes(db, userId) {
  const codes = [];
  db.exec('SAVEPOINT recovery_codes');
  try {
    db.prepare('DELETE FROM recovery_code WHERE user_id = ?').run(userId);
    const insert = db.prepare('INSERT INTO recovery_code (user_id, lookup_id, secret_hash) VALUES (?, ?, ?)');
    for (let i = 0; i < SET_SIZE; i += 1) {
      const lookup = randomBytes(6).toString('base64url');
      const secret = randomBytes(16).toString('base64url');
      insert.run(userId, lookup, sha256(secret).toString('hex'));
      codes.push(`${lookup}.${secret}`);
    }
    db.exec('RELEASE recovery_codes');
  } catch (error) {
    db.exec('ROLLBACK TO recovery_codes');
    db.exec('RELEASE recovery_codes');
    throw error;
  }
  return codes;
}

/**
 * The lookup id of a code, or null if it isn't shaped like one. Rate limits
 * key on it before the code is checked.
 * @param {unknown} code
 */
export function lookupIdOf(code) {
  if (typeof code !== 'string') return null;
  const parts = code.trim().split('.');
  return parts.length === 2 && LOOKUP.test(parts[0]) && SECRET.test(parts[1]) ? parts[0] : null;
}

/**
 * Spends a code: the user id it belonged to, or null if it is unknown,
 * wrong, already spent, or malformed.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {unknown} code
 * @returns {string | null}
 */
export function spendRecoveryCode(db, code) {
  const lookup = lookupIdOf(code);
  if (!lookup) return null;
  const secret = /** @type {string} */ (code).trim().split('.')[1];
  const row = db.prepare('SELECT user_id, secret_hash FROM recovery_code WHERE lookup_id = ? AND used_at IS NULL').get(lookup);
  if (!row) return null;
  const stored = Buffer.from(String(row.secret_hash), 'hex');
  const given = sha256(secret);
  if (stored.length !== given.length || !timingSafeEqual(stored, given)) return null;
  const { changes } = db.prepare('UPDATE recovery_code SET used_at = ? WHERE lookup_id = ? AND used_at IS NULL')
    .run(new Date().toISOString(), lookup);
  return changes === 1 ? String(row.user_id) : null;
}
