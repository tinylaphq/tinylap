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

// The region a cut removes: corner vertex -> first endpoint -> along the
// arc -> back to the vertex. Painted in the canvas colour over the mats so
// a cut corner reads as cut. Without this every arc was drawn as a stroke
// lying across an intact square, which is what made the large corner look
// like it was missing a tile rather than swept.
// Endpoints, centre and sweep for a wall's arc.
//
// A convex clip (a quarter-round trimming an outer corner) curves AWAY from
// the corner vertex, so its centre sits diagonally inward at V + r*(u1+u2).
// A concave sweep (the inside of a turn, hugging the gap) curves TOWARD the
// vertex, so its centre is V itself. Same two endpoints either way — only
// the centre differs, and with it which of the two possible arcs is drawn.
// Using the convex centre for a concave sweep bulges the barrier outward
// into the track, which is exactly backwards.
function arcParts(wall) {
  const { r, cell, corner, concave = false } = wall;
  const v = CORNER_VERTEX[corner](cell);
  const [s1, s2] = CORNER_STEPS[corner];
  const a = [v[0] + s1[0] * r, v[1] + s1[1] * r];
  const b = [v[0] + s2[0] * r, v[1] + s2[1] * r];
  const c = concave ? v : [v[0] + (s1[0] + s2[0]) * r, v[1] + (s1[1] + s2[1]) * r];
  const cross = (a[0] - c[0]) * (b[1] - c[1]) - (a[1] - c[1]) * (b[0] - c[0]);
  return { v, a, b, r, sweep: cross > 0 ? 1 : 0, far: [v[0] + (s1[0] + s2[0]) * r, v[1] + (s1[1] + s2[1]) * r] };
}

export function cutPath(wall) {
  const { v, a, b, r, sweep, far } = arcParts(wall);
  // Convex: remove the sliver between the corner vertex and the arc.
  // Concave: remove everything from the arc out to the diagonal corner.
  return wall.concave
    ? `M ${a[0]} ${a[1]} A ${r} ${r} 0 0 ${sweep} ${b[0]} ${b[1]} L ${far[0]} ${far[1]} Z`
    : `M ${v[0]} ${v[1]} L ${a[0]} ${a[1]} A ${r} ${r} 0 0 ${sweep} ${b[0]} ${b[1]} Z`;
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
    cuts: arcs.map((w) => cutPath(w)),
    bbox: bbox ?? { x: 0, y: 0, w: 0, h: 0 },
  };
}

// Two palettes. `dark` matches the on-screen canvas and is what the
// standalone export uses. `light` is for thumbnails, which sit on white
// cards in the palette and preset gallery — dark-on-dark reads as mud at
// 3rem, so those invert to palace's dark-on-light.
const THEMES = {
  dark:  { mat: '#262626', matEdge: '#3a3a3a', wall: '#ffffff', bg: '#0a0a0a' },
  light: { mat: '#d9d9d9', matEdge: '#bdbdbd', wall: '#0a0a0a', bg: '#f7f7f7' },
};

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

const SVG_NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

// The visible world is a fixed extent in mats, not a window that snaps to
// the current layout. Deriving the viewBox from the piece bbox meant an
// empty canvas showed 8x8 mats and every placement rescaled the whole
// scene — which also fed back into pointer mapping during a drag.
// A floor on the visible area so an empty canvas still offers somewhere to
// build, and a margin so the layout never touches the edge. The view fits
// the content rather than being a fixed world, but it is only recomputed on
// a real render — dragover touches the ghost layer alone — so it cannot
// rescale under the pointer mid-drag.
export const MIN_VIEW = { w: 14, h: 11 };
const MARGIN = 2;

function worldFor(layout, room) {
  const { bbox } = computeMetrics(layout);
  let x0 = 0, y0 = 0, x1 = MIN_VIEW.w, y1 = MIN_VIEW.h;
  if (bbox) {
    x0 = Math.min(x0, bbox.x - MARGIN);
    y0 = Math.min(y0, bbox.y - MARGIN);
    x1 = Math.max(x1, bbox.x + bbox.w + MARGIN);
    y1 = Math.max(y1, bbox.y + bbox.h + MARGIN);
  }
  if (room) { x1 = Math.max(x1, room.w + MARGIN); y1 = Math.max(y1, room.h + MARGIN); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Layers are created once and then updated in place. Rebuilding the SVG's
// children wholesale is what broke native drag-and-drop: `dragover` fires
// continuously, and replacing the element under the pointer makes Chrome
// fire `dragleave` with a null relatedTarget and abandon the drop target,
// so `drop` never arrives at all.
const LAYERS = ['grid', 'room', 'mats', 'cuts', 'walls', 'handles', 'ghost'];

function layers(svgEl) {
  if (svgEl.dataset.layered !== 'yes') {
    svgEl.replaceChildren(...LAYERS.map((name) => el('g', { class: name })));
    svgEl.dataset.layered = 'yes';
  }
  return Object.fromEntries(LAYERS.map((name) => [name, svgEl.querySelector(`:scope > g.${name}`)]));
}

function drawGrid(layer, world) {
  const want = `${world.x},${world.y},${world.w},${world.h}`;
  if (layer.dataset.world === want) return;   // grid is static; skip the churn
  layer.dataset.world = want;
  layer.replaceChildren();
  for (let x = world.x; x <= world.x + world.w; x++) {
    layer.append(el('line', { x1: x, y1: world.y, x2: x, y2: world.y + world.h, class: 'gridline' }));
  }
  for (let y = world.y; y <= world.y + world.h; y++) {
    layer.append(el('line', { x1: world.x, y1: y, x2: world.x + world.w, y2: y, class: 'gridline' }));
  }
}

// Updates only the ghost layer. The dragover handler calls this instead of
// drawLayout so nothing else in the SVG is touched mid-drag.
export function drawGhost(svgEl, ghost) {
  const layer = layers(svgEl).ghost;
  layer.setAttribute('class', ghost ? `ghost ${ghost.valid ? 'valid' : 'invalid'}` : 'ghost');
  layer.replaceChildren();
  if (!ghost) return;
  for (const [x, y] of ghost.cells) {
    layer.append(el('rect', { x, y, width: 1, height: 1 }));
  }
}

export function drawLayout(svgEl, layout, { room = null, ghost = null, selected = null, handles = false } = {}) {
  const g = layoutGeometry(layout);
  const L = layers(svgEl);
  const world = worldFor(layout, room);

  svgEl.setAttribute('viewBox', `${world.x} ${world.y} ${world.w} ${world.h}`);
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  drawGrid(L.grid, world);

  L.room.replaceChildren();
  if (room) {
    L.room.append(el('rect', { x: 0, y: 0, width: room.w, height: room.h, class: 'room' }));
  }

  L.mats.replaceChildren();
  for (const m of g.mats) {
    const classes = ['mat'];
    if (m.overlapping) classes.push('overlap');
    if (m.pieceIndex === selected) classes.push('selected');
    L.mats.append(el('rect', {
      x: m.x, y: m.y, width: 1, height: 1,
      class: classes.join(' '),
      'data-piece': m.pieceIndex,
    }));
  }

  L.cuts.replaceChildren();
  for (const d of g.cuts) L.cuts.append(el('path', { d, class: 'cut' }));

  L.walls.replaceChildren();
  for (const l of g.lines) L.walls.append(el('line', { ...l, class: 'wall' }));
  for (const a of g.arcs) L.walls.append(el('path', { d: a.d, class: 'wall' }));

  L.handles.replaceChildren();
  if (handles) {
    openPorts(layout).forEach(({ port }) => {
      const [dx, dy] = { N: [0, -0.5], S: [0, 0.5], E: [0.5, 0], W: [-0.5, 0] }[port.dir];
      const cx = (port.cells[0][0] + port.cells[1][0]) / 2 + 0.5 + dx;
      const cy = (port.cells[0][1] + port.cells[1][1]) / 2 + 0.5 + dy;
      // Keyed by portKey (its edge ids), not array index: a stable string
      // key avoids depending on array order between render and pointerdown.
      L.handles.append(el('circle', { cx, cy, r: 0.22, class: 'port-handle', 'data-port': portKey(port) }));
    });
  }

  drawGhost(svgEl, ghost);
}

export { MAT_MM };
