// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// The ZRound Free LapCounter protocol (zround.com wiki, CC BY-SA), which
// TinyLap decoders speak over USB so existing software works with them, plus
// TinyLap's own %TL… commands (spec §5), which ZRound never sends.
// Every message is "%" + code + data + "&". Times are hex milliseconds.

import { BOOT_ID, DECODER_ID, base64url } from './passing.js';

/** @import { ZroundMessage } from './types.js' */

export const ZROUND_BAUD = 19200;
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const TRANSPONDER_HEX = /^[0-9A-Fa-f]{1,16}$/;
const TIME_HEX = /^[0-9A-Fa-f]{1,13}$/;
const MAX_PENDING = 1024;

/** @param {string} text */
const encode = (text) => base64url(new TextEncoder().encode(text));
/** @param {string} value @returns {string | null} */
function decode(value) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** One message. @param {string} body the text between "%" and "&" @returns {ZroundMessage} */
export function parseMessage(body) {
  const unknown = /** @type {const} */ ({ type: 'unknown', raw: body });
  if (body === 'C') return { type: 'startup' };
  if (body === 'A') return { type: 'ack' };
  if (body === 'I') return { type: 'reset' };
  if (body === 'F') return { type: 'stop' };
  if (body.startsWith('TL')) {
    const [word, ...fields] = body.split(' ');
    if (word === 'TLHELLO' && fields.length === 0) return { type: 'hello-request' };
    if (word === 'TLOK' && fields.length === 0) return { type: 'ok' };
    if (word === 'TLERR') return { type: 'error', text: fields.join(' ') };
    if (word === 'TLID' && fields.length === 2) {
      const [decoder, boot] = fields;
      if (BOOT_ID.test(boot) && (decoder === '-' || DECODER_ID.test(decoder))) return { type: 'hello', decoder: decoder === '-' ? null : decoder, boot };
    }
    if (word === 'TLPAIR' && fields.length === 2 && DECODER_ID.test(fields[0]) && TOKEN.test(fields[1])) return { type: 'pair', decoder: fields[0], token: fields[1] };
    if (word === 'TLWIFI' && fields.length === 2) {
      const ssid = decode(fields[0]);
      const password = decode(fields[1]);
      if (ssid !== null && password !== null) return { type: 'wifi', ssid, password };
    }
    return unknown;
  }
  if (body[0] === 'T' && TIME_HEX.test(body.slice(1))) {
    const t = parseInt(body.slice(1), 16);
    if (Number.isSafeInteger(t)) return { type: 'clock', t };
  }
  if (body[0] === 'L') {
    const rest = body.slice(1);
    const [transponder, time] = rest.includes(',') ? rest.split(',', 2) : [rest.slice(0, 2), rest.slice(2)];
    if (TRANSPONDER_HEX.test(transponder) && TIME_HEX.test(time)) {
      const t = parseInt(time, 16);
      if (Number.isSafeInteger(t)) return { type: 'lap', transponder: transponder.toUpperCase(), t };
    }
  }
  return unknown;
}

/** Splits a serial text stream into messages. Text outside "%…&" is dropped. */
export function createReader() {
  let pending = '';
  return {
    /** @param {string} chunk @returns {ZroundMessage[]} */
    push(chunk) {
      pending += chunk;
      /** @type {ZroundMessage[]} */
      const out = [];
      for (;;) {
        const start = pending.indexOf('%');
        if (start === -1) {
          pending = '';
          break;
        }
        const end = pending.indexOf('&', start);
        if (end === -1) {
          pending = pending.slice(start);
          break;
        }
        out.push(parseMessage(pending.slice(start + 1, end)));
        pending = pending.slice(end + 1);
      }
      if (pending.length > MAX_PENDING) pending = '';
      return out;
    },
  };
}

/** @param {number} n */
const hex = (n) => n.toString(16).toUpperCase();

/** Framed lines, ready to write. */
export const commands = Object.freeze({
  startup: '%C&',
  ack: '%A&',
  hello: '%TLHELLO&',
  ok: '%TLOK&',
  /** @param {string} decoder @param {string} token */
  pair: (decoder, token) => `%TLPAIR ${decoder} ${token}&`,
  /** @param {string} ssid @param {string} password */
  wifi: (ssid, password) => `%TLWIFI ${encode(ssid)} ${encode(password)}&`,
  /** @param {string | null} decoder @param {string} boot */
  id: (decoder, boot) => `%TLID ${decoder ?? '-'} ${boot}&`,
  /** @param {string} text */
  error: (text) => `%TLERR ${text.replace(/[%&]/g, '')}&`,
  /** @param {string} transponder @param {number} t */
  lap: (transponder, t) => `%L${transponder},${hex(t)}&`,
  /** @param {number} t */
  clock: (t) => `%T${hex(t)}&`,
});
