// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// Track identity: which concrete track a layout is. See the design spec
// docs/superpowers/specs/2026-10-13-track-identity-design.md.

import { rotateCell, rotateCorner, rotateVertex } from './geometry.js';
import { isClosedCircuit, occupiedSet, parseCellKey, wallCounts, computeBarriers, capVertices } from './model.js';

/** @import { Track, Layout, Cell } from './types.js' */

// crypto.randomUUID() emits lowercase RFC 4122 version 4 ids.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** @param {unknown} value @returns {value is Track} */
export function isTrack(value) {
  if (typeof value !== 'object' || value === null) return false;
  const { id, shape } = /** @type {{ id?: unknown, shape?: unknown }} */ (value);
  return typeof id === 'string' && UUID.test(id) && typeof shape === 'string' && shape.startsWith('c30:');
}

export const SHAPE_PREFIX = 'c30:1:';

// An edge id names a unit edge by its upper-left vertex:
// H:x:y runs (x,y)-(x+1,y), V:x:y runs (x,y)-(x,y+1).
/** @param {string} id @returns {[Cell, Cell]} */
function edgeEnds(id) {
  const [axis, xs, ys] = id.split(':');
  const x = Number(xs);
  const y = Number(ys);
  return axis === 'H' ? [[x, y], [x + 1, y]] : [[x, y], [x, y + 1]];
}

/** @param {Cell} a @param {Cell} b @returns {string} */
function edgeKey(a, b) {
  return a[1] === b[1] ? `H:${Math.min(a[0], b[0])}:${a[1]}` : `V:${a[0]}:${Math.min(a[1], b[1])}`;
}

// The fingerprint of what is physically built: cells, straight barriers (with
// how many each edge carries), curved barriers and corner caps. It is
// normalised for position and the four quarter turns, but not for mirroring,
// because a mirrored layout turns the other way and is a different track.
/** @param {Layout} layout @returns {string | null} */
export function shapeOf(layout) {
  if (!isClosedCircuit(layout)) return null;
  const cells = [...occupiedSet(layout)].map(parseCellKey);
  const edges = [...wallCounts(layout)].filter(([, n]) => n > 0).map(([id, n]) => ({ ends: edgeEnds(id), n }));
  const { arcs } = computeBarriers(layout);
  const caps = capVertices(layout);

  const forms = [0, 90, 180, 270].map((rot) => {
    const turned = cells.map((c) => rotateCell(c, rot));
    const mx = Math.min(...turned.map((c) => c[0]));
    const my = Math.min(...turned.map((c) => c[1]));
    /** @param {Cell} c */
    const at = ([x, y]) => `${x - mx},${y - my}`;
    /** @param {Cell} v @returns {Cell} */
    const vertex = (v) => {
      const [x, y] = rotateVertex(v, rot);
      return [x - mx, y - my];
    };
    return [
      ...turned.map((c) => `c${at(c)}`),
      ...edges.map(({ ends, n }) => `e${edgeKey(vertex(ends[0]), vertex(ends[1]))}*${n}`),
      ...arcs.map((w) => `a${w.kind}:${w.r}:${rotateCorner(w.corner, rot)}:${at(rotateCell(w.cell, rot))}`),
      ...caps.map((v) => `k${vertex(v).join(',')}`),
    ].sort().join(';');
  });
  return SHAPE_PREFIX + forms.sort()[0];
}
