import { createLayout } from './model.js';
import { PIECES } from './geometry.js';

export const SUPPORTED_VERSION = 1;

// Validate and rebuild a layout from plain data in the persisted shape.
// Split out of importHtml so the session store validates by exactly the
// same rules — two copies of "is this piece type real, is this rotation
// one of four, is this coordinate finite" is how the two paths drift, and
// these particular checks are what stop a hand-edited payload reaching
// the renderer.
export function layoutFromData(data) {

  if (data.version !== SUPPORTED_VERSION) {
    throw new Error(
      `This file was saved by a newer planner (version ${data.version}); this build reads version ${SUPPORTED_VERSION}.`,
    );
  }
  if (!Array.isArray(data.pieces)) {
    throw new Error('The layout data has no pieces array.');
  }
  for (const piece of data.pieces) {
    // Object.hasOwn, not a truthy lookup: PIECES['__proto__'] and
    // PIECES['constructor'] are inherited and truthy, so a crafted file
    // or a hand-edited session entry got a bogus piece type past this
    // guard and threw deep in the renderer instead.
    if (!Object.hasOwn(PIECES, piece.type)) throw new Error(`Unknown piece type: ${piece.type}`);
    if (![0, 90, 180, 270].includes(piece.rot)) {
      throw new Error(`Unknown rotation: ${piece.rot}`);
    }
    if (!Number.isFinite(piece.x)) throw new Error(`Invalid piece x: ${piece.x}`);
    if (!Number.isFinite(piece.y)) throw new Error(`Invalid piece y: ${piece.y}`);
  }

  let room = null;
  if (data.room != null) {
    const { w, h } = data.room;
    if (!Number.isFinite(w) || !Number.isFinite(h)) {
      throw new Error(`Invalid room: ${JSON.stringify(data.room)}`);
    }
    room = { w, h };
  }

  return createLayout({
    room,
    pieces: data.pieces.map(({ type, x, y, rot }) => ({ type, x, y, rot })),
  });
}
