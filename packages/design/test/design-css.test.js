// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// design.css carries the shared tokens and the base rules the elements need.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../design.css', import.meta.url), 'utf8');

test('the track-surface tokens are there', () => {
  assert.match(css, /--tl-track-mat:/);
});

test('a frame is a block, and a hidden control stays hidden', () => {
  assert.match(css, /tl-frame \{ display: block; \}/);
  assert.match(css, /\[hidden\] \{ display: none !important; \}/);
});

test('page loads cross-fade with the navbar held still, and not for reduced motion', () => {
  assert.match(css, /@view-transition \{ navigation: auto; \}/);
  assert.match(css, /\.navbar \{ view-transition-name: navbar; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*@view-transition \{ navigation: none; \}/);
});

test('the shared account menu: visible focus, also on the current club; fits a phone navbar', () => {
  assert.match(css, /\.nav-account-signout:focus-visible \{ outline: 2px solid var\(--p-accent-2\); outline-offset: -2px; color: var\(--p-accent-2\); transform: none; box-shadow: none; \}/, 'buttons focus like links, without palace’s lift');
  const current = /\.nav-account-menu a\[aria-current="true"\] \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(current, /box-shadow/);
  assert.doesNotMatch(current, /outline/, 'the current club keeps the focus outline');
  assert.match(css, /max-width: min\(14rem, 40vw\)/);
  assert.match(css, /\.nav-account-menu a, \.nav-account-item, \.nav-account-signout \{[^}]*transition: none;/, 'no transition stuck in a closed menu');
  assert.match(css, /\.nav-account-menu \{[^}]*z-index: 100;/);
});

test('the brand, lockup and visually-hidden rules are shared', () => {
  for (const rule of ['.brand-lockup { gap: var(--p-space-sm); }', '.brand-lockup img { width: 32px; height: 32px; }', '.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }']) assert.ok(css.includes(rule), rule);
});
