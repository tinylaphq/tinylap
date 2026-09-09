import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout } from '../js/model.js';
import { exportHtml, importHtml, extractLayoutJson } from '../js/storage.js';
import { rectangularRing } from './fixtures.js';

const ring = () => createLayout({ pieces: rectangularRing(), room: { w: 12, h: 15 } });

test('the export is a complete html document with an inline svg', () => {
  const html = exportHtml(ring());
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<svg /);
  assert.match(html, /<\/html>\s*$/);
});

test('the export states its dimensions, mat count and lap length', () => {
  const html = exportHtml(ring());
  assert.match(html, /2\.10 m/);
  assert.match(html, /2\.70 m/);
  assert.match(html, /48/);
});

test('the layout json rides along and survives a round trip', () => {
  const before = ring();
  const after = importHtml(exportHtml(before));
  assert.deepEqual(after, before);
});

test('the json block is found without a DOM', () => {
  const data = extractLayoutJson(exportHtml(ring()));
  assert.equal(data.version, 1);
  assert.equal(data.pieces.length, 20);
});

test('a future version is rejected outright', () => {
  const html = exportHtml(ring()).replace('"version": 1', '"version": 99');
  assert.throws(() => importHtml(html), /version 99/);
});

test('an unknown piece type is rejected', () => {
  const html = exportHtml(ring()).replace('"straight"', '"loopTheLoop"');
  assert.throws(() => importHtml(html), /loopTheLoop/);
});

test('a file with no layout block is rejected', () => {
  assert.throws(() => importHtml('<!doctype html><html><body>hi</body></html>'), /no layout/i);
});

test('a piece with a non-numeric x is rejected', () => {
  const html = exportHtml(ring()).replace('"x": 0', '"x": "nope"');
  assert.throws(() => importHtml(html), /nope/);
});

test('a piece with a non-finite y is rejected', () => {
  const html = exportHtml(ring()).replace('"y": 0', '"y": null');
  assert.throws(() => importHtml(html), /null/);
});

test('a malformed room is rejected', () => {
  const html = exportHtml(ring()).replace('"w": 12', '"w": "wide"');
  assert.throws(() => importHtml(html), /room/i);
});

test('a round trip still works for a valid layout with a non-null room', () => {
  const before = ring();
  const after = importHtml(exportHtml(before));
  assert.deepEqual(after, before);
});

test('the json block escapes an embedded </script> to prevent injection', () => {
  const layout = {
    version: 1,
    unit: 'mat',
    room: null,
    pieces: [{ type: 'straight', x: 0, y: 0, rot: 0, note: '</script><script>alert(1)</script>' }],
  };
  const html = exportHtml(layout);
  assert.doesNotMatch(html, /<\/script><script>alert\(1\)<\/script>/);
  const data = extractLayoutJson(html);
  assert.equal(data.pieces[0].note, '</script><script>alert(1)</script>');
});
