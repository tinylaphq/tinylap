// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// Track identity: which concrete track a layout is. See the design spec
// docs/superpowers/specs/2026-10-13-track-identity-design.md.

/** @import { Track } from './types.js' */

// crypto.randomUUID() emits lowercase RFC 4122 version 4 ids.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** @param {unknown} value @returns {value is Track} */
export function isTrack(value) {
  if (typeof value !== 'object' || value === null) return false;
  const { id, shape } = /** @type {{ id?: unknown, shape?: unknown }} */ (value);
  return typeof id === 'string' && UUID.test(id) && typeof shape === 'string' && shape.startsWith('c30:');
}
