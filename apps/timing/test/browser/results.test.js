// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A session's result as drawn (board hub and results spec §6, §10): the rank
// gutter, measured (every position ends on one line, every colour square
// starts on one, cards and table alike), one width for every block, P1's
// pink numeral and shadow, the record's shadow on a practice that beat it,
// and the lap card a name links to lit when targeted; at a laptop and a phone.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { clubNight } from '../server/club-night.js';
import { startTiming, useTrack } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

const clock = { now: Date.UTC(2026, 10, 16, 18, 0) };
let app;
let browser;
let member;
/** @type {Record<string, string>} */
let sessions;
/** @type {Record<string, string>} */
let ids;

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  const ws = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  ({ sessions, ids } = await clubNight(app, clock, member, { ws, base: '/personal', useTrack }));
});
after(async () => {
  await browser?.close();
  await app?.close();
});

/** The result's geometry: each position's right edge, each square's left edge, each block's edges, and P1's colours. */
const measure = () => {
  const result = document.querySelector('.result');
  const edges = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; };
  // Measured from the inner left edge of the card or table each sits in, so P3 beside P2 counts too.
  const inner = (el) => { const box = el.closest('.place, table'); return box.getBoundingClientRect().left + box.clientLeft; };
  /** A driver's square is the chip's ::before: it starts at the chip's left edge. */
  const squares = [...result.querySelectorAll('.place:not(.is-pb) .place-name .driver, .result-table td.board-driver .driver')].map((el) => el.getBoundingClientRect().left - inner(el));
  /** A numeral ends where its text ends: a range around its digits. */
  const numerals = [...result.querySelectorAll('.place-pos, .result-table td.pos')].map((el) => {
    const range = document.createRange();
    const digits = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    range.selectNodeContents(digits);
    return range.getBoundingClientRect().right - inner(el);
  });
  const blocks = [...result.children].flatMap((el) => (el.classList.contains('place-tier') ? [el] : [el.matches('.board-scroll') ? el.querySelector('table') : el])).map(edges);
  const p1 = result.querySelector('.place.is-first');
  return {
    squares, numerals, blocks,
    p1: { numeral: getComputedStyle(p1.querySelector('.place-pos')).color, shadow: getComputedStyle(p1).boxShadow, record: p1.classList.contains('is-record') },
    accent: getComputedStyle(document.documentElement).getPropertyValue('--p-accent-1').trim(),
    recordColour: getComputedStyle(document.documentElement).getPropertyValue('--tl-record').trim(),
    scrollWidth: document.documentElement.scrollWidth, width: window.innerWidth,
  };
};
const spread = (xs) => Math.max(...xs) - Math.min(...xs);

/** A colour token as the browser computes it. */
const computed = (page, value) => page.evaluate((v) => { const el = document.createElement('i'); el.style.color = v; document.body.append(el); const c = getComputedStyle(el).color; el.remove(); return c; }, value);

for (const [label, viewport, rank, gap] of [['a laptop', { width: 1280, height: 800 }, 64, 16], ['a phone', { width: 390, height: 844 }, 40, 8]]) {
  for (const kind of ['race', 'qualifying', 'record', 'plain']) {
    test(`${label}, ${kind}: the rank gutter runs through cards and table, every block one width, P1 pink`, async () => {
      const { context, page, errors } = await pageAs(browser, app, member, { viewport });
      await page.goto(`/personal/sessions/${sessions[kind]}`);
      const m = await page.evaluate(measure);
      assert.ok(m.squares.length >= 3, `${m.squares.length} squares`);
      assert.equal(m.squares.length, m.numerals.length);
      assert.ok(spread(m.squares) <= 0.5, `squares start on one line: ${m.squares}`);
      assert.ok(spread(m.numerals) <= 0.5, `numerals end on one line: ${m.numerals}`);
      // The gutter: from a block's inner edge to the square is --rank; the numeral ends one gap before it.
      assert.ok(Math.abs(m.squares[0] - rank) <= 0.5, `the square ${m.squares[0]}px in, not ${rank}`);
      assert.ok(Math.abs(m.squares[0] - m.numerals[0] - gap) <= 0.5, `the gap ${m.squares[0] - m.numerals[0]}px`);
      const lefts = m.blocks.map((b) => b.left);
      const rights = m.blocks.map((b) => b.right);
      assert.ok(spread(lefts) <= 0.5 && spread(rights) <= 0.5, `one width: ${JSON.stringify(m.blocks)}`);
      assert.equal(m.p1.numeral, await computed(page, m.accent), 'P1\'s numeral is the accent');
      assert.match(m.p1.shadow, /4px 4px 0px/);
      const shadowColour = await computed(page, kind === 'record' ? m.recordColour : m.accent);
      assert.ok(m.p1.shadow.startsWith(shadowColour), `${m.p1.shadow} in ${shadowColour}`);
      assert.equal(m.p1.record, kind === 'record');
      assert.ok(m.scrollWidth <= m.width, 'no sideways scroll');
      assert.deepEqual(errors, []);
      await context.close();
    });
  }
}

test('a phone drops Time and Laps from the table; Gap and Best lap stay', async () => {
  const { context, page } = await pageAs(browser, app, member, { viewport: { width: 390, height: 844 } });
  await page.goto(`/personal/sessions/${sessions.race}`);
  const heads = await page.locator('.result-table th').evaluateAll((ths) => ths.filter((th) => th.offsetParent !== null).map((th) => th.textContent));
  assert.deepEqual(heads.filter((h) => h && h !== 'Position' && h !== 'Mark'), ['Driver', 'Gap', 'Best lap']);
  await context.close();
});

test('a name in the table opens its lap card, which takes the accent shadow', async () => {
  const { context, page, errors } = await pageAs(browser, app, member);
  await page.goto(`/personal/sessions/${sessions.race}`);
  const card = page.locator(`#driver-${ids.Dara}`);
  const before = await card.evaluate((el) => getComputedStyle(el).boxShadow);
  await page.locator('.result-table a', { hasText: 'Dara' }).click();
  assert.match(page.url(), new RegExp(`#driver-${ids.Dara}$`));
  const lit = await card.evaluate((el) => getComputedStyle(el).boxShadow);
  const accent2 = await computed(page, 'var(--p-accent-2)');
  assert.notEqual(lit, before);
  assert.ok(lit.startsWith(accent2), `${lit} in ${accent2}`);
  assert.deepEqual(errors, []);
  await context.close();
});
