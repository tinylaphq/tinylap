import { placedCells } from './geometry.js';
import { computeBarriers, computeMetrics, findOverlaps } from './model.js';

/** @import { Corner, Cell, ArcWall, Layout } from './types.js' */
/** @typedef {{ mat: string, matEdge: string, wall: string, bg: string }} Theme */

export const MAT_PX = 24;

/** @type {Record<Corner, (cell: Cell) => Cell>} */
const CORNER_VERTEX = {
  NE: ([cx, cy]) => [cx + 1, cy],
  SE: ([cx, cy]) => [cx + 1, cy + 1],
  SW: ([cx, cy]) => [cx, cy + 1],
  NW: ([cx, cy]) => [cx, cy],
};

// Same step vectors as CORNER_EDGES in model.js.
/** @type {Record<Corner, [Cell, Cell]>} */
const CORNER_STEPS = {
  NE: [[-1, 0], [0, 1]],
  SE: [[-1, 0], [0, -1]],
  SW: [[1, 0], [0, -1]],
  NW: [[1, 0], [0, 1]],
};

// Guards every coordinate interpolated into SVG markup strings. A
// non-finite value is meaningless geometry, not content to sanitise, so
// it is rejected outright rather than escaped.
/** @param {number} value @param {string} label @returns {number} */
function assertFinite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`Invalid ${label}: ${value}`);
  return value;
}

// The region a cut removes: corner vertex -> first endpoint -> along the
// arc -> back to the vertex. Painted in the canvas colour over the mats so
// a cut corner reads as cut. Without this every arc was drawn as a stroke
// lying across an intact square, which is what made the large corner look
// like it was missing a tile rather than swept.
// Corner vertex, endpoints and sweep flag for a wall's arc.
//
// Every arc wall is a convex quarter-round: its centre sits diagonally
// inward from the corner vertex V at V + r*(s1+s2), so it curves AWAY from
// V and meets the two adjoining straight walls tangentially. That holds for
// the R60 inner sweep too (arcLarge): it is centred on the turn's centre,
// concentric with the corridor's centreline. `sweep` picks the arc direction
// from the sign of the cross product of the endpoint radii.
/** @param {ArcWall} wall */
function arcParts(wall) {
  const { r, cell, corner } = wall;
  const v = CORNER_VERTEX[corner](cell);
  const [s1, s2] = CORNER_STEPS[corner];
  const a = [v[0] + s1[0] * r, v[1] + s1[1] * r];
  const b = [v[0] + s2[0] * r, v[1] + s2[1] * r];
  const c = [v[0] + (s1[0] + s2[0]) * r, v[1] + (s1[1] + s2[1]) * r];
  const cross = (a[0] - c[0]) * (b[1] - c[1]) - (a[1] - c[1]) * (b[0] - c[0]);
  return { v, a, b, r, sweep: cross > 0 ? 1 : 0 };
}

/** @param {ArcWall} wall @returns {string} */
export function cutPath(wall) {
  const { v, a, b, r, sweep } = arcParts(wall);
  // Remove the sliver between the corner vertex and the arc.
  return `M ${v[0]} ${v[1]} L ${a[0]} ${a[1]} A ${r} ${r} 0 0 ${sweep} ${b[0]} ${b[1]} Z`;
}

/** @param {ArcWall} wall @returns {string} */
export function arcPath(wall) {
  const { r, cell, corner } = wall;
  const [vx, vy] = CORNER_VERTEX[corner](cell);
  const [s1, s2] = CORNER_STEPS[corner];
  const a = [vx + s1[0] * r, vy + s1[1] * r];
  const b = [vx + s2[0] * r, vy + s2[1] * r];
  const c = [vx + (s1[0] + s2[0]) * r, vy + (s1[1] + s2[1]) * r];
  const cross = (a[0] - c[0]) * (b[1] - c[1]) - (a[1] - c[1]) * (b[0] - c[0]);
  const sweep = cross > 0 ? 1 : 0;
  const ax = assertFinite(a[0], 'arc coordinate');
  const ay = assertFinite(a[1], 'arc coordinate');
  const rr = assertFinite(r, 'arc radius');
  const bx = assertFinite(b[0], 'arc coordinate');
  const by = assertFinite(b[1], 'arc coordinate');
  return `M ${ax} ${ay} A ${rr} ${rr} 0 0 ${sweep} ${bx} ${by}`;
}

/** @param {string} id */
function edgeLine(id) {
  const [axis, x, y] = id.split(':');
  const [ix, iy] = [Number(x), Number(y)];
  return axis === 'H'
    ? { x1: ix, y1: iy, x2: ix + 1, y2: iy }
    : { x1: ix, y1: iy, x2: ix, y2: iy + 1 };
}

/** @param {Layout} layout */
export function layoutGeometry(layout) {
  const { straightEdgeIds, arcs } = computeBarriers(layout);
  const { bbox } = computeMetrics(layout);
  const overlaps = new Set(findOverlaps(layout));

  /** @type {{ x: number, y: number, pieceIndex: number, overlapping: boolean }[]} */
  const mats = [];
  layout.pieces.forEach((piece, index) => {
    for (const cell of placedCells(piece)) {
      mats.push({ x: cell[0], y: cell[1], pieceIndex: index, overlapping: overlaps.has(`${cell[0]},${cell[1]}`) });
    }
  });

  return {
    mats,
    lines: straightEdgeIds.map(edgeLine),
    arcs: arcs.map((w) => ({ d: arcPath(w), kind: w.kind })),
    cuts: arcs.map((w) => cutPath(w)),
    bbox: bbox ?? { x: 0, y: 0, w: 0, h: 0 },
  };
}

// Two palettes. `dark` matches the on-screen canvas and is what the
// standalone export uses. `light` is for thumbnails, which sit on white
// cards in the palette and preset gallery — dark-on-dark reads as mud at
// 3rem, so those invert to palace's dark-on-light.
// dark repeats @tinylap/design's --tl-track-* values; SVG exports cannot read CSS variables.
/** @type {Record<string, Theme>} */
const THEMES = {
  dark:  { mat: '#262626', matEdge: '#3a3a3a', wall: '#ffffff', bg: '#0a0a0a' },
  light: { mat: '#d9d9d9', matEdge: '#bdbdbd', wall: '#0a0a0a', bg: '#f7f7f7' },
};

/** @param {Layout} layout @param {{ pad?: number, theme?: string }} [options] @returns {string} */
export function layoutToSvgString(layout, { pad = 1, theme = 'dark' } = {}) {
  const t = THEMES[theme] ?? THEMES.dark;
  const g = layoutGeometry(layout);
  const vb = [
    assertFinite(g.bbox.x - pad, 'viewBox x'),
    assertFinite(g.bbox.y - pad, 'viewBox y'),
    assertFinite(g.bbox.w + pad * 2, 'viewBox width'),
    assertFinite(g.bbox.h + pad * 2, 'viewBox height'),
  ];
  const mats = g.mats
    .map((m) => `<rect x="${assertFinite(m.x, 'mat x')}" y="${assertFinite(m.y, 'mat y')}" width="1" height="1" fill="${t.mat}" stroke="${t.matEdge}" stroke-width="0.03"/>`)
    .join('');
  const lines = g.lines
    .map((l) => `<line x1="${assertFinite(l.x1, 'line x1')}" y1="${assertFinite(l.y1, 'line y1')}" x2="${assertFinite(l.x2, 'line x2')}" y2="${assertFinite(l.y2, 'line y2')}" stroke="${t.wall}" stroke-width="0.16" stroke-linecap="square"/>`)
    .join('');
  const cuts = g.cuts.map((d) => `<path d="${d}" fill="${t.bg}"/>`).join('');
  const arcs = g.arcs
    .map((a) => `<path d="${a.d}" fill="none" stroke="${t.wall}" stroke-width="0.16" stroke-linecap="square"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${vb[2] * MAT_PX}" height="${vb[3] * MAT_PX}"><rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="${t.bg}"/>${mats}${cuts}${lines}${arcs}</svg>`;
}
