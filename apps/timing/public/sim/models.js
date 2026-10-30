// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The simulated decoders the server's TINYLAP_SIMULATE can name (decoders spec §5.4): `<model>[,fast]`,
// with a 2 s lap for `,fast`. A later model (AMB, say) is one more entry.
import { fakeHidDevice } from './hid-device.js';
import { easylapModel } from './models/easylap.js';
import { tinylapModel } from './models/tinylap.js';
import { fakeSerialPort } from './serial-port.js';
import { zroundModel } from './models/zround.js';

export const MODELS = Object.freeze({
  tinylap: { transport: /** @type {const} */ ('serial'), create: tinylapModel },
  zround: { transport: /** @type {const} */ ('serial'), create: zroundModel },
  easylap: { transport: /** @type {const} */ ('hid'), create: easylapModel },
});

/** What a TINYLAP_SIMULATE value, `<model>[,fast]`, asks for; null without one (decoders spec §5.4). @param {string | null | undefined} value */
export function simulation(value) {
  if (!value) return null;
  const [model, speed] = value.split(',');
  let name = model;
  if (!Object.hasOwn(MODELS, name)) {
    console.warn(`There is no simulated decoder "${model}". The known ones are ${Object.keys(MODELS).join(', ')}.`);
    name = 'tinylap';
  }
  return { name: /** @type {keyof typeof MODELS} */ (name), transport: MODELS[name].transport, lapMs: speed === 'fast' ? 2000 : 8000 };
}

const NVS_KEY = 'tinylap-sim-decoder';

/**
 * The simulated TinyLap decoder's flash, in this browser's storage: like the board, it stays paired
 * across a replug and a reload. Without storage it forgets on every pick.
 */
const browserNvs = {
  load() {
    try {
      const value = JSON.parse(localStorage.getItem(NVS_KEY) ?? 'null');
      return typeof value?.decoder === 'string' && typeof value?.token === 'string' ? value : null;
    } catch {
      return null;
    }
  },
  /** @param {{ decoder: string, token: string }} pairing */
  save(pairing) {
    try {
      localStorage.setItem(NVS_KEY, JSON.stringify(pairing));
    } catch {
      // No storage: the pairing lasts as long as this device.
    }
  },
};

/**
 * A fresh simulated device for one pick (spec §5.4): every pick is a new device (a TinyLap one keeps its pairing), so an unplug and
 * Connect again is one too. @param {{ name: keyof typeof MODELS, transport: 'serial' | 'hid', lapMs: number }} sim
 * @param {{ hid?: EventTarget }} [options]
 */
export function simulatedDevice(sim, { hid } = {}) {
  const model = sim.name === 'tinylap'
    ? tinylapModel({ lapMs: sim.lapMs, cars: 4, resetOnOpen: false, nvs: browserNvs })
    : MODELS[sim.name].create({ lapMs: sim.lapMs });
  return sim.transport === 'serial' ? fakeSerialPort(model) : fakeHidDevice(model, { hid });
}
