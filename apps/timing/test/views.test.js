// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { Html, html, safe } from '../server/views/html.js';

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
});

import { textField } from '../server/views/form-parts.js';
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
