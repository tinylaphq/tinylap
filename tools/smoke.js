// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Crawls a running deployment the way a browser would and fails on any
// broken promise the versioned layout makes: the page revalidates, every
// asset is immutable, and every URL the page can reach (stylesheets, fonts,
// the module graph through the import map) answers 200.
import { stripComments } from './js-source.js';

const base = new URL(process.argv[2] ?? 'http://localhost:8080/');
const failures = [];
const fail = (msg) => failures.push(msg);

async function get(url) {
  const res = await fetch(url);
  if (res.status !== 200) fail(`${url} -> ${res.status}`);
  return res;
}

const page = await get(base);
if (!/no-cache/.test(page.headers.get('cache-control') ?? '')) fail(`/ is not no-cache: ${page.headers.get('cache-control')}`);
const html = await page.text();
const baseHref = html.match(/<base href="([^"]+)">/)?.[1];
if (!baseHref?.startsWith('/v/')) fail(`base href is not versioned: ${baseHref}`);
const root = new URL(baseHref ?? '/', base);
const imports = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1] ?? '{"imports":{}}').imports;

// A missing asset must never be cached: during a rolling deploy a request can
// reach a machine that lacks the file, and a cached 404 would stick for a year.
const missing = await fetch(new URL('does-not-exist.js', root));
if (missing.status !== 404) fail(`missing asset answered ${missing.status}, expected 404`);
if (/immutable/.test(missing.headers.get('cache-control') ?? '')) fail(`a 404 under ${root.pathname} is cacheable: ${missing.headers.get('cache-control')}`);

const seen = new Set();
const queue = [...html.matchAll(/<(?:link[^>]+href|script[^>]+src)="(\.\/[^"]+)"/g)].map((m) => new URL(m[1], root));

while (queue.length) {
  const url = queue.shift();
  if (seen.has(url.href)) continue;
  seen.add(url.href);
  const res = await get(url);
  if (!/immutable/.test(res.headers.get('cache-control') ?? '')) fail(`${url.pathname} is not immutable`);
  const raw = url.pathname.endsWith('.js') || url.pathname.endsWith('.css') ? await res.text() : '';
  const text = url.pathname.endsWith('.js') ? stripComments(raw) : raw;
  if (url.pathname.endsWith('.css')) {
    for (const m of text.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) if (!m[1].startsWith('data:')) queue.push(new URL(m[1], url));
  }
  if (url.pathname.endsWith('.js')) {
    for (const m of text.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (spec.startsWith('.')) queue.push(new URL(spec, url));
      else if (imports[spec]) queue.push(new URL(imports[spec], root));
      else fail(`${url.pathname} imports unmapped "${spec}"`);
    }
  }
}

console.log(`checked ${seen.size + 1} urls`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
