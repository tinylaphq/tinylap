import { createLayout, occupiedSet, cellKey, openPorts, placeAgainst, portKey, matchPorts, computeMetrics, isClosedCircuit, findOverlaps, NEIGHBOUR } from './model.js';
import { drawLayout, drawGhost, drawMarquee, layoutToSvgString } from './render.js';
import { PIECES, MAT_MM, placedCells, placedPorts } from './geometry.js';
import { billOfMaterials, diffStock, stockFromKits, recommendKit, KITS } from './inventory.js';
import { exportHtml, importHtml } from './storage.js';
import { PRESETS } from './presets.js';
import { loadKits, saveKits } from './kits-store.js';
import { generateLayouts, groupByCharacter, outOfReach, outlineName, hasCachedLayouts, scoreLayouts } from './generate.js';

const canvas = document.querySelector('#canvas');

// Each piece is defined at whatever rotation suited its geometry, and those
// disagree: cornerR30 opens north+east at rot 0, cornerR60 north+west. Shown
// that way the palette looks arbitrary, and the two corners land facing
// different directions when placed. Both are presented and placed opening
// right and down, and the straight west-east, so the palette reads as one
// set: a straight and a corner shown side by side share an opening, which
// is how they will actually meet on the canvas.
const DEFAULT_ROT = { straight: 90, cornerR30: 90, cornerR60: 180 };
const defaultRot = (type) => DEFAULT_ROT[type] ?? 0;

const state = {
  layout: createLayout(),
  kits: loadKits(localStorage),
  tool: null,     // { type, rot }
  ghost: null,    // { cells, valid }
  hoverCell: null, // [x, y] last cell hovered while dragging
  history: [],
  selection: [], // indices into layout.pieces; empty when nothing is selected
  dragging: false, // true while a piece move-drag or port-handle drag is in flight
  lastPlaced: null, // { type, x, y, rot } of the most recently placed piece
  pending: null,    // { type, x, y, rot } the auto-advance ghost would place on Space/Enter
  error: null,      // C1: message from the last failed operation (e.g. a bad
                     // file open) that renderStatus prefers over its normal
                     // text — never written into #status directly, since
                     // render() owns that field and repaints it on every call.
};

// Derived from generateLayouts(stockFromKits(state.kits)) every time the
// presets dialog opens — never persisted (see storage.js: only version,
// unit, room, pieces round-trip). `pool` is round-robined across characters
// so paging shows spread, not five near-identical rectangles; `cursor`
// advances by 5 with wraparound rather than reshuffling, so repeats never
// show until the whole pool has been seen once.
state.suggestions = { pool: [], cursor: 0, stopped: false };

function renderPalette() {
  const list = document.querySelector('#palette-list');
  list.replaceChildren(...Object.entries(PIECES).map(([type, def]) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.type = type;
    const thumb = document.createElement('span');
    thumb.className = 'piece-thumb';
    try {
      thumb.innerHTML = layoutToSvgString(createLayout({ pieces: [{ type, x: 0, y: 0, rot: defaultRot(type) }] }), { pad: 0.35, theme: 'light' });
    } catch (error) {
      console.error(`piece thumbnail failed for ${type}`, error);
    }
    const name = document.createElement('span');
    name.className = 'piece-name';
    name.textContent = def.label;
    li.append(thumb, name);
    return li;
  }));
}

const metres = (mats) => ((mats * MAT_MM) / 1000).toFixed(2);

// Renders the materials panel: owned-vs-used per part (red when short) and
// the kit recommendation, plus the size/lap/mat-count readouts. Reads only
// from state.layout and state.kits — never mutates either, so it is safe
// to call from render() on every commit.
function renderBom() {
  const bom = billOfMaterials(state.layout);
  const rows = diffStock(bom, stockFromKits(state.kits)).filter((r) => r.used > 0 || r.owned > 0);

  document.querySelector('#bom-table tbody').replaceChildren(...rows.map((r) => {
    const tr = document.createElement('tr');
    if (r.short > 0) tr.className = 'short';
    tr.innerHTML = `<th scope="row">${r.label}</th><td>${r.owned}</td><td>${r.used}</td>`;
    return tr;
  }));

  // I2: computeBarriers/computeMetrics both sum per-piece declarations, so
  // an overlapping layout's figures are simply wrong (not just "unusual") —
  // two overlapping straights report matCount 3 but mats.square 4. Flag it
  // rather than presenting numbers known to be off.
  const overlapCount = findOverlaps(state.layout).length;
  const warning = document.querySelector('#bom-warning');
  warning.textContent = overlapCount > 0
    ? `${overlapCount} overlapping mat${overlapCount === 1 ? '' : 's'} — these figures are unreliable until the overlap is fixed.`
    : '';
  warning.hidden = overlapCount === 0;

  // I3: recommendKit returns null both when nothing is short AND when
  // something is short but no single kit clears it — those are opposite
  // messages, so branch on the shortfall first rather than trusting null
  // to mean "you're fine".
  const short = rows.some((r) => r.short > 0);
  const kit = short ? recommendKit(rows) : null;
  const rec = document.querySelector('#recommendation');
  // Nothing placed yet means nothing to be short of, so "everything you need
  // is in stock" is true but says nothing — and it contradicts the canvas,
  // which is telling the user the layout is empty. Say nothing instead.
  rec.hidden = state.layout.pieces.length === 0;
  rec.textContent = !short
    ? 'Everything you need is in stock.'
    : kit
      ? `Short on pieces — ${kit.name} (${kit.id}) covers it.`
      : 'Short on pieces — no single kit covers it.';
  rec.className = `status ${!short ? 'status-success' : kit ? 'status-info' : 'status-warning'}`;

  const { bbox, matCount, lapMm } = computeMetrics(state.layout);
  document.querySelector('#out-size').textContent = bbox ? `${metres(bbox.w)} × ${metres(bbox.h)}` : '—';
  document.querySelector('#out-lap').textContent = lapMm ? `${(lapMm / 1000).toFixed(2)} m` : '—';
  document.querySelector('#out-mats').textContent = String(matCount);
}

// Renders the status line: error / overlap / empty / open-ends /
// closed-circuit, in that preference order. Reads only from state.layout
// and state.error — never mutates either or calls render() itself.
function renderStatus() {
  const status = document.querySelector('#status');
  // C1: an error from the last failed operation takes priority over the
  // normal status text — render() calls this on every commit and on plenty
  // of non-mutating interactions too (e.g. a click on empty canvas), so if
  // the error were ever written into #status directly it would be erased
  // by the very next repaint.
  if (state.error) {
    status.textContent = state.error;
    status.className = 'status status-error';
    return;
  }
  // I2: an overlapping layout is invalid, not merely "has open ends" — say
  // so plainly rather than falling through to a possibly-zero open-end
  // count that reads as if the layout were fine.
  const overlapCount = findOverlaps(state.layout).length;
  if (overlapCount > 0) {
    status.textContent = `${overlapCount} overlapping mat${overlapCount === 1 ? '' : 's'} — layout invalid`;
    status.className = 'status status-error';
    return;
  }
  const open = openPorts(state.layout).length;
  const closed = isClosedCircuit(state.layout);
  status.textContent =
    state.layout.pieces.length === 0 ? 'Empty — drag a piece from the left'
    : closed ? 'Closed circuit'
    : `${open} open end${open === 1 ? '' : 's'}`;
  status.className = `status ${closed ? 'status-success' : ''}`.trim();
}

export function render() {
  drawLayout(canvas, state.layout, {
    room: state.layout.room,
    ghost: state.ghost,
    selected: state.selection,
    handles: true,
  });
  renderBom();
  renderStatus();
}

// The legend hard-codes the Mac modifier; correct it elsewhere.
if (!/Mac|iP(hone|ad)/.test(navigator.platform)) {
  for (const k of document.querySelectorAll('#shortcuts kbd')) {
    if (k.textContent === '\u2318') k.textContent = 'Ctrl';
  }
}

renderPalette();
render();

export function commit(mutate) {
  state.history.push(structuredClone(state.layout));
  mutate(state.layout);
  // Any successful mutation supersedes a stale error from a previous failed
  // operation (C1) — but rendering alone (e.g. a click that only changes
  // selection) must not clear it, or the feedback disappears before the
  // user can read it.
  state.error = null;
  render();
}

export function pointerCell(event) {
  const pt = new DOMPoint(event.clientX, event.clientY)
    .matrixTransform(canvas.getScreenCTM().inverse());
  return [Math.floor(pt.x), Math.floor(pt.y)];
}

// pointerCell floors to a whole mat; the marquee needs the exact point so
// the band tracks the cursor instead of snapping.
function pointerWorld(event) {
  const pt = new DOMPoint(event.clientX, event.clientY)
    .matrixTransform(canvas.getScreenCTM().inverse());
  return [pt.x, pt.y];
}

const OPPOSITE_DIR = { N: 'S', S: 'N', E: 'W', W: 'E' };

// Which way round this piece wants to go at [x, y]: the rotation that joins
// the most open ends without overlapping anything. Ties keep `preferred`,
// so the ghost does not spin under the cursor when nothing is nearby to
// connect to, and the piece lands the way the palette showed it.
function bestRotAt(type, cell, preferred) {
  const open = new Map();
  for (const { port } of openPorts(state.layout)) open.set(portKey(port), port.dir);
  if (open.size === 0) return preferred;

  const taken = occupiedSet(state.layout);
  let best = preferred;
  let bestScore = -1;
  // preferred first, so an equal score never displaces it
  for (const rot of [preferred, ...[0, 90, 180, 270].filter((r) => r !== preferred)]) {
    const piece = { type, x: cell[0], y: cell[1], rot };
    if (placedCells(piece).some((c) => taken.has(cellKey(c)))) continue;
    const joins = placedPorts(piece)
      .filter((p) => open.get(portKey(p)) === OPPOSITE_DIR[p.dir]).length;
    if (joins > bestScore) { bestScore = joins; best = rot; }
  }
  return bestScore > 0 ? best : preferred;
}

function ghostFor(type, rot, [x, y]) {
  const cells = placedCells({ type, x, y, rot });
  const taken = occupiedSet(state.layout);
  return { cells, valid: !cells.some((c) => taken.has(cellKey(c))) };
}

// Auto-advance: after any placement, ghost the same piece again at the open
// port left at its far end, so a run of identical pieces chains with
// Space/Enter alone. Clears both state.pending and state.ghost together on
// every "can't continue" branch so the two never disagree with each other.
// Every piece-and-rotation that could sit where the selected one sits, in
// a stable order, so the keys can walk them.
//
// C walks the TYPES in this list (one entry per type) and R walks the
// ROTATIONS of the current type. Keeping them separate matters: an earlier
// version had C step through both corner directions, which made changing
// the piece and changing its direction the same gesture and read as a bug.
//
// The anchor is the join this piece already has: the neighbouring port it
// is matched to. Swapping a straight for a corner keeps that join and
// swings the rest of the piece around it, which is what "convert the last
// tile I laid into a corner" means — replacing it in place at the same
// x/y would leave the corner hanging off the chain.
//
// Rotations are enumerated too, not just types: from one incoming port a
// corner can turn either way, and those are genuinely different choices
// the cycle should offer. placeAgainst returns null for a rotation with no
// port facing the anchor, which filters the impossible ones for free.
function anchoredCandidates(index) {
  const piece = state.layout.pieces[index];
  const others = state.layout.pieces.filter((_, i) => i !== index);
  const taken = occupiedSet(createLayout({ pieces: others }));

  const { matched } = matchPorts(state.layout);
  const mine = new Set(placedPorts(piece).map(portKey));
  let anchor = null;
  for (const other of others) {
    for (const port of placedPorts(other)) {
      const key = portKey(port);
      if (mine.has(key) && matched.has(key)) { anchor = port; break; }
    }
    if (anchor) break;
  }

  const seen = new Set();
  const candidates = [];
  for (const type of Object.keys(PIECES)) {
    for (const rot of [0, 90, 180, 270]) {
      // Unanchored (a piece joined to nothing): swap in place instead.
      const cand = anchor
        ? placeAgainst(anchor, type, rot)
        : { type, rot, x: piece.x, y: piece.y };
      if (!cand) continue;
      if (placedCells(cand).some((c) => taken.has(cellKey(c)))) continue;
      // Identity is the cells it fills plus the ports it offers — not the
      // rotation number. A straight at 0 and at 180 fills the same cells
      // and opens the same two ends, so it is one option, not two; a
      // corner at 0 and at 180 opens different ends, so it is two.
      const key = cand.type
        + '|' + placedCells(cand).map(cellKey).sort().join(',')
        + '|' + placedPorts(cand).map(portKey).sort().join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(cand);
    }
  }
  return candidates;
}

// `nextType` overrides what gets armed: the conversion path uses it to go
// back to a straight after turning a corner, because straights are the
// default the mouse lays and a corner is a deliberate one-off.
function advanceGhost(nextType = null) {
  const last = state.lastPlaced;
  if (!last) { state.pending = null; state.ghost = null; return; }
  armGhostFrom(state.layout.pieces.length - 1, nextType ?? last.type, nextType ? null : last.rot);
}

// Queue the next piece off `index`'s open end. Split out of advanceGhost so
// it can arm from the SELECTED piece and not only the last placed one:
// clicking used to clear the queue outright, which left Space working only
// until the first click — in practice, not at all.
function armGhostFrom(index, type, rot = null) {
  const stillOpen = openPorts(state.layout).filter((o) => o.pieceIndex === index);
  // Deliberate tie-break, inherited from the brief: when a piece has two
  // still-open ports (e.g. it was placed in open space, not against
  // anything), pick the last one in port-definition order rather than the
  // first — for `straight` that's S over N, i.e. "continue forward", not
  // "double back". Not proven for every piece type, just the working rule.
  const forward = stillOpen.at(-1);
  if (!forward) { state.pending = null; state.ghost = null; return; }
  // Without a rotation to inherit, the previous piece's is meaningless — a
  // straight following a corner needs whichever rotation actually meets
  // that port, so try them all and take the first that fits.
  const rots = rot === null ? [0, 90, 180, 270] : [rot];
  let next = null;
  for (const rot of rots) {
    const candidate = placeAgainst(forward.port, type, rot);
    if (candidate) { next = candidate; break; }
  }
  if (!next) { state.pending = null; state.ghost = null; return; }
  state.pending = next;
  state.ghost = ghostFor(next.type, next.rot, [next.x, next.y]);
}

document.querySelector('#palette-list').addEventListener('dragstart', (e) => {
  const type = e.target.dataset.type;
  if (!type) return;
  state.tool = { type, rot: defaultRot(type), turned: false };
  // A new palette drag supersedes any armed auto-advance pending: dragover
  // is about to start overwriting state.ghost with the tool preview, and
  // the invariant is state.pending is non-null only when state.ghost shows
  // exactly that pending piece — once the ghost stops showing it, pending
  // must stop pointing at it too.
  state.pending = null;
  e.dataTransfer.setData('text/plain', type);
  e.dataTransfer.effectAllowed = 'copy';
});

document.querySelector('#palette-list').addEventListener('dragend', () => {
  state.tool = null;
  state.hoverCell = null;
  // Correction 4: dragend always fires after drop, whether or not drop
  // committed a piece. drop's success path calls advanceGhost() to arm a
  // pending auto-advance ghost — if dragend unconditionally nulled
  // state.ghost here, it would wipe that ghost out a moment after
  // advanceGhost set it, and auto-advance would silently never show
  // anything. So dragend only clears the ghost when there is nothing
  // pending for it to preserve.
  if (!state.pending) state.ghost = null;
  render();
});

// A drop target must cancel dragenter as well as dragover. Without this
// Chrome re-evaluates the target every time hit-testing moves between the
// SVG's children and can end the drag without ever firing `drop`.
canvas.addEventListener('dragenter', (e) => {
  if (!state.tool) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

canvas.addEventListener('dragover', (e) => {
  if (!state.tool) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  state.hoverCell = pointerCell(e);
  // Guess the orientation that connects, unless R has been pressed during
  // this drag — once the user has turned it themselves, stop overriding.
  if (!state.tool.turned) {
    state.tool.rot = bestRotAt(state.tool.type, state.hoverCell, state.tool.rot);
  }
  state.ghost = ghostFor(state.tool.type, state.tool.rot, state.hoverCell);
  // Only the ghost layer is touched. Calling drawLayout here rebuilt every
  // child of the SVG on each dragover, destroying the element under the
  // pointer — Chrome then fired dragleave with a null relatedTarget and
  // abandoned the drag, so `drop` never fired and nothing happened.
  drawGhost(canvas, state.ghost);
});

canvas.addEventListener('dragleave', (e) => {
  if (canvas.contains(e.relatedTarget)) return;
  // relatedTarget is null both when the pointer leaves the window and when
  // the node under it was removed mid-drag. Confirm against the actual
  // geometry rather than trusting the null.
  const r = canvas.getBoundingClientRect();
  if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return;
  state.ghost = null;
  state.hoverCell = null;
  render();
});

canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!state.tool || !state.ghost?.valid || !state.hoverCell) {
    state.tool = null;
    state.ghost = null;
    state.hoverCell = null;
    // Belt-and-suspenders with the dragstart clear above: whatever cleared
    // ghost here must also clear pending, or Space could place a piece
    // whose ghost was never shown for this failed drop.
    state.pending = null;
    render();
    return;
  }
  const [x, y] = state.hoverCell;
  const { type, rot } = state.tool;
  commit((l) => l.pieces.push({ type, x, y, rot }));
  state.tool = null;
  state.hoverCell = null;
  state.lastPlaced = { type, rot, x, y };
  // Select what you just placed, so R rotates it and Delete removes it
  // without having to click it first. The piece just pushed is the last one.
  state.selection = [state.layout.pieces.length - 1];
  // As in the Space/Enter handler: advanceGhost() runs after commit()'s own
  // render(), so this trailing render() is what actually shows the newly
  // armed ghost — not a redundant second paint of the same state.
  advanceGhost();
  render();
});

canvas.addEventListener('pointerdown', (e) => {
  // Task 13 adds open-port drag handles with their own pointerdown listener
  // on this same element; a click there must not fall through to selection.
  if (e.target.closest('.port-handle')) return;

  // Clear the queued piece before re-deciding. A stale ghost left over from
  // an earlier placement must never survive a click — Space would then put
  // a piece somewhere the user is no longer looking. Where the click lands
  // on a single piece, the queue is immediately re-armed from THAT piece
  // below, so Space continues to mean "carry on from here".
  state.pending = null;
  state.ghost = null;

  const rect = e.target.closest('.mat');
  if (!rect) {
    // Empty canvas: rubber-band select. The selection is not cleared here
    // — a plain click (a band of no size) clears it on release, so a drag
    // that starts on empty space can still extend an existing selection
    // with Shift rather than wiping it the moment the pointer goes down.
    const [ox, oy] = pointerWorld(e);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = additive ? [...state.selection] : [];
    let band = { x: ox, y: oy, w: 0, h: 0 };
    canvas.setPointerCapture(e.pointerId);
    state.dragging = true;

    // Anything the band touches counts — a cell spans [x, x+1), so this is
    // an overlap test, not containment. Requiring a piece to be fully
    // enclosed makes big pieces frustrating to catch. Shared by the live
    // preview and the commit on release, so what is highlighted while
    // dragging is by construction what gets selected.
    const hitPieces = (b) => state.layout.pieces.reduce((hits, piece, i) => {
      const touches = placedCells(piece).some(([cx, cy]) =>
        cx + 1 > b.x && cx < b.x + b.w && cy + 1 > b.y && cy < b.y + b.h);
      if (touches) hits.push(i);
      return hits;
    }, []);

    // Repaint just the mat classes, not the whole canvas: this runs on
    // every pointermove, and drawLayout would rebuild the walls and arcs
    // each time for no visual gain.
    const showPreview = (hits) => {
      const set = new Set(hits);
      for (const r of canvas.querySelectorAll('rect.mat')) {
        r.classList.toggle('will-select', set.has(Number(r.dataset.piece)));
      }
    };
    const clearPreview = () => {
      for (const r of canvas.querySelectorAll('rect.mat.will-select')) r.classList.remove('will-select');
    };

    const bandMove = (ev) => {
      const [x, y] = pointerWorld(ev);
      band = { x: Math.min(ox, x), y: Math.min(oy, y), w: Math.abs(x - ox), h: Math.abs(y - oy) };
      drawMarquee(canvas, band);
      showPreview(hitPieces(band));
    };
    const bandEnd = () => {
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      canvas.removeEventListener('pointermove', bandMove);
      canvas.removeEventListener('pointerup', bandEnd);
      canvas.removeEventListener('pointercancel', bandCancel);
      state.dragging = false;
      drawMarquee(canvas, null);
      clearPreview();
      // A band smaller than a tenth of a mat is a click, not a drag.
      if (band.w < 0.1 && band.h < 0.1) {
        state.selection = additive ? base : [];
        render();
        return;
      }
      state.selection = [...new Set([...base, ...hitPieces(band)])];
      render();
    };
    const bandCancel = () => {
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      canvas.removeEventListener('pointermove', bandMove);
      canvas.removeEventListener('pointerup', bandEnd);
      canvas.removeEventListener('pointercancel', bandCancel);
      state.dragging = false;
      drawMarquee(canvas, null);
      clearPreview();
      render();
    };
    canvas.addEventListener('pointermove', bandMove);
    canvas.addEventListener('pointerup', bandEnd);
    canvas.addEventListener('pointercancel', bandCancel);
    render();
    return;
  }

  const index = Number(rect.dataset.piece);
  // Shift or the platform modifier extends the selection; a plain click
  // replaces it. A modifier-click on an already-selected piece removes it,
  // which is the only way to undo an over-click without starting over.
  if (e.shiftKey || e.metaKey || e.ctrlKey) {
    state.selection = state.selection.includes(index)
      ? state.selection.filter((i) => i !== index)
      : [...state.selection, index];
  } else if (!state.selection.includes(index)) {
    // Grabbing a piece that is already part of a multi-selection keeps the
    // group, so dragging one of them does not silently collapse it to one.
    state.selection = [index];
  }
  // Queue the next piece off whatever is now selected, so Space carries on
  // from the piece just clicked. Straights are the default the mouse lays;
  // C swaps the placed piece afterwards. Only for a single selection —
  // "carry on from here" has no meaning for three pieces at once.
  if (state.selection.length === 1) armGhostFrom(state.selection[0], 'straight');
  const piece = state.layout.pieces[index];
  const [cx, cy] = pointerCell(e);
  const grab = { dx: piece.x - cx, dy: piece.y - cy, index, moved: false };
  // Drag the whole selection, not just the piece under the cursor. Their
  // starting positions are captured once, up front, and every move writes
  // origin + delta — accumulating per-move offsets would drift as soon as
  // one piece was clamped or skipped.
  //
  // A modifier-click can deselect the very piece being grabbed; in that
  // case move just that piece rather than the group it is no longer in.
  const moving = state.selection.includes(index) ? [...state.selection] : [index];
  const origins = moving.map((i) => {
    const p = state.layout.pieces[i];
    return { index: i, x: p.x, y: p.y };
  });
  let current = { x: piece.x, y: piece.y }; // last-written position of the
                        // grabbed piece, so a round-trip back to the start
                        // is still recognised as "no-op" correctly
  canvas.setPointerCapture(e.pointerId);
  state.dragging = true;

  const onMove = (ev) => {
    const [nx, ny] = pointerCell(ev);
    const x = nx + grab.dx;
    const y = ny + grab.dy;
    if (x === current.x && y === current.y) return;
    if (!grab.moved) { state.history.push(structuredClone(state.layout)); grab.moved = true; state.error = null; }
    const ddx = x - piece.x;
    const ddy = y - piece.y;
    for (const origin of origins) {
      const p = state.layout.pieces[origin.index];
      state.layout.pieces[origin.index] = { ...p, x: origin.x + ddx, y: origin.y + ddy };
    }
    current = { x, y };
    render();
  };
  const cleanup = () => {
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released, e.g. on pointercancel */ }
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
    state.dragging = false;
  };
  const onUp = () => cleanup();
  const onCancel = () => cleanup();
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);

  render();
});

// Drag-to-extend: press an open-port handle and drag outward to lay a run
// of straights in one gesture. The existing pointerdown listener above
// already returns early for '.port-handle' targets (Task 12's guard), so
// this listener owns the gesture cleanly.
canvas.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.port-handle');
  if (!handle) return;
  e.stopPropagation();

  // Keyed by portKey, not array index: an index into openPorts(layout)
  // would only be safe if that array's order were guaranteed identical
  // between the render that drew this handle and this pointerdown — a
  // stable string key sidesteps needing that guarantee at all.
  const origin = openPorts(state.layout).find((o) => portKey(o.port) === handle.dataset.port);
  if (!origin) return;

  const baseline = structuredClone(state.layout);
  const rot = origin.port.dir === 'N' || origin.port.dir === 'S' ? 0 : 90;
  let laid = 0;
  canvas.setPointerCapture(e.pointerId);
  state.dragging = true;

  const onMove = (ev) => {
    const [cx, cy] = pointerCell(ev);
    const [ox, oy] = origin.port.cells[0];
    // I1: straights are always laid forward along origin.port.dir, so the
    // run length must be the cursor's displacement *projected onto that
    // direction* — Manhattan distance (the old formula) also counts
    // sideways movement and treats a backward drag as a positive length.
    // Piece i of the run lands i cells beyond [ox, oy] (placeAgainst steps
    // one NEIGHBOUR cell per call, chained through each new tip port), so
    // a projected delta of exactly D cells means D pieces are wanted — no
    // "-1": verified headlessly (see final-fix-report.md) that subtracting
    // 1 here left the run one cell short of the cursor.
    const [dx, dy] = NEIGHBOUR[origin.port.dir];
    const wanted = Math.max(0, (cx - ox) * dx + (cy - oy) * dy);

    state.layout = structuredClone(baseline);
    laid = 0;
    // Track the tip port we just created directly, rather than
    // re-searching openPorts(...) for "some port facing origin's
    // direction" each iteration — that search could match an unrelated
    // open port elsewhere in the layout that happens to face the same way.
    let tip = origin.port;
    for (let i = 0; i < wanted; i++) {
      const next = placeAgainst(tip, 'straight', rot);
      if (!next) break;
      // placeAgainst is purely geometric — it answers "where must this sit
      // to connect", not "is that space free". Check occupancy (recomputed
      // each iteration so it also sees pieces already laid earlier in this
      // same run, e.g. a run that curls back on itself) and stop the run
      // at the first blocked cell rather than skipping it and continuing —
      // a run with a hole in it is worse than a short run.
      const taken = occupiedSet(state.layout);
      if (placedCells(next).some((c) => taken.has(cellKey(c)))) break;
      state.layout.pieces.push(next);
      laid += 1;
      const forward = placedPorts(next).find((p) => p.dir === origin.port.dir);
      if (!forward) break;
      tip = forward;
    }
    render();
  };
  const cleanup = () => {
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released, e.g. on pointercancel */ }
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
    state.dragging = false;
  };
  const onUp = () => {
    cleanup();
    // One undo step for the whole run, matching the move-drag's pattern
    // of only recording history when something actually changed.
    if (laid > 0) {
      state.history.push(baseline);
      state.error = null;
      // Select the last piece of the run, so R and Delete act on the end
      // of what was just laid without a click. Done here rather than in
      // onMove: during the drag the run is rebuilt repeatedly, and a
      // selection that flickered with it would be noise.
      const tail = state.layout.pieces.length - 1;
      state.selection = [tail];
      state.lastPlaced = state.layout.pieces[tail];
      // Queue the next straight off the end of the run so the ghost shows
      // where Space would continue, as it does after any other placement.
      armGhostFrom(tail, 'straight');
      render();
    }
  };
  const onCancel = () => {
    // Abnormal termination, not a deliberate "keep what I built" signal
    // (that's pointerup) — discard the speculative run instead of
    // committing a partial one with no undo step to remove it.
    state.layout = baseline;
    cleanup();
    render();
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);

  render();
});

// Inventory dialog: state.kits is UI-only (never written into state.layout,
// never persisted by exportHtml) so editing it doesn't touch undo history.
const inventoryDialog = document.querySelector('#inventory-dialog');
document.querySelector('#btn-inventory').addEventListener('click', () => {
  const form = document.querySelector('#inventory-form');
  form.replaceChildren(
    ...Object.entries(KITS).map(([id, kit]) => {
      const wrap = document.createElement('div');
      wrap.innerHTML = `<label for="kit-${id}">${kit.name} (${id})</label>
        <input type="number" id="kit-${id}" name="${id}" min="0" step="1" value="${state.kits[id] ?? 0}">`;
      return wrap;
    }),
    Object.assign(document.createElement('menu'), {
      innerHTML: '<button class="btn btn-outline" value="cancel" formnovalidate>Cancel</button>'
        + '<button class="btn btn-primary" value="save">Save</button>',
    }),
  );
  inventoryDialog.showModal();
});

inventoryDialog.addEventListener('close', () => {
  if (inventoryDialog.returnValue !== 'save') return;
  const data = new FormData(document.querySelector('#inventory-form'));
  state.kits = Object.fromEntries([...data].map(([k, v]) => [k, Number(v) || 0]));
  saveKits(localStorage, state.kits);
  render();
});

// Room dialog: the room lives on state.layout, so this goes through
// commit() to stay undoable. Metres are converted to whole mats — the unit
// state.layout.room is actually stored in (see render.js, which compares
// room.w/h directly against the mat-unit bbox). Non-finite or non-positive
// input is rejected rather than stored: storage.js's importHtml validates
// room on load and would reject a saved file containing one, so writing a
// bad value into the live layout would produce a layout that can't be
// re-opened after being saved.
const roomDialog = document.querySelector('#room-dialog');
const roomToMats = (m) => Math.round((m * 1000) / MAT_MM);
document.querySelector('#btn-room').addEventListener('click', () => {
  const form = document.querySelector('#room-form');
  const room = state.layout.room;
  form.w.value = room ? metres(room.w) : '';
  form.h.value = room ? metres(room.h) : '';
  roomDialog.showModal();
});

roomDialog.addEventListener('close', () => {
  if (roomDialog.returnValue === 'clear') {
    commit((l) => { l.room = null; });
    return;
  }
  if (roomDialog.returnValue !== 'set') return;
  const data = new FormData(document.querySelector('#room-form'));
  const w = Number(data.get('w'));
  const h = Number(data.get('h'));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
  commit((l) => { l.room = { w: roomToMats(w), h: roomToMats(h) }; });
});

// Presets gallery: one entry per PRESETS item, with a thumbnail, name,
// source attribution, and a buildability badge computed against the
// current owned inventory (state.kits). Badges are recomputed on every
// open — not cached — since state.kits can change between openings.
const presetsDialog = document.querySelector('#presets-dialog');

function renderPresetsList() {
  const stock = stockFromKits(state.kits);
  const list = document.querySelector('#presets-list');
  list.replaceChildren(...PRESETS.map((preset) => presetListItem(preset, stock)));
}

// One preset's row. Isolated in its own try/catch: layoutToSvgString
// throws on non-finite coordinates, and renderPresetsList runs *before*
// showModal() — an unguarded throw here would abort the whole .map(),
// meaning the dialog never opens and every other, valid preset silently
// vanishes along with the broken one. So a bad preset degrades on its
// own: log it for diagnosis, show its name with a "couldn't be drawn"
// note, and leave it unclickable (no data-preset-id, so the delegated
// click handler's `button[data-preset-id]` selector never matches it).
function presetListItem(preset, stock) {
  const li = document.createElement('li');
  try {
    const layout = createLayout({ pieces: preset.pieces });
    const rows = diffStock(billOfMaterials(layout), stock);
    const shortfall = rows.reduce((total, r) => total + r.short, 0);
    const buildable = shortfall === 0;
    const badge = buildable ? 'Buildable' : `Short by ${shortfall} piece${shortfall === 1 ? '' : 's'}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset-card';
    button.dataset.presetId = preset.id;
    button.innerHTML = `<span class="preset-thumb">${layoutToSvgString(layout, { pad: 0.6, theme: 'light' })}</span>
      <span class="preset-info">
        <span class="preset-name">${preset.name}</span>
        <span class="preset-source">${preset.source}</span>
        <span class="preset-badge ${buildable ? 'preset-badge--ok' : 'preset-badge--bad'}">${badge}</span>
      </span>`;
    li.append(button);
  } catch (error) {
    console.error(`Preset "${preset.id}" could not be rendered:`, error);
    const p = document.createElement('p');
    p.className = 'preset-broken';
    p.textContent = `${preset.name || preset.id}: thumbnail could not be drawn.`;
    li.append(p);
  }
  return li;
}

document.querySelector('#btn-presets').addEventListener('click', () => {
  // The preset gallery is cheap and renders synchronously; the generated
  // suggestions below are not, so showModal() happens FIRST and
  // renderSuggestions (async) paints a skeleton and computes after — see
  // its own comment. Getting this order backwards is exactly the bug being
  // fixed here: computing before showModal() freezes the whole UI with no
  // dialog visible at all for as long as generation takes.
  renderPresetsList();
  presetsDialog.showModal();
  renderSuggestions();
});

document.querySelector('#presets-list').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-preset-id]');
  if (!button) return;
  const preset = PRESETS.find((p) => p.id === button.dataset.presetId);
  if (!preset) return;
  commit((l) => { l.pieces = structuredClone(preset.pieces); });
  // A loaded preset invalidates anything computed against the previous
  // layout — same clearing this file does on import (see loadFile below).
  state.selection = [];
  state.ghost = null;
  state.pending = null;
  state.hoverCell = null;
  state.tool = null;
  render();
  presetsDialog.close();
});

// Suggestions: layouts generated from the owned inventory, offered
// alongside the fixed presets above. Derived state — never written into
// state.layout, so it never persists (see storage.js: only version, unit,
// room, pieces round-trip) and never auto-loads onto the blank canvas.

// Round-robin across characters so the first five show different shapes
// rather than five rectangles differing by one mat.
//
// Within a character, best-scoring first — so the round-robin draws each
// shape's best example before any shape's second-best. Ordering by score
// here rather than in groupByCharacter keeps that function's own contract
// (variants by mat count, `best` = the largest) unchanged; `best` is not
// read by this UI.
function suggestionPool(characters) {
  const pool = [];
  const queues = characters
    .map((c) => [...c.variants].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)))
    // Strongest shape first, judged by its own best example, so the top of
    // page one is the best thing on offer and not merely the shape with the
    // fewest corners. The round-robin below still guarantees the spread.
    .sort((a, b) => (b[0]?.score ?? 0) - (a[0]?.score ?? 0));
  while (queues.some((q) => q.length > 0)) {
    for (const q of queues) if (q.length > 0) pool.push(q.shift());
  }
  return pool;
}

// Bumped on every renderSuggestions call, and checked before any of it
// writes to the DOM. generateLayouts is synchronous and can run for
// seconds on a cold cache, so this function awaits a couple of yields
// first (to let the skeleton actually paint — see below) — and the dialog
// can be closed and reopened, or the inventory can change, during that
// wait. Whichever call is the last to start is the only one allowed to
// write; an earlier, still-pending call that resumes afterward must find
// itself superseded and bail out instead of overwriting newer results with
// stale ones.
let suggestionsRun = 0;

async function renderSuggestions() {
  const stock = stockFromKits(state.kits);
  const opts = { room: state.layout.room };
  const run = ++suggestionsRun;
  const superseded = () => run !== suggestionsRun;

  // Only pay for a skeleton when generateLayouts is actually about to do
  // real work. hasCachedLayouts is a pure lookup — it costs nothing and
  // runs no part of the enumeration — so checking it first is what lets a
  // warm reopen skip straight to real content instead of flashing a
  // placeholder for one frame and then replacing it, which would look
  // broken rather than fast.
  if (!hasCachedLayouts(stock, opts)) {
    renderSuggestionsSkeleton();
    // Yield to the browser so the skeleton just painted actually gets
    // presented before the computation below blocks the main thread:
    // one animation frame for layout/paint of what was just queued, then
    // a task-boundary yield (setTimeout) so that frame is flushed rather
    // than coalesced with the synchronous work that follows in the same
    // microtask/frame.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (superseded()) return;
  }

  const generated = generateLayouts(stock, opts);
  const { results, stopped } = generated;
  // Score before grouping so every variant carries its score into the pool,
  // which orders each character's variants by it. Scores are normalised
  // within this one call, so they are only comparable inside this set.
  const characters = groupByCharacter(scoreLayouts(results, { room: state.layout.room }));
  if (superseded()) return;

  state.suggestions = { pool: suggestionPool(characters), cursor: 0, stopped };

  // `results.length` is a CAPPED count, not a total: generateLayouts keeps
  // at most 50 size-variants per shape and reports how many shapes it
  // capped. Printing it bare overstates coverage badly — two starter kits
  // return 300 here out of 35,083 that actually exist. The shape count is
  // exact; the layout count is not, and must not be presented as if it
  // were. (Those 34,783 omitted are size-variants of shapes already shown,
  // which is exactly what this feature sets out to collapse — so capping
  // is right; silently rounding it off as a total is not.)
  const { cappedCharacters = 0 } = generated;
  document.querySelector('#suggestions-summary').textContent = results.length === 0
    ? 'Nothing can be built with the current inventory.'
    : `${characters.length} shape${characters.length === 1 ? '' : 's'}, `
      + `${results.length} size${results.length === 1 ? '' : 's'} to choose from`
      + (cappedCharacters > 0 ? ' (showing up to 50 sizes per shape)' : '')
      + (stopped ? ' — search stopped early, there may be more' : '');

  document.querySelector('#suggestions-list').removeAttribute('aria-busy');
  // Deliberately NOT passed `opts` here: renderOutOfReach has always called
  // outOfReach(stock) with no options (room is never applied to the
  // out-of-reach list, only to the suggestions above), and changing that
  // now would change what "out of reach" reports under a room boundary —
  // untested territory this task's profiling never measured. Left as-is;
  // this means outOfReach's own internal owned-stock enumeration only
  // shares generateCache with the call above when state.layout.room is
  // null, which is the common case and the one the reported 5s/12.2s
  // numbers were measured against. A room boundary being set is a
  // pre-existing, unrelated case where this duplicate work still happens.
  renderOutOfReach(stock);
  renderSuggestionPage();
}

// Five placeholder rows shaped like a real suggestion card — not a spinner
// or a "Loading…" line, per the design this dialog was given. Painted
// immediately (before the compute below ever starts) and swapped out for
// the real rows in renderSuggestions once results land. #suggestions-list
// carries aria-busy while these are up; the rows themselves are
// aria-hidden, since they carry no information — a screen reader should
// hear the eventual real list, not five meaningless placeholders.
function renderSuggestionsSkeleton() {
  const list = document.querySelector('#suggestions-list');
  list.setAttribute('aria-busy', 'true');
  list.replaceChildren(...Array.from({ length: 5 }, suggestionSkeletonItem));
  // Clear anything left over from a previous open rather than leaving it
  // visible alongside/underneath the skeleton.
  document.querySelector('#suggestions-summary').textContent = '';
  delete document.querySelector('#suggestions-summary').dataset.page;
  document.querySelector('#btn-more-suggestions').hidden = true;
  document.querySelector('#out-of-reach').replaceChildren();
}

// One skeleton row. Its box model is the real .preset-card/.preset-thumb/
// .preset-info rules (css/app.css, ~line 211) reused as-is via the
// `preset-card--skeleton` / `preset-thumb--skeleton` modifiers — the same
// flex layout, gap, padding, border and 4rem thumb footprint a real
// suggestion row gets — so nothing jumps when suggestionListItem's real
// markup replaces this. Two bars of different widths stand in for
// .preset-name and .preset-source so it reads as a card, not a grey slab.
function suggestionSkeletonItem() {
  const li = document.createElement('li');
  li.setAttribute('aria-hidden', 'true');
  li.innerHTML = `<div class="preset-card preset-card--skeleton">
      <span class="preset-thumb preset-thumb--skeleton"></span>
      <span class="preset-info">
        <span class="skeleton-bar skeleton-bar--name"></span>
        <span class="skeleton-bar skeleton-bar--source"></span>
      </span>
    </div>`;
  return li;
}

function renderSuggestionPage() {
  const { pool, cursor } = state.suggestions;
  const page = pool.slice(cursor, cursor + 5);
  const list = document.querySelector('#suggestions-list');
  list.replaceChildren(...page.map(suggestionListItem));

  const more = document.querySelector('#btn-more-suggestions');
  more.hidden = pool.length <= 5;
  more.textContent = cursor + 5 >= pool.length ? 'Start again from the first' : 'Show 5 different';
  document.querySelector('#suggestions-summary').dataset.page =
    pool.length ? `showing ${cursor + 1}-${Math.min(cursor + 5, pool.length)} of ${pool.length}` : '';
}

document.querySelector('#btn-more-suggestions').addEventListener('click', () => {
  const { pool, cursor } = state.suggestions;
  state.suggestions.cursor = cursor + 5 >= pool.length ? 0 : cursor + 5;
  renderSuggestionPage();
});

// One suggestion's row. Isolated in its own try/catch for the same reason
// as presetListItem above: renderSuggestions runs before showModal(), so an
// unguarded throw here would abort the whole .map() and the dialog would
// never open.
function suggestionListItem(result) {
  const li = document.createElement('li');
  try {
    const layout = createLayout({ pieces: result.pieces });
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset-card';
    button.dataset.suggestionKey = result.key;
    button.innerHTML = `<span class="preset-thumb">${layoutToSvgString(layout, { pad: 0.6, theme: 'light' })}</span>
      <span class="preset-info">
        <span class="preset-name">${outlineName(result.signature)} ${result.bbox.w}×${result.bbox.h}</span>
        <span class="preset-source">${result.matCount} mats · lap ${(result.lapMm / 1000).toFixed(2)} m</span>
      </span>`;
    li.append(button);
  } catch (error) {
    console.error(`Suggestion "${result.key}" could not be rendered:`, error);
    const p = document.createElement('p');
    p.className = 'preset-broken';
    p.textContent = 'This suggestion could not be drawn.';
    li.append(p);
  }
  return li;
}

function renderOutOfReach(stock) {
  const { blocked, stopped } = outOfReach(stock);
  const host = document.querySelector('#out-of-reach');
  if (blocked.length === 0) { host.replaceChildren(); return; }
  const seen = new Set();
  const lines = blocked.filter((b) => !seen.has(b.name + b.feel) && seen.add(b.name + b.feel));
  // Two reasons, two very different messages. 'stock' is actionable — a
  // purchase unlocks it. 'geometry' is not, and must never be phrased as
  // something to buy: no closed loop of large corners exists at any
  // inventory, so telling the owner to buy the large-corner kit would be
  // a lie the UI shows them. See outOfReach in js/generate.js.
  host.innerHTML = `<hr class="divider"><h3 class="h3">Out of reach</h3><dl id="out-of-reach-list">`
    + lines.map((b) => `<dt>${b.name}${b.feel === 'sweeping' ? ', sweeping' : ''}</dt>`
      + `<dd>${b.reason === 'stock'
          // "needs 2 more quarter-round mat" reads wrong, and naive
          // pluralisation would give "joint as" for the Joint A/B labels.
          // Naming the part and stating the shortfall sidesteps both.
          ? `${b.missing.label}: ${b.missing.short} short`
          : 'not possible with these pieces, whatever you buy'}</dd>`).join('')
    + `</dl>`
    + (stopped ? `<p class="status">Search stopped early — there may be more.</p>` : '');
}

document.querySelector('#suggestions-list').addEventListener('click', (e) => {
  const button = e.target.closest('[data-suggestion-key]');
  if (!button) return;
  const chosen = state.suggestions.pool.find((r) => r.key === button.dataset.suggestionKey);
  if (!chosen) return;
  commit((l) => { l.pieces = chosen.pieces.map((p) => ({ ...p })); });
  // A loaded suggestion is ordinary pieces. Clear the interaction state the
  // same way the preset and file-open paths do — anything computed against
  // the previous layout is meaningless now.
  state.selection = [];
  state.ghost = null;
  state.pending = null;
  state.hoverCell = null;
  state.tool = null;
  render();
  presetsDialog.close();
});

// Save / open. Correction 1: the canvas drop handler above must NOT get a
// stopPropagation() call here. Reasoning verified against the code: these
// document-level dragover/drop listeners gate on
// e.dataTransfer.types.includes('Files') and e.dataTransfer.files.length.
// A palette drag (dragstart above) only ever calls
// e.dataTransfer.setData('text/plain', type) — it never adds a File, so
// types never includes 'Files' and files.length is always 0 for a palette
// drag. The canvas drop handler already runs first (event order: target
// before ancestors) and always calls preventDefault(), so by the time this
// listener sees a bubbled palette-drop event, files.length is 0 and it
// returns immediately without touching state. There is no conflict to
// prevent, so no stopPropagation() is added.
document.querySelector('#btn-save').addEventListener('click', () => {
  const blob = new Blob([exportHtml(state.layout)], { type: 'text/html' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'circuit30-layout.html',
  });
  a.click();
  // Minor: revoking synchronously right after click() on a detached anchor
  // is a known cause of silently-failing downloads outside Chrome — some
  // browsers haven't started the download yet. Defer it a tick instead.
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
});

const openInput = document.querySelector('#open-input');
document.querySelector('#btn-open').addEventListener('click', () => openInput.click());
// loadFile never rejects (its own try/catch swallows import errors), so
// .finally() here runs after both the success and failure paths. Resetting
// the input's value is what lets choosing the same filename twice in a row
// fire 'change' again — the browser only fires it when the value differs.
openInput.addEventListener('change', () => {
  loadFile(openInput.files[0]).finally(() => { openInput.value = ''; });
});

async function loadFile(file) {
  if (!file) return;
  // C1: parse and validate the incoming file BEFORE touching history or
  // state.layout. importHtml can throw (bad version, unknown piece type,
  // non-finite coordinates, malformed room, ...) — pushing the history
  // snapshot first meant a failed import still left a phantom undo step
  // that did nothing when popped, since state.layout was never actually
  // replaced. Only commit history once the new layout is known-good.
  let imported;
  try {
    imported = importHtml(await file.text());
  } catch (error) {
    // Routed through state.error rather than written into #status
    // directly: renderStatus() runs on every render() call, including
    // ones triggered by unrelated, non-mutating interactions (e.g. a click
    // on empty canvas), and would otherwise overwrite this message on the
    // very next repaint.
    state.error = error.message;
    render();
    return;
  }

  state.history.push(structuredClone(state.layout));
  state.layout = imported;
  state.selection = [];
  state.error = null;
  // The new layout invalidates anything computed against the old one:
  // a ghost/pending placement, a hovered cell, or an armed tool all
  // referenced state.layout as it was before this import. Space's
  // handler revalidates a pending ghost against the live layout before
  // committing, so nothing corrupt could actually be placed — but
  // leaving these set would still show a stale ghost on the canvas and
  // let Space drop a leftover piece at coordinates that mean nothing in
  // the newly loaded layout. Deliberately not touching state.dragging:
  // opening a file only happens via a toolbar click or a page-level
  // drop, neither of which can be mid-drag, and forcing that flag false
  // here would strand an in-flight drag's own cleanup instead.
  state.ghost = null;
  state.pending = null;
  state.hoverCell = null;
  state.tool = null;
  render();
}

document.addEventListener('dragover', (e) => {
  if (e.dataTransfer.types.includes('Files')) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  loadFile(e.dataTransfer.files[0]);
});

export function undo() {
  if (state.dragging) return; // a move-drag is holding grab.index/piece against
                               // the current state.layout; swapping it out from
                               // under an in-flight drag would corrupt it
  const previous = state.history.pop();
  if (previous) {
    state.layout = previous;
    state.selection = [];
    // Any armed ghost/pending was computed against the layout that just
    // went away — reverting the layout invalidates both, or Space could
    // place an orphan piece computed against a state that no longer exists.
    state.ghost = null;
    state.pending = null;
    // C1: undo is itself a successful mutation, so it also supersedes a
    // stale error from a previous failed operation.
    state.error = null;
    render();
  }
}

// Single document-level keydown listener: Task 11's rotate-in-flight-tool
// behaviour and Task 12's select/rotate/delete/undo behaviour are merged
// here so there is exactly one handler, not two competing ones.
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  // Minor: the input/textarea/select guard above misses an open <dialog> —
  // its own focused controls (a button, etc.) don't match that selector,
  // so with a modal open Space/Enter would both activate the focused
  // button AND commit a pending piece behind it, and 'r' would rotate the
  // hidden selection underneath.
  if (document.querySelector('dialog[open]')) return;

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
    return;
  }

  if (e.key === 'Escape') {
    // I5: the only way to dismiss an armed auto-advance ghost used to be
    // to place it — five other paths cleared pending/ghost, but there was
    // no way to just cancel one. dialog[open] is already handled above, so
    // this Escape is free to mean "dismiss the ghost" without also being
    // asked to close a modal.
    // Also drop the selection. Space now derives its target from the
    // selection rather than from a pre-armed queue, so clearing only the
    // queue would let the very next Space re-derive it — Escape would
    // cancel the preview and nothing else. Escape means stop.
    if (state.pending || state.ghost || state.selection.length > 0) {
      state.pending = null;
      state.ghost = null;
      state.selection = [];
      render();
    }
    return;
  }

  if (e.key.toLowerCase() === 'r') {
    if (state.tool) {
      e.preventDefault();
      // Turning by hand takes the wheel off the auto-guess for this drag.
      state.tool.turned = true;
      state.tool.rot = (state.tool.rot + 90) % 360;
      if (state.hoverCell) {
        state.ghost = ghostFor(state.tool.type, state.tool.rot, state.hoverCell);
        drawLayout(canvas, state.layout, { room: state.layout.room, ghost: state.ghost, selected: state.selection, handles: true });
      }
      return;
    }
    if (state.selection.length > 0 && !state.dragging) {
      e.preventDefault();
      // I5: rotate is one of the paths that never dismissed an armed
      // auto-advance ghost.
      state.pending = null;
      state.ghost = null;
      commit((l) => {
        for (const i of state.selection) {
          const current = l.pieces[i];
          // Prefer the next orientation of this same type that still meets
          // the piece's existing join — for a corner that is "turn the
          // other way". A blind +90 would swing it off the end of the
          // chain, which is never what rotating a connected piece means.
          const sameType = anchoredCandidates(i).filter((c) => c.type === current.type);
          if (sameType.length > 1) {
            const at = sameType.findIndex((c) => c.rot === current.rot
              && c.x === current.x && c.y === current.y);
            l.pieces[i] = sameType[(at + 1) % sameType.length];
            continue;
          }
          // Unconnected, or nothing else fits: turn it where it stands.
          current.rot = (current.rot + 90) % 360;
        }
      });
    }
    return;
  }

  // Cycle the selected piece through everything that could sit there, so a
  // run of straights can be turned into a corner without going back to the
  // palette. Re-arms the auto-advance ghost, so the mouse carries straight
  // on from the new piece's open end.
  if (e.key.toLowerCase() === 'c') {
    if (state.selection.length === 0 || state.dragging) return;
    e.preventDefault();
    // Each selected piece advances to its own next option. Evaluated one
    // at a time against the layout as it stands, so a conversion that
    // frees or fills space is seen by the pieces cycled after it.
    const wasLast = state.selection.length === 1
      && state.selection[0] === state.layout.pieces.length - 1;
    let last = null;
    let changed = false;
    state.pending = null;
    state.ghost = null;
    commit((l) => {
      for (const i of state.selection) {
        const candidates = anchoredCandidates(i);
        const current = l.pieces[i];
        // One entry per type, in the palette's order, so C cycles pieces —
        // straight, corner, large corner — and leaves which way a corner
        // turns to R. Whichever orientation of the next type fits first
        // is the one offered.
        const types = [];
        for (const c of candidates) if (!types.some((t) => t.type === c.type)) types.push(c);
        if (types.length <= 1) continue;
        const at = types.findIndex((c) => c.type === current.type);
        const next = types[(at + 1) % types.length];
        l.pieces[i] = next;
        last = next;
        changed = true;
      }
    });
    if (!changed) { render(); return; }
    // advanceGhost re-arms from the LAST piece, so only re-arm when the
    // converted piece is the last one — which it is in the flow this
    // serves: lay straights, convert the final one, carry on.
    if (wasLast && last) {
      state.lastPlaced = last;
      advanceGhost('straight');
    }
    render();
    return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selection.length === 0 || state.dragging) return;
    e.preventDefault();
    // Descending, so each splice cannot shift an index still to be removed.
    const doomed = [...state.selection].sort((a, b) => b - a);
    state.selection = [];
    // I5: delete is one of the paths that never dismissed an armed
    // auto-advance ghost.
    state.pending = null;
    state.ghost = null;
    commit((l) => { for (const i of doomed) l.pieces.splice(i, 1); });
    return;
  }

  if (e.key === ' ' || e.key === 'Enter') {
    // Guard on state.dragging too: commit() below pushes state.layout onto
    // history and mutates it, which must not race a port-handle drag that
    // is speculatively rebuilding state.layout on every pointermove.
    if (state.dragging) return;
    // Derive the queued piece here rather than relying on every placement
    // path to have armed one. Space kept breaking because each new path —
    // the palette drop, the run drag, a click — had to remember to arm it,
    // and any handler that cleared it silently disabled the key. The
    // selection is the one thing every path does set, so ask for it now.
    if (!state.pending && state.selection.length === 1) {
      armGhostFrom(state.selection[0], 'straight');
    }
    if (!state.pending) return;
    // state.ghost.valid was computed by advanceGhost() at the moment
    // state.pending was armed — any later gesture that mutates
    // state.layout without touching ghost/pending (e.g. a drag-to-extend
    // run that lays pieces onto exactly the cells state.pending targets)
    // leaves that flag stale. Revalidate against the *current* layout
    // right before committing, rather than trusting a flag captured
    // earlier — this is the third staleness bug in this feature, so the
    // fix is "always recheck live state", not "find and patch this one
    // path".
    const fresh = ghostFor(state.pending.type, state.pending.rot, [state.pending.x, state.pending.y]);
    if (!fresh.valid) {
      // Stop the stale ghost from silently sitting there rejecting
      // keypresses forever — clear it so the UI reflects that this
      // pending placement is dead.
      state.pending = null;
      state.ghost = null;
      render();
      return;
    }
    state.ghost = fresh;
    e.preventDefault();
    const next = state.pending;
    commit((l) => l.pieces.push(next));
    state.lastPlaced = next;
    // Same as the drop path: the piece you just placed is the selected one.
    state.selection = [state.layout.pieces.length - 1];
    // advanceGhost() runs after commit()'s own render(), so it mutates
    // ghost/pending state that render already drew — this trailing render
    // is what actually shows the freshly re-armed ghost; it is not
    // redundant with commit()'s render.
    advanceGhost();
    render();
  }
});
