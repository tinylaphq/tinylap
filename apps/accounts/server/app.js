// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The request handler: TinyLap's pages, styles and scripts first, then
// everything else to Better Auth at the root, so the issuer is the origin.
// Security headers go on every response, whoever writes it.
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toNodeHandler } from 'better-auth/node';
import { packageRoots, within } from '../../../tools/serve-map.js';
import { createAuth, authOptions, seedClients } from './auth.js';
import { openDb } from './db.js';

const APP_DIR = fileURLToPath(new URL('..', import.meta.url));

const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

const isFile = (path) => stat(path).then((s) => s.isFile(), () => false);

// Placeholders until Task 3 builds the real pages.
const PLACEHOLDERS = {
  '/sign-in': 'Sign in',
  '/consent': 'Allow access',
};

function page(title) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · TinyLap</title>
<link rel="stylesheet" href="/pkg/palace-ui/palace.css">
<link rel="stylesheet" href="/pkg/design/design.css">
</head>
<body>
<main><h1>${title}</h1></main>
</body>
</html>
`;
}

function send(req, res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

/**
 * Static assets: /pkg/<name>/… from the app's dependencies (palace-ui,
 * @tinylap/design), /public/… from apps/accounts/public. Null if the path is
 * none of ours.
 */
function assetPath(roots, pathname) {
  const pkg = /^\/pkg\/([^/]+)\/(.+)$/.exec(pathname);
  if (pkg) {
    const root = roots.get(pkg[1]);
    return root ? within(root, pkg[2]) ?? false : false;
  }
  if (pathname.startsWith('/pkg/')) return false;
  if (pathname.startsWith('/public/')) return within(join(APP_DIR, 'public'), pathname.slice('/public/'.length)) ?? false;
  return null;
}

/**
 * @param {import('./config.js').Config} config
 */
export async function createAccounts(config) {
  const db = await openDb(config.dbPath, authOptions(config));
  const auth = createAuth(config, db);
  await seedClients(auth, config.clients);
  const betterAuth = toNodeHandler(auth);
  const roots = packageRoots(APP_DIR);
  const cache = config.dev ? 'no-store' : 'public, max-age=3600';

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  async function route(req, res) {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const readOnly = req.method === 'GET' || req.method === 'HEAD';

    const title = PLACEHOLDERS[pathname];
    if (title && readOnly) {
      return send(req, res, 200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': PAGE_CSP,
        'Cache-Control': 'no-store',
      }, page(title));
    }

    const asset = assetPath(roots, pathname);
    if (asset !== null) {
      const type = asset && TYPES[extname(asset)];
      if (!readOnly || !type || !(await isFile(asset))) {
        return send(req, res, 404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, 'not found');
      }
      return send(req, res, 200, { 'Content-Type': type, 'Cache-Control': cache }, await readFile(asset));
    }

    return betterAuth(req, res);
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  async function handler(req, res) {
    for (const [name, value] of Object.entries(BASE_HEADERS)) res.setHeader(name, value);
    res.removeHeader('Server');
    try {
      await route(req, res);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(req, res, 500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, 'server error');
      else res.destroy();
    }
  }

  return { handler, auth, db, close: () => db.close() };
}
