import {
  computeMetrics, openPorts, portKey, layoutGeometry,
} from '@tinylap/track-format';

export { layoutToSvgString, MAT_MM } from '@tinylap/track-format';

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
// the content rather than being a fixed world.
//
// That makes it a feedback loop during a pointer drag, which this comment
// used to deny: the palette's dragover only touches the ghost layer, true,
// but the move-drag and the port-handle run both call render() on every
// pointermove. Dragging a piece outward grows the bbox, which widens the
// view, which shrinks pixels-per-mat, which maps the same cursor position
// to a further-out cell, which widens the view again. Measured before the
// fix: a cursor moved 20 mats sent the piece 265 and the view from 16x13
// to 271x76. Hence `freezeWorld` — callers hold the view still for the
// duration of a drag.
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
const LAYERS = ['grid', 'room', 'mats', 'cuts', 'walls', 'handles', 'ghost', 'marquee'];

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

// Updates only the marquee layer, like drawGhost — the rubber-band band
// changes on every pointermove and must not drag a full repaint with it.
// `band` is world-coordinate {x, y, w, h}, or null to clear.
export function drawMarquee(svgEl, band) {
  const layer = layers(svgEl).marquee;
  layer.replaceChildren();
  if (!band) return;
  layer.append(el('rect', { x: band.x, y: band.y, width: band.w, height: band.h, class: 'marquee-band' }));
}

// `selected` takes an index, an array of them, or null — the canvas passes
// a list now that more than one piece can be selected at a time, while
// thumbnail callers pass nothing.
export function drawLayout(svgEl, layout, { room = null, ghost = null, selected = null, handles = false, freezeWorld = false } = {}) {
  const selectedSet = selected === null
    ? null
    : new Set(Array.isArray(selected) ? selected : [selected]);
  const g = layoutGeometry(layout);
  const L = layers(svgEl);
  // Keep the view exactly as it is while a drag is in flight, so the
  // mapping from cursor to cell cannot move under the pointer.
  const held = freezeWorld && svgEl.getAttribute('viewBox');
  const world = held
    ? (([x, y, w, h]) => ({ x, y, w, h }))(held.split(/\s+/).map(Number))
    : worldFor(layout, room);

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
    if (selectedSet?.has(m.pieceIndex)) classes.push('selected');
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
