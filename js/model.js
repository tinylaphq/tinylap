import { placedCells, placedPorts } from './geometry.js';

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
