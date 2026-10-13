// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Lays an app out for production: /index.html points its <base> at
// /v/<sha>/, and everything it loads lives under that path. A deploy changes
// every asset URL at once, so assets can be cached forever and a visitor can
// never mix files from two deploys.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageRoots } from './serve-map.js';

const BASE = '<base href="/">';
const skip = (src) => !['node_modules', 'test', '.turbo'].includes(basename(src));

export function assemble(appDir, outDir, sha) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/.test(sha)) {
    throw new Error(`assemble: expected a git sha (7-40 lowercase hex), got ${JSON.stringify(sha)}`);
  }
  const html = readFileSync(join(appDir, 'index.html'), 'utf8');
  const count = html.split(BASE).length - 1;
  if (count !== 1) throw new Error(`assemble: index.html must contain exactly one ${BASE}, found ${count}`);

  const tree = join(outDir, 'v', sha);
  mkdirSync(tree, { recursive: true });
  const { files = [] } = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
  for (const entry of files) {
    if (entry !== 'index.html') cpSync(join(appDir, entry), join(tree, entry), { recursive: true, filter: skip });
  }
  for (const [segment, root] of packageRoots(appDir)) {
    cpSync(root, join(tree, 'pkg', segment), { recursive: true, dereference: true, filter: skip });
  }
  writeFileSync(join(outDir, 'index.html'), html.replace(BASE, `<base href="/v/${sha}/">`));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [appDir, outDir, sha] = process.argv.slice(2);
  assemble(resolve(appDir), resolve(outDir), sha);
}
