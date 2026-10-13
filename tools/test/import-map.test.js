// The browser resolves @tinylap/* through each app's import map; Node (the
// tests) resolves it through pnpm links and package exports. This keeps the
// two in agreement, and checks the rules the versioned deploy depends on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageRoots, jsEntry } from '../serve-map.js';

const APPS = fileURLToPath(new URL('../../apps/', import.meta.url));
const apps = readdirSync(APPS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(APPS, d.name));

const importMap = (html) => {
  const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]).imports : null;
};

const jsFiles = (dir) => readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => join(dir, f));

for (const app of apps) {
  const html = readFileSync(join(app, 'index.html'), 'utf8');

  test(`${app}: exactly one <base href="/">, before any other URL`, () => {
    assert.equal(html.split('<base href="/">').length - 1, 1);
    assert.ok(html.indexOf('<base href="/">') < html.search(/<(link|script)\b/));
  });

  test(`${app}: the import map lists exactly the JS dependencies, at their entries`, () => {
    const imports = importMap(html);
    assert.ok(imports, 'no import map');
    const expected = {};
    for (const [segment, root] of packageRoots(app)) {
      const entry = jsEntry(root);
      const { name } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      if (entry) expected[name ?? segment] = `./pkg/${segment}/${entry}`;
    }
    assert.deepEqual(imports, expected);
  });

  test(`${app}: no third-party URLs in the page`, () => {
    assert.doesNotMatch(html, /(href|src)="https?:\/\//);
  });

  // An open tab keeps the old /v/<sha>/ base after a deploy; that tree is
  // gone, so any module fetched later would 404. Everything loads up front.
  test(`${app}: no dynamic import()`, () => {
    for (const file of jsFiles(join(app, 'js'))) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /\bimport\s*\(/, file);
    }
  });
}
