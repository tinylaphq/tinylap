// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// Seals small secrets (tokens, pending-login state) with AES-256-GCM under a
// list of keys with ids. The first key seals; any listed key opens, so a new
// key goes first and the old one stays until nothing sealed with it is left.
// An optional purpose label is authenticated with the key id, so a value
// sealed for one use (a login cookie) never opens as another (stored tokens).
import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** @typedef {{ id: string, key: Buffer }} SealKey */

const ID = /^[A-Za-z0-9_-]+$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const TAG_BYTES = 16;

/**
 * Parses `TINYLAP_TOKEN_KEYS`: `<id>:<base64 32 bytes>,<id>:<…>`, newest first.
 * @param {string | undefined} text
 * @returns {SealKey[]}
 */
export function parseKeys(text) {
  const entries = (text ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) throw new Error('TINYLAP_TOKEN_KEYS needs at least one key, as "<id>:<base64 32 bytes>".');
  /** @type {SealKey[]} */
  const keys = [];
  for (const entry of entries) {
    const i = entry.indexOf(':');
    if (i < 0) throw new Error('TINYLAP_TOKEN_KEYS entries look like "<id>:<base64 32 bytes>".');
    const id = entry.slice(0, i);
    const b64 = entry.slice(i + 1);
    if (!ID.test(id)) throw new Error(`TINYLAP_TOKEN_KEYS: a key id may only use letters, digits, "-" and "_"; got "${id}".`);
    if (keys.some((k) => k.id === id)) throw new Error(`TINYLAP_TOKEN_KEYS: key id "${id}" appears twice.`);
    const key = Buffer.from(b64, 'base64');
    if (!BASE64.test(b64) || key.length !== 32) throw new Error(`TINYLAP_TOKEN_KEYS: key "${id}" must be 32 bytes in base64.`);
    keys.push({ id, key });
  }
  return keys;
}

/** @param {string} kid @param {string} purpose */
const aad = (kid, purpose) => Buffer.from(purpose ? `${kid}:${purpose}` : kid);

/**
 * @param {SealKey[]} keys the first one seals
 * @param {string} plaintext
 * @param {string} [purpose] must be given again to open it
 * @returns {string} `<kid>.<iv>.<ciphertext+tag>`, base64url
 */
export function seal(keys, plaintext, purpose = '') {
  const [first] = keys;
  if (!first) throw new Error('seal needs at least one key.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', first.key, iv);
  cipher.setAAD(aad(first.id, purpose));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `${first.id}.${iv.toString('base64url')}.${body.toString('base64url')}`;
}

/**
 * @param {SealKey[]} keys any of them may open it, chosen by id
 * @param {string} sealed
 * @param {string} [purpose] the one it was sealed with
 * @returns {string}
 */
export function open(keys, sealed, purpose = '') {
  const parts = sealed.split('.');
  if (parts.length !== 3) throw new Error('Not a sealed value.');
  const [kid, ivText, bodyText] = parts;
  const entry = keys.find((k) => k.id === kid);
  if (!entry) throw new Error(`Sealed with an unknown key "${kid}".`);
  const iv = Buffer.from(ivText, 'base64url');
  const body = Buffer.from(bodyText, 'base64url');
  if (iv.length !== 12 || body.length < TAG_BYTES) throw new Error('Not a sealed value.');
  const decipher = createDecipheriv('aes-256-gcm', entry.key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad(kid, purpose));
  decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
  return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]).toString('utf8');
}
