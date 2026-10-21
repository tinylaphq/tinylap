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

/**
 * A fresh simulated device for one pick (spec §5.4): every pick is a new device, so an unplug and
 * Connect again is one too. @param {{ name: keyof typeof MODELS, transport: 'serial' | 'hid', lapMs: number }} sim
 * @param {{ hid?: EventTarget }} [options]
 */
export function simulatedDevice(sim, { hid } = {}) {
  const model = MODELS[sim.name].create({ lapMs: sim.lapMs });
  return sim.transport === 'serial' ? fakeSerialPort(model) : fakeHidDevice(model, { hid });
}
