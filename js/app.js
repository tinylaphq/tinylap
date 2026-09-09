import { createLayout, occupiedSet, cellKey, openPorts, placeAgainst, portKey, computeMetrics, isClosedCircuit } from './model.js';
import { drawLayout, layoutToSvgString } from './render.js';
import { PIECES, MAT_MM, placedCells, placedPorts } from './geometry.js';
import { billOfMaterials, diffStock, stockFromKits, recommendKit, KITS } from './inventory.js';
import { exportHtml, importHtml } from './storage.js';
import { PRESETS } from './presets.js';

const canvas = document.querySelector('#canvas');

const state = {
  layout: createLayout(),
  kits: { '87033': 1 },
};

function renderPalette() {
  const list = document.querySelector('#palette-list');
  list.replaceChildren(...Object.entries(PIECES).map(([type, def]) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.type = type;
    li.textContent = def.label;
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

  const kit = recommendKit(rows);
  document.querySelector('#recommendation').textContent = kit
    ? `Short on pieces — ${kit.name} (${kit.id}) covers it.`
    : 'Everything you need is in stock.';

  const { bbox, matCount, lapMm } = computeMetrics(state.layout);
  document.querySelector('#out-size').value = bbox ? `${metres(bbox.w)} × ${metres(bbox.h)} m` : '—';
  document.querySelector('#out-lap').value = lapMm ? `${(lapMm / 1000).toFixed(2)} m` : '—';
  document.querySelector('#out-mats').value = String(matCount);
}

// Renders the status line: empty / open-ends / closed-circuit. Reads only
// from state.layout — never mutates it or calls render() itself.
function renderStatus() {
  const open = openPorts(state.layout).length;
  document.querySelector('#status').textContent =
    state.layout.pieces.length === 0 ? 'Empty — drag a piece from the left.'
    : isClosedCircuit(state.layout) ? 'Closed circuit ✓'
    : `${open} open end${open === 1 ? '' : 's'}`;
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

renderPalette();
render();

state.tool = null;     // { type, rot }
state.ghost = null;    // { cells, valid }
state.hoverCell = null; // [x, y] last cell hovered while dragging
state.history = [];
state.selected = null; // index into layout.pieces, or null
state.dragging = false; // true while a piece move-drag or port-handle drag is in flight
state.lastPlaced = null; // { type, x, y, rot } of the most recently placed piece
state.pending = null;    // { type, x, y, rot } the auto-advance ghost would place on Space/Enter

export function commit(mutate) {
  state.history.push(structuredClone(state.layout));
  mutate(state.layout);
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

canvas.addEventListener('dragover', (e) => {
  if (!state.tool) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  state.hoverCell = pointerCell(e);
  state.ghost = ghostFor(state.tool.type, state.tool.rot, state.hoverCell);
  drawLayout(canvas, state.layout, { room: state.layout.room, ghost: state.ghost, selected: state.selected, handles: true });
});

canvas.addEventListener('dragleave', (e) => {
  if (canvas.contains(e.relatedTarget)) return;
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
    if (!grab.moved) { state.history.push(structuredClone(state.layout)); grab.moved = true; }
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
    const wanted = Math.max(0, Math.abs(cx - ox) + Math.abs(cy - oy) - 1);

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
    if (laid > 0) state.history.push(baseline);
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
      const p = document.createElement('p');
      p.innerHTML = `<label>${kit.name} (${id})
        <input type="number" name="${id}" min="0" step="1" value="${state.kits[id] ?? 0}"></label>`;
      return p;
    }),
    Object.assign(document.createElement('menu'), {
      innerHTML: '<button value="save">Save</button><button value="cancel" formnovalidate>Cancel</button>',
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
  URL.revokeObjectURL(a.href);
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
  try {
    state.history.push(structuredClone(state.layout));
    state.layout = importHtml(await file.text());
    state.selected = null;
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
  } catch (error) {
    document.querySelector('#status').textContent = error.message;
  }
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
    render();
  }
}

// Single document-level keydown listener: Task 11's rotate-in-flight-tool
// behaviour and Task 12's select/rotate/delete/undo behaviour are merged
// here so there is exactly one handler, not two competing ones.
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
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
