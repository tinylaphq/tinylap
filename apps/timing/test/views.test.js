// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { Html, html, safe } from '../server/views/html.js';
import { selectField } from '../server/views/form-parts.js';

test('interpolations are escaped', () => {
  const name = `<b>Ana</b> & "Ben" 'C'`;
  assert.equal(String(html`<li title="${name}">${name}</li>`),
    '<li title="&lt;b&gt;Ana&lt;/b&gt; &amp; &quot;Ben&quot; &#39;C&#39;">&lt;b&gt;Ana&lt;/b&gt; &amp; &quot;Ben&quot; &#39;C&#39;</li>');
});

test('templates nest, arrays join, empties vanish', () => {
  const items = ['a<', 'b'].map((x) => html`<li>${x}</li>`);
  assert.equal(String(html`<ul>${items}${null}${undefined}${false}</ul>`), '<ul><li>a&lt;</li><li>b</li></ul>');
  assert.equal(String(html`${0} ${''}`), '0 ');
  assert.ok(html`x` instanceof Html);
});

test('safe() passes trusted markup through', () => {
  assert.equal(String(html`<p>${safe('<br>')}</p>`), '<p><br></p>');
  assert.equal(safe('<i>').text, '<i>');
  assert.equal(String(html`<p>${safe(null)}${safe(undefined)}</p>`), '<p></p>');
});

test('made markup cannot be changed afterwards', () => {
  for (const made of [html`<p>x</p>`, safe('<p>x</p>')]) {
    assert.ok(Object.isFrozen(made));
    assert.throws(() => { made.text = '<script>'; }, TypeError);
    assert.equal(String(made), '<p>x</p>');
  }
});

import { copyable, textField } from '../server/views/form-parts.js';
import { clockOf } from '../server/views/board.js';

test('fields escape their values and mark their errors', () => {
  const out = String(textField({ id: 'n', label: 'Name', name: 'name', value: '"><script>', error: { field: 'name', message: 'Too <long>' } }));
  assert.match(out, /value="&quot;&gt;&lt;script&gt;"/);
  assert.match(out, /aria-invalid="true" aria-describedby="n-error"/);
  assert.match(out, /<p class="field-error" id="n-error">Too &lt;long&gt;<\/p>/);
});

test('the clock for each state, on the server', () => {
  const race = { kind: 'race', opensAt: 10_000, closesAt: 310_000 };
  assert.equal(clockOf(null, 0), null);
  assert.deepEqual(clockOf({ kind: 'practice', state: 'running', opensAt: 1000 }, 61_000), { label: 'Practice', ms: 60_000 });
  assert.deepEqual(clockOf({ kind: 'practice', state: 'done', opensAt: 1000 }, 61_000), { label: 'Practice ended', ms: 0 });
  assert.deepEqual(clockOf({ ...race, state: 'countdown' }, 5000), { label: 'Starts in', ms: 5000 });
  assert.deepEqual(clockOf({ ...race, state: 'running' }, 70_000), { label: 'Remaining', ms: 240_000 });
  assert.deepEqual(clockOf({ ...race, state: 'finishing' }, 400_000), { label: 'Last lap', ms: 0 });
  assert.deepEqual(clockOf({ ...race, state: 'aborted' }, 400_000), { label: 'Aborted', ms: 0 });
  assert.deepEqual(clockOf({ ...race, state: 'done' }, 400_000), { label: 'Finished', ms: 0 });
});

test('a copyable value: the Copy button and its hint are hidden until tl-copy shows them', () => {
  const out = String(copyable(html`<code class="token">abc</code>`));
  assert.match(out, /^<tl-copy class="copy"><code class="token">abc<\/code>/);
  assert.match(out, /<button type="button" class="btn btn-outline" hidden>Copy<\/button>/);
  assert.match(out, /<span class="visually-hidden" role="status"><\/span>/);
  assert.match(out, /<p class="field-hint copy-hint" hidden>Select it and copy it yourself\.<\/p>/);
});

test('a copyable field wraps its input, not its label', () => {
  const out = String(textField({ id: 'w', label: 'Link', name: 'link', value: 'https://x', readonly: true, copy: true }));
  assert.match(out, /<label for="w">Link<\/label>\s*<tl-copy class="copy"><input type="text" id="w"[^>]*readonly>/);
});

import { notFoundPage, startPage } from '../server/views/notice.js';

test('signed out, the start page has one Sign in, in its card; other pages keep the navbar one', () => {
  const signedOut = (path) => ({ session: null, url: new URL(path, 'https://timing.example') });
  const start = String(startPage(signedOut('/')));
  assert.equal(start.match(/>Sign in</g)?.length, 1);
  assert.match(start, /<a class="btn btn-primary" href="\/auth\/login\?returnTo=%2F">Sign in<\/a>/);
  assert.doesNotMatch(start, /nav-sign-in/);
  assert.match(String(notFoundPage(signedOut('/nope'))), /<a class="btn btn-sm btn-outline nav-sign-in" href="\/auth\/login\?returnTo=%2Fnope">Sign in<\/a>/);
});

test('selectField without a hint or data-name renders as it always has', () => {
  const options = [{ value: 'cw', label: 'Clockwise' }, { value: 'ccw', label: 'Counter-clockwise' }];
  assert.equal(String(selectField({ id: 'x', label: 'Direction', name: 'direction', options, value: 'cw' })),
    '<div class="field">\n  <label for="x">Direction</label>\n  <select id="x" name="direction">\n    <option value="cw" selected>Clockwise</option><option value="ccw">Counter-clockwise</option>\n  </select>\n  \n</div>');
  assert.equal(String(selectField({ id: 'x', label: 'Direction', name: 'direction', options, value: 'cw', error: { field: 'direction', message: 'Pick one.' } })),
    '<div class="field">\n  <label for="x">Direction</label>\n  <select id="x" name="direction" aria-invalid="true" aria-describedby="x-error">\n    <option value="cw" selected>Clockwise</option><option value="ccw">Counter-clockwise</option>\n  </select>\n  <p class="field-error" id="x-error">Pick one.</p>\n</div>');
});
