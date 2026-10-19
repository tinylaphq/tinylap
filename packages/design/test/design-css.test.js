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

test('a frame is a block; [hidden] comes from palace-ui 0.11', () => {
  assert.match(css, /tl-frame \{ display: block; \}/);
  assert.doesNotMatch(css, /\[hidden\] \{/, 'no local copy');
});

test('page loads cross-fade with the navbar held still, and not for reduced motion', () => {
  assert.match(css, /@view-transition \{ navigation: auto; \}/);
  assert.match(css, /\.navbar \{ view-transition-name: navbar; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*@view-transition \{ navigation: none; \}/);
});

test('the account menu and visually-hidden come from palace-ui, not a copy here', () => {
  const palace = readFileSync(new URL('../node_modules/palace-ui/palace.css', import.meta.url), 'utf8');
  for (const rule of ['.navbar-menu > summary {', '.navbar-menu-panel {', '.navbar-menu-panel a[aria-current]', '.visually-hidden {']) assert.ok(palace.includes(rule), `palace has ${rule}`);
  assert.doesNotMatch(css, /\.nav-account-menu|\.visually-hidden \{|\.nav-account > details/, 'no local copy');
  assert.match(css, /\.nav-account \{ display: block; \}/, 'tl-menu is a block');
});

test('the brand and lockup rules are shared', () => {
  for (const rule of ['.brand-lockup { gap: var(--p-space-sm); }', '.brand-lockup img { width: 32px; height: 32px; }']) assert.ok(css.includes(rule), rule);
});
