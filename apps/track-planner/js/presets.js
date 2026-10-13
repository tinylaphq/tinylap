// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { rectangularRing, stockL } from '@tinylap/track-format';

// Re-exported: the planner's tests and the gallery reach them through here.
export { rectangularRing, stockL };

// Official (and reference) layout presets for the gallery.
//
// Correction 1 (Task 15): this builder used to live in test/fixtures.js.
// Source must not import from test/, so the construction moved here and
// test/fixtures.js now re-exports it — one definition, tests unchanged.
//
// Correction 2 (Task 15): the manual figures in docs/ are too
// low-resolution to transcribe their grids reliably. Shipping a guessed
// layout would silently teach the bill of materials the wrong thing, which
// is worse than shipping fewer presets. So this file ships only the
// hand-derived reference ring used throughout the test suite — nothing
// from the manuals. Task 16 adds the stock L separately.

// Only the stock layout. The 7x9 ring used to sit here too, but it is a
// hand-derived test fixture rather than a plan Kyosho published, and the
// generator already enumerates rectangles sized to the owner's real stock —
// so offering it as a "known layout" was both misleading and redundant.
// rectangularRing() stays exported: the test suite leans on it heavily.
export const PRESETS = [
  {
    id: 'stock-l',
    name: 'Stock L (87033)',
    source: '87032/87033',
    pieces: stockL(),
  },
];
