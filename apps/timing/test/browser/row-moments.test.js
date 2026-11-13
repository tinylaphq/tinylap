// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A row's moment (fastest lap spec §4, §9): when a swap brings a standings
// row whose data-moment the page has not seen, tl-board lights that row in
// its mark's colour, behind its text; never on the first render or a page
// load. A swap during it carries it over at its elapsed time; nothing it adds
// stays.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming, useTrack } from '../server/helpers.js';
import { openBrowser, pageAs, postPassings } from './browser.js';

// Server time runs with real time; a test only ever moves it forward.
const clock = { offset: 0, get now() { return Date.now() + this.offset; } };
let app;
let browser;
let member;
let decoder;
let ws;
/** The decoder's clock, and each car's last crossing on it. */
let t = 1000;
const last = new Map();
/** The fastest lap so far in the running session; each FL beats it by 10 ms, staying slower than the record. */
let fastest = 9900;

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  const user = await app.signUp('Ana');
  member = await app.login(user);
  ws = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  for (const name of ['Ana', 'Ben', 'Cy']) await app.form(member, '/personal/drivers', { name });
  const [ana, ben, cy] = app.store.drivers(ws);
  app.engine.assign(ws, '10', ana.id);
  app.engine.assign(ws, '20', ben.id);
  app.engine.assign(ws, '30', cy.id);
  useTrack(app.store, ws, 'Ring', 'cw', 't1');
  decoder = await (await app.api(member, 'POST', `/workspaces/${ws}/decoders`, { name: 'Gate' })).json();
  // An earlier session gives every driver a best here, so a later one can play PB; Ana's 9.000 is the record.
  await practice();
  await lap('10', 9000);
  await lap('20', 9800);
  await lap('30', 9900);
});
after(async () => {
  await browser?.close();
  await app?.close();
});

/** A crossing of `transponder`, `ms` after its last one, or a start, later than every crossing so far. */
async function pass(transponder, ms) {
  const at = ms ? last.get(transponder) + ms : t + 20_000;
  t = Math.max(t, at);
  last.set(transponder, at);
  const response = await postPassings(app, decoder, [{ transponder, t: at }]);
  assert.equal(response.status, 200);
}
/** A start and then a lap of `ms`. */
async function lap(transponder, ms) {
  await pass(transponder);
  await pass(transponder, ms);
}
/** A new practice, ending the running one; its first counted lap (Ana's, slower than her best) plays nothing. */
async function practice() {
  app.engine.start(ws, { kind: 'practice', replace: true });
  clock.offset += 10_000; // a practice starts clean: the laps begin after its start
  fastest = 9900;
}
/** A new fastest lap of the session by `transponder`, not a record. */
const fastestLap = (transponder) => lap(transponder, (fastest -= 10));

/** The live board, counting every .row-fx as it comes. */
async function boardPage(path = '/personal/board', options = {}) {
  const { context, page, errors } = await pageAs(browser, app, member, options);
  await page.addInitScript(() => {
    window.added = [];
    new MutationObserver((records) => {
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (node instanceof Element && node.matches('.row-fx')) {
            window.added.push({ hidden: node.getAttribute('aria-hidden'), driver: node.closest('tr')?.getAttribute('data-driver'), first: node.parentElement === node.closest('tr')?.firstElementChild });
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(path);
  await page.locator('#live-status[data-state="live"]').waitFor({ state: 'attached' });
  return { context, page, errors, added: () => page.evaluate(() => window.added) };
}
const row = (page, name) => page.locator('.standings-table tbody tr', { hasText: name });

/** Nothing of a row moment is left: no element, no lit row, no script animation. */
const settled = (page) => page.waitForFunction(() => !document.querySelector('.row-fx, [class*="is-lit"]')
  && document.getAnimations().filter((a) => !(a instanceof CSSAnimation || a instanceof CSSTransition)).length === 0, null, { timeout: 4000 });

/** The properties each running script animation on the row moves. */
const moved = (page) => page.evaluate(() => [...new Set(document.getAnimations()
  .filter((a) => !(a instanceof CSSAnimation || a instanceof CSSTransition))
  .flatMap((a) => /** @type {KeyframeEffect} */ (a.effect).getKeyframes().flatMap((k) => Object.keys(k).filter((p) => !['offset', 'computedOffset', 'easing', 'composite'].includes(p)))))].sort());

test('a new fastest lap lights its row behind the text, its mark inverted, and nothing stays', async (t) => {
  await practice();
  await lap('10', 9950);
  const { context, page, errors, added } = await boardPage();
  t.after(() => context.close());
  await fastestLap('20');
  const ben = row(page, 'Ben');
  await ben.locator('.row-fx').waitFor({ state: 'attached' });
  assert.match(await ben.getAttribute('class') ?? '', /\bis-lit-fl\b/);
  // Positioned against the row, behind its text, clipped to it.
  assert.deepEqual(await ben.evaluate((tr) => {
    const fx = /** @type {Element} */ (tr.querySelector('.row-fx'));
    const s = getComputedStyle(fx), r = getComputedStyle(tr);
    return [r.position, r.isolation, s.position, s.zIndex, s.overflow, s.pointerEvents, Math.round(fx.getBoundingClientRect().width) === Math.round(tr.getBoundingClientRect().width)];
  }), ['relative', 'isolate', 'absolute', '-1', 'hidden', 'none', true]);
  assert.deepEqual(await ben.locator('.row-fx > *').evaluateAll((els) => els.map((e) => e.className)), ['row-fx-fill', 'row-fx-head']);
  // Only transforms and clip-path move.
  assert.deepEqual(await moved(page), ['clipPath', 'transform']);
  // The mark turns ink with cyan letters; driver squares get a 2px ink edge.
  const ink = await page.evaluate(() => getComputedStyle(document.body).color);
  assert.deepEqual(await ben.locator('.mark-fl').evaluate((m) => [getComputedStyle(m).backgroundColor, getComputedStyle(m).color]), [ink, 'rgb(0, 229, 255)']);
  assert.deepEqual(await ben.locator('.driver').evaluate((d) => {
    const s = getComputedStyle(d, '::before');
    return [s.outlineStyle, s.outlineWidth, s.outlineColor];
  }), ['solid', '2px', ink]);
  assert.equal(await row(page, 'Ana').locator('.row-fx').count(), 0, 'only the lap\'s own row');
  await settled(page);
  assert.deepEqual(await ben.locator('.mark-fl').evaluate((m) => getComputedStyle(m).backgroundColor), 'rgb(0, 229, 255)', 'the mark is itself again');
  assert.deepEqual(await added(), [{ hidden: 'true', driver: await ben.getAttribute('data-driver'), first: true }]);
  assert.deepEqual(errors, []);
});

test('the first render and a page load play nothing, nor a swap that brings a moment already shown', async (t) => {
  await practice();
  await lap('10', 9950);
  await fastestLap('20');
  const { context, page, errors, added } = await boardPage();
  t.after(() => context.close());
  assert.ok(await row(page, 'Ben').getAttribute('data-moment'), 'the moment is still offered');
  await pass('30'); // a swap that brings the same moment
  await new Promise((resolve) => setTimeout(resolve, 500));
  await page.reload();
  await page.locator('#live-status[data-state="live"]').waitFor({ state: 'attached' });
  await pass('30');
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.deepEqual(await added(), []);
  assert.deepEqual(errors, []);
});

test('a personal best lights its row green', async (t) => {
  await practice();
  await lap('10', 9100); // the session's fastest lap, not Ana's best: no moment
  const { context, page, errors } = await boardPage();
  t.after(() => context.close());
  await lap('20', 9700); // Ben beats his 9.800, not the fastest lap
  const ben = row(page, 'Ben');
  await ben.locator('.row-fx').waitFor({ state: 'attached' });
  assert.match(await ben.getAttribute('class') ?? '', /\bis-lit-pb\b/);
  assert.deepEqual(await ben.locator('.mark-pb').evaluate((m) => getComputedStyle(m).color), 'rgb(0, 255, 136)');
  await settled(page);
  assert.deepEqual(errors, []);
});

test('a moment carries over a swap during it, to the same driver\'s row, at its elapsed time', async (t) => {
  await practice();
  await lap('10', 9950);
  const { context, page, errors } = await boardPage();
  t.after(() => context.close());
  await fastestLap('20');
  await row(page, 'Ben').locator('.row-fx').waitFor({ state: 'attached' });
  const began = await page.evaluate(() => performance.now() - /** @type {number} */ (document.querySelector('.row-fx-fill')?.getAnimations()[0].currentTime));
  const board = await page.locator('#board-live').elementHandle();
  await pass('10'); // a crossing that plays nothing: the board is swapped again
  await page.waitForFunction((el) => !el.isConnected, board);
  const ben = row(page, 'Ben');
  assert.equal(await ben.locator('.row-fx').count(), 1, 'on the new row');
  assert.match(await ben.getAttribute('class') ?? '', /\bis-lit-fl\b/, 'still lit, its mark still inverted');
  const now = await page.evaluate(() => performance.now() - /** @type {number} */ (document.querySelector('.row-fx-fill')?.getAnimations()[0].currentTime));
  assert.ok(Math.abs(now - began) < 50, `continued where it was (${Math.round(now - began)} ms apart)`);
  await settled(page);
  assert.deepEqual(errors, []);
});

test('a newer fastest lap slides the older row out', async (t) => {
  await practice();
  await lap('10', 9950);
  const { context, page, errors } = await boardPage();
  t.after(() => context.close());
  await fastestLap('20');
  await row(page, 'Ben').locator('.row-fx').waitFor({ state: 'attached' });
  await fastestLap('30');
  await row(page, 'Cy').locator('.row-fx').waitFor({ state: 'attached' });
  const cut = Date.now();
  await row(page, 'Ben').locator('.row-fx').waitFor({ state: 'detached', timeout: 1000 });
  assert.ok(Date.now() - cut < 600, 'gone within its 300 ms slide');
  assert.equal(await row(page, 'Cy').locator('.row-fx').count(), 1, 'the new one plays on');
  await settled(page);
  assert.deepEqual(errors, []);
});

test('with reduced motion the row takes the colour, holds and fades: nothing moves', async (t) => {
  await practice();
  await lap('10', 9950);
  const { context, page, errors, added } = await boardPage();
  t.after(() => context.close());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fastestLap('20');
  const ben = row(page, 'Ben');
  await ben.locator('.row-fx').waitFor({ state: 'attached' });
  assert.equal(await ben.locator('.row-fx-head').count(), 0, 'no head');
  assert.deepEqual(await moved(page), ['opacity']);
  await settled(page);
  assert.equal((await added()).length, 1);
  assert.deepEqual(errors, []);
});

/**
 * Samples a row's moment live, every frame from when its .row-fx appears
 * until `ms` later: elapsed ms, then the lit row's classes, its cells', driver
 * name's and crown outline's colours, its mark's colours, and how much of the
 * row the fill covers (0 to 1).
 */
const sampling = (page, ms) => page.evaluate((ms) => {
  window.samples = [];
  let t0 = null;
  let row = null;
  const step = () => {
    const fx = document.querySelector('.row-fx');
    if (fx && t0 === null) {
      t0 = performance.now();
      row = fx.closest('tr')?.getAttribute('data-driver');
    }
    if (t0 !== null) {
      const tr = document.querySelector(`.standings-table tbody tr[data-driver="${row}"]`);
      const fill = tr?.querySelector('.row-fx-fill');
      let covers = 0;
      if (fill) {
        const [, top, right, , left] = getComputedStyle(fill).clipPath.match(/inset\(([-\d.]+)\S*\s+([-\d.]+)\S*\s+([-\d.]+)\S*\s+([-\d.]+)/) ?? [];
        covers = top === undefined ? 1 : Math.max(0, Math.min(1, 1 - Math.max(0, Number(right)) / 100 - Math.max(0, Number(left)) / 100));
      }
      const mark = tr?.querySelector('.mark');
      const css = (el, p) => (el ? getComputedStyle(el).getPropertyValue(p) : null);
      window.samples.push([performance.now() - t0, tr?.className ?? '', css(tr?.querySelector('td.num'), 'color'), css(tr?.querySelector('.driver-name'), 'color'),
        css(tr?.querySelector('.crown'), 'stroke'), css(mark, 'background-color'), css(mark, 'color'), covers]);
    }
    if (t0 === null || performance.now() - t0 < ms) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}, ms);
/** The first sample at or after `ms`, once sampling is done, as a record. */
async function sampleAt(page, ms) {
  await page.waitForFunction((ms) => window.samples.length && window.samples.at(-1)[0] >= ms, ms, { timeout: 5000 });
  const [at, classes, cell, name, crown, markBg, markColour, covers] = await page.evaluate((ms) => window.samples.find((x) => x[0] >= ms), ms);
  return { at, classes, cell, name, crown, markBg, markColour, covers };
}

test('a track record lights its row purple, its text white from the start until the fill leaves, on the big screen too', async (t) => {
  await practice();
  await lap('20', 9950);
  const { context, page, errors } = await boardPage('/personal/board?big', { viewport: { width: 1920, height: 1080 } });
  t.after(() => context.close());
  await sampling(page, 2600);
  await lap('10', 8900); // beats Ana's 9.000
  const ink = await page.evaluate(() => getComputedStyle(document.body).color);
  const white = 'rgb(255, 255, 255)';
  for (const ms of [200, 400, 600, 1000, 1800]) {
    const s = await sampleAt(page, ms);
    assert.match(s.classes, /\bis-lit-tr\b/);
    assert.deepEqual([s.cell, s.name, s.crown], [white, white, white], `white text and crown outline at ${Math.round(s.at)} ms`);
    assert.deepEqual([s.markBg, s.markColour], [ink, white], 'the mark inverted');
  }
  const leaving = await sampleAt(page, 2050);
  assert.doesNotMatch(leaving.classes, /is-lit-light/, 'ink again once the fill begins to leave');
  assert.equal(leaving.cell, ink);
  const after = await sampleAt(page, 2500);
  assert.equal(after.classes, '', 'nothing lit once the fill is gone');
  await settled(page);
  assert.deepEqual(errors, []);
});

test('an FL fill holds through its slide-out, and the row is itself again as it ends', async (t) => {
  await practice();
  await lap('10', 9950);
  const { context, page, errors } = await boardPage();
  t.after(() => context.close());
  await sampling(page, 1900);
  await fastestLap('20');
  const held = await sampleAt(page, 1300);
  assert.ok(held.covers > 0.5, `the fill still covers ${Math.round(held.covers * 100)}% of the row at ${Math.round(held.at)} ms`);
  assert.match(held.classes, /\bis-lit-fl\b/);
  const done = await sampleAt(page, 1700);
  assert.equal(done.classes, '', 'no longer lit');
  assert.equal(done.markBg, 'rgb(0, 229, 255)', 'the mark is cyan again');
  assert.equal(done.markColour, await page.evaluate(() => getComputedStyle(document.body).color));
  assert.deepEqual(errors, []);
});

test('a board taken away stops its row moments', async (t) => {
  await practice();
  await lap('10', 9950);
  const { context, page, errors } = await boardPage();
  t.after(() => context.close());
  await fastestLap('20');
  await row(page, 'Ben').locator('.row-fx').waitFor({ state: 'attached' });
  const ben = await row(page, 'Ben').elementHandle();
  await page.locator('tl-board').evaluate((board) => board.remove());
  assert.equal(await page.evaluate(() => document.getAnimations().filter((a) => !(a instanceof CSSAnimation || a instanceof CSSTransition)).length), 0);
  assert.equal(await ben?.evaluate((tr) => tr.querySelectorAll('.row-fx').length + tr.classList.length), 0);
  assert.deepEqual(errors, []);
});

test('the watchers\' board on a phone plays it too', async (t) => {
  await practice();
  await lap('10', 9950);
  await app.form(member, '/personal/watch-link', {});
  const token = app.store.workspace(ws).watchToken;
  const { context, page, errors } = await pageAs(browser, app, null, { viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  await page.goto(`/watch/${token}`);
  await page.locator('#live-status[data-state="live"]').waitFor({ state: 'attached' });
  await fastestLap('20');
  const ben = row(page, 'Ben');
  await ben.locator('.row-fx').waitFor({ state: 'attached' });
  assert.ok(await ben.evaluate((tr) => Math.round(/** @type {Element} */ (tr.querySelector('.row-fx')).getBoundingClientRect().width) === Math.round(tr.getBoundingClientRect().width)), 'the whole row');
  await settled(page);
  assert.deepEqual(errors, []);
});
