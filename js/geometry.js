// Kyosho Mini-Z Grand Prix Circuit 30 geometry.
// Cells are [col, row] with row increasing downward, matching SVG.
// Rotation is clockwise on screen: 0, 90, 180, 270.

export const MAT_MM = 300;

const DIRS = ['N', 'E', 'S', 'W'];
const CORNERS = ['NE', 'SE', 'SW', 'NW'];

const steps = (rot) => (((rot / 90) % 4) + 4) % 4;

export function rotateDir(dir, rot) {
  return DIRS[(DIRS.indexOf(dir) + steps(rot)) % 4];
}

export function rotateCorner(corner, rot) {
  return CORNERS[(CORNERS.indexOf(corner) + steps(rot)) % 4];
}

// A vertex is a point: (x, y) -> (-y, x) per quarter turn.
export function rotateVertex([x, y], rot) {
  let p = [x, y];
  for (let i = steps(rot); i > 0; i--) p = [-p[1], p[0]];
  return p.map(v => v === 0 ? 0 : v);
}

// A cell is the unit square (x, y)..(x+1, y+1). Rotating those corners
// yields the square indexed (-y-1, x).
export function rotateCell([x, y], rot) {
  let p = [x, y];
  for (let i = steps(rot); i > 0; i--) p = [-p[1] - 1, p[0]];
  return p;
}

const QUARTER_TURN_MM = (Math.PI / 2) * MAT_MM;

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

  cornerR60: {
    label: 'Corner R60',
    cells: [
      [0, 0], [1, 0],
      [0, 1], [1, 1], [2, 1],
      [0, 2], [1, 2], [2, 2],
    ],
    ports: [
      { cells: [[0, 0], [1, 0]], dir: 'N' },
      { cells: [[2, 1], [2, 2]], dir: 'E' },
    ],
    walls: [
      { kind: 'arcLarge', r: 2, cell: [0, 2], corner: 'SW' },
      { kind: 'cap', vertex: [2, 1] },
    ],
    mats: { square: 6, arcLarge: 2 },
    centrelineMm: 2 * QUARTER_TURN_MM,
  },
};

export const PIECE_TYPES = Object.keys(PIECES);
export const ROTATIONS = [0, 90, 180, 270];

const cache = new Map();

// Rotate a definition and translate it so its footprint starts at [0, 0].
export function rotatedDef(type, rot) {
  const key = `${type}:${steps(rot) * 90}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const def = PIECES[type];
  if (!def) throw new Error(`unknown piece type: ${type}`);

  const spun = def.cells.map((c) => rotateCell(c, rot));
  const dx = -Math.min(...spun.map((c) => c[0]));
  const dy = -Math.min(...spun.map((c) => c[1]));
  const shift = ([x, y]) => [x + dx, y + dy];

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

export function placedCells({ type, x, y, rot }) {
  return rotatedDef(type, rot).cells.map(([cx, cy]) => [cx + x, cy + y]);
}

export function placedPorts({ type, x, y, rot }) {
  return rotatedDef(type, rot).ports.map((p) => ({
    cells: p.cells.map(([cx, cy]) => [cx + x, cy + y]),
    dir: p.dir,
  }));
}

export function placedWalls({ type, x, y, rot }) {
  return rotatedDef(type, rot).walls.map((w) =>
    w.kind === 'cap'
      ? { kind: 'cap', vertex: [w.vertex[0] + x, w.vertex[1] + y] }
      : { ...w, cell: [w.cell[0] + x, w.cell[1] + y] },
  );
}
