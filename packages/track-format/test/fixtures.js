// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import { placedCells, rotateCell } from '../index.js';

// Four R30 corners packed into a 4x4 block. rot 0 exits N and E, so each
// corner is turned to face the two neighbours it must meet.
export function fourCornerLoop() {
  return [
    { type: 'cornerR30', x: 0, y: 0, rot: 90 },   // top-left,  ports E + S
    { type: 'cornerR30', x: 2, y: 0, rot: 180 },  // top-right, ports S + W
    { type: 'cornerR30', x: 2, y: 2, rot: 270 },  // bot-right, ports W + N
    { type: 'cornerR30', x: 0, y: 2, rot: 0 },    // bot-left,  ports N + E
  ];
}

// Rotate a whole build by `rot` degrees clockwise: every piece turns with it,
// and lands at the minimum of its rotated cells (rotatedDef's convention).
export function rotated(pieces, rot) {
  return pieces.map((p) => {
    const cells = placedCells(p).map((c) => rotateCell(c, rot));
    return {
      type: p.type,
      x: Math.min(...cells.map((c) => c[0])),
      y: Math.min(...cells.map((c) => c[1])),
      rot: (p.rot + rot) % 360,
    };
  });
}

export { rectangularRing } from '../reference-layouts.js';
