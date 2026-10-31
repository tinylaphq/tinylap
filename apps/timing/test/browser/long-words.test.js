// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A name of one word, as long as a name may be (60 letters), on every page
// that shows it, at a small phone's, a phone's and a laptop's width: nothing
// spills out of its box or scrolls the page sideways; where a word is too
// long for its line, it is cut, and the cut ends in "…".
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

const clock = { offset: 0, get now() { return Date.now() + this.offset; } };
const WORD = 'Wolfeschlegelsteinhausenbergerdorffvoralternwarengewissenhaft'.slice(0, 60);
const TRACK = 'Hochgeschwindigkeitsrundkursanlagenbetriebsgesellschaftsteil'.slice(0, 60);
const DECODER = 'Zielliniendurchfahrtserkennungsempfangsgeraeteeinheitsmodulx'.slice(0, 60);
let app;
let browser;
let member;
let ws;
let session;
let ids;

before(async () => {
  assert.equal(WORD.length, 60);
  app = await startTiming({ clock });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  ws = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  for (const [i, name] of [WORD, 'Ana'].entries()) {
    await app.form(member, '/personal/drivers', { name });
    app.engine.assign(ws, String(41 + i), app.store.drivers(ws).find((d) => d.name === name).id);
  }
  await app.form(member, '/personal/tracks', { name: TRACK });
  const track = app.store.tracks(ws, { archived: false }).find((t) => t.name === TRACK);
  // The long track is the current one; the first stays as an other track, so both kinds of row show it.
  await app.form(member, '/personal/track', { id: track.id, direction: 'ccw' });
  await app.form(member, '/personal/decoders', { name: DECODER });
  // The long name sets the record in a practice.
  session = app.engine.start(ws, { kind: 'practice' }).session;
  clock.offset += 60_000;
  for (const i of [0, 1]) {
    let t = clock.now - 500;
    const passings = [];
    for (let k = 0; k < 3; k++) { passings.unshift({ transponder: String(41 + i), t }); t -= 8000 + i * 300; }
    app.engine.ingest({ workspaceId: ws, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings } });
  }
  app.engine.end(ws, session.id);
  ids = {
    driver: app.store.drivers(ws).find((d) => d.name === WORD).id,
    track: track.id,
    decoder: app.store.decoders(ws).find((d) => d.name === DECODER).id,
  };
});
after(async () => {
  await browser?.close();
  await app?.close();
});

/**
 * What spills: a box whose content is wider than it and shows it, and a box
 * that hides it without an ellipsis. Form controls, scroll boxes and hidden
 * text are left out.
 */
const spills = () => {
  const out = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el.matches('input, select, textarea, option, svg *, .visually-hidden, .visually-hidden *') || !el.getClientRects().length) continue;
    if (el.clientWidth === 0 || el.scrollWidth <= el.clientWidth + 1) continue;
    const s = getComputedStyle(el);
    if (s.overflowX === 'auto' || s.overflowX === 'scroll') continue;
    const cut = s.overflowX !== 'visible';
    if (cut && s.textOverflow === 'ellipsis') continue;
    out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')}: ${el.scrollWidth} > ${el.clientWidth}${cut ? ', cut without …' : ''}`);
  }
  return { out, sideways: document.documentElement.scrollWidth - innerWidth };
};

/** Each box that cuts one of the long words: it ends in an ellipsis. */
const cuts = (words) => [...document.body.querySelectorAll('*')]
  .filter((el) => !el.matches('input, select, textarea, option, .visually-hidden') && el.scrollWidth > el.clientWidth + 1 && words.some((w) => el.textContent.includes(w)) && getComputedStyle(el).overflowX === 'hidden')
  .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}: ${getComputedStyle(el).textOverflow}`);

const PAGES = [
  ['the board', () => '/personal/board'],
  ['the big board', () => '/personal/board?big'],
  ['Setup', () => '/personal/setup'],
  ['Sessions', () => '/personal/sessions'],
  ['a session', () => `/personal/sessions/${session.id}`],
  ['the records', () => '/personal/records'],
  ['the track', () => `/personal/tracks/${ids.track}`],
  ['Delete a driver', () => `/personal/drivers/${ids.driver}/delete`],
  ['Unpair a decoder', () => `/personal/decoders/${ids.decoder}/unpair`],
  // The current track can't be deleted: Setup comes back with an error that names it.
  ['Delete the current track', () => `/personal/tracks/${ids.track}/delete`],
];

for (const width of [320, 390, 1280]) {
  test(`at ${width}: a 60-letter word never pushes a page sideways; where it is cut, it ends in "…"`, async (t) => {
    const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width, height: 900 } });
    t.after(() => context.close());
    // The big board is for a wall screen; a small phone gets the board itself.
    for (const [name, path] of PAGES.filter(([name]) => width > 320 || name !== 'the big board')) {
      await page.goto(path());
      await page.evaluate(() => document.fonts.ready);
      const m = await page.evaluate(spills);
      assert.deepEqual(m.out, [], `${name}: nothing spills`);
      assert.equal(m.sideways, 0, `${name}: no sideways scroll`);
      for (const cut of await page.evaluate(cuts, [WORD, TRACK, DECODER])) assert.match(cut, /: ellipsis$/, `${name}: a cut word ends in …`);
    }
    // At a phone's width, the confirmation's heading is one that cuts the name, and it keeps it whole for a screen reader.
    if (width < 1280) {
      await page.goto(`/personal/drivers/${ids.driver}/delete`);
      const h1 = await page.locator('h1').evaluate((el) => ({ cut: el.scrollWidth > el.clientWidth, title: el.title }));
      assert.deepEqual(h1, { cut: true, title: `Delete ${WORD}?` });
      assert.match(await page.locator('main').ariaSnapshot(), new RegExp(`heading "Delete ${WORD}\\?"`));
    }
    assert.deepEqual(errors.filter((e) => !/status of 409/.test(e)), [], 'nothing but the refused delete');
  });
}

test('while a session runs (Tap, the start form, the board\'s track strip), the long names stay inside their boxes, cut with "…", at 320 and 390', async (t) => {
  const running = app.engine.start(ws, { kind: 'practice' }).session;
  t.after(() => app.engine.end(ws, running.id));
  for (const width of [320, 390]) {
    const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width, height: 900 } });
    for (const path of ['/personal/tap', '/personal/sessions', '/personal/board', '/personal/board?big']) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const m = await page.evaluate(spills);
      assert.deepEqual(m.out, [], `${path} at ${width}: nothing spills`);
      assert.equal(m.sideways, 0, `${path} at ${width}: no sideways scroll`);
    }
    await page.goto('/personal/tap');
    const tile = await page.locator('.tap-tile', { hasText: WORD }).evaluate((el) => {
      const name = el.querySelector('.tap-tile-name');
      const grid = el.closest('.tap-grid').getBoundingClientRect();
      return { cut: name.scrollWidth > name.clientWidth, overflow: getComputedStyle(name).textOverflow, size: parseFloat(getComputedStyle(el).fontSize), inGrid: el.getBoundingClientRect().right <= grid.right + 0.5, title: name.title };
    });
    assert.deepEqual(tile, { cut: true, overflow: 'ellipsis', size: width < 380 ? 14 : 16, inGrid: true, title: WORD });
    // A screen reader hears the whole name on the button.
    assert.equal(await page.getByRole('button', { name: WORD }).count(), 1);
    await context.close();
    assert.deepEqual(errors, []);
  }
});
