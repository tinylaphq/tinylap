// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board's Start panel in a browser (board hub spec §5, §10): each kind's
// settings appear and submit without script, and without :has() the server's
// choice stays and still submits; with script a half-filled form survives the
// stream's updates, and the panel goes while a session runs and comes back
// when it ends. The line that a car is on the track sits above the button.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

const clock = { offset: 0, get now() { return Date.now() + this.offset; } };
let app;
let browser;
let member;
let ws;
/** @type {Record<string, string>} */
let ids;

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  ws = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  for (const name of ['Ana', 'Ben']) await app.form(member, '/personal/drivers', { name });
  ids = Object.fromEntries(app.store.drivers(ws).map((d) => [d.name, d.id]));
  app.engine.assign(ws, '7', ids.Ana);
});
after(async () => {
  await browser?.close();
  await app?.close();
});

/** Ends whatever runs, so each test starts from the idle board. */
const stop = () => {
  const running = app.store.runningSession(ws);
  if (running?.kind === 'practice') app.engine.end(ws, running.id);
  else if (running) app.engine.abort(ws, running.id);
};
/** What the panel shows: the settings on screen, the button's name, the hint and the roster. */
const shown = (page) => page.evaluate(() => {
  const visible = (el) => el && getComputedStyle(el).display !== 'none';
  const panel = document.querySelector('.start-panel');
  return {
    settings: [...panel.querySelectorAll('.start-settings')].filter(visible).map((el) => el.dataset.for),
    button: panel.querySelector('.start-go').innerText.trim(),
    hints: [...panel.querySelectorAll('.start-hint')].filter(visible).map((el) => el.textContent),
    roster: [...panel.querySelectorAll('.start-roster')].filter(visible).map((el) => el.closest('[data-for]').dataset.for),
  };
});
const kind = (page, name) => page.locator('.start-kind-option', { hasText: name }).click();

test('without script, each kind shows only its settings, and a race with chosen drivers starts from the panel', async (t) => {
  t.after(stop);
  const { context, page, errors } = await pageAs(browser, app, member, { javaScriptEnabled: false });
  t.after(() => context.close());
  await page.goto('/personal/board');
  assert.deepEqual(await shown(page), { settings: [], button: 'START PRACTICE', hints: ['Runs until you end it, timing every car with a driver.'], roster: [] });
  await kind(page, 'Qualifying');
  assert.deepEqual(await shown(page), { settings: ['qualifying'], button: 'START QUALIFYING', hints: ['Ranked by each driver’s best lap.'], roster: [] });
  await kind(page, 'Race');
  assert.deepEqual((await shown(page)).settings, ['race']);
  const race = page.locator('.start-settings[data-for="race"]');
  await race.locator('.start-option', { hasText: 'Chosen drivers' }).click();
  assert.deepEqual((await shown(page)).roster, ['race'], 'the roster opens under Chosen drivers');
  await race.getByLabel('Ana').uncheck();
  await race.getByLabel('Length').fill('2');
  await race.getByLabel('Countdown').fill('0');
  await page.getByRole('button', { name: 'Start race' }).click();
  assert.equal(new URL(page.url()).pathname, '/personal/board');
  await page.getByRole('heading', { name: 'Race' }).waitFor();
  const session = app.store.runningSession(ws);
  assert.equal(session.kind, 'race');
  assert.deepEqual(session.roster, [ids.Ben]);
  assert.equal(session.durationMs, 120_000);
  assert.equal(await page.locator('.start-panel').count(), 0, 'no panel while it runs');
  assert.deepEqual(errors, []);
});

test('without :has(), the server\'s choice stays on screen, and the kind sent is the kind started', async (t) => {
  t.after(stop);
  const { context, page, errors } = await pageAs(browser, app, member, { javaScriptEnabled: false });
  t.after(() => context.close());
  await page.goto('/personal/board');
  // The last session was a race: the server checks it, and shows its settings.
  assert.deepEqual((await shown(page)).settings, ['race']);
  // Take out the rules that follow the radios, as a browser without :has() would never read them.
  const removed = await page.evaluate(() => {
    let n = 0;
    for (const sheet of document.styleSheets) {
      for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
        const rule = sheet.cssRules[i];
        if (rule instanceof CSSSupportsRule && rule.conditionText.includes(':has(')) { sheet.deleteRule(i); n++; }
      }
    }
    return n;
  });
  assert.ok(removed >= 1);
  await kind(page, 'Qualifying');
  assert.deepEqual(await shown(page), { settings: ['race'], button: 'START RACE', hints: ['Same drivers, length and countdown as the last race.'], roster: ['race'] }, 'the server\'s choice stays');
  await page.locator('.start-go').click();
  await page.getByRole('heading', { name: 'Qualifying' }).waitFor();
  const session = app.store.runningSession(ws);
  assert.equal(session.kind, 'qualifying', 'the checked kind');
  assert.equal(session.roster, null, 'its own fields\' defaults: everyone on the track');
  assert.deepEqual(errors, []);
});

test('with script, a half-filled form survives the stream, the panel goes while a session runs and comes back when it ends', async (t) => {
  t.after(stop);
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/personal/board');
  await page.locator('#live-status[data-state="live"]').waitFor();
  await kind(page, 'Race');
  const race = page.locator('.start-settings[data-for="race"]');
  await race.getByLabel('Length').fill('7');
  // A car crosses: the stream sends the board, and the line that it is on the track comes into the panel.
  app.engine.ingest({ workspaceId: ws, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder: '7', t: clock.now - 100 }] } });
  await page.locator('.start-panel .board-on-track', { hasText: 'Ana is on the track' }).waitFor();
  assert.equal(await race.getByLabel('Length').inputValue(), '7', 'the typed length kept');
  assert.equal(await page.locator('[name="kind"][value="race"]').isChecked(), true, 'the chosen kind kept');
  const place = await page.evaluate(() => {
    const line = document.querySelector('.start-panel .board-on-track').getBoundingClientRect();
    const button = document.querySelector('.start-go').getBoundingClientRect();
    return { line: line.bottom, button: button.top };
  });
  assert.ok(place.line <= place.button, 'the line above the button');
  // A session starts elsewhere: the panel goes; it ends: a fresh panel comes.
  const { session } = app.engine.start(ws, { kind: 'practice' });
  await page.locator('#board-start[hidden]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('.start-panel').count(), 0);
  app.engine.end(ws, session.id);
  await page.locator('.start-panel').waitFor();
  assert.equal(await page.locator('[name="kind"][value="practice"]').isChecked(), true, 'the last session\'s kind');
  assert.deepEqual(errors, []);
});

for (const [size, viewport] of [['phone', { width: 390, height: 844 }], ['laptop', { width: 1280, height: 800 }]]) {
  test(`on a ${size}, the panel sits ${size === 'phone' ? 'under' : 'beside'} the board, its parts inside its box`, async (t) => {
    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    t.after(() => context.close());
    await page.goto('/personal/board');
    const box = await page.evaluate(() => {
      const r = (el) => el.getBoundingClientRect();
      const live = r(document.querySelector('.board-result > :last-child'));
      const panel = r(document.querySelector('.start-panel'));
      const parts = [...document.querySelectorAll('.start-panel > *')].filter((el) => getComputedStyle(el).display !== 'none').map(r);
      return { live, panel, parts, page: document.documentElement.scrollWidth, width: innerWidth };
    });
    if (size === 'phone') assert.ok(box.panel.top >= box.live.bottom, 'under the board');
    else assert.ok(box.panel.left >= box.live.right && Math.abs(box.panel.top - box.live.top) < 60, 'beside the board');
    for (const part of box.parts) assert.ok(part.left >= box.panel.left && part.right <= box.panel.right, 'inside the box');
    assert.ok(box.page <= box.width, 'no sideways scroll');
    assert.deepEqual(errors, []);
  });
}
