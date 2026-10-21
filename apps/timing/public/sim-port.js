// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A SerialPort look-alike with a simulated TinyLap decoder at the other end,
// for trying the bridge without hardware (?simulate, ?simulate=fast), and for
// the browser tests that build one themselves. It is the TinyLap model on the
// fake serial port (decoders spec §5).
import { tinylapModel } from './sim/models/tinylap.js';
import { fakeSerialPort } from './sim/serial-port.js';

/** @param {{ lapMs?: number, cars?: number }} [options] */
export function simulatedPort({ lapMs = 8000, cars = 3 } = {}) {
  return fakeSerialPort(tinylapModel({ lapMs, cars }));
}
