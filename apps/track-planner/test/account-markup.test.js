// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The planner page is static, so it writes the shared account control
// (@tinylap/design html/account.js) out by hand. This keeps the copy in step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accountMenu, signInLink } from '@tinylap/design/html/account.js';
import { brand } from '@tinylap/design/html/brand.js';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const normal = (html) => html.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();

/** The one fragment between <!-- name --> and <!-- /name -->. */
function fragment(name) {
  const parts = page.split(`<!-- ${name} -->`);
  assert.equal(parts.length, 2, `<!-- ${name} --> appears once`);
  const inner = parts[1].split(`<!-- /${name} -->`);
  assert.equal(inner.length, 2, `<!-- /${name} --> appears once`);
  return inner[0];
}

test('the page’s account menu is the shared one', () => {
  assert.equal(normal(fragment('account-menu')), normal(accountMenu({ name: 'Account', accountUrl: '/', items: [{ id: 'menu-library', label: 'Library', hidden: true }] })));
});

test('the page’s brand is the shared one', () => {
  assert.equal(normal(fragment('brand')), normal(brand({ href: './', name: 'TinyLap Planner', markSrc: './pkg/design/mark.svg' })));
});

test('the page’s Sign in is the shared one', () => {
  assert.equal(normal(fragment('sign-in')), normal(signInLink({ href: '/auth/login' })));
});
