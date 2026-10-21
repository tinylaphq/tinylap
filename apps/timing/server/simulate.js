// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The simulator setting (decoders spec §5.4): TINYLAP_SIMULATE=<model>[,fast], with model tinylap,
// zround or easylap. With it, the layout loads public/sim/install.js, which stands in for Web Serial's
// and WebHID's pickers. Production never sets it.

import { posix } from 'node:path';

const FORMAT = /^(tinylap|zround|easylap)(,fast)?$/;
/**
 * The one file that changes a page's platform: served only while the setting is on. Tested the way
 * static serving resolves a path (decoded, normalized, case-blind for case-insensitive disks), so no
 * spelling, `//`, `%2E`, `..` or /v/<build>/ prefix, reaches it. @param {string} pathname
 */
export function isInstallPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape: fail closed, so the gate answers 404 rather than letting static serving guess.
    return true;
  }
  return /^(\/v\/[^/]+)?\/public\/sim\/install\.js$/i.test(posix.normalize(decoded));
}

/** The setting, checked; null when unset or empty. @param {string | null | undefined} value */
export function readSimulate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!FORMAT.test(value)) throw new Error(`"${value}" is not <model>[,fast], with model tinylap, zround or easylap.`);
  return value;
}
