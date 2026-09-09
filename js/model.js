import { placedCells } from './geometry.js';

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
