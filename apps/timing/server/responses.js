// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Response builders shared by every route module, kept apart from
// app.js so the modules do not import each other.
import { PROBLEMS } from './problems.js';

/** @typedef {{ status: number, headers?: Record<string, string>, body?: string | Buffer }} Response */

/** Pages the server renders have no scripts at all. */
export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** @returns {Response} */
export const json = (status, value, headers = {}) => ({
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof value === 'string' ? value : JSON.stringify(value),
});

/** @returns {Response} */
export const html = (status, text, headers = {}) => ({
  status,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_CSP, ...headers },
  body: text,
});

/** RFC 9457. @param {{ origin: string }} request @param {string} name @param {string} detail @returns {Response} */
export function problem(request, name, detail, headers = {}) {
  const { status, title } = PROBLEMS[name];
  return {
    status,
    headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store', ...headers },
    body: JSON.stringify({ type: `${request.origin}/problems/${name}`, title, status, detail }),
  };
}
