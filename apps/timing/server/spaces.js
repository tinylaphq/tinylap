// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Spaces (spec §3): a person's own space at /personal, each club at
// /clubs/<id>. They come from the access token's workspaces claim; "kind"
// says which is personal. Tokens from before accounts sent "kind" list the
// personal space first, so without any "kind" the first entry is personal.

/**
 * @typedef {{ id: string, role: string, kind: 'personal' | 'club', name: string, base: string }} Space
 * @param {{ workspaces?: { id: string, role: string, name?: string, kind?: string }[] }} claims
 * @returns {Space[]}
 */
export function spacesOf(claims) {
  const list = claims.workspaces ?? [];
  const marked = list.some((w) => w.kind);
  const personalId = (marked ? list.find((w) => w.kind === 'personal') : list[0])?.id ?? null;
  return list.map((w) => {
    const personal = w.id === personalId;
    return { id: w.id, role: w.role, kind: personal ? 'personal' : 'club', name: personal ? 'Personal' : w.name ?? 'Club', base: personal ? '/personal' : `/clubs/${w.id}` };
  });
}

/** The space a path names: a club by id, or (no id) your personal space. @param {Space[]} spaces @param {string | undefined} clubId */
export const spaceFor = (spaces, clubId) => (clubId === undefined ? spaces.find((s) => s.kind === 'personal') : spaces.find((s) => s.id === clubId)) ?? null;

/** /personal/<rest> or /clubs/<id>/<rest>; group 1 is the club id, then rest's own groups. @param {string} rest */
export const spacePath = (rest) => new RegExp(`^/(?:personal|clubs/([^/]+))/${rest}$`);
