import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageSegment, packageRoots, resolveUrl, jsEntry } from '../serve-map.js';

// A throwaway app with one JS package and one CSS-only package, linked the
// way pnpm links workspace and registry dependencies.
function fixture() {
  // realpath: on macOS tmpdir() is under /var, a symlink to /private/var,
  // and packageRoots returns real paths.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'serve-map-')));
  const app = join(root, 'app');
  const fmt = join(root, 'fmt');
  const css = join(root, 'css');
  for (const d of [app, fmt, css, join(app, 'node_modules', '@tinylap')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(app, 'package.json'), JSON.stringify({ dependencies: { '@tinylap/track-format': 'workspace:*', 'palace-ui': '^0.10.0' } }));
  writeFileSync(join(app, 'index.html'), '<base href="/">');
  writeFileSync(join(fmt, 'package.json'), JSON.stringify({ exports: { '.': './index.js' } }));
  writeFileSync(join(fmt, 'index.js'), 'export {};');
  writeFileSync(join(css, 'package.json'), JSON.stringify({ main: 'palace.css' }));
  writeFileSync(join(css, 'palace.css'), '');
  symlinkSync(fmt, join(app, 'node_modules', '@tinylap', 'track-format'));
  symlinkSync(css, join(app, 'node_modules', 'palace-ui'));
  return { app, fmt, css };
}

test('scoped TinyLap packages drop their scope, others keep their name', () => {
  assert.equal(packageSegment('@tinylap/track-format'), 'track-format');
  assert.equal(packageSegment('palace-ui'), 'palace-ui');
});

test('every dependency gets a root, resolved through its symlink', () => {
  const { app, fmt, css } = fixture();
  const roots = packageRoots(app);
  assert.deepEqual([...roots.keys()].sort(), ['palace-ui', 'track-format']);
  assert.equal(roots.get('track-format'), fmt);
  assert.equal(roots.get('palace-ui'), css);
});

test('urls map to app files and package files', () => {
  const { app, fmt } = fixture();
  const roots = packageRoots(app);
  assert.equal(resolveUrl(app, roots, '/'), join(app, 'index.html'));
  assert.equal(resolveUrl(app, roots, '/pkg/track-format/index.js'), join(fmt, 'index.js'));
});

test('traversal and unknown packages resolve to nothing', () => {
  const { app } = fixture();
  const roots = packageRoots(app);
  for (const p of ['/../secret', '/pkg/track-format/../../secret', '/%2e%2e/secret', '/..%2fsecret', '/pkg/nope/x.js', '/pkg/']) {
    assert.equal(resolveUrl(app, roots, p), null, p);
  }
});

test('the js entry comes from exports or main, and css-only packages have none', () => {
  const { fmt, css } = fixture();
  assert.equal(jsEntry(fmt), 'index.js');
  assert.equal(jsEntry(css), null);
});
