// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The ZRound reader (decoders spec §2.3): text messages, TinyLap's %TL…
// included, as session events. A clock, a lap or an ack says the device
// speaks ZRound ("alive"); %TLID says it is a TinyLap decoder ("identity").
import { ZROUND_BAUD, createReader } from '@tinylap/timing';

/** @import { DecoderEvent, ZroundMessage } from '@tinylap/timing/types' */

/** @param {ZroundMessage} m @returns {DecoderEvent[]} */
function eventsOf(m) {
  switch (m.type) {
    case 'ack': return [{ type: 'alive' }];
    case 'clock': return [{ type: 'alive' }, { type: 'clock', t: m.t }];
    case 'lap': return [{ type: 'alive' }, { type: 'passing', transponder: m.transponder, t: m.t }];
    case 'hello': return [{ type: 'identity', decoder: m.decoder, boot: m.boot }];
    case 'reset': return [{ type: 'reset' }];
    case 'ok': return [{ type: 'ok' }];
    case 'error': return [{ type: 'error', text: m.text }];
    case 'unknown': return [{ type: 'noise', detail: m.raw }];
    default: return [];
  }
}

export function zroundProtocol() {
  const lines = createReader();
  const text = new TextDecoder();
  return {
    kind: /** @type {const} */ ('zround'),
    baudRate: ZROUND_BAUD,
    /** @param {Uint8Array} bytes */
    push: (bytes) => lines.push(text.decode(bytes, { stream: true })).flatMap(eventsOf),
  };
}
