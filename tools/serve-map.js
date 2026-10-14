// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The URL space every TinyLap app is served under, in dev and in prod:
//   /                 the app folder
//   /pkg/<segment>/   one of the app's dependencies, by name without scope,
//                     unless its package.json says "tinylap": { "serve": false }
//                     (server-only code, such as @tinylap/auth)
// Shared by the dev server and the assemble step so the two cannot disagree.
import { readFileSync, realpathSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';

const SCOPE = '@tinylap/';

export const packageSegment = (name) => (name.startsWith(SCOPE) ? name.slice(SCOPE.length) : name);

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

export function packageRoots(appDir) {
  const { dependencies = {} } = readJson(join(appDir, 'package.json'));
  const roots = new Map();
  for (const name of Object.keys(dependencies)) {
    const root = realpathSync(join(appDir, 'node_modules', ...name.split('/')));
    if (readJson(join(root, 'package.json')).tinylap?.serve === false) continue;
    roots.set(packageSegment(name), root);
  }
  return roots;
}

// Joins `rest` under `root`, or returns null if the result would escape it.
// Decoding happens first, so %2e%2e and %2f cannot smuggle a `..` past the
// check.
export function within(rootDir, rest) {
  const root = resolve(rootDir);
  let decoded;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const target = normalize(join(root, decoded));
  return target === root || target.startsWith(root + sep) ? target : null;
}

export function resolveUrl(appDir, roots, pathname) {
  if (pathname === '/' || pathname === '') return join(appDir, 'index.html');
  const pkg = pathname.match(/^\/pkg\/([^/]+)\/(.+)$/);
  if (pkg) {
    const root = roots.get(pkg[1]);
    return root ? within(root, pkg[2]) : null;
  }
  if (pathname.startsWith('/pkg/')) return null;
  return within(appDir, pathname.slice(1));
}

export function jsEntry(pkgDir) {
  const { exports, main } = readJson(join(pkgDir, 'package.json'));
  const dot = typeof exports === 'string' ? exports : exports?.['.'];
  const entry = typeof dot === 'string' ? dot : dot?.default ?? (typeof main === 'string' ? main : null);
  return typeof entry === 'string' && entry.endsWith('.js') ? entry.replace(/^\.\//, '') : null;
}
