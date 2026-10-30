// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The browser notification (records spec §4.3): the Notify me switch, and
// tl-board raising one notification when a swap brings a track record it has
// not seen. Notification is a stub that records what is constructed; the test
// sets its permission and what requestPermission answers.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { PARTIALS } from '../../public/bell.js';
import { formatLap } from '../../public/format.js';
import { startTiming } from '../server/helpers.js';
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
  app.store.setTrack(personal, { id: 't1', shape: 'c30:1:x', name: 'Ring', snapshotKey: 'r'.repeat(22), layout: '{}' }, 'cw');
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

/**
 * A page with Notification stubbed: `permission` to start with, `answer` for
 * requestPermission, or `notification: false` for a browser without it;
 * `throws` makes its constructor throw, as Android Chrome's does. AudioContext
 * counts the oscillators a ring starts.
 */
async function boardPage(path = '/personal/board', { permission = 'default', answer = 'granted', notification = true, storage = true, throws = false, who = member } = {}) {
  const { context, page, errors } = await pageAs(browser, app, who);
  await page.addInitScript(({ permission, answer, notification, storage, throws }) => {
    window.oscillators = 0;
    window.AudioContext = class {
      currentTime = 0;
      state = 'running';
      destination = {};
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createGain() {
        const param = { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
        return { gain: param, connect() {} };
      }
      createOscillator() {
        return { frequency: { value: 0 }, type: 'sine', connect() {}, start() { window.oscillators += 1; }, stop() {} };
      }
    };
    if (!storage) Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
    window.notes = [];
    window.focused = 0;
    window.focus = () => { window.focused += 1; };
    if (!notification) {
      delete window.Notification;
      return;
    }
    window.Notification = class {
      static permission = permission;
      static requestPermission() {
        window.Notification.permission = answer;
        return Promise.resolve(answer);
      }
      constructor(title, options) {
        if (throws) throw new TypeError('Illegal constructor');
        this.listeners = [];
        window.notes.push({ title, body: options.body, tag: options.tag, note: this });
      }
      addEventListener(type, listener) { this.listeners.push({ type, listener }); }
      close() {}
    };
  }, { permission, answer, notification, storage, throws });
  await page.goto(path);
  await page.locator('#live-status[data-state="live"]').waitFor({ state: 'attached' });
  const notes = () => page.evaluate(() => window.notes.map(({ title, body, tag }) => ({ title, body, tag })));
  const rings = async () => (await page.evaluate(() => window.oscillators)) / PARTIALS.length;
  return { context, page, errors, notes, rings };
}

/** Turns Notify me on and waits for it to show pressed. */
async function turnOn(page) {
  await page.getByRole('button', { name: 'Notify me' }).click();
  await page.locator('#notify-switch[aria-pressed="true"]').waitFor();
}

test('with Notify me off a new record shows no notification', async () => {
  const { context, page, notes, errors } = await boardPage();
  try {
    const notify = page.getByRole('button', { name: 'Notify me' });
    await notify.waitFor();
    assert.equal(await notify.getAttribute('aria-pressed'), 'false');
    const seq = newRecord();
    await page.locator(`[data-record-new="${seq}"]`).waitFor();
    assert.deepEqual(await notes(), []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('on and granted, a new record shows one notification with its text and tag; a click on it focuses the board', async () => {
  const { context, page, notes, errors } = await boardPage();
  try {
    await turnOn(page);
    assert.equal(await page.evaluate(() => localStorage.getItem('tinylap-notify')), 'on');
    const beat = lapMs;
    const seq = newRecord();
    await page.locator(`[data-record-new="${seq}"]`).waitFor();
    const [note, ...more] = await notes();
    assert.deepEqual(more, []);
    assert.equal(note.title, 'New track record');
    assert.equal(note.tag, `tinylap-record-${seq}`);
    assert.match(note.body, new RegExp(`^${formatLap(lapMs).replace('.', '\\.')} · Ana\\nBeat ${formatLap(beat).replace('.', '\\.')} · Ana · \\S.*$`));
    await page.evaluate(() => {
      for (const { type, listener } of window.notes[0].note.listeners) if (type === 'click') listener(new Event('click'));
    });
    assert.equal(await page.evaluate(() => window.focused), 1);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('the same record in a later swap notifies once; the next record notifies again; a second click turns it off', async () => {
  const { context, page, notes } = await boardPage('/personal/board?big');
  try {
    await turnOn(page);
    const seq = newRecord();
    await page.locator(`[data-record-new="${seq}"]`).waitFor();
    assert.equal((await notes()).length, 1);
    t += 12_000; // a slower lap: the board is swapped again, the same record still showing
    passIn(t);
    await page.locator('.board-feed', { hasText: '12.000' }).waitFor(); // the swap that carries the lap
    await page.locator(`[data-record-new="${seq}"]`).waitFor();
    assert.equal((await notes()).length, 1);
    const next = newRecord();
    await page.locator(`[data-record-new="${next}"]`).waitFor();
    assert.deepEqual((await notes()).map((n) => n.tag), [`tinylap-record-${seq}`, `tinylap-record-${next}`]);
    await page.getByRole('button', { name: 'Notify me' }).click();
    await page.locator('#notify-switch[aria-pressed="false"]').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('tinylap-notify')), 'off');
    const last = newRecord();
    await page.locator(`[data-record-new="${last}"]`).waitFor();
    assert.equal((await notes()).length, 2);
  } finally { await context.close(); }
});

test('a record already showing on the first render shows no notification, with Notify me remembered on', async () => {
  const { context, page, notes } = await boardPage('/personal/board', { permission: 'granted' });
  try {
    await turnOn(page);
    const seq = newRecord();
    await page.locator(`[data-record-new="${seq}"]`).waitFor();
    await page.reload();
    await page.locator('#live-status[data-state="live"]').waitFor();
    await page.locator('#notify-switch[aria-pressed="true"]').waitFor();
    await page.locator(`[data-record-new="${seq}"]`).waitFor();
    await page.waitForTimeout(300);
    assert.deepEqual(await notes(), []);
  } finally { await context.close(); }
});

test('denied, the switch shows it is blocked and nothing is notified', async () => {
  const { context, page, notes } = await boardPage('/personal/board', { answer: 'denied' });
  try {
    await page.getByRole('button', { name: 'Notify me' }).click();
    const notify = page.locator('#notify-switch[data-state="blocked"]');
    await notify.waitFor();
    assert.equal(await notify.isDisabled(), true);
    assert.equal(await notify.getAttribute('aria-pressed'), 'false');
    await page.getByRole('button', { name: 'Notifications blocked' }).waitFor();
    const seq = newRecord();
    await page.locator(`[data-record-new="${seq}"]`).waitFor();
    assert.deepEqual(await notes(), []);
  } finally { await context.close(); }
  const again = await boardPage('/personal/board', { permission: 'denied' });
  try {
    await again.page.getByRole('button', { name: 'Notifications blocked' }).waitFor();
    assert.equal(await again.page.locator('#notify-switch').isDisabled(), true);
  } finally { await again.context.close(); }
});

test('without Notification in the browser the switch stays hidden', async () => {
  const { context, page, errors } = await boardPage('/personal/board', { notification: false });
  try {
    await page.getByRole('button', { name: 'Sound on' }).waitFor();
    assert.equal(await page.locator('#notify-switch').isHidden(), true);
    const seq = newRecord();
    await page.locator(`[data-record-new="${seq}"]`).waitFor();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('the watch link has the switch too, and it works with storage blocked', async () => {
  await app.form(member, '/personal/watch-link', {});
  const token = app.store.workspace(personal).watchToken;
  const { context, page, notes, errors } = await boardPage(`/watch/${token}`, { storage: false, who: null });
  try {
    await turnOn(page);
    const seq = newRecord();
    await page.locator(`[data-record-new="${seq}"]`).waitFor();
    assert.deepEqual((await notes()).map((n) => n.tag), [`tinylap-record-${seq}`]);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('a notification the browser refuses to construct leaves one ring of the bell and no page error', async () => {
  const { context, page, errors, rings } = await boardPage('/personal/board', { throws: true });
  try {
    await page.getByRole('button', { name: 'Sound on' }).click();
    await page.locator('#sound-switch[aria-pressed="true"]').waitFor();
    await turnOn(page);
    const seq = newRecord();
    await page.locator(`[data-record-new="${seq}"]`).waitFor();
    t += 12_300; // a slower lap, unlike any before: the board is swapped again, the same record still showing
    passIn(t);
    await page.locator('.board-feed', { hasText: '12.300' }).waitFor();
    assert.equal(await rings(), 1);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('a permission revoked while the page was hidden unpresses the switch when it shows again', async () => {
  const { context, page } = await boardPage();
  try {
    await turnOn(page);
    await page.evaluate(() => {
      window.Notification.permission = 'default';
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); // as the browser's does
    });
    await page.locator('#notify-switch[aria-pressed="false"]').waitFor();
  } finally { await context.close(); }
});
