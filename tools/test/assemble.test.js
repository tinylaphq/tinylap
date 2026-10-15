// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../assemble.js';

const SHA = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';

function fixture(indexHtml = '<head><base href="/"><link href="./css/a.css"></head>') {
  const root = mkdtempSync(join(tmpdir(), 'assemble-'));
  const app = join(root, 'app');
  const pkg = join(root, 'pkg');
  mkdirSync(join(app, 'css'), { recursive: true });
  mkdirSync(join(app, 'test'), { recursive: true });
  mkdirSync(join(app, 'node_modules', '@tinylap'), { recursive: true });
  mkdirSync(join(pkg, 'test'), { recursive: true });
  writeFileSync(join(app, 'package.json'), JSON.stringify({ files: ['index.html', 'css'], dependencies: { '@tinylap/fmt': 'workspace:*' } }));
  writeFileSync(join(app, 'index.html'), indexHtml);
  writeFileSync(join(app, 'css', 'a.css'), 'a{}');
  writeFileSync(join(app, 'test', 'x.test.js'), '');
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ exports: { '.': './index.js' } }));
  writeFileSync(join(pkg, 'index.js'), 'export {};');
  writeFileSync(join(pkg, 'test', 'y.test.js'), '');
  symlinkSync(pkg, join(app, 'node_modules', '@tinylap', 'fmt'));
  return { app, out: join(root, 'out') };
}

test('the page points at the versioned tree and everything is copied under it', () => {
  const { app, out } = fixture();
  assemble(app, out, SHA);
  assert.match(readFileSync(join(out, 'index.html'), 'utf8'), new RegExp(`<base href="/v/${SHA}/">`));
  assert.ok(existsSync(join(out, 'v', SHA, 'css', 'a.css')));
  assert.ok(existsSync(join(out, 'v', SHA, 'pkg', 'fmt', 'index.js')));
});

test('tests and node_modules are not shipped', () => {
  const { app, out } = fixture();
  assemble(app, out, SHA);
  assert.ok(!existsSync(join(out, 'v', SHA, 'test')));
  assert.ok(!existsSync(join(out, 'v', SHA, 'pkg', 'fmt', 'test')));
});

test('a missing or malformed sha fails instead of serving /v//', () => {
  for (const sha of ['', undefined, 'main', '../x', 'A1B2C3D']) {
    const { app, out } = fixture();
    assert.throws(() => assemble(app, out, sha), /sha/i, String(sha));
  }
});

test('an index without exactly one <base href="/"> fails loudly', () => {
  for (const html of ['<head></head>', '<base href="/"><base href="/">', '<base href="/app/">']) {
    const { app, out } = fixture(html);
    assert.throws(() => assemble(app, out, SHA), /base/i, html);
  }
});

test('every text file gets a gzip twin, binaries do not', async () => {
  const { gunzipSync } = await import('node:zlib');
  const { app, out } = fixture();
  writeFileSync(join(app, 'css', 'font.woff2'), 'binary');
  assemble(app, out, SHA);
  const css = join(out, 'v', SHA, 'css', 'a.css');
  assert.equal(gunzipSync(readFileSync(`${css}.gz`)).toString(), 'a{}');
  assert.ok(existsSync(join(out, 'index.html.gz')));
  assert.ok(existsSync(join(out, 'v', SHA, 'pkg', 'fmt', 'index.js.gz')));
  assert.ok(!existsSync(join(out, 'v', SHA, 'css', 'font.woff2.gz')));
});

test('an app without index.html gets its files and packages and no page', () => {
  const { app, out } = fixture();
  writeFileSync(join(app, 'package.json'), JSON.stringify({ files: ['css'], dependencies: { '@tinylap/fmt': 'workspace:*' } }));
  rmSync(join(app, 'index.html'));
  assemble(app, out, SHA);
  assert.equal(existsSync(join(out, 'index.html')), false);
  assert.equal(readFileSync(join(out, 'v', SHA, 'css', 'a.css'), 'utf8'), 'a{}');
  assert.ok(existsSync(join(out, 'v', SHA, 'pkg', 'fmt', 'index.js')));
});
