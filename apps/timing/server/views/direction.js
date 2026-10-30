// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The direction a club races, as an icon (named tracks spec §4): an open loop,
// like a track seen from above, with one arrowhead in the accent where it
// carries on. No visible word; its own <title> names it for screen readers
// and as a tooltip, in the words Setup uses.
import { html } from './html.js';

const NAME = { ccw: 'Anticlockwise', cw: 'Clockwise' };
// The loop and its arrowhead, drawn on a 40 × 22 grid; clockwise is anticlockwise mirrored.
const PATHS = {
  ccw: { loop: 'M26 3 H11 A8 8 0 0 0 11 19 H25 A8 8 0 0 0 33 11', head: 'M29 12 L33 6 L37 12' },
  cw: { loop: 'M12 3 H27 A8 8 0 0 1 27 19 H13 A8 8 0 0 1 5 11', head: 'M1 12 L5 6 L9 12' },
};

/** @param {'cw' | 'ccw'} direction */
export function directionIcon(direction) {
  const { loop, head } = PATHS[direction];
  return html`<svg class="direction-icon" width="40" height="22" viewBox="0 0 40 22" role="img"><title>${NAME[direction]}</title><path d="${loop}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"/><path d="${head}" fill="none" stroke="var(--p-accent-1)" stroke-width="3" stroke-linecap="square"/></svg>`;
}
