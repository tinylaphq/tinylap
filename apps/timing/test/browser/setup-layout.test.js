// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Tap and Setup in the browser, at a phone's and a laptop's width: a long
// name stays inside its tile, unbroken inside its words, never under 16px,
// and the result bar keeps its height after a tap; on Setup a section's
// heading keeps its gap to what follows, actions beside a field stand as tall
// as the field and actions in a row of text one lighter height, the row's
// actions end at the section's edge, and a fold's error takes the fold's width.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs, postPassings } from './browser.js';

const clock = { now: Date.now() };
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const LONG = 'Cyrille Featherstonehaugh';
let app;
let browser;
let member;
let ws;

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  for (const name of ['Ana', LONG, 'Jürgen Müßig']) await app.form(member, '/personal/drivers', { name });
  for (const name of ['Garage figure eight', 'Old kitchen layout']) await app.form(member, '/personal/tracks', { name });
  const me = await (await app.api(member, 'GET', '/auth/me')).json();
  ws = me.workspaces[0].id;
  const old = app.store.tracks(ws, { archived: false }).find((t) => t.name === 'Old kitchen layout');
  await app.form(member, `/personal/tracks/${old.id}/archive`, {});
  const decoder = await (await app.api(member, 'POST', `/workspaces/${ws}/decoders`, { name: 'Start line' })).json();
  await postPassings(app, decoder, [{ transponder: '0A', t: 1000 }, { transponder: '7A', t: 1001 }]);
  await app.form(member, '/personal/transponders/0A', { driver: app.store.drivers(ws)[0].id });
  app.engine.start(ws, { kind: 'practice' });
});
after(async () => {
  await browser?.close();
  await app?.close();
});

for (const [size, viewport] of [['phone', PHONE], ['desktop', DESKTOP]]) {
  test(`tap at ${size} width: every name stays inside its tile, broken only between words, in its own case, at 16px or more`, async (t) => {
    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    t.after(() => context.close());
    await page.goto('/personal/tap');
    const tiles = await page.locator('.tap-tile').evaluateAll((els) => els.map((el) => {
      const box = el.getBoundingClientRect();
      const range = document.createRange();
      const name = el.querySelector('.tap-tile-name');
      range.selectNodeContents(name);
      const text = range.getBoundingClientRect();
      // Each word's own boxes: a word broken inside itself has more than one line box.
      const words = [];
      const node = name.firstChild;
      let at = 0;
      for (const word of el.textContent.split(' ')) {
        const r = document.createRange();
        r.setStart(node, at);
        r.setEnd(node, at + word.length);
        const lines = new Set([...r.getClientRects()].map((rect) => Math.round(rect.top)));
        words.push({ word, lines: lines.size });
        at += word.length + 1;
      }
      return { name: el.textContent, transform: getComputedStyle(el).textTransform, size: parseFloat(getComputedStyle(el).fontSize), inside: text.left >= box.left && text.right <= box.right + 0.5 && el.scrollWidth <= el.clientWidth && name.scrollWidth <= name.clientWidth, words };
    }));
    for (const tile of tiles) {
      assert.ok(tile.inside, `${tile.name} inside its tile`);
      assert.equal(tile.transform, 'none', `${tile.name} keeps its case`);
      assert.ok(tile.size >= 16, `${tile.name}: ${tile.size}px, not under 16px`);
      for (const w of tile.words) assert.equal(w.lines, 1, `${tile.name}: "${w.word}" on one line`);
    }
    assert.deepEqual(errors, []);
  });

  test(`tap at ${size} width: the result bar keeps its height after a long name's tap, and the time stays in view`, async (t) => {
    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    t.after(() => context.close());
    await page.goto('/personal/tap');
    const bar = page.locator('.tap-bar');
    const before = (await bar.boundingBox()).height;
    const firstTile = (await page.locator('.tap-tile').first().boundingBox()).y;
    app.engine.start(ws, { kind: 'practice', replace: true });
    clock.now += 1000;
    await page.getByRole('button', { name: LONG }).click();
    await page.locator('#tap-result').filter({ hasText: `${LONG}: started` }).waitFor();
    clock.now += 8000;
    await page.getByRole('button', { name: LONG }).click();
    await page.locator('#tap-result').filter({ hasText: `${LONG}: 8.000` }).waitFor();
    assert.equal((await bar.boundingBox()).height, before, 'the bar keeps its height');
    assert.equal((await page.locator('.tap-tile').first().boundingBox()).y, firstTile, 'the tiles stay put');
    const time = await page.locator('#tap-result .tap-detail').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const b = el.closest('.tap-bar').getBoundingClientRect();
      return { right: r.right, barRight: b.right, text: el.textContent };
    });
    assert.equal(time.text, ': 8.000');
    assert.ok(time.right <= time.barRight, 'the time is inside the bar');
    assert.deepEqual(errors, []);
  });

  test(`setup at ${size} width: a heading keeps its gap, row actions take a field's height or a text row's, and end at the section's edge`, async (t) => {
    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    t.after(() => context.close());
    await page.goto('/personal/setup');
    for (const d of await page.locator('details.track-edit, details.track-archive').all()) await d.locator('summary').click();
    const m = await page.evaluate(() => {
      const gapAfter = (id) => {
        const h = document.getElementById(id);
        const next = h.nextElementSibling;
        return Math.round(next.getBoundingClientRect().top - h.getBoundingClientRect().bottom);
      };
      const actions = [...document.querySelectorAll('.setup-row .btn, .track-row .button-row .btn, .setup-table .btn')]
        .filter((el) => el.getClientRects().length)
        .map((el) => {
          // Beside a field: a field in the action's row, not in a fold under it.
          const row = el.closest('.setup-row, .track-row, tr');
          const field = [...row.querySelectorAll('input:not([type="hidden"]), select')].find((f) => !f.closest('details'));
          return { text: el.textContent.trim(), h: Math.round(el.getBoundingClientRect().height), field: field ? Math.round(field.getBoundingClientRect().height) : null };
        });
      const edge = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().right);
      const content = (sel) => { const s = document.querySelector(sel); return Math.round(s.getBoundingClientRect().right - parseFloat(getComputedStyle(s).paddingRight) - parseFloat(getComputedStyle(s).borderRightWidth)); };
      return {
        gaps: ['track-title', 'drivers-title', 'transponders-title', 'decoders-title'].map((id) => [id, gapAfter(id)]),
        actions,
        assign: edge('#transponders .setup-table .btn') - content('#transponders section'),
        unpair: edge('#decoders .setup-row .btn') - content('#decoders'),
        docW: document.documentElement.scrollWidth,
      };
    });
    for (const [id, gap] of m.gaps) assert.equal(gap, 16, `${id}: 16px to what follows`);
    const besideField = m.actions.filter((a) => a.field !== null);
    const inText = m.actions.filter((a) => a.field === null);
    assert.ok(besideField.length && inText.length, `both kinds of row: ${JSON.stringify(m.actions)}`);
    for (const a of besideField) assert.equal(a.h, a.field, `${a.text}: as tall as its field`);
    assert.deepEqual([...new Set(inText.map((a) => a.h))], [36], `actions in a row of text: one lighter height, ${JSON.stringify(inText)}`);
    assert.equal(m.assign, 0, 'Assign ends at the section edge');
    assert.equal(m.unpair, 0, 'Unpair ends at the section edge');
    assert.ok(m.docW <= viewport.width, 'no sideways scroll');
    assert.deepEqual(errors, []);
  });
}

test('setup on a phone: a driver row keeps the whole name in view, its actions on a line of their own, one row gap under the name', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: PHONE });
  t.after(() => context.close());
  await page.goto('/personal/setup');
  const measure = (el) => {
    const input = el.querySelector('input[name="name"]');
    const save = el.querySelector('button[type="submit"]');
    const error = el.querySelector('.field-error')?.getBoundingClientRect();
    return {
      fits: input.scrollWidth <= input.clientWidth,
      gap: parseFloat(getComputedStyle(el).rowGap),
      inputBottom: input.getBoundingClientRect().bottom,
      saveTop: save.getBoundingClientRect().top,
      error: error ? { top: error.top, bottom: error.bottom } : null,
    };
  };
  const row = page.locator('#drivers .setup-row', { has: page.locator(`input[value="${LONG}"]`) });
  const m = await row.evaluate(measure);
  assert.ok(m.fits, 'the whole name shows');
  assert.equal(m.error, null);
  // Within a pixel: rows can land on half pixels. An empty error row would add a whole row gap.
  const near = (px, gap, what) => assert.ok(Math.abs(px - gap) <= 1, `${what}: ${px}px, not ${gap}px`);
  near(m.saveTop - m.inputBottom, m.gap, 'Save is below the name, one row gap away: no empty error row between');
  // A refused rename: the error takes the row between, a row gap on each side.
  await row.locator('input[name="name"]').evaluate((input) => { input.form.noValidate = true; input.value = ''; });
  await row.locator('button[type="submit"]').click();
  const refused = page.locator('#drivers .setup-row', { has: page.locator('.field-error') });
  await refused.waitFor();
  const e = await refused.evaluate(measure);
  near(e.error.top - e.inputBottom, e.gap, 'the error under the name');
  near(e.saveTop - e.error.bottom, e.gap, 'Save under the error');
  assert.deepEqual(errors.filter((x) => !/status of 422/.test(x)), [], 'nothing but the refused form');
});

test('setup on a phone: a fold’s error spans the fold, and Rename and Change layout end at one edge', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: PHONE });
  t.after(() => context.close());
  await page.goto('/personal/setup');
  await page.locator('.track-now details.track-edit summary').click();
  const form = page.locator('.track-now details.track-edit form').first();
  await form.evaluate((f) => { f.noValidate = true; f.querySelector('input[name="name"]').value = ''; });
  await form.locator('button').click();
  const error = page.locator('.track-now .track-edit .field-error');
  await error.waitFor();
  const m = await page.evaluate(() => {
    const fold = document.querySelector('.track-now .track-edit');
    const e = fold.querySelector('.field-error').getBoundingClientRect();
    const f = fold.getBoundingClientRect();
    const [a, b] = [...fold.querySelectorAll('form')].map((x) => x.querySelector('input').getBoundingClientRect().right);
    return { errorW: e.width, foldW: f.width, inputs: [a, b] };
  });
  assert.ok(m.errorW >= m.foldW - 1, `the error spans the fold (${m.errorW} of ${m.foldW})`);
  assert.ok(Math.abs(m.inputs[0] - m.inputs[1]) <= 1, `both inputs end at one edge (${m.inputs})`);
  assert.deepEqual(errors.filter((e) => !/status of 422/.test(e)), [], 'nothing but the refused form');
});
