// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { open, parseKeys, seal } from '../crypto.js';

const k1 = { id: 'k1', key: randomBytes(32) };
const k2 = { id: 'k2', key: randomBytes(32) };

test('seal and open round-trip, as <kid>.<iv>.<ciphertext+tag> in base64url', () => {
  const sealed = seal([k1], 'refresh-token ✓');
  const parts = sealed.split('.');
  assert.equal(parts.length, 3);
  assert.equal(parts[0], 'k1');
  assert.match(parts[1], /^[A-Za-z0-9_-]+$/);
  assert.equal(Buffer.from(parts[1], 'base64url').length, 12);
  assert.match(parts[2], /^[A-Za-z0-9_-]+$/);
  assert.equal(open([k1], sealed), 'refresh-token ✓');
  assert.notEqual(seal([k1], 'x'), seal([k1], 'x'), 'a fresh IV each time');
});

test('after rotation the new key seals and the old key still opens old ciphertexts', () => {
  const old = seal([k1], 'old');
  const rotated = [k2, k1];
  assert.equal(open(rotated, old), 'old');
  const fresh = seal(rotated, 'new');
  assert.ok(fresh.startsWith('k2.'));
  assert.equal(open(rotated, fresh), 'new');
});

test('a tampered ciphertext, IV or kid throws', () => {
  const sealed = seal([k1], 'secret');
  const [kid, iv, ct] = sealed.split('.');
  const flip = (/** @type {string} */ b64) => {
    const buf = Buffer.from(b64, 'base64url');
    buf[0] ^= 1;
    return buf.toString('base64url');
  };
  assert.throws(() => open([k1], `${kid}.${iv}.${flip(ct)}`));
  assert.throws(() => open([k1], `${kid}.${flip(iv)}.${ct}`));
  assert.throws(() => open([k1, { id: 'k9', key: k2.key }], `k9.${iv}.${ct}`));
  assert.throws(() => open([k1], 'garbage'));
  assert.throws(() => open([k1], `${kid}.${iv}.`));
});

test('an unknown kid throws', () => {
  const sealed = seal([k1], 'secret');
  assert.throws(() => open([k2], sealed), /unknown key/i);
});

test('parseKeys reads "<id>:<base64 32 bytes>,…" and refuses anything else', () => {
  const text = `k2:${k2.key.toString('base64')}, k1:${k1.key.toString('base64')}`;
  const keys = parseKeys(text);
  assert.deepEqual(keys.map((k) => k.id), ['k2', 'k1']);
  assert.ok(keys[0].key.equals(k2.key));
  assert.ok(keys[1].key.equals(k1.key));
  assert.throws(() => parseKeys(''), /TINYLAP_TOKEN_KEYS/);
  assert.throws(() => parseKeys(undefined), /TINYLAP_TOKEN_KEYS/);
  assert.throws(() => parseKeys(`k1:${randomBytes(16).toString('base64')}`), /32 bytes/);
  assert.throws(() => parseKeys(`k1${k1.key.toString('base64')}`), /<id>:<base64/);
  assert.throws(() => parseKeys(`k1:${k1.key.toString('base64')},k1:${k2.key.toString('base64')}`), /twice/);
  assert.throws(() => parseKeys(`k.1:${k1.key.toString('base64')}`), /id/);
});

test('a purpose label binds a sealed value to its use', () => {
  const sealed = seal([k1], 'state', 'login');
  assert.equal(open([k1], sealed, 'login'), 'state');
  assert.throws(() => open([k1], sealed, 'tokens'));
  assert.throws(() => open([k1], sealed));
  assert.throws(() => open([k1], seal([k1], 'x'), 'login'));
});

test('seal needs at least one key', () => {
  assert.throws(() => seal([], 'x'), /key/);
});
