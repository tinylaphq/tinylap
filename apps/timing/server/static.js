// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Serves the app. With `root`, the assembled tree from tools/assemble.js:
// pages revalidate, /v/<sha>/ is immutable, .gz twins go to clients that
// accept them. Without it, the source through serve-map, never cached, so
// an edit shows on the next reload.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { packageRoots, resolveUrl, within } from '../../../tools/serve-map.js';
import { matchesEtag } from './negotiate.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

const isFile = (path) => stat(path).then((s) => s.isFile(), () => false);
const digest = (body) => createHash('sha256').update(body).digest('base64url').slice(0, 22);

/**
 * The app's policy: everything from its own origin, plus the inline
 * import map, allowed by its hash. Styles may be inline (SVG thumbnails
 * carry style attributes); scripts may not. `formAction` adds origins a
 * form may end up at: logging out posts to the planner, which redirects to
 * accounts' end-session page, and browsers check form-action on redirects.
 * @param {string} html @param {{ formAction?: string[] }} [options]
 */
export function appCsp(html, { formAction = [] } = {}) {
  const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)?.[1];
  const scripts = map === undefined ? "'self'" : `'self' 'sha256-${createHash('sha256').update(map).digest('base64')}'`;
  return [
    "default-src 'self'",
    `script-src ${scripts}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    ["form-action 'self'", ...formAction].join(' '),
    "frame-ancestors 'none'",
  ].join('; ');
}

/** @param {{ root?: string, appDir: string, formAction?: string[] }} options */
export function staticFiles({ root, appDir, formAction = [] }) {
  const dev = !root;
  const roots = dev ? packageRoots(appDir) : null;
  /** @type {Map<string, string>} */
  const etags = new Map();
  const missing = { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: 'not found' };

  return async (req, url) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }, body: '' };
    }
    const { pathname } = url;
    const file = dev ? resolveUrl(appDir, roots, pathname) : within(root, pathname.slice(1));
    if (!file || file.endsWith('.gz') || !(await isFile(file))) return missing;

    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    const cache = dev ? 'no-store' : pathname.startsWith('/v/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    /** @type {Record<string, string>} */
    const headers = { 'Content-Type': type, 'Cache-Control': cache };
    let body = await readFile(file);
    if (type.startsWith('text/html')) headers['Content-Security-Policy'] = appCsp(body.toString('utf8'), { formAction });
    if (dev) return { status: 200, headers, body };

    let tag = etags.get(file);
    if (!tag) etags.set(file, (tag = digest(body)));
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && (await isFile(`${file}.gz`));
    headers.Vary = 'Accept-Encoding';
    headers.ETag = gzip ? `"${tag}-gz"` : `"${tag}"`;
    if (matchesEtag(req, headers.ETag)) return { status: 304, headers };
    if (gzip) {
      headers['Content-Encoding'] = 'gzip';
      body = await readFile(`${file}.gz`);
    }
    return { status: 200, headers, body };
  };
}
