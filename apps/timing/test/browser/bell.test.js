// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bell (records spec §4.3): the Sound icon switch, and tl-board ringing once
// when a swap brings a track record it has not seen. AudioContext is a stub
// that counts the oscillators a ring starts.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { PARTIALS } from '../../public/bell.js';
import { startTiming, useTrack } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

const EPOCH = 1_000_000_000_000;
const clock = { now: EPOCH };
let app;
let browser;
let member;
let personal;
let t = 0;
let lapMs = 10_000;

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  const user = await app.signUp('Ana');
  member = await app.login(user);
  await app.form(member, '/personal/drivers', { name: 'Ana' });
  personal = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  app.engine.assign(personal, '10', app.store.drivers(personal)[0].id);
  useTrack(app.store, personal, 'Ring', 'cw', 't1');
  clock.now = EPOCH;
  app.engine.start(personal, { kind: 'practice' });
  passIn(1000);
  passIn(1000 + lapMs); // the first record: nothing to beat, so no record state
  t = 1000 + lapMs;
});
after(async () => {
  await browser?.close();
  await app?.close();
});

const passIn = (at) => {
  clock.now = EPOCH + at;
  app.engine.ingest({ workspaceId: personal, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder: '10', t: at }] } });
};
/** A lap faster than the last, so a new track record; its seq. */
function newRecord() {
  lapMs -= 100;
  t += lapMs;
  passIn(t);
  return app.engine.snapshot(personal).recordNew.seq;
}

/** A page with AudioContext stubbed to count contexts made and oscillators started. */
async function boardPage(path = '/personal/board') {
  const { context, page, errors } = await pageAs(browser, app, member);
  await page.addInitScript(() => {
    window.contexts = 0;
    window.oscillators = 0;
    window.closes = 0;
    window.AudioContext = class {
      currentTime = 0;
      state = 'running';
      destination = {};
      constructor() { window.contexts += 1; }
      resume() { return Promise.resolve(); }
      close() { window.closes += 1; return Promise.resolve(); }
      createGain() {
        const param = { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
        return { gain: param, connect() {} };
      }
      createOscillator() {
        return { frequency: { value: 0 }, type: 'sine', connect() {}, start() { window.oscillators += 1; }, stop() {} };
      }
    };
  });
  await page.goto(path);
  await page.locator('#live-status[data-state="live"]').waitFor({ state: 'attached' });
  const rings = async () => (await page.evaluate(() => window.oscillators)) / PARTIALS.length;
  return { context, page, errors, rings };
}

/** Waiting for a gesture: the switch's state and the title the server gave for it. */
const WANTED = '#sound-switch[data-state="wanted"][title="Tap to turn sound on"][aria-label="Sound"]';
/** Which of the icon's parts show. */
const parts = (page) => page.locator('#sound-switch path').evaluateAll((paths) => paths.filter((p) => getComputedStyle(p).display !== 'none').map((p) => p.getAttribute('class')));

test('the switch is revealed by tl-board and toggles aria-pressed', async () => {
  const { context, page, errors } = await boardPage();
  try {
    const sound = page.getByRole('button', { name: 'Sound', exact: true });
    await sound.waitFor();
    assert.equal(await sound.getAttribute('aria-pressed'), 'false');
    await sound.click();
    await page.locator('#sound-switch[aria-pressed="true"]').waitFor();
    assert.equal(await page.evaluate(() => window.contexts), 1);
    await sound.click();
    assert.equal(await sound.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('the icon: struck through and outline when off, with waves and the pressed fill when on, the amber lamp while it waits for a tap', async () => {
  const { context, page, errors } = await boardPage();
  try {
    const sound = page.locator('#sound-switch');
    await sound.waitFor();
    assert.equal(await sound.getAttribute('title'), 'Sound');
    assert.deepEqual(await parts(page), ['sound-speaker', 'sound-strike']);
    const lamp = () => sound.evaluate((b) => getComputedStyle(b, '::after').content);
    assert.equal(await lamp(), 'none');
    const off = await sound.evaluate((b) => getComputedStyle(b).backgroundColor);
    await sound.click();
    await page.locator('#sound-switch[aria-pressed="true"]').waitFor();
    assert.deepEqual(await parts(page), ['sound-speaker', 'sound-waves']);
    await page.waitForFunction((was) => getComputedStyle(document.querySelector('#sound-switch')).backgroundColor !== was, off); // filled when pressed, after palace's transition
    assert.equal(await sound.getAttribute('title'), 'Sound');
    await page.reload();
    await page.locator(WANTED).waitFor();
    assert.deepEqual(await parts(page), ['sound-speaker']);
    assert.notEqual(await lamp(), 'none', 'the amber lamp');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('with sound off a new record does not ring', async () => {
  const { context, page, rings } = await boardPage();
  try {
    const seq = newRecord();
    await page.locator(`[data-record-new="${seq}"]`).waitFor();
    assert.equal(await rings(), 0);
  } finally { await context.close(); }
});

test('with sound on a new record rings once, and the same record in a later swap does not ring again', async () => {
  const { context, page, rings } = await boardPage('/personal/board?big');
  try {
    await page.getByRole('button', { name: 'Sound', exact: true }).click();
    await page.locator('#sound-switch[aria-pressed="true"]').waitFor();
    const seq = newRecord();
    await page.locator(`[data-record-new="${seq}"]`).waitFor();
    assert.equal(await rings(), 1);
    t += 12_000; // a slower lap: the board is swapped again, the same record still showing
    passIn(t);
    await page.locator('.board-feed', { hasText: '12.000' }).waitFor(); // the swap that carries the lap
    await page.locator(`[data-record-new="${seq}"]`).waitFor();
    assert.equal(await rings(), 1);
    const next = newRecord();
    await page.locator(`[data-record-new="${next}"]`).waitFor();
    assert.equal(await rings(), 2);
  } finally { await context.close(); }
});

test('a record already showing on the first render does not ring', async () => {
  const seq = newRecord();
  const { context, page, rings } = await boardPage();
  try {
    await page.locator(`[data-record-new="${seq}"]`).waitFor();
    await page.getByRole('button', { name: 'Sound', exact: true }).click();
    await page.waitForTimeout(300);
    assert.equal(await rings(), 0);
  } finally { await context.close(); }
});

test('a reload with sound remembered on asks for a tap, and only a running context shows the switch pressed', async () => {
  const { context, page, rings } = await boardPage();
  try {
    await page.getByRole('button', { name: 'Sound', exact: true }).click();
    await page.reload();
    await page.locator('#live-status[data-state="live"]').waitFor();
    const sound = page.locator('#sound-switch');
    await page.locator(WANTED).waitFor();
    assert.equal(await sound.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => window.contexts), 0);
    await sound.click();
    await page.locator('#sound-switch[aria-pressed="true"]').waitFor();
    assert.equal(await sound.getAttribute('data-state'), null);
    assert.equal(await sound.getAttribute('title'), 'Sound');
    assert.equal(await page.evaluate(() => window.contexts), 1);
    const seq = newRecord();
    await page.locator(`[data-record-new="${seq}"]`).waitFor();
    assert.equal(await rings(), 1);
  } finally { await context.close(); }
});

test('after a reload with sound remembered on, a click anywhere starts it too', async () => {
  const { context, page, rings } = await boardPage();
  try {
    await page.getByRole('button', { name: 'Sound', exact: true }).click();
    await page.reload();
    await page.locator('#live-status[data-state="live"]').waitFor();
    await page.locator(WANTED).waitFor();
    await page.locator('main').click({ position: { x: 5, y: 5 } });
    await page.locator('#sound-switch[aria-pressed="true"]').waitFor();
    assert.equal(await page.evaluate(() => window.contexts), 1);
    const seq = newRecord();
    await page.locator(`[data-record-new="${seq}"]`).waitFor();
    assert.equal(await rings(), 1);
  } finally { await context.close(); }
});

test('a context the browser keeps suspended leaves the switch asking for a tap', async () => {
  const { context, page } = await boardPage();
  try {
    await page.evaluate(() => {
      window.AudioContext = class extends window.AudioContext {
        state = 'suspended';
      };
    });
    await page.locator('#sound-switch').click();
    await page.locator(WANTED).waitFor();
    assert.equal(await page.locator('#sound-switch').getAttribute('aria-pressed'), 'false');
  } finally { await context.close(); }
});

test('the context is closed when tl-board is disconnected', async () => {
  const { context, page } = await boardPage();
  try {
    await page.getByRole('button', { name: 'Sound', exact: true }).click();
    assert.equal(await page.evaluate(() => window.contexts), 1);
    assert.equal(await page.evaluate(() => window.closes), 0);
    await page.evaluate(() => document.querySelector('tl-board').remove());
    assert.equal(await page.evaluate(() => window.closes), 1);
  } finally { await context.close(); }
});

test('the watch link has the switch too, and it works with storage blocked', async () => {
  await app.form(member, '/personal/watch-link', {});
  const token = app.store.workspace(personal).watchToken;
  const { context, page, errors } = await pageAs(browser, app, null);
  try {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
    });
    await page.goto(`/watch/${token}`);
    const sound = page.getByRole('button', { name: 'Sound', exact: true });
    await sound.waitFor();
    await sound.click();
    await page.locator('#sound-switch[aria-pressed="true"]').waitFor();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
