// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Robitronic reader (decoders spec §2.5): frames as session events. Only
// a frame whose checksum is right counts: it says the device speaks the
// protocol ("alive"). A bad one is noted, counted and logged once, never used.
import { createFrameReader } from '@tinylap/timing';

/** @import { DecoderEvent } from '@tinylap/timing/types' */

/** @param {Uint8Array} bytes */
const hex = (bytes) => [...bytes].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

export function robitronicProtocol() {
  const reader = createFrameReader();
  let warned = false;
  return {
    kind: /** @type {const} */ ('robitronic'),
    baudRate: 38400,
    get mismatches() {
      return reader.mismatches;
    },
    /** @param {Uint8Array} bytes @returns {DecoderEvent[]} */
    push(bytes) {
      /** @type {DecoderEvent[]} */
      const out = [];
      for (const item of reader.push(bytes)) {
        if (item.type === 'noise') {
          if (!warned) {
            warned = true;
            console.warn(`An EasyLap frame failed its checksum, so it was skipped: ${hex(item.bytes)}. Please report this device.`);
          }
          out.push({ type: 'noise', detail: 'checksum' });
        } else if (item.type === 'heartbeat') {
          out.push({ type: 'alive' }, { type: 'clock', t: item.t });
        } else {
          out.push({ type: 'alive' }, { type: 'passing', transponder: item.transponder, t: item.t, hits: item.hits, strength: item.strength });
        }
      }
      return out;
    },
  };
}
