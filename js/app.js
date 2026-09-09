import { createLayout } from './model.js';
import { drawLayout } from './render.js';
import { PIECES } from './geometry.js';

const canvas = document.querySelector('#canvas');

const state = {
  layout: createLayout({ pieces: [{ type: 'cornerR30', x: 0, y: 0, rot: 0 }] }),
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
