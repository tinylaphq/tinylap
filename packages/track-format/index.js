// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

export * from './geometry.js';
export * from './model.js';
export * from './data.js';
export * from './identity.js';
export * from './svg.js';
export * from './reference-layouts.js';

// The data model types, so consumers can import them from the package root.
/** @typedef {import('./types.js').Dir} Dir */
/** @typedef {import('./types.js').Corner} Corner */
/** @typedef {import('./types.js').Rotation} Rotation */
/** @typedef {import('./types.js').Cell} Cell */
/** @typedef {import('./types.js').PieceType} PieceType */
/** @typedef {import('./types.js').Port} Port */
/** @typedef {import('./types.js').CapWall} CapWall */
/** @typedef {import('./types.js').ArcWall} ArcWall */
/** @typedef {import('./types.js').Wall} Wall */
/** @typedef {import('./types.js').MatCounts} MatCounts */
/** @typedef {import('./types.js').PieceDef} PieceDef */
/** @typedef {import('./types.js').PlacedPiece} PlacedPiece */
/** @typedef {import('./types.js').Room} Room */
/** @typedef {import('./types.js').Layout} Layout */
/** @typedef {import('./types.js').Track} Track */
/** @typedef {import('./types.js').Direction} Direction */
/** @typedef {import('./types.js').BBox} BBox */
/** @typedef {import('./types.js').Metrics} Metrics */
/** @typedef {import('./types.js').BarrierCounts} BarrierCounts */
/** @typedef {import('./types.js').Barriers} Barriers */
