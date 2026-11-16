// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Shoots the idle board and its Start panel for each kind (board hub spec §5)
// at a laptop, a phone and a TV, to look at against the design.
// Run by hand: node apps/timing/test/layout/shoot-start.js <out-dir>
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { clubNight } from '../server/club-night.js';
import { startTiming, useTrack } from '../server/helpers.js';
import { openBrowser, pageAs } from '../browser/browser.js';

const out = process.argv[2];
if (!out) throw new Error('usage: shoot-start.js <out-dir>');
mkdirSync(out, { recursive: true });
const clock = { now: Date.UTC(2026, 10, 16, 18, 0) };
const app = await startTiming({ clock });
const browser = await openBrowser();
const ana = await app.signUp('Ana');
const night = await app.signUp('Night');
const fresh = app.club(ana, 'Fresh');
const empty = app.club(ana, 'Empty');
const member = await app.login(ana);
const host = await app.login(night);
const personal = (await (await app.api(host, 'GET', '/auth/me')).json()).workspaces[0].id;
await clubNight(app, clock, host, { ws: personal, base: '/personal', useTrack });
// A race last, so the board shows a race result and the panel has Race checked.
const pass = (code, at) => { clock.now = at; app.engine.ingest({ workspaceId: personal, decoder: 'shoot', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder: code, t: at }] } }); };
const race = app.engine.start(personal, { kind: 'race', roster: null, durationMs: 30_000, countdownMs: 0 }).session;
const from = clock.now;
for (let lap = 0; lap <= 5; lap += 1) for (const [i, code] of ['11', '12', '13', '14', '15', '16'].entries()) pass(code, from + 300 + i * 150 + lap * (7100 + i * 60));
clock.now += 2000;
app.engine.tick();
if (app.store.runningSession(personal)?.id === race.id) app.engine.abort(personal, race.id);
useTrack(app.store, fresh.id, 'Kitchen Ring', 'cw');
for (const name of ['Ana', 'Ben Okafor', 'Dara']) await app.form(member, `/clubs/${fresh.id}/drivers`, { name });

const sizes = { laptop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 }, tv: { width: 1920, height: 1080 } };
async function shot(who, path, name, viewport, act = async () => {}) {
  const { context, page } = await pageAs(browser, app, who, { viewport });
  await page.goto(path);
  await act(page);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
  await context.close();
}
for (const [size, viewport] of Object.entries(sizes)) {
  await shot(host, '/personal/board', `${size}-idle-practice`, viewport);
  await shot(host, '/personal/board', `${size}-qualifying`, viewport, (page) => page.locator('.start-kind-option', { hasText: 'Qualifying' }).click());
  await shot(host, '/personal/board', `${size}-race`, viewport, (page) => page.locator('.start-kind-option', { hasText: 'Race' }).click());
  await shot(host, '/personal/board', `${size}-race-chosen`, viewport, async (page) => {
    await page.locator('.start-kind-option', { hasText: 'Race' }).click();
    await page.locator('.start-settings[data-for="race"] .start-option', { hasText: 'Chosen drivers' }).click();
  });
  await shot(member, `/clubs/${fresh.id}/board`, `${size}-never-driven`, viewport);
  await shot(member, `/clubs/${empty.id}/board`, `${size}-no-drivers`, viewport);
}
await shot(host, '/personal/board?big', 'tv-big-idle', sizes.tv);
// A car on the track, the reason to press Start.
clock.now += 60_000;
pass('11', clock.now);
await shot(host, '/personal/board', 'laptop-on-track', sizes.laptop);
await shot(host, '/personal/board', 'phone-on-track', sizes.phone);
await browser.close();
await app.close();
