// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Page responses (spec §4.2): HTML with the page CSP, never cached, never
// CORS (credentials: true), and 303s for POST/redirect/GET.
import { SPECULATION_HASH } from '@tinylap/design/html/speculation.js';

/** @param {any} request @param {string[]} [scriptHashes] e.g. 'sha256-…' for an import map; every page also allows its speculation rules */
export function pageCsp(request, scriptHashes = []) {
  const issuer = request.auth ? ` ${new URL(request.auth.issuer).origin}` : '';
  return [
    "default-src 'self'",
    `script-src 'self'${[SPECULATION_HASH, ...scriptHashes].map((h) => ` '${h}'`).join('')}`,
    // Inline styles only, for driver colour swatches (as the planner allows).
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    `form-action 'self'${issuer}`,
    "frame-ancestors 'none'",
  ].join('; ');
}

/** @param {any} request @param {number} status @param {unknown} body @param {{ headers?: Record<string, any>, scriptHashes?: string[] }} [options] */
export const page = (request, status, body, { headers = {}, scriptHashes = [] } = {}) => ({
  status,
  credentials: true,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': pageCsp(request, scriptHashes), 'Cache-Control': 'no-store', ...headers },
  body: String(body),
});

/** @param {string} location @param {Record<string, any>} [headers] */
export const seeOther = (location, headers = {}) => ({ status: 303, credentials: true, headers: { Location: location, 'Cache-Control': 'no-store', ...headers }, body: '' });
