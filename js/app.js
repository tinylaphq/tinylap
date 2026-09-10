import { createLayout, occupiedSet, cellKey, openPorts, placeAgainst, portKey, computeMetrics, isClosedCircuit, findOverlaps, NEIGHBOUR } from './model.js';
import { drawLayout, drawGhost, layoutToSvgString } from './render.js';
import { PIECES, MAT_MM, placedCells, placedPorts } from './geometry.js';
import { billOfMaterials, diffStock, stockFromKits, recommendKit, KITS } from './inventory.js';
import { exportHtml, importHtml } from './storage.js';
import { PRESETS } from './presets.js';

const canvas = document.querySelector('#canvas');

const state = {
  layout: createLayout(),
  kits: { '87033': 1 },
  tool: null,     // { type, rot }
  ghost: null,    // { cells, valid }
  hoverCell: null, // [x, y] last cell hovered while dragging
  history: [],
  selected: null, // index into layout.pieces, or null
  dragging: false, // true while a piece move-drag or port-handle drag is in flight
  lastPlaced: null, // { type, x, y, rot } of the most recently placed piece
  pending: null,    // { type, x, y, rot } the auto-advance ghost would place on Space/Enter
  error: null,      // C1: message from the last failed operation (e.g. a bad
                     // file open) that renderStatus prefers over its normal
                     // text — never written into #status directly, since
                     // render() owns that field and repaints it on every call.
};

function renderPalette() {
  const list = document.querySelector('#palette-list');
  list.replaceChildren(...Object.entries(PIECES).map(([type, def]) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.type = type;
    const thumb = document.createElement('span');
    thumb.className = 'piece-thumb';
    try {
      thumb.innerHTML = layoutToSvgString(createLayout({ pieces: [{ type, x: 0, y: 0, rot: 0 }] }), { pad: 0.25 });
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
    selected: state.selected,
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

function ghostFor(type, rot, [x, y]) {
  const cells = placedCells({ type, x, y, rot });
  const taken = occupiedSet(state.layout);
  return { cells, valid: !cells.some((c) => taken.has(cellKey(c))) };
}

// Auto-advance: after any placement, ghost the same piece again at the open
// port left at its far end, so a run of identical pieces chains with
// Space/Enter alone. Clears both state.pending and state.ghost together on
// every "can't continue" branch so the two never disagree with each other.
function advanceGhost() {
  const last = state.lastPlaced;
  if (!last) { state.pending = null; state.ghost = null; return; }
  const index = state.layout.pieces.length - 1;
  const stillOpen = openPorts(state.layout).filter((o) => o.pieceIndex === index);
  // Deliberate tie-break, inherited from the brief: when a piece has two
  // still-open ports (e.g. it was placed in open space, not against
  // anything), pick the last one in port-definition order rather than the
  // first — for `straight` that's S over N, i.e. "continue forward", not
  // "double back". Not proven for every piece type, just the working rule.
  const forward = stillOpen.at(-1);
  if (!forward) { state.pending = null; state.ghost = null; return; }
  const next = placeAgainst(forward.port, last.type, last.rot);
  if (!next) { state.pending = null; state.ghost = null; return; }
  state.pending = next;
  state.ghost = ghostFor(next.type, next.rot, [next.x, next.y]);
}

document.querySelector('#palette-list').addEventListener('dragstart', (e) => {
  const type = e.target.dataset.type;
  if (!type) return;
  state.tool = { type, rot: 0 };
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

  // I5: selection (click on a mat or on empty canvas) is one of the paths
  // that never dismissed an armed auto-advance ghost — clear it here so
  // Space can no longer place a leftover piece behind whatever the user
  // just selected instead.
  state.pending = null;
  state.ghost = null;

  const rect = e.target.closest('.mat');
  if (!rect) { state.selected = null; render(); return; }

  const index = Number(rect.dataset.piece);
  state.selected = index;
  const piece = state.layout.pieces[index];
  const [cx, cy] = pointerCell(e);
  const grab = { dx: piece.x - cx, dy: piece.y - cy, index, moved: false };
  let current = piece; // last-written position, so a round-trip back to the
                        // start is still recognised as "no-op" correctly
  canvas.setPointerCapture(e.pointerId);
  state.dragging = true;

  const onMove = (ev) => {
    const [nx, ny] = pointerCell(ev);
    const next = { ...piece, x: nx + grab.dx, y: ny + grab.dy };
    if (next.x === current.x && next.y === current.y) return;
    if (!grab.moved) { state.history.push(structuredClone(state.layout)); grab.moved = true; state.error = null; }
    state.layout.pieces[grab.index] = next;
    current = next;
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
    if (laid > 0) { state.history.push(baseline); state.error = null; }
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
    button.innerHTML = `<span class="preset-thumb">${layoutToSvgString(layout, { pad: 1 })}</span>
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
  renderPresetsList();
  presetsDialog.showModal();
});

document.querySelector('#presets-list').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-preset-id]');
  if (!button) return;
  const preset = PRESETS.find((p) => p.id === button.dataset.presetId);
  if (!preset) return;
  commit((l) => { l.pieces = structuredClone(preset.pieces); });
  // A loaded preset invalidates anything computed against the previous
  // layout — same clearing this file does on import (see loadFile below).
  state.selected = null;
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
  state.selected = null;
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
    state.selected = null;
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
    if (state.pending || state.ghost) {
      state.pending = null;
      state.ghost = null;
      render();
    }
    return;
  }

  if (e.key.toLowerCase() === 'r') {
    if (state.tool) {
      e.preventDefault();
      state.tool.rot = (state.tool.rot + 90) % 360;
      if (state.hoverCell) {
        state.ghost = ghostFor(state.tool.type, state.tool.rot, state.hoverCell);
        drawLayout(canvas, state.layout, { room: state.layout.room, ghost: state.ghost, selected: state.selected, handles: true });
      }
      return;
    }
    if (state.selected !== null && !state.dragging) {
      e.preventDefault();
      // I5: rotate is one of the paths that never dismissed an armed
      // auto-advance ghost.
      state.pending = null;
      state.ghost = null;
      commit((l) => {
        const p = l.pieces[state.selected];
        p.rot = (p.rot + 90) % 360;
      });
    }
    return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selected === null || state.dragging) return;
    e.preventDefault();
    const index = state.selected;
    state.selected = null;
    // I5: delete is one of the paths that never dismissed an armed
    // auto-advance ghost.
    state.pending = null;
    state.ghost = null;
    commit((l) => l.pieces.splice(index, 1));
    return;
  }

  if (e.key === ' ' || e.key === 'Enter') {
    // Guard on state.dragging too: commit() below pushes state.layout onto
    // history and mutates it, which must not race a port-handle drag that
    // is speculatively rebuilding state.layout on every pointermove.
    if (!state.pending || state.dragging) return;
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
    // advanceGhost() runs after commit()'s own render(), so it mutates
    // ghost/pending state that render already drew — this trailing render
    // is what actually shows the freshly re-armed ghost; it is not
    // redundant with commit()'s render.
    advanceGhost();
    render();
  }
});
