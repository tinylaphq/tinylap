import { placedCells, MAT_MM } from './geometry.js';
import { computeBarriers, computeMetrics, findOverlaps, openPorts, portKey } from './model.js';

export const MAT_PX = 24;

const CORNER_VERTEX = {
  NE: ([cx, cy]) => [cx + 1, cy],
  SE: ([cx, cy]) => [cx + 1, cy + 1],
  SW: ([cx, cy]) => [cx, cy + 1],
  NW: ([cx, cy]) => [cx, cy],
};

// Same step vectors as CORNER_EDGES in model.js.
const CORNER_STEPS = {
  NE: [[-1, 0], [0, 1]],
  SE: [[-1, 0], [0, -1]],
  SW: [[1, 0], [0, -1]],
  NW: [[1, 0], [0, 1]],
};

// Guards every coordinate interpolated into SVG markup strings. A
// non-finite value is meaningless geometry, not content to sanitise, so
// it is rejected outright rather than escaped.
function assertFinite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`Invalid ${label}: ${value}`);
  return value;
}

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

function edgeLine(id) {
  const [axis, x, y] = id.split(':');
  const [ix, iy] = [Number(x), Number(y)];
  return axis === 'H'
    ? { x1: ix, y1: iy, x2: ix + 1, y2: iy }
    : { x1: ix, y1: iy, x2: ix, y2: iy + 1 };
}

export function layoutGeometry(layout) {
  const { straightEdgeIds, arcs } = computeBarriers(layout);
  const { bbox } = computeMetrics(layout);
  const overlaps = new Set(findOverlaps(layout));

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
    bbox: bbox ?? { x: 0, y: 0, w: 0, h: 0 },
  };
}

export function layoutToSvgString(layout, { pad = 1 } = {}) {
  const g = layoutGeometry(layout);
  const vb = [g.bbox.x - pad, g.bbox.y - pad, g.bbox.w + pad * 2, g.bbox.h + pad * 2]
    .map((n) => assertFinite(n, 'viewBox component'));
  const mats = g.mats
    .map((m) => `<rect x="${assertFinite(m.x, 'mat x')}" y="${assertFinite(m.y, 'mat y')}" width="1" height="1" fill="#2b2b2b" stroke="#3d3d3d" stroke-width="0.02"/>`)
    .join('');
  const lines = g.lines
    .map((l) => `<line x1="${assertFinite(l.x1, 'line x1')}" y1="${assertFinite(l.y1, 'line y1')}" x2="${assertFinite(l.x2, 'line x2')}" y2="${assertFinite(l.y2, 'line y2')}" stroke="#f2f2f2" stroke-width="0.12" stroke-linecap="round"/>`)
    .join('');
  const arcs = g.arcs
    .map((a) => `<path d="${a.d}" fill="none" stroke="#f2f2f2" stroke-width="0.12" stroke-linecap="round"/>`)
    .join('');
  const width = assertFinite(vb[2] * MAT_PX, 'width');
  const height = assertFinite(vb[3] * MAT_PX, 'height');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${width}" height="${height}">${mats}${lines}${arcs}</svg>`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

export function drawLayout(svgEl, layout, { room = null, ghost = null, selected = null, handles = false } = {}) {
  const g = layoutGeometry(layout);
  svgEl.replaceChildren();

  const pad = 4;
  const w = Math.max(g.bbox.w, room?.w ?? 0) + pad * 2;
  const h = Math.max(g.bbox.h, room?.h ?? 0) + pad * 2;
  svgEl.setAttribute('viewBox', `${g.bbox.x - pad} ${g.bbox.y - pad} ${w} ${h}`);

  const grid = el('g', { class: 'grid' });
  for (let x = Math.floor(g.bbox.x - pad); x <= g.bbox.x + w; x++) {
    grid.append(el('line', { x1: x, y1: g.bbox.y - pad, x2: x, y2: g.bbox.y + h, class: 'gridline' }));
  }
  for (let y = Math.floor(g.bbox.y - pad); y <= g.bbox.y + h; y++) {
    grid.append(el('line', { x1: g.bbox.x - pad, y1: y, x2: g.bbox.x + w, y2: y, class: 'gridline' }));
  }
  svgEl.append(grid);

  if (room) {
    svgEl.append(el('rect', { x: 0, y: 0, width: room.w, height: room.h, class: 'room' }));
  }

  const matsG = el('g', { class: 'mats' });
  for (const m of g.mats) {
    const classes = ['mat'];
    if (m.overlapping) classes.push('overlap');
    if (m.pieceIndex === selected) classes.push('selected');
    matsG.append(el('rect', {
      x: m.x, y: m.y, width: 1, height: 1,
      class: classes.join(' '),
      'data-piece': m.pieceIndex,
    }));
  }
  svgEl.append(matsG);

  const wallsG = el('g', { class: 'walls' });
  for (const l of g.lines) wallsG.append(el('line', { ...l, class: 'wall' }));
  for (const a of g.arcs) wallsG.append(el('path', { d: a.d, class: 'wall' }));
  svgEl.append(wallsG);

  if (handles) {
    const handlesG = el('g', { class: 'handles' });
    openPorts(layout).forEach(({ port }) => {
      const [dx, dy] = { N: [0, -0.5], S: [0, 0.5], E: [0.5, 0], W: [-0.5, 0] }[port.dir];
      const cx = (port.cells[0][0] + port.cells[1][0]) / 2 + 0.5 + dx;
      const cy = (port.cells[0][1] + port.cells[1][1]) / 2 + 0.5 + dy;
      // Keyed by portKey (its edge ids), not array index: openPorts' order
      // is deterministic within one call, but keying by index would still
      // require the array not to be re-sorted between render and
      // pointerdown, which a stable string key avoids depending on at all.
      handlesG.append(el('circle', { cx, cy, r: 0.22, class: 'port-handle', 'data-port': portKey(port) }));
    });
    svgEl.append(handlesG);
  }

  if (ghost) {
    const ghostG = el('g', { class: ghost.valid ? 'ghost valid' : 'ghost invalid' });
    for (const [x, y] of ghost.cells) {
      ghostG.append(el('rect', { x, y, width: 1, height: 1 }));
    }
    svgEl.append(ghostG);
  }
}

export { MAT_MM };
