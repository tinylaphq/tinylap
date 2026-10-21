// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The simulator setting (decoders spec §5.4): TINYLAP_SIMULATE=<model>[,fast], with model tinylap,
// zround or easylap. With it, the layout loads public/sim/install.js, which stands in for Web Serial's
// and WebHID's pickers. Production never sets it.

const FORMAT = /^(tinylap|zround|easylap)(,fast)?$/;
/** The one file that changes a page's platform: served only while the setting is on. */
export const INSTALL_PATH = /\/public\/sim\/install\.js$/;

/** The setting, checked; null when unset or empty. @param {string | null | undefined} value */
export function readSimulate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!FORMAT.test(value)) throw new Error(`"${value}" is not <model>[,fast], with model tinylap, zround or easylap.`);
  return value;
}
