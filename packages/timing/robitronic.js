// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// The Robitronic binary protocol an EasyLap speaks (decoders spec §2.5):
// frames of [length, checksum, type, payload…], numbers little-endian, no
// delimiter. Points the research marks low-confidence (the CRC, the id width,
// the heartbeat interval, clock start and rollover) need a real-device
// capture; the code below is written so each is one constant or unused.

/** @import { RobitronicItem, RobitronicMessage } from './types.js' */

/** Frame type → its length. Only these pairs start a frame. */
const KNOWN = new Map([[0x83, 0x0b], [0x84, 0x0d]]);
/** How many bytes of a passing are the transponder id: 4 (lappr, RicinoNext), or 2 (FlipSide). Needs a real-device capture. */
export const ID_BYTES = 4;

/** CRC-8, poly 0x07, init 0xDE, not reflected, no final XOR, over the frame with byte 1 read as 0 (derived; needs a capture). @param {Uint8Array} bytes */
export function crc8(bytes) {
  let crc = 0xde;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= i === 1 ? 0 : bytes[i];
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

/** A little-endian u32. The fourth byte shifts by 24: the public parsers' `<< 32` is a no-op in JavaScript. @param {Uint8Array} b @param {number} at */
const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

/** One frame; null for a length and type it doesn't know. @param {Uint8Array} bytes @returns {RobitronicMessage | null} */
export function parseFrame(bytes) {
  const [len, ck, type] = bytes;
  if (KNOWN.get(type) !== len || bytes.length < len) return null;
  const checksumOk = crc8(bytes.subarray(0, len)) === ck;
  if (type === 0x83) return { type: 'heartbeat', t: u32(bytes, 3), tail: [...bytes.subarray(7, 11)], checksumOk };
  const id = ID_BYTES === 4 ? u32(bytes, 3) : bytes[3] | (bytes[4] << 8);
  return { type: 'passing', id, transponder: id.toString(16).toUpperCase(), t: u32(bytes, 7), hits: bytes[11], strength: bytes[12], checksumOk };
}

/**
 * Splits a byte stream into frames. A frame starts only at a known (length,
 * type) pair; anything else drops one byte. A frame whose checksum fails is
 * never yielded: the reader notes it, counts it, and resyncs one byte on.
 * The scan never keeps more than one incomplete frame (at most 12 bytes), so
 * the buffer stays far below the spec's 256-byte cap.
 */
export function createFrameReader() {
  let buffer = new Uint8Array(0);
  let mismatches = 0;
  return {
    get mismatches() {
      return mismatches;
    },
    /** @param {Uint8Array} chunk @returns {RobitronicItem[]} */
    push(chunk) {
      const all = new Uint8Array(buffer.length + chunk.length);
      all.set(buffer);
      all.set(chunk, buffer.length);
      /** @type {RobitronicItem[]} */
      const out = [];
      let i = 0;
      while (all.length - i >= 3) {
        const len = KNOWN.get(all[i + 2]);
        if (len === undefined || all[i] !== len) {
          i += 1;
          continue;
        }
        if (all.length - i < len) break;
        const frame = all.slice(i, i + len);
        const message = /** @type {RobitronicMessage} */ (parseFrame(frame));
        if (message.checksumOk) {
          out.push(message);
          i += len;
        } else {
          mismatches += 1;
          out.push({ type: 'noise', detail: 'checksum', bytes: frame });
          i += 1;
        }
      }
      buffer = all.slice(i);
      return out;
    },
  };
}

/** @param {number} n */
const le32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
/** Fills in the checksum byte. @param {Uint8Array} bytes */
const seal = (bytes) => {
  bytes[1] = crc8(bytes);
  return bytes;
};

/** Frames, ready to send: the two host commands, and encoders for the simulator. */
export const frames = Object.freeze({
  start: Uint8Array.of(0x03, 0xb9, 0x01),
  reset: Uint8Array.of(0x03, 0xb0, 0x02),
  /** @param {number} t @param {number[]} [tail] */
  heartbeat: (t, tail = [0x14, 0xd0, 0x01, 0x02]) => seal(Uint8Array.of(0x0b, 0, 0x83, ...le32(t), ...tail)),
  /** @param {number} id @param {number} t @param {number} hits @param {number} strength */
  passing: (id, t, hits, strength) => seal(Uint8Array.of(0x0d, 0, 0x84, ...le32(id), ...le32(t), hits, strength)),
});
