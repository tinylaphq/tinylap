// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The simulated decoders a bridge page can use (decoders spec §5.4):
// ?simulate=tinylap|zround|easylap, ?simulate and ?simulate=fast for TinyLap,
// and &speed=fast for a 2 s lap. A later model (AMB, say) is one more entry.
import { easylapModel } from './models/easylap.js';
import { tinylapModel } from './models/tinylap.js';
import { zroundModel } from './models/zround.js';

export const MODELS = Object.freeze({
  tinylap: { transport: /** @type {const} */ ('serial'), create: tinylapModel },
  zround: { transport: /** @type {const} */ ('serial'), create: zroundModel },
  easylap: { transport: /** @type {const} */ ('hid'), create: easylapModel },
});

/** What the page's ?simulate asks for, or null without it. @param {string} search */
export function simulation(search) {
  const params = new URLSearchParams(search);
  const value = params.get('simulate');
  if (value === null) return null;
  let name = value === '' || value === 'fast' ? 'tinylap' : value;
  if (!Object.hasOwn(MODELS, name)) {
    console.warn(`There is no simulated decoder "${value}". The known ones are ${Object.keys(MODELS).join(', ')}.`);
    name = 'tinylap';
  }
  const fast = value === 'fast' || params.get('speed') === 'fast';
  return { name: /** @type {keyof typeof MODELS} */ (name), transport: MODELS[name].transport, lapMs: fast ? 2000 : 8000 };
}
