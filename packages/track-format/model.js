// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import { placedCells, placedPorts, placedWalls, rotatedDef } from './geometry.js';

/** @import { Dir, Corner, Rotation, Cell, PieceType, Port, ArcWall, PlacedPiece, Layout, Metrics, Barriers, BarrierCounts } from './types.js' */
/** @typedef {{ pieceIndex: number, port: Port }} PortEntry */

/** @param {Partial<Layout>} [overrides] @returns {Layout} */
export function createLayout(overrides = {}) {
  return { version: 2, unit: 'mat', room: null, pieces: [], ...overrides };
}

/** @param {Cell} cell @returns {string} */
export const cellKey = ([x, y]) => `${x},${y}`;
/** @param {string} k @returns {Cell} */
export const parseCellKey = (k) => /** @type {Cell} */ (k.split(',').map(Number));

/** @param {Layout} layout @returns {Map<string, number[]>} */
export function occupancy(layout) {
  /** @type {Map<string, number[]>} */
  const map = new Map();
  layout.pieces.forEach((piece, index) => {
    for (const cell of placedCells(piece)) {
      const key = cellKey(cell);
      const owners = map.get(key);
      if (owners) owners.push(index);
      else map.set(key, [index]);
    }
  });
  return map;
}

/** @param {Layout} layout @returns {Set<string>} */
export function occupiedSet(layout) {
  return new Set(occupancy(layout).keys());
}

/** @param {Layout} layout @returns {string[]} */
export function findOverlaps(layout) {
  return [...occupancy(layout)]
    .filter(([, owners]) => owners.length > 1)
    .map(([key]) => key);
}

/** @param {Cell} cell @param {Dir} dir @returns {string} */
export function edgeId([x, y], dir) {
  switch (dir) {
    case 'N': return `H:${x}:${y}`;
    case 'S': return `H:${x}:${y + 1}`;
    case 'W': return `V:${x}:${y}`;
    case 'E': return `V:${x + 1}:${y}`;
    default: throw new Error(`bad direction: ${dir}`);
  }
}

/** @param {Port} port @returns {string[]} */
export const portEdgeIds = (port) => port.cells.map((c) => edgeId(c, port.dir));
/** @param {Port} port @returns {string} */
export const portKey = (port) => portEdgeIds(port).slice().sort().join('|');

/** @type {Record<Dir, Dir>} */
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** @param {Layout} layout @returns {{ matched: Set<string>, open: PortEntry[] }} */
export function matchPorts(layout) {
  /** @type {Map<string, PortEntry[]>} */
  const byKey = new Map();
  layout.pieces.forEach((piece, pieceIndex) => {
    for (const port of placedPorts(piece)) {
      const key = portKey(port);
      const bucket = byKey.get(key);
      if (bucket) bucket.push({ pieceIndex, port });
      else byKey.set(key, [{ pieceIndex, port }]);
    }
  });

  /** @type {Set<string>} */
  const matched = new Set();
  /** @type {PortEntry[]} */
  const open = [];
  for (const [key, entries] of byKey) {
    const paired =
      entries.length === 2 && entries[0].port.dir === OPPOSITE[entries[1].port.dir];
    if (paired) matched.add(key);
    else open.push(...entries);
  }
  return { matched, open };
}

// Edges of unmatched ports. These are openings, not walls, so the
// boundary walk must not put a barrier on them.
/** @param {Layout} layout @returns {Set<string>} */
export function openEdgeIds(layout) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const { port } of matchPorts(layout).open) {
    for (const id of portEdgeIds(port)) ids.add(id);
  }
  return ids;
}

/** @param {Layout} layout @returns {boolean} */
export function isClosedCircuit(layout) {
  if (layout.pieces.length === 0) return false;
  if (findOverlaps(layout).length > 0) return false;
  if (matchPorts(layout).open.length > 0) return false;
  return isSingleComponent(layout);
}

/** @param {Layout} layout @returns {boolean} */
function isSingleComponent(layout) {
  const cells = occupiedSet(layout);
  const first = cells.values().next().value;
  if (!first) return false;
  const seen = new Set([first]);
  const queue = [parseCellKey(first)];
  while (queue.length > 0) {
    const [x, y] = /** @type {Cell} */ (queue.pop());
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      const key = cellKey([nx, ny]);
      if (cells.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push([nx, ny]);
      }
    }
  }
  return seen.size === cells.size;
}

/** @type {Record<Dir, Cell>} */
export const NEIGHBOUR = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

// For each corner, the two edges meeting there and the direction each
// one runs as you walk away from the corner.
/** @type {Record<Corner, [Dir, Cell][]>} */
const CORNER_EDGES = {
  NE: [['N', [-1, 0]], ['E', [0, 1]]],
  SE: [['S', [-1, 0]], ['E', [0, -1]]],
  SW: [['S', [1, 0]], ['W', [0, -1]]],
  NW: [['N', [1, 0]], ['W', [0, 1]]],
};

// How many walls each edge carries, counted per piece-side.
//
// Barriers belong to the PIECES, not to the outline of the mats. A piece
// walls every side of itself that is not one of its own ports, whatever is
// beyond it. So:
//   - outline edge                  -> 1 (the one piece facing it)
//   - two pieces joined by a port   -> 0 (both sides are openings)
//   - two pieces merely touching    -> 2 (each mounts its own wall on its
//                                        own tile; there is no shared
//                                        barrier — see spec 2.1)
//   - one piece's open port abutted
//     by another piece's flank      -> 1 (an opening one side, wall the other)
//
// That last case is why this counts per side rather than testing "is this
// a port edge" globally: the same edge can be an opening for one piece and
// a wall for its neighbour. Getting it wrong swallowed real walls and
// invented others.
/** @param {Layout} layout @returns {Map<string, number>} */
export function wallCounts(layout) {
  const occ = occupancy(layout);

  // Each piece's own port edges are openings in THAT piece's wall, whether
  // the port is matched or not. Keeping them per piece is the whole point:
  // an edge can be one piece's open port and another piece's plain outside
  // wall at the same time, and then it carries exactly one wall, not none
  // and not two. Treating "is a port edge" as a global property got this
  // wrong in both directions.
  const portIdsByPiece = layout.pieces.map((piece) => {
    /** @type {Set<string>} */
    const ids = new Set();
    for (const port of placedPorts(piece)) {
      for (const id of portEdgeIds(port)) ids.add(id);
    }
    return ids;
  });

  /** @type {Map<string, number>} */
  const counts = new Map();
  layout.pieces.forEach((piece, index) => {
    const ownPorts = portIdsByPiece[index];
    for (const cell of placedCells(piece)) {
      const [x, y] = cell;
      for (const dir of /** @type {Dir[]} */ (['N', 'E', 'S', 'W'])) {
        const [dx, dy] = NEIGHBOUR[dir];
        const nOwners = occ.get(cellKey([x + dx, y + dy]));
        if (nOwners && nOwners.includes(index)) continue;  // inside this piece
        const id = edgeId([x, y], dir);
        if (ownPorts.has(id)) continue;                    // this piece's opening
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  });
  return counts;
}

/** @param {Layout} layout @returns {Set<string>} */
export function boundaryEdges(layout) {
  return new Set(wallCounts(layout).keys());
}

// Shared setup for enclosedInfields and maxTrackDepth: flood-fill the empty
// complement of the occupied cells outward from a corner of a one-cell
// margin around the bounding box. Everything the flood reaches is "outside"
// — connected to the open edge of the layout; everything empty it never
// reaches is boxed in by occupied cells on every side. Returns null for an
// empty layout (nothing to flood).
/** @param {Layout} layout */
function floodOutsideMargin(layout) {
  const cells = occupiedSet(layout);
  if (cells.size === 0) return null;

  const points = [...cells].map(parseCellKey);
  const minX = Math.min(...points.map(([x]) => x)) - 1;
  const maxX = Math.max(...points.map(([x]) => x)) + 1;
  const minY = Math.min(...points.map(([, y]) => y)) - 1;
  const maxY = Math.max(...points.map(([, y]) => y)) + 1;
  /** @param {Cell} cell */
  const inBounds = ([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  /** @param {Cell} cell @returns {Cell[]} */
  const emptyNeighbours = ([x, y]) =>
    Object.values(NEIGHBOUR)
      .map(([dx, dy]) => /** @type {Cell} */ ([x + dx, y + dy]))
      .filter((n) => inBounds(n) && !cells.has(cellKey(n)));

  // Flood outward from a corner of the margin — guaranteed empty, and
  // guaranteed connected to every other margin cell round the outside.
  const outside = new Set([cellKey([minX, minY])]);
  /** @type {Cell[]} */
  const queue = [[minX, minY]];
  while (queue.length > 0) {
    const cell = /** @type {Cell} */ (queue.pop());
    for (const n of emptyNeighbours(cell)) {
      const key = cellKey(n);
      if (outside.has(key)) continue;
      outside.add(key);
      queue.push(n);
    }
  }

  return { cells, minX, maxX, minY, maxY, outside, emptyNeighbours };
}

// The filled outline: every cell in the margined bounding box that
// floodOutsideMargin's flood never reached, i.e. the occupied cells plus
// everything they enclose (the infield). Shared by maxTrackDepth and
// subWidthNotches — both reason about the SAME filled shape, one by
// Chebyshev depth, the other by morphological closing.
/** @param {{ minX: number, maxX: number, minY: number, maxY: number, outside: Set<string> }} flood @returns {Set<string>} */
function filledOutline({ minX, maxX, minY, maxY, outside }) {
  /** @type {Set<string>} */
  const R = new Set();
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const key = cellKey([x, y]);
      if (!outside.has(key)) R.add(key);
    }
  }
  return R;
}

// How many separate enclosed empty regions the occupied cells surround.
// Port-closed and overlap-free is not enough to be a real track: a solid
// block of mats with a wall round the outside satisfies both while
// enclosing nothing to drive around. Every empty region floodOutsideMargin's
// flood never reaches is cut off by the occupied cells on all sides, i.e.
// an enclosed infield.
/** @param {Layout} layout @returns {number} */
export function enclosedInfields(layout) {
  const flood = floodOutsideMargin(layout);
  if (!flood) return 0;
  const { cells, minX, maxX, minY, maxY, outside, emptyNeighbours } = flood;

  // Count connected components among the empty cells the outside flood
  // never reached — each one is a distinct region walled off on every side.
  /** @type {Set<string>} */
  const visited = new Set();
  let infields = 0;
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const key = cellKey([x, y]);
      if (cells.has(key) || outside.has(key) || visited.has(key)) continue;
      infields += 1;
      visited.add(key);
      /** @type {Cell[]} */
      const componentQueue = [[x, y]];
      while (componentQueue.length > 0) {
        const cell = /** @type {Cell} */ (componentQueue.pop());
        for (const n of emptyNeighbours(cell)) {
          const nKey = cellKey(n);
          if (outside.has(nKey) || visited.has(nKey)) continue;
          visited.add(nKey);
          componentQueue.push(n);
        }
      }
    }
  }
  return infields;
}

// Every shared edge between two occupied cells belonging to different
// pieces that is NOT a matched-port join. Barriers belong to the pieces
// themselves — a straight carries a barrier down each long side — so where
// two pieces are edge-adjacent without actually connecting through a
// matched port, that edge should have carried a barrier but the outline
// walk (boundaryEdges/computeBarriers) never sees it: both cells are
// occupied, so the edge is interior, and the two lanes silently merge. A
// loop that runs back alongside itself produces exactly this: it can still
// enclose one infield and stay within two mats of its own edge in places,
// while two of its own straights rest side by side with no wall between
// them.
//
// Cells belonging to the SAME piece touching each other is normal (e.g. an
// R30 corner's own two cells) and is never reported. Returns an empty
// array for a valid track.
/** @param {Layout} layout @returns {string[]} */
export function unjoinedContacts(layout) {
  const occ = occupancy(layout);
  const { matched } = matchPorts(layout);
  /** @type {Set<string>} */
  const legit = new Set();
  layout.pieces.forEach((piece) => {
    for (const port of placedPorts(piece)) {
      if (!matched.has(portKey(port))) continue;
      for (const id of portEdgeIds(port)) legit.add(id);
    }
  });

  /** @type {Set<string>} */
  const contacts = new Set();
  for (const [key, owners] of occ) {
    const [x, y] = parseCellKey(key);
    for (const dir of /** @type {Dir[]} */ (['N', 'E', 'S', 'W'])) {
      const [dx, dy] = NEIGHBOUR[dir];
      const nOwners = occ.get(cellKey([x + dx, y + dy]));
      if (!nOwners) continue;
      if (owners.some((o) => nOwners.includes(o))) continue; // same piece
      const id = edgeId([x, y], dir);
      if (legit.has(id)) continue;
      contacts.add(id);
    }
  }
  return [...contacts];
}

// The 8-neighbourhood (including diagonals) — Chebyshev-adjacent cells.
/** @type {Cell[]} */
const NEIGHBOURS8 = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

// How deep the thickest part of the track is, measured inward from the
// edge of its own outline. Let R be the filled outline: the occupied cells
// plus everything they enclose (the infield(s) floodOutsideMargin's flood
// never reaches). Give every cell of R its Chebyshev distance to the
// nearest cell outside R — 1 on the edge, 2 the next ring in, and so on.
// A real two-mat-wide track is exactly the cells of R at depth 1 or 2; a
// depth of 3 or more means the track is wider than two mats there. Two
// non-consecutive straight runs sitting side by side pass the infield
// check (there is still exactly one hole) but fail this one.
/** @param {Layout} layout @returns {number} */
export function maxTrackDepth(layout) {
  const flood = floodOutsideMargin(layout);
  if (!flood) return 0;
  const { cells } = flood;
  const R = filledOutline(flood);

  // Multi-source BFS inward, over the 8-neighbourhood, starting from every
  // cell of R that touches a non-R cell (depth 1).
  /** @type {Map<string, number>} */
  const depth = new Map();
  /** @type {string[]} */
  const queue = [];
  for (const key of R) {
    const [x, y] = parseCellKey(key);
    const onEdge = NEIGHBOURS8.some(([dx, dy]) => !R.has(cellKey([x + dx, y + dy])));
    if (onEdge) {
      depth.set(key, 1);
      queue.push(key);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const key = queue[head++];
    const d = /** @type {number} */ (depth.get(key));
    const [x, y] = parseCellKey(key);
    for (const [dx, dy] of NEIGHBOURS8) {
      const nKey = cellKey([x + dx, y + dy]);
      if (R.has(nKey) && !depth.has(nKey)) {
        depth.set(nKey, d + 1);
        queue.push(nKey);
      }
    }
  }

  let max = 0;
  for (const key of cells) max = Math.max(max, depth.get(key) ?? 0);
  return max;
}

// Shift every cell of `cells` by each offset in `offsets` and union the
// results — the set-based form of dilating `cells` by the structuring
// element `offsets` (a Minkowski sum). Unbounded: callers never need to
// pre-size a grid, since only cells that could plausibly be touched are
// ever visited.
/** @param {Set<string>} cells @param {Cell[]} offsets @returns {Set<string>} */
function dilateBy(cells, offsets) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const key of cells) {
    const [x, y] = parseCellKey(key);
    for (const [dx, dy] of offsets) out.add(cellKey([x + dx, y + dy]));
  }
  return out;
}

// Erode `cells` by the structuring element `offsets`: a point survives only
// if every offset shift of it lands back in `cells`. Computed by counting,
// for each candidate point, how many of the offsets it satisfies — cheaper
// than testing every point of an unbounded plane against `cells` directly.
/** @param {Set<string>} cells @param {Cell[]} offsets @returns {Set<string>} */
function erodeBy(cells, offsets) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const key of cells) {
    const [x, y] = parseCellKey(key);
    for (const [dx, dy] of offsets) {
      const point = cellKey([x - dx, y - dy]);
      counts.set(point, (counts.get(point) ?? 0) + 1);
    }
  }
  /** @type {Set<string>} */
  const out = new Set();
  for (const [key, count] of counts) if (count === offsets.length) out.add(key);
  return out;
}

// A 2x2 square, the structuring element subWidthNotches closes with. It
// contains its own origin (0,0), which is what makes the closing below
// extensive (R is always a subset of its own closing) — so "cells the
// closing added" is always well-defined as closing \ R, never the reverse.
/** @type {Cell[]} */
const SQUARE_2X2 = [[0, 0], [1, 0], [0, 1], [1, 1]];

// How many sub-width notches are cut into the outline: slots narrower than
// the two-mat track width that a driver cannot actually use — what made an
// "8-corner shape 3" suggestion look like a rectangle with a pimple.
//
// Measured as a morphological CLOSING (dilate then erode) of the filled
// outline R — the same occupied-plus-enclosed-infield shape maxTrackDepth
// computes — by a 2x2 square: closing fills in any gap too narrow for the
// square to sit inside fully, so any cell the closing gains that R did not
// already have was part of a gap narrower than two mats.
//
// Deliberately CLOSING, not opening. Opening (erode then dilate) detects
// thin TRACK, and this track is exactly two mats wide everywhere by
// construction — an earlier attempt at this filter used opening and it
// passed 100% of generated layouts, calibration included, because nothing
// here is ever thin FOREGROUND. Closing detects thin GAPS instead, which is
// what a sub-width notch actually is: two lobes of the outline pinched
// together across a gap too narrow to be real track.
//
// Counted as connected regions of the gained cells (4-connectivity), not a
// raw cell count — the same "count regions, not cells" shape as
// enclosedInfields — so one wide notch does not outweigh two separate
// narrow ones purely by area.
//
// Calibration: both stockL() and rectangularRing() — real, physically-built
// layouts — score 0. At two starter kits (stockFromKits({'87033':2})),
// this catches 50 of the 300 layouts the contact rule alone used to let
// through.
/** @param {Layout} layout @returns {number} */
export function subWidthNotches(layout) {
  const flood = floodOutsideMargin(layout);
  if (!flood) return 0;
  const R = filledOutline(flood);

  const closed = erodeBy(dilateBy(R, SQUARE_2X2), SQUARE_2X2);
  const gained = new Set([...closed].filter((key) => !R.has(key)));

  // Connected components of `gained`, 4-connectivity — the same
  // flood-fill-and-count shape enclosedInfields uses for its regions.
  /** @type {Set<string>} */
  const visited = new Set();
  let notches = 0;
  for (const start of gained) {
    if (visited.has(start)) continue;
    notches += 1;
    visited.add(start);
    const queue = [parseCellKey(start)];
    while (queue.length > 0) {
      const [x, y] = /** @type {Cell} */ (queue.pop());
      for (const [dx, dy] of Object.values(NEIGHBOUR)) {
        const nKey = cellKey([x + dx, y + dy]);
        if (gained.has(nKey) && !visited.has(nKey)) {
          visited.add(nKey);
          queue.push([x + dx, y + dy]);
        }
      }
    }
  }
  return notches;
}

/** @param {ArcWall} wall @returns {string[]} */
export function arcEdgeIds(wall) {
  /** @type {string[]} */
  const ids = [];
  for (const [dir, [sx, sy]] of CORNER_EDGES[wall.corner]) {
    for (let i = 0; i < wall.r; i++) {
      ids.push(edgeId([wall.cell[0] + sx * i, wall.cell[1] + sy * i], dir));
    }
  }
  return ids;
}

// A cap belongs at a concave corner: three of the four cells around the
// vertex occupied, one empty.
/** @param {Set<string>} cells @param {Cell} vertex @returns {boolean} */
function isConcaveVertex(cells, [vx, vy]) {
  /** @type {Cell[]} */
  const around = [[vx - 1, vy - 1], [vx, vy - 1], [vx - 1, vy], [vx, vy]];
  return around.filter((c) => cells.has(cellKey(c))).length === 3;
}

/** @param {Layout} layout @returns {Barriers} */
export function computeBarriers(layout) {
  const cells = occupiedSet(layout);
  /** @type {BarrierCounts} */
  const counts = { straight: 0, curve: 0, curveLarge: 0, cornerCap: 0 };
  /** @type {ArcWall[]} */
  const arcs = [];

  // How many walls each edge still needs, rather than whether it needs one.
  // An arc takes ONE of them, leaving any wall the neighbouring piece owns
  // on that same edge behind. Deleting the edge outright (as this did
  // before) swallowed that second wall: it vanished from straightEdgeIds,
  // so the track rendered with an open gap where a straight met a corner,
  // and the count lost it too.
  const wallsLeft = wallCounts(layout);

  for (const piece of layout.pieces) {
    for (const wall of placedWalls(piece)) {
      if (wall.kind === 'cap') {
        if (isConcaveVertex(cells, wall.vertex)) counts.cornerCap += 1;
        continue;
      }
      const claimed = arcEdgeIds(wall);
      if (!claimed.every((id) => /** @type {number} */ (wallsLeft.get(id)) > 0)) continue;
      for (const id of claimed) wallsLeft.set(id, /** @type {number} */ (wallsLeft.get(id)) - 1);
      if (wall.kind === 'arc') counts.curve += 1;
      else counts.curveLarge += 2;
      arcs.push(wall);
    }
  }

  // Every edge carries one straight barrier, except an unjoined inter-piece
  // contact edge, which carries TWO: there is no shared barrier between two
  // lanes that merely touch without joining — each piece mounts its own
  // wall on its own tile, and the two sit back to back at the seam (spec
  // 2.1; corrected from an earlier, wrong "shared barrier" assumption once
  // the user, who owns the physical kit, pointed out that real halves don't
  // share hardware). boundaryEdges stays a plain set of edges-that-carry-
  // a-wall — right for rendering (one stroke per edge) and for the arc-claim
  // loop above (which only needs to know a wall exists there) — so the
  // doubling happens only in this count, not in the edge set itself.
  let straight = 0;
  /** @type {string[]} */
  const straightEdgeIds = [];
  for (const [id, n] of wallsLeft) {
    straight += n;
    if (n > 0) straightEdgeIds.push(id);
  }
  counts.straight = straight;

  return { counts, straightEdgeIds, arcs };
}

/** @param {Layout} layout @returns {Metrics} */
export function computeMetrics(layout) {
  const cells = [...occupiedSet(layout)].map(parseCellKey);

  const bbox = cells.length === 0 ? null : (() => {
    const xs = cells.map((c) => c[0]);
    const ys = cells.map((c) => c[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 };
  })();

  /** @type {Record<string, number>} */
  const mats = {};
  let lapMm = 0;
  for (const piece of layout.pieces) {
    const def = rotatedDef(piece.type, piece.rot);
    for (const [kind, n] of Object.entries(def.mats)) {
      mats[kind] = (mats[kind] ?? 0) + n;
    }
    lapMm += def.centrelineMm;
  }

  return { bbox, matCount: cells.length, mats, lapMm };
}

/** @param {Layout} layout @returns {PortEntry[]} */
export const openPorts = (layout) => matchPorts(layout).open;

/** @param {Cell[]} cells @returns {Cell[]} */
const sortCells = (cells) => [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

// Where a piece of `type`/`rot` must sit so its opposite-facing port meets
// `port`. Returns null if that rotation has no port facing the right way.
/** @param {Port} port @param {PieceType} type @param {Rotation} rot @returns {PlacedPiece | null} */
export function placeAgainst(port, type, rot) {
  const want = OPPOSITE[port.dir];
  const mate = rotatedDef(type, rot).ports.find((p) => p.dir === want);
  if (!mate) return null;

  const [dx, dy] = NEIGHBOUR[port.dir];
  const target = sortCells(port.cells.map(([x, y]) => [x + dx, y + dy]));
  const local = sortCells(mate.cells);

  return {
    type,
    rot,
    x: target[0][0] - local[0][0],
    y: target[0][1] - local[0][1],
  };
}
