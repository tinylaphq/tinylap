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
  drawLayout(canvas, state.layout, { room: state.layout.room });
}

renderPalette();
render();

state.tool = null;     // { type, rot }
state.ghost = null;    // { cells, valid }
state.hoverCell = null; // [x, y] last cell hovered while dragging
state.history = [];

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

canvas.addEventListener('dragover', (e) => {
  if (!state.tool) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  state.hoverCell = pointerCell(e);
  state.ghost = ghostFor(state.tool.type, state.tool.rot, state.hoverCell);
  drawLayout(canvas, state.layout, { room: state.layout.room, ghost: state.ghost });
});

canvas.addEventListener('dragleave', (e) => {
  if (canvas.contains(e.relatedTarget)) return;
  state.ghost = null;
  state.hoverCell = null;
  render();
});

canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!state.tool || !state.ghost?.valid) { state.ghost = null; state.hoverCell = null; render(); return; }
  const [x, y] = pointerCell(e);
  const { type, rot } = state.tool;
  commit((l) => l.pieces.push({ type, x, y, rot }));
  state.ghost = null;
  state.hoverCell = null;
  state.lastPlaced = { type, rot, x, y };
  render();
});

document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'r') return;
  if (state.tool) {
    state.tool.rot = (state.tool.rot + 90) % 360;
    if (state.hoverCell) {
      state.ghost = ghostFor(state.tool.type, state.tool.rot, state.hoverCell);
      drawLayout(canvas, state.layout, { room: state.layout.room, ghost: state.ghost });
    }
  }
});
