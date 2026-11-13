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
// - transitions: palace's 0.1s (var(--p-transition)), or none;
// - font sizes: a size in px or rem is a --p-text-* step (em and %, which
//   follow the parent, as the big screen's sizes follow --board-font, stay
//   allowed).
//
// Shadows have their own check (shadows.test.js). Pages that must stand alone (the
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
 * Each is a size palace has no token for, or geometry, not spacing; take an
 * entry out when its value becomes a token.
 */
const EXCEPTIONS = new Map([
  // Navbar controls beside palace's navbar menu summary.
  ['apps/timing/public/app.css|.live-status:not(:empty)::before|margin-right: 6px', 'the live lamp before its word, between palace\'s steps'],
  ['apps/timing/public/app.css|.navbar-right .btn, .navbar-right .live-status|padding: 0 14px', '.btn-sm\'s and the menu summary\'s sides, which palace writes out too'],
  ['apps/timing/public/app.css|body.big .navbar-right .btn-icon|padding-inline: 12px', 'the big screen\'s icon button, between palace\'s steps'],
  ['apps/track-planner/css/app.css|.navbar-right > .btn|padding: 6px 10px', 'the phone navbar\'s buttons, narrower than .btn-sm so one row holds them'],
  // Display sizes that follow the screen between two sizes, one of them off the scale.
  ['apps/timing/public/app.css|.board-title|font-size: clamp(1.75rem, 5vw, 3.5rem)', 'the board\'s title'],
  ['apps/timing/public/app.css|.board-clock-time|font: 700 clamp(2.5rem, 9vw, 6rem) / 1 var(--p-font-mono)', 'the session clock'],
  ['apps/timing/public/app.css|.board-hero-time|font: 700 clamp(3.5rem, 11vw, 8rem) / 0.95 var(--p-font-mono)', 'the record\'s time'],
  ['apps/timing/public/app.css|.board-hero-none|font-size: clamp(var(--p-text-3xl), 5vw, 3.5rem)', 'the hero with no record yet'],
  ['apps/timing/public/app.css|.board-first h1|font-size: clamp(1.75rem, 4vw, var(--p-text-4xl))', 'the first-run heading'],
  ['apps/timing/public/app.css|.tap-bar .tap-result|font: 700 clamp(1.25rem, 5vw, 1.75rem)/1.2 var(--p-font-mono)', 'the tap screen\'s last time'],
  // Geometry, not spacing.
  ['apps/timing/public/app.css|.tp-rows > li > .tp|margin-top: 0.15rem', 'drops a number onto its row\'s first line'],
  ['apps/track-planner/css/app.css|.library-version::before|margin-top: -5px', 'centres a 10px stop on its line'],
  // A border palace has no width for.
  ['apps/accounts/public/accounts.css|.accounts-workspace|border-left-width: 8px', 'a club\'s lane colour'],
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
  if (/^font(-size)?$/.test(property) && px.test(bare)) return 'a raw font size: use a --p-text-* step';
  return null;
}

test('the rules catch raw values and leave tokens alone', () => {
  const bad = [
    ['color', '#fff'], ['background', 'rgba(0, 0, 0, 0.5)'], ['margin', '12px 0'], ['padding', '0 var(--p-space-md) 6px'],
    ['gap', '0.5rem'], ['margin-top', '-5px'], ['border-left-width', '8px'], ['outline', '3px solid var(--p-text)'],
    ['transition', 'transform 0.15s'], ['font-size', '13px'], ['font-size', '0.875rem'], ['font', '700 1rem/1 var(--p-font)'],
    ['font-size', 'clamp(1rem, 3.5vw, var(--p-text-2xl))'], ['font-size', 'max(0.7em, 14px)'],
  ];
  for (const [property, value] of bad) assert.ok(problem({ property, value }), `${property}: ${value}`);
  const good = [
    ['--tl-track-mat', '#262626'], ['color', 'var(--p-surface)'], ['margin', '0'], ['margin', '0 auto'],
    ['padding', 'var(--p-space-sm) var(--p-space-md)'], ['padding', '0.1em 0.5em'], ['gap', 'calc(var(--p-space-xs) - var(--p-space-md))'],
    ['padding-left', '1.25em'], ['border', 'var(--p-border-width) solid var(--p-text)'], ['border-left', '0.75rem solid var(--driver)'],
    ['outline', 'none'], ['transition', 'var(--p-transition)'], ['transition', 'none'], ['transition-property', 'box-shadow'],
    ['color', 'var(--driver, #888)'], ['font-size', 'var(--p-text-sm)'], ['font-size', '0.75em'], ['font-size', 'inherit'],
    ['font', '600 var(--p-text-2xs)/1.4 var(--p-font)'], ['font', 'inherit'], ['font-size', 'max(0.7em, var(--p-text-md))'],
    ['font-size', 'clamp(var(--p-text-lg), 3.5vw, var(--p-text-2xl))'], ['--board-font', 'clamp(1rem, 2.4vw, 2.6rem)'],
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

test('every stylesheet takes its colours, spaces, borders, durations and font sizes from tokens', () => {
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
