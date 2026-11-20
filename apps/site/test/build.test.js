// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../build.js';

const REPO = new URL('../../../', import.meta.url);
const BLOB = 'https://github.com/tinylaphq/tinylap/blob/main/';
let out = '';
let html = '';

before(async () => {
  out = mkdtempSync(join(tmpdir(), 'tinylap-site-'));
  await build(out);
  html = readFileSync(join(out, 'index.html'), 'utf8');
});

/** @param {string} name */
const values = (name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map((m) => m[1]);
const assets = () => [...values('src'), ...values('poster'), ...values('href').filter((h) => !h.startsWith('http') && !h.startsWith('#'))];

/** GitHub's anchor for a heading: lowercase, punctuation dropped, spaces to hyphens. */
const slug = (/** @type {string} */ heading) => heading.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replace(/ /g, '-');

test('every asset the page loads is in dist', () => {
  for (const path of assets()) assert.ok(existsSync(join(out, path)), path);
  const css = readFileSync(join(out, 'palace.css'), 'utf8');
  for (const [, path] of css.matchAll(/url\('([^']+)'\)/g)) assert.ok(existsSync(join(out, path)), path);
});

test('asset paths are relative', () => {
  for (const path of assets()) assert.ok(!path.startsWith('/'), path);
});

test('nothing loads from another origin', () => {
  for (const path of [...values('src'), ...values('poster')]) assert.ok(!/^https?:/.test(path), path);
  for (const [, href] of html.matchAll(/<link[^>]*rel="(?:stylesheet|icon)"[^>]*href="([^"]*)"/g)) assert.ok(!/^https?:/.test(href), href);
});

test('links go to files in the repository', () => {
  const links = values('href').filter((h) => h.startsWith(BLOB)).map((h) => h.slice(BLOB.length));
  assert.deepEqual(links.toSorted(), [
    'README.md#planner',
    'README.md#timing',
    'docs/timing.md',
    'firmware/tinylap-decoder/README.md',
    'firmware/tinylap-transponder/README.md',
  ]);
  const readme = readFileSync(new URL('README.md', REPO), 'utf8');
  const anchors = [...readme.matchAll(/^#+ (.+)$/gm)].map((m) => slug(m[1]));
  for (const link of links) {
    const [file, anchor] = link.split('#');
    assert.ok(existsSync(new URL(file, REPO)), file);
    if (anchor) assert.ok(anchors.includes(anchor), link);
  }
});

test('no hosted instance is linked', () => {
  assert.doesNotMatch(html, /fly\.dev/);
});

test('github appears once', () => {
  assert.equal(values('href').filter((h) => h === 'https://github.com/tinylaphq/tinylap').length, 1);
  assert.equal(values('href').filter((h) => h.startsWith('https://github.com/') && !h.startsWith(BLOB)).length, 1);
});

test('the headline says what it is, in three lines', () => {
  const h1 = html.match(/<h1[^>]*>(.*?)<\/h1>/)?.[1] ?? '';
  assert.deepEqual([...h1.matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1]), ['Lap timing', 'for Mini-Z', 'racing']);
});

test('the hero film is described as the README describes it', () => {
  const readme = readFileSync(new URL('README.md', REPO), 'utf8');
  const alt = readme.match(/!\[([^\]]+)\]\(docs\/walkthrough\.gif\)/)?.[1];
  assert.equal(html.match(/<tl-autoplay>\s*<video[^>]*aria-label="([^"]*)"/)?.[1], alt);
});

test('link previews get a title, a description and the share card', () => {
  /** @param {string} key */
  const meta = (key) => html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`))?.[1];
  assert.equal(meta('og:title'), 'TinyLap: lap timing for Mini-Z racing');
  assert.equal(meta('og:description'), meta('description'));
  assert.equal(meta('og:url'), 'https://tinylaphq.github.io/tinylap/');
  assert.equal(meta('og:type'), 'website');
  // Bump ?v= with every new card: previews cache an image by its URL.
  assert.equal(meta('og:image'), 'https://tinylaphq.github.io/tinylap/share.png?v=2');
  assert.equal(meta('og:image:width'), '1200');
  assert.equal(meta('og:image:height'), '630');
  assert.ok(meta('og:image:alt'));
  assert.equal(meta('twitter:card'), 'summary_large_image');
  const png = readFileSync(join(out, 'share.png'));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
  // WhatsApp leaves out a preview image much over 300 KB.
  assert.ok(png.length < 300_000, `${png.length} bytes`);
});

test('the hero video can play without script', () => {
  const hero = html.match(/<tl-autoplay>\s*<video([^>]*)>/)?.[1] ?? '';
  for (const attr of [' controls', ' muted', ' loop', ' playsinline']) assert.ok(hero.includes(attr), attr);
  const planner = html.match(/<video([^>]*planner\.mp4[^>]*)>/)?.[1] ?? '';
  assert.ok(planner.includes(' controls'), 'planner controls');
  assert.ok(planner.includes('preload="none"'), 'planner preload');
});
