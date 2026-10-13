// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// Kyosho Mini-Z Grand Prix Circuit 30 geometry.
// Cells are [col, row] with row increasing downward, matching SVG.
// Rotation is clockwise on screen: 0, 90, 180, 270.

/** @import { Dir, Corner, Rotation, Cell, PieceType, PieceDef, PlacedPiece, Port, Wall } from './types.js' */

export const MAT_MM = 300;

/** @type {Dir[]} */
const DIRS = ['N', 'E', 'S', 'W'];
/** @type {Corner[]} */
const CORNERS = ['NE', 'SE', 'SW', 'NW'];

/** @param {number} rot */
const steps = (rot) => (((rot / 90) % 4) + 4) % 4;

/** @param {Dir} dir @param {number} rot @returns {Dir} */
export function rotateDir(dir, rot) {
  return DIRS[(DIRS.indexOf(dir) + steps(rot)) % 4];
}

/** @param {Corner} corner @param {number} rot @returns {Corner} */
export function rotateCorner(corner, rot) {
  return CORNERS[(CORNERS.indexOf(corner) + steps(rot)) % 4];
}

// A vertex is a point: (x, y) -> (-y, x) per quarter turn.
/** @param {Cell} vertex @param {number} rot @returns {Cell} */
export function rotateVertex([x, y], rot) {
  /** @type {Cell} */
  let p = [x, y];
  for (let i = steps(rot); i > 0; i--) p = [-p[1], p[0]];
  return /** @type {Cell} */ (p.map(v => v === 0 ? 0 : v));
}

// A cell is the unit square (x, y)..(x+1, y+1). Rotating those corners
// yields the square indexed (-y-1, x).
/** @param {Cell} cell @param {number} rot @returns {Cell} */
export function rotateCell([x, y], rot) {
  /** @type {Cell} */
  let p = [x, y];
  for (let i = steps(rot); i > 0; i--) p = [-p[1] - 1, p[0]];
  return p;
}

const QUARTER_TURN_MM = (Math.PI / 2) * MAT_MM;

/** @type {Record<PieceType, PieceDef>} */
export const PIECES = {
  straight: {
    label: 'Straight',
    cells: [[0, 0], [1, 0]],
    ports: [
      { cells: [[0, 0], [1, 0]], dir: 'N' },
      { cells: [[0, 0], [1, 0]], dir: 'S' },
    ],
    walls: [],
    mats: { square: 2 },
    centrelineMm: MAT_MM,
  },

  cornerR30: {
    label: 'Corner R30',
    cells: [[0, 0], [1, 0], [0, 1], [1, 1]],
    ports: [
      { cells: [[0, 0], [1, 0]], dir: 'N' },
      { cells: [[1, 0], [1, 1]], dir: 'E' },
    ],
    walls: [
      { kind: 'arc', r: 1, cell: [0, 1], corner: 'SW' },
      { kind: 'cap', vertex: [2, 0] },
    ],
    mats: { square: 3, quarterRound: 1 },
    centrelineMm: QUARTER_TURN_MM,
  },

  cornerR60: {                                         // enter N, exit W
    label: 'Corner R60',
    // The COMPLETE placeable corner, not just the kit's contribution.
    //
    // 87033-02 supplies only the inside of the turn: three mats (two
    // shaped, one plain) and two curve halves, with no outside barriers
    // at all. Those three alone leave a corridor one mat wide, which is
    // not a usable corner — so the piece placed on the canvas is that
    // inner assembly plus an outer layer of plain mats and barriers from
    // a base set, bringing the corridor back to the fixed two mats.
    // This is why the kit's manual says it cannot be used alone.
    cells: [
      [1, 0], [2, 0],                                  // 3x3 minus the swept
      [0, 1], [1, 1], [2, 1],                          // inner cell [0,0]
      [0, 2], [1, 2], [2, 2],
    ],
    ports: [
      { cells: [[1, 0], [2, 0]], dir: 'N' },
      { cells: [[0, 1], [0, 2]], dir: 'W' },
    ],
    walls: [
      // Inside: the kit's large sweep. An ordinary quarter-circle arc centred
      // on the turn's centre, concentric with the corridor's centreline and
      // tangent to the adjoining straights.
      { kind: 'arcLarge', r: 1, cell: [0, 0], corner: 'SE' },
      // Outside: an ordinary quarter-round from the base set, as on any
      // other corner. The kit supplies nothing for this edge.
      { kind: 'arc', r: 1, cell: [2, 2], corner: 'SE' },
    ],
    mats: { square: 5, quarterRound: 1, arcLarge: 2 },
    centrelineMm: 2 * QUARTER_TURN_MM,
  },
};

export const PIECE_TYPES = /** @type {PieceType[]} */ (Object.keys(PIECES));
/** @type {Rotation[]} */
export const ROTATIONS = [0, 90, 180, 270];

/** @type {Map<string, PieceDef>} */
const cache = new Map();

// Rotate a definition and translate it so its footprint starts at [0, 0].
/** @param {PieceType} type @param {number} rot @returns {PieceDef} */
export function rotatedDef(type, rot) {
  const key = `${type}:${steps(rot) * 90}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const def = PIECES[type];
  if (!def) throw new Error(`unknown piece type: ${type}`);

  const spun = def.cells.map((c) => rotateCell(c, rot));
  const dx = -Math.min(...spun.map((c) => c[0]));
  const dy = -Math.min(...spun.map((c) => c[1]));
  /** @type {(cell: Cell) => Cell} */
  const shift = ([x, y]) => [x + dx, y + dy];

  /** @type {PieceDef} */
  const out = {
    label: def.label,
    mats: def.mats,
    centrelineMm: def.centrelineMm,
    cells: spun.map(shift),
    ports: def.ports.map((p) => ({
      cells: p.cells.map((c) => shift(rotateCell(c, rot))),
      dir: rotateDir(p.dir, rot),
    })),
    walls: def.walls.map((w) =>
      w.kind === 'cap'
        ? { kind: 'cap', vertex: shift(rotateVertex(w.vertex, rot)) }
        : {
            kind: w.kind,
            r: w.r,
            cell: shift(rotateCell(w.cell, rot)),
            corner: rotateCorner(w.corner, rot),
          },
    ),
  };

  cache.set(key, out);
  return out;
}

/** @param {PlacedPiece} piece @returns {Cell[]} */
export function placedCells({ type, x, y, rot }) {
  return rotatedDef(type, rot).cells.map(([cx, cy]) => [cx + x, cy + y]);
}

/** @param {PlacedPiece} piece @returns {Port[]} */
export function placedPorts({ type, x, y, rot }) {
  return rotatedDef(type, rot).ports.map((p) => ({
    cells: p.cells.map(([cx, cy]) => [cx + x, cy + y]),
    dir: p.dir,
  }));
}

/** @param {PlacedPiece} piece @returns {Wall[]} */
export function placedWalls({ type, x, y, rot }) {
  return rotatedDef(type, rot).walls.map((w) =>
    w.kind === 'cap'
      ? { kind: 'cap', vertex: [w.vertex[0] + x, w.vertex[1] + y] }
      : { ...w, cell: [w.cell[0] + x, w.cell[1] + y] },
  );
}
