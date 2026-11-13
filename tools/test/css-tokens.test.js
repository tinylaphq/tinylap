// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// TinyLap's stylesheets take their values from palace-ui's tokens (and
// @tinylap/design's --tl-*), not from raw numbers:
//
// - colours: no hex, rgb() or hsl() outside a custom property's definition;
// - spacing: a margin, padding or gap in px or rem is a --p-space-* token
//   (0, percentages and em, which follow the type, stay allowed);
// - borders and outlines: a width in px is --p-border-width or --p-border-thin;
// - transitions: palace's 0.1s (var(--p-transition)), or none.
//
// Shadows have their own check (shadows.test.js). Font sizes are not checked:
// palace has no type scale tokens yet. Pages that must stand alone (the
// exported layout, the API docs) write palace's look out literally in their
// own <style>, by design; they are not .css files and are not read here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SKIP = new Set(['node_modules', 'dist', 'test', '.turbo', 'pkg', 'vendor']);

/**
 * Values a rule may still use, each with its reason: `file|selector|property: value`.
 * Most wait on a decision in #107 (a token would change the look) or on a
 * size palace lacks; take an entry out when its value becomes a token.
 */
const EXCEPTIONS = new Map([
  // Sub-xs steps: palace has no space below --p-space-xs (4px).
  ['apps/timing/public/app.css|.board-laps .tag|padding: 1px 6px', 'a lap tag, smaller than palace\'s .tag'],
  ['apps/timing/public/app.css|.board-last-meta .tag|padding: 1px 6px', 'a lap tag, smaller than palace\'s .tag'],
  ['apps/timing/public/app.css|.history-table .tag|padding: 1px 6px', 'a lap tag, smaller than palace\'s .tag'],
  ['apps/timing/public/app.css|.lap-table .tag|padding: 1px 6px', 'a lap tag, smaller than palace\'s .tag'],
  ['apps/track-planner/css/app.css|.library-ws-head .tag|padding: 1px 6px', 'a lap tag, smaller than palace\'s .tag'],
  ['apps/timing/public/app.css|.net-note|margin-top: 2px', 'a note under its name'],
  ['apps/timing/public/app.css|.nav-account-hint|margin-top: 2px', 'a hint under its setting'],
  ['apps/track-planner/css/app.css|.library-meta|margin: 2px 0 0', 'a meta line under its name'],
  ['apps/timing/public/app.css|.bridge-stat|gap: 2px', 'a stat\'s label over its count'],
  ['apps/timing/public/app.css|.decoder-info|gap: 2px', 'a decoder\'s name over its meta'],
  ['apps/track-planner/css/app.css|.preset-info|gap: 2px', 'a card\'s name over its source'],
  ['apps/track-planner/css/app.css|.dialog-dismiss .btn|padding: 2px 8px', 'the dialogs\' close button'],
  ['apps/track-planner/css/app.css|.chip|padding: 2px 8px', 'a filter chip'],
  ['apps/track-planner/css/app.css|.library-current|padding: 2px var(--p-space-sm)', 'the library name in the navbar'],
  // Steps between palace's sizes (6, 10, 12, 14px): a token would move them.
  ['apps/timing/public/app.css|.live-status:not(:empty)::before|margin-right: 6px', 'the live lamp before its word'],
  ['apps/timing/public/app.css|.navbar-right .btn, .navbar-right .live-status|padding: 6px 14px', 'palace\'s .navbar-menu summary padding, written out'],
  ['apps/timing/public/app.css|body.big .navbar-right .btn-icon|padding-inline: 12px', 'the big screen\'s icon button'],
  ['apps/accounts/public/accounts.css|.accounts-progress li|gap: 6px', 'a step\'s number before its name'],
  ['apps/accounts/public/accounts.css|.accounts-hint|margin-top: 6px', 'a hint under its field'],
  ['apps/accounts/public/accounts.css|.accounts-workspace, .accounts-row|padding: 12px var(--p-space-md)', 'a club or member row'],
  ['apps/accounts/public/accounts.css|.accounts-reveal-note|margin-bottom: 10px', 'the reveal\'s note'],
  ['apps/accounts/public/accounts.css|.accounts-reveal-meta|margin-bottom: 12px', 'the reveal\'s meta'],
  ['apps/accounts/public/accounts.css|.accounts-reveal .status|margin-top: 12px', 'the reveal\'s status'],
  ['apps/track-planner/css/app.css|.library-form-row input|padding: 0 10px', 'a small field beside a .btn-sm'],
  ['apps/track-planner/css/app.css|.library-form-row select|padding: 0 2.5rem 0 10px', 'a small select beside a .btn-sm, room for palace\'s arrow'],
  ['apps/track-planner/css/app.css|.navbar-right > .btn|padding: 6px 10px', 'the phone navbar\'s buttons'],
  // Geometry, not spacing.
  ['apps/timing/public/app.css|.tp-rows > li > .tp|margin-top: 0.15rem', 'drops a number onto its row\'s first line'],
  ['apps/track-planner/css/app.css|.library-version::before|margin-top: -5px', 'centres a 10px stop on its line'],
  // Borders palace has no width for.
  ['apps/accounts/public/accounts.css|.accounts-workspace|border-left-width: 8px', 'a club\'s lane colour'],
  ['apps/timing/public/app.css|.tap-tile:focus-visible|outline: 3px solid var(--p-accent-3)', 'the tap tile\'s focus, wider than palace\'s'],
  ['apps/timing/public/app.css|.track-drawing:target .track-drawing-art|outline: 3px solid var(--tl-record)', 'the linked layout drawing'],
  // Slower than palace's 0.1s.
  ['apps/timing/public/app.css|.pick-row > summary::before|transition: transform 0.15s', 'a fold\'s triangle turning'],
  ['apps/timing/public/app.css|.collect-row|transition: box-shadow 0.15s', 'the crossing row\'s shadow easing in'],
]);

function* stylesheets(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* stylesheets(path);
    else if (entry.name.endsWith('.css')) yield path;
  }
}

/** Every declaration in `css` with the selector of the rule it sits in. */
function declarations(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const stack = [];
  let text = '';
  for (const ch of src) {
    if (ch === '{') { stack.push(text.trim()); text = ''; }
    else if (ch === ';' || ch === '}') {
      const i = text.indexOf(':');
      const selector = stack.at(-1) ?? '';
      if (i > 0 && stack.length && !selector.startsWith('@')) {
        out.push({ selector: selector.replace(/\s+/g, ' '), property: text.slice(0, i).trim(), value: text.slice(i + 1).trim().replace(/\s+/g, ' ') });
      }
      text = '';
      if (ch === '}') stack.pop();
    } else text += ch;
  }
  return out;
}

/** What is wrong with one declaration, or null. */
function problem({ property, value }) {
  if (property.startsWith('--')) return null;
  // The numbers outside var(): a token's fallback is the token's business.
  const bare = value.replace(/var\([^()]*(\([^()]*\))?[^()]*\)/g, 'var()');
  if (/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/i.test(bare)) return 'a raw colour: use a --p-* or --tl-* token';
  const px = /(^|[\s(,*+-])-?\d*\.?\d+(px|rem)\b/;
  if (/^(margin|padding)(-[a-z-]+)?$|^(row-|column-)?gap$/.test(property) && px.test(bare.replace(/\b0(px|rem)\b/g, '0'))) {
    return 'a raw space: use a --p-space-* token';
  }
  if (/^(border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-width)?|outline(-width)?)$/.test(property)
    && /(^|\s)[1-9]\d*(\.\d+)?px\b/.test(bare)) return 'a raw border width: use --p-border-width or --p-border-thin';
  if (/^transition(-duration)?$/.test(property) && /\d*\.?\d+m?s\b/.test(bare) && !/(^|\s)0?\.1s\b/.test(bare)) {
    return 'a raw duration: use var(--p-transition) (0.1s)';
  }
  return null;
}

test('the rules catch raw values and leave tokens alone', () => {
  const bad = [
    ['color', '#fff'], ['background', 'rgba(0, 0, 0, 0.5)'], ['margin', '12px 0'], ['padding', '0 var(--p-space-md) 6px'],
    ['gap', '0.5rem'], ['margin-top', '-5px'], ['border-left-width', '8px'], ['outline', '3px solid var(--p-text)'],
    ['transition', 'transform 0.15s'],
  ];
  for (const [property, value] of bad) assert.ok(problem({ property, value }), `${property}: ${value}`);
  const good = [
    ['--tl-track-mat', '#262626'], ['color', 'var(--p-surface)'], ['margin', '0'], ['margin', '0 auto'],
    ['padding', 'var(--p-space-sm) var(--p-space-md)'], ['padding', '0.1em 0.5em'], ['gap', 'calc(var(--p-space-xs) - var(--p-space-md))'],
    ['padding-left', '1.25em'], ['border', 'var(--p-border-width) solid var(--p-text)'], ['border-left', '0.75rem solid var(--driver)'],
    ['outline', 'none'], ['transition', 'var(--p-transition)'], ['transition', 'none'], ['transition-property', 'box-shadow'],
    ['color', 'var(--driver, #888)'],
  ];
  for (const [property, value] of good) assert.equal(problem({ property, value }), null, `${property}: ${value}`);
});

test('reads declarations with their selector, inside @media too', () => {
  const found = declarations('/* a: 1px */ .a { margin: 1px; }\n@media (max-width: 1px) { .b, .c { gap: 2px; color: red } }');
  assert.deepEqual(found, [
    { selector: '.a', property: 'margin', value: '1px' },
    { selector: '.b, .c', property: 'gap', value: '2px' },
    { selector: '.b, .c', property: 'color', value: 'red' },
  ]);
});

test('every stylesheet takes its colours, spaces, borders and durations from tokens', () => {
  const found = [];
  const used = new Set();
  for (const dir of ['apps', 'packages']) {
    for (const path of stylesheets(join(root, dir))) {
      const file = relative(root, path);
      for (const d of declarations(readFileSync(path, 'utf8'))) {
        const why = problem(d);
        if (!why) continue;
        const key = `${file}|${d.selector}|${d.property}: ${d.value}`;
        if (EXCEPTIONS.has(key)) used.add(key);
        else found.push(`${key}  (${why})`);
      }
    }
  }
  assert.deepEqual(found, [], 'raw values: use a token, or list the value in EXCEPTIONS with its reason');
  assert.deepEqual([...EXCEPTIONS.keys()].filter((k) => !used.has(k)), [], 'exceptions that no longer match: take them out');
});
