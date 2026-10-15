// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// The permission matrix of the identity spec §5, as data. Every app checks
// workspace access with can(); nothing compares role names by hand.

/** @typedef {'owner' | 'admin' | 'member'} Role */
export const ROLES = /** @type {const} */ (['owner', 'admin', 'member']);

/** @type {Record<string, Role[]>} */
const MATRIX = {
  'track.read': ['owner', 'admin', 'member'],
  'track.save': ['owner', 'admin', 'member'],
  'track.share': ['owner', 'admin', 'member'],
  'track.copy': ['owner', 'admin', 'member'],
  'track.delete': ['owner', 'admin'],
  'invite.manage': ['owner', 'admin'],
  'member.remove': ['owner', 'admin'],
  'admin.manage': ['owner'],
  'owner.transfer': ['owner'],
  'club.manage': ['owner'],
  'club.leave': ['admin', 'member'],
  'timing.run': ['owner', 'admin', 'member'],
  'timing.setup': ['owner', 'admin', 'member'],
  'timing.delete': ['owner', 'admin'],
};

export const ACTIONS = Object.freeze(Object.keys(MATRIX));

/** @param {{ workspaces?: { id: string, role: string }[] }} claims @param {string} workspaceId @param {string} action */
export function can(claims, workspaceId, action) {
  const allowed = Object.hasOwn(MATRIX, action) ? MATRIX[action] : [];
  const membership = (claims.workspaces ?? []).find((w) => w.id === workspaceId);
  return Boolean(membership && allowed.includes(/** @type {any} */ (membership.role)));
}
