import { placedCells, placedPorts, placedWalls } from './geometry.js';

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

const NEIGHBOUR = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

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
