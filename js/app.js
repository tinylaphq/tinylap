import { createLayout, occupiedSet, cellKey, openPorts, placeAgainst, portKey } from './model.js';
import { drawLayout } from './render.js';
import { PIECES, placedCells, placedPorts } from './geometry.js';

const canvas = document.querySelector('#canvas');

const state = {
  layout: createLayout(),
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

export function render() {
  drawLayout(canvas, state.layout, {
    room: state.layout.room,
    ghost: state.ghost,
    selected: state.selected,
    handles: true,
  });
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
