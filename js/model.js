import { placedCells, placedPorts, placedWalls, rotatedDef } from './geometry.js';

export function createLayout(overrides = {}) {
  return { version: 1, unit: 'mat', room: null, pieces: [], ...overrides };
}

export const cellKey = ([x, y]) => `${x},${y}`;
export const parseCellKey = (k) => k.split(',').map(Number);

export function occupancy(layout) {
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

export function occupiedSet(layout) {
  return new Set(occupancy(layout).keys());
}

export function findOverlaps(layout) {
  return [...occupancy(layout)]
    .filter(([, owners]) => owners.length > 1)
    .map(([key]) => key);
}

export function edgeId([x, y], dir) {
  switch (dir) {
    case 'N': return `H:${x}:${y}`;
    case 'S': return `H:${x}:${y + 1}`;
    case 'W': return `V:${x}:${y}`;
    case 'E': return `V:${x + 1}:${y}`;
    default: throw new Error(`bad direction: ${dir}`);
  }
}

export const portEdgeIds = (port) => port.cells.map((c) => edgeId(c, port.dir));
export const portKey = (port) => portEdgeIds(port).slice().sort().join('|');

const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

export function matchPorts(layout) {
  const byKey = new Map();
  layout.pieces.forEach((piece, pieceIndex) => {
    for (const port of placedPorts(piece)) {
      const key = portKey(port);
      const bucket = byKey.get(key);
      if (bucket) bucket.push({ pieceIndex, port });
      else byKey.set(key, [{ pieceIndex, port }]);
    }
  });

  const matched = new Set();
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
export function openEdgeIds(layout) {
  const ids = new Set();
  for (const { port } of matchPorts(layout).open) {
    for (const id of portEdgeIds(port)) ids.add(id);
  }
  return ids;
}

export function isClosedCircuit(layout) {
  if (layout.pieces.length === 0) return false;
  if (findOverlaps(layout).length > 0) return false;
  if (matchPorts(layout).open.length > 0) return false;
  return isSingleComponent(layout);
}

function isSingleComponent(layout) {
  const cells = occupiedSet(layout);
  const first = cells.values().next().value;
  if (!first) return false;
  const seen = new Set([first]);
  const queue = [parseCellKey(first)];
  while (queue.length > 0) {
    const [x, y] = queue.pop();
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

export const NEIGHBOUR = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

// For each corner, the two edges meeting there and the direction each
// one runs as you walk away from the corner.
const CORNER_EDGES = {
  NE: [['N', [-1, 0]], ['E', [0, 1]]],
  SE: [['S', [-1, 0]], ['E', [0, -1]]],
  SW: [['S', [1, 0]], ['W', [0, -1]]],
  NW: [['N', [1, 0]], ['W', [0, 1]]],
};

export function boundaryEdges(layout) {
  const cells = occupiedSet(layout);
  const open = openEdgeIds(layout);
  const edges = new Set();
  for (const key of cells) {
    const [x, y] = parseCellKey(key);
    for (const dir of ['N', 'E', 'S', 'W']) {
      const [dx, dy] = NEIGHBOUR[dir];
      if (cells.has(cellKey([x + dx, y + dy]))) continue;
      const id = edgeId([x, y], dir);
      if (open.has(id)) continue;
      edges.add(id);
    }
  }
  return edges;
}

// Shared setup for enclosedInfields and maxTrackDepth: flood-fill the empty
// complement of the occupied cells outward from a corner of a one-cell
// margin around the bounding box. Everything the flood reaches is "outside"
// — connected to the open edge of the layout; everything empty it never
// reaches is boxed in by occupied cells on every side. Returns null for an
// empty layout (nothing to flood).
function floodOutsideMargin(layout) {
  const cells = occupiedSet(layout);
  if (cells.size === 0) return null;

  const points = [...cells].map(parseCellKey);
  const minX = Math.min(...points.map(([x]) => x)) - 1;
  const maxX = Math.max(...points.map(([x]) => x)) + 1;
  const minY = Math.min(...points.map(([, y]) => y)) - 1;
  const maxY = Math.max(...points.map(([, y]) => y)) + 1;
  const inBounds = ([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  const emptyNeighbours = ([x, y]) =>
    Object.values(NEIGHBOUR)
      .map(([dx, dy]) => [x + dx, y + dy])
      .filter((n) => inBounds(n) && !cells.has(cellKey(n)));

  // Flood outward from a corner of the margin — guaranteed empty, and
  // guaranteed connected to every other margin cell round the outside.
  const outside = new Set([cellKey([minX, minY])]);
  const queue = [[minX, minY]];
  while (queue.length > 0) {
    const cell = queue.pop();
    for (const n of emptyNeighbours(cell)) {
      const key = cellKey(n);
      if (outside.has(key)) continue;
      outside.add(key);
      queue.push(n);
    }
  }

  return { cells, minX, maxX, minY, maxY, outside, emptyNeighbours };
}

// How many separate enclosed empty regions the occupied cells surround.
// Port-closed and overlap-free is not enough to be a real track: a solid
// block of mats with a wall round the outside satisfies both while
// enclosing nothing to drive around. Every empty region floodOutsideMargin's
// flood never reaches is cut off by the occupied cells on all sides, i.e.
// an enclosed infield.
export function enclosedInfields(layout) {
  const flood = floodOutsideMargin(layout);
  if (!flood) return 0;
  const { cells, minX, maxX, minY, maxY, outside, emptyNeighbours } = flood;

  // Count connected components among the empty cells the outside flood
  // never reached — each one is a distinct region walled off on every side.
  const visited = new Set();
  let infields = 0;
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const key = cellKey([x, y]);
      if (cells.has(key) || outside.has(key) || visited.has(key)) continue;
      infields += 1;
      visited.add(key);
      const componentQueue = [[x, y]];
      while (componentQueue.length > 0) {
        const cell = componentQueue.pop();
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
export function unjoinedContacts(layout) {
  const occ = occupancy(layout);
  const { matched } = matchPorts(layout);
  const legit = new Set();
  layout.pieces.forEach((piece) => {
    for (const port of placedPorts(piece)) {
      if (!matched.has(portKey(port))) continue;
      for (const id of portEdgeIds(port)) legit.add(id);
    }
  });

  const contacts = new Set();
  for (const [key, owners] of occ) {
    const [x, y] = parseCellKey(key);
    for (const dir of ['N', 'E', 'S', 'W']) {
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
export function maxTrackDepth(layout) {
  const flood = floodOutsideMargin(layout);
  if (!flood) return 0;
  const { cells, minX, maxX, minY, maxY, outside } = flood;

  // R = every cell in the margined bounding box that the outside flood
  // never reached, i.e. occupied cells plus enclosed infield cells.
  const R = new Set();
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const key = cellKey([x, y]);
      if (!outside.has(key)) R.add(key);
    }
  }

  // Multi-source BFS inward, over the 8-neighbourhood, starting from every
  // cell of R that touches a non-R cell (depth 1).
  const depth = new Map();
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
    const d = depth.get(key);
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

export function arcEdgeIds(wall) {
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
function isConcaveVertex(cells, [vx, vy]) {
  const around = [[vx - 1, vy - 1], [vx, vy - 1], [vx - 1, vy], [vx, vy]];
  return around.filter((c) => cells.has(cellKey(c))).length === 3;
}

export function computeBarriers(layout) {
  const edges = boundaryEdges(layout);
  const cells = occupiedSet(layout);
  const counts = { straight: 0, curve: 0, curveLarge: 0, cornerCap: 0 };
  const arcs = [];

  for (const piece of layout.pieces) {
    for (const wall of placedWalls(piece)) {
      if (wall.kind === 'cap') {
        if (isConcaveVertex(cells, wall.vertex)) counts.cornerCap += 1;
        continue;
      }
      const claimed = arcEdgeIds(wall);
      if (!claimed.every((id) => edges.has(id))) continue;
      for (const id of claimed) edges.delete(id);
      if (wall.kind === 'arc') counts.curve += 1;
      else counts.curveLarge += 2;
      arcs.push(wall);
    }
  }

  counts.straight = edges.size;
  return { counts, straightEdgeIds: [...edges], arcs };
}

export function computeMetrics(layout) {
  const cells = [...occupiedSet(layout)].map(parseCellKey);

  const bbox = cells.length === 0 ? null : (() => {
    const xs = cells.map((c) => c[0]);
    const ys = cells.map((c) => c[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 };
  })();

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

export const openPorts = (layout) => matchPorts(layout).open;

const sortCells = (cells) => [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

// Where a piece of `type`/`rot` must sit so its opposite-facing port meets
// `port`. Returns null if that rotation has no port facing the right way.
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
