// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Builds the landing page into one folder GitHub Pages serves as it is: the
// page and its element, palace with its fonts, the design tokens and mark,
// the walkthrough films with their posters from docs/, and the link preview.
// Run: node build.js (writes dist/)
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (/** @type {string} */ path) => fileURLToPath(new URL(path, import.meta.url));
const resolved = (/** @type {string} */ specifier) => fileURLToPath(import.meta.resolve(specifier));

const MEDIA = ['walkthrough.mp4', 'walkthrough-poster.png', 'planner.mp4', 'planner-poster.png'];

/** Writes the site into `outDir`, replacing whatever was there. */
export async function build(/** @type {string} */ outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'media'), { recursive: true });
  cpSync(here('index.html'), join(outDir, 'index.html'));
  cpSync(here('elements'), join(outDir, 'elements'), { recursive: true });
  const palace = resolved('palace-ui/palace.css');
  cpSync(palace, join(outDir, 'palace.css'));
  cpSync(join(dirname(palace), 'fonts'), join(outDir, 'fonts'), { recursive: true });
  cpSync(resolved('@tinylap/design/design.css'), join(outDir, 'design.css'));
  cpSync(here('../../packages/design/mark.svg'), join(outDir, 'mark.svg'));
  for (const name of MEDIA) cpSync(here(`../../docs/${name}`), join(outDir, 'media', name));
  // share/render.js makes share.png inside a build, so the first render has none yet.
  if (existsSync(here('share.png'))) cpSync(here('share.png'), join(outDir, 'share.png'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await build(here('dist'));
