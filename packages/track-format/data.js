// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import { createLayout } from './model.js';
import { PIECES } from './geometry.js';
import { isTrack } from './identity.js';

export const SUPPORTED_VERSION = 2;
/** Every format version layoutFromData reads. Older ones are upgraded in memory. */
export const SUPPORTED_VERSIONS = [1, 2];

// Validate and rebuild a layout from plain data in the persisted shape.
// Split out of importHtml so the session store validates by exactly the
// same rules — two copies of "is this piece type real, is this rotation
// one of four, is this coordinate finite" is how the two paths drift, and
// these particular checks are what stop a hand-edited payload reaching
// the renderer.
/** @import { Layout, PlacedPiece, Room } from './types.js' */

/** @param {{ version: unknown, room?: Room | null, pieces: PlacedPiece[], track?: unknown }} data Unvalidated, in the persisted shape. @returns {Layout} */
export function layoutFromData(data) {

  if (!SUPPORTED_VERSIONS.includes(/** @type {number} */ (data.version))) {
    throw new Error(
      `This file was saved by a newer planner (version ${data.version}); this build reads version ${SUPPORTED_VERSION}.`,
    );
  }
  if (!Array.isArray(data.pieces)) {
    throw new Error('The layout data has no pieces array.');
  }
  for (const piece of data.pieces) {
    if (piece === null || typeof piece !== 'object' || Array.isArray(piece)) {
      throw new Error(`Invalid piece: ${JSON.stringify(piece)}`);
    }
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

  const layout = createLayout({
    room,
    pieces: data.pieces.map(({ type, x, y, rot }) => ({ type, x, y, rot })),
  });
  // A damaged track block costs only a re-issued id, never a file that won't open.
  if (isTrack(data.track)) layout.track = { id: data.track.id, shape: data.track.shape };
  return layout;
}

export const LAYOUT_SCRIPT_ID = 'layout';

const BLOCK = new RegExp(
  `<script[^>]*id=["']${LAYOUT_SCRIPT_ID}["'][^>]*>([\\s\\S]*?)</script>`,
  'i',
);

/** @param {string} html @returns {unknown} */
export function extractLayoutJson(html) {
  const match = BLOCK.exec(html);
  if (!match) throw new Error('This file has no layout data in it.');
  try {
    return JSON.parse(match[1]);
  } catch (cause) {
    throw new Error('The layout data in this file is not valid JSON.', { cause });
  }
}

/** @param {string} html @returns {Layout} */
export function layoutFromHtml(html) {
  return layoutFromData(/** @type {any} */ (extractLayoutJson(html)));
}
