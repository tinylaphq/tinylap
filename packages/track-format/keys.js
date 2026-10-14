// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// Content addresses for layouts and shapes. A snapshot key names one exact
// layout, a shape key one physical build; see docs/identity.md. Both hash
// with crypto.subtle so browsers and Node compute the same keys.
import { layoutFromData, layoutFromHtml } from './data.js';

/** @import { Layout } from './types.js' */

/** 22 base64url characters: 16 bytes of SHA-256. */
export const KEY_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const order = (/** @type {string} */ a, /** @type {string} */ b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The bytes a snapshot key is computed from. layoutFromData rebuilds the
 * layout with a fixed key order; pieces are sorted because their order
 * carries no meaning, so one build listed two ways is one snapshot.
 * @param {unknown} data @returns {string}
 */
export function canonicalJson(data) {
  const layout = layoutFromData(/** @type {any} */ (data));
  const pieces = [...layout.pieces].sort((a, b) => a.y - b.y || a.x - b.x || order(a.type, b.type) || a.rot - b.rot);
  return JSON.stringify({ ...layout, pieces });
}

/** @param {string} text @returns {Promise<string>} */
async function key(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const bytes = new Uint8Array(digest).subarray(0, 16);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {unknown} layout @returns {Promise<string>} */
export const snapshotKey = (layout) => key(canonicalJson(layout));

/** @param {string} shape A shapeOf result, prefix included. @returns {Promise<string>} */
export const shapeKey = (shape) => key(shape);

/**
 * Reads a layout from JSON or from a page the planner exported.
 * @param {string} text @returns {Layout}
 */
export function parseLayout(text) {
  return /^\s*\{/.test(text) ? layoutFromData(JSON.parse(text)) : layoutFromHtml(text);
}
