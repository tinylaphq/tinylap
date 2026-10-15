// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Problem types are defined once, in the API description, so the errors the
// server sends and the ones /api documents cannot disagree.
import openapi from './openapi.json' with { type: 'json' };

/** @type {Record<string, { status: number, title: string, description: string }>} */
export const PROBLEMS = openapi['x-tinylap-problems'];
