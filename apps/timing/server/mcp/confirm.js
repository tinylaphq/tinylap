// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Confirmations for MCP tools that lose data or interrupt a session (timing
// MCP spec §6). The first call answers what would happen and a sealed token
// that binds the member, the workspace, the tool, its other arguments and the
// state the message described. Only a second call that brings it back, within
// two minutes and with that state unchanged, acts. A flag could be sent on the
// first call; this token can't exist before the server has said what happens.
import { createHash } from 'node:crypto';
import { open, seal } from '@tinylap/auth';

export const CONFIRM_TTL_MS = 2 * 60 * 1000;
const PURPOSE = 'mcp-confirm';

/** JSON with sorted keys, so the same arguments always read the same. @param {unknown} value @returns {string} */
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const members = entries.map(([k, v]) => JSON.stringify(k) + ':' + canonical(v));
    return '{' + members.join(',') + '}';
  }
  return JSON.stringify(value);
}

const digest = (value) => createHash('sha256').update(canonical(value)).digest('base64url');

/**
 * What a confirmation is bound to. `args` leaves out `confirmation` itself.
 * @typedef {{ sub: string, workspace: string, tool: string, args: Record<string, unknown>, state: unknown }} Binding
 */

/** @param {import('@tinylap/auth').SealKey[]} keys @param {Binding} binding @param {number} now ms */
export function issue(keys, { sub, workspace, tool, args, state }, now) {
  return seal(keys, JSON.stringify({ sub, workspace, tool, args: digest(args), state: digest(state), exp: now + CONFIRM_TTL_MS }), PURPOSE);
}

/**
 * Checks a confirmation token against the call that brings it back.
 * - `ok`: it was issued for exactly this, and the state is unchanged;
 * - `stale`: it was issued for this call, but expired or the state changed: ask again;
 * - `invalid`: not a token, or one for another member, workspace, tool or arguments.
 * @param {import('@tinylap/auth').SealKey[]} keys @param {string} token @param {Binding} binding @param {number} now ms
 * @returns {'ok' | 'stale' | 'invalid'}
 */
export function check(keys, token, { sub, workspace, tool, args, state }, now) {
  let claims;
  try {
    claims = JSON.parse(open(keys, token, PURPOSE));
  } catch {
    return 'invalid';
  }
  if (claims?.sub !== sub || claims.workspace !== workspace || claims.tool !== tool || claims.args !== digest(args)) return 'invalid';
  if (typeof claims.exp !== 'number' || claims.exp < now || claims.state !== digest(state)) return 'stale';
  return 'ok';
}
