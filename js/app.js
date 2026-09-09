import { createLayout, occupiedSet, cellKey } from './model.js';
import { drawLayout } from './render.js';
import { PIECES, placedCells } from './geometry.js';

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
  drawLayout(canvas, state.layout, { room: state.layout.room, selected: state.selected });
}

renderPalette();
render();

state.tool = null;     // { type, rot }
state.ghost = null;    // { cells, valid }
state.hoverCell = null; // [x, y] last cell hovered while dragging
state.history = [];
state.selected = null; // index into layout.pieces, or null
state.dragging = false; // true while a piece move-drag is in flight

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

document.querySelector('#palette-list').addEventListener('dragstart', (e) => {
  const type = e.target.dataset.type;
  if (!type) return;
  state.tool = { type, rot: 0 };
  e.dataTransfer.setData('text/plain', type);
  e.dataTransfer.effectAllowed = 'copy';
});

document.querySelector('#palette-list').addEventListener('dragend', () => {
  state.tool = null;
  state.ghost = null;
  state.hoverCell = null;
  render();
});

canvas.addEventListener('dragover', (e) => {
  if (!state.tool) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  state.hoverCell = pointerCell(e);
  state.ghost = ghostFor(state.tool.type, state.tool.rot, state.hoverCell);
  drawLayout(canvas, state.layout, { room: state.layout.room, ghost: state.ghost, selected: state.selected });
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
    render();
    return;
  }
  const [x, y] = state.hoverCell;
  const { type, rot } = state.tool;
  commit((l) => l.pieces.push({ type, x, y, rot }));
  state.tool = null;
  state.ghost = null;
  state.hoverCell = null;
  state.lastPlaced = { type, rot, x, y };
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

export function undo() {
  if (state.dragging) return; // a move-drag is holding grab.index/piece against
                               // the current state.layout; swapping it out from
                               // under an in-flight drag would corrupt it
  const previous = state.history.pop();
  if (previous) { state.layout = previous; state.selected = null; render(); }
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
        drawLayout(canvas, state.layout, { room: state.layout.room, ghost: state.ghost, selected: state.selected });
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
  }
});
