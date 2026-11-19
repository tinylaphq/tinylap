// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Records the README walkthrough: a club night's race on the laptop board,
// from adding a driver to a personal best and a track record. Writes the raw
// video and the cuts (the waits to leave out) for make-walkthrough-gif.sh.
// Run by hand: node apps/timing/test/layout/record-walkthrough.js <out-dir>
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startTiming, useTrack } from '../server/helpers.js';
import { openBrowser, postPassings } from '../browser/browser.js';

const out = process.argv[2];
if (!out) throw new Error('usage: record-walkthrough.js <out-dir>');
mkdirSync(out, { recursive: true });

// Server time runs with real time, moved forward between crossings so the track runs faster than the film.
const clock = { offset: -3_600_000, get now() { return Date.now() + this.offset; } };
const app = await startTiming({ clock });
const browser = await openBrowser();
const user = await app.signUp('Sam');
const member = await app.login(user);
const ws = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
useTrack(app.store, ws, 'Kitchen Ring', 'cw');
const CARS = { Ana: '11', 'Ben Okafor': '12', Dara: '13', 'Mia Schulz': '14', Jo: '15' };
const REGULARS = ['Ana', 'Ben Okafor', 'Dara', 'Mia Schulz'];
for (const name of REGULARS) await app.form(member, '/personal/drivers', { name });
for (const d of app.store.drivers(ws)) app.engine.assign(ws, CARS[d.name], d.id);
const decoder = await (await app.api(member, 'POST', `/workspaces/${ws}/decoders`, { name: 'Gate' })).json();

/** The decoder's clock maps to server time from `anchor`; each car's last crossing on it. */
let anchor = { t: 1000, wall: clock.now };
const last = new Map();
async function cross(code, lapMs) {
  const t = lapMs ? last.get(code) + lapMs : Math.max(anchor.t, ...last.values()) + 400;
  last.set(code, t);
  clock.offset = anchor.wall + (t - anchor.t) - Date.now();
  const res = await postPassings(app, decoder, [{ transponder: code, t }]);
  if (res.status !== 200) throw new Error(`passing ${res.status}`);
}
/** Each car's laps in the order they cross, `gap` ms of film apart. */
async function drive(laps, gap = 0) {
  const plan = [];
  for (const [name, ms] of Object.entries(laps)) {
    let t = last.get(CARS[name]) ?? 0;
    for (const lap of ms) plan.push({ name, lap, at: (t += lap) });
  }
  plan.sort((a, b) => a.at - b.at);
  for (const p of plan) {
    await cross(CARS[p.name], p.lap);
    if (gap) await new Promise((r) => setTimeout(r, gap));
  }
}

// Last week's practice: Dara holds the record, the regulars each have a best.
app.engine.start(ws, { kind: 'practice' });
clock.offset += 5000;
anchor = { t: 1000, wall: clock.now };
for (const name of REGULARS) await cross(CARS[name]);
await drive({ Ana: [7420, 7310], 'Ben Okafor': [7380, 7262], Dara: [7104, 7250], 'Mia Schulz': [7690, 7610] });
app.engine.end(ws, app.store.runningSession(ws).id);
clock.offset = 0;
last.clear();
// Tonight Jo brought a car: it crossed the line once, its transponder not anyone's yet.
anchor = { t: 40_000, wall: clock.now - 20_000 };
await cross(CARS.Jo);
last.clear();

const viewport = { width: 1280, height: 800 };
const context = await browser.newContext({ baseURL: app.base, viewport, recordVideo: { dir: out, size: viewport }, reducedMotion: 'no-preference' });
await context.addCookies([...member.jar.cookies].map(([name, value]) => ({ name, value, domain: new URL(app.base).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' })));
// A pointer the film can see: a dot that follows the mouse and pulses on a click, kept across page loads.
await context.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;z-index:99999;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(10,10,10,.55);border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4);pointer-events:none;transition:transform .12s';
    const [x, y] = (sessionStorage.getItem('dot') ?? '640,400').split(',');
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    document.body.append(dot);
    addEventListener('mousemove', (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; sessionStorage.setItem('dot', `${e.clientX},${e.clientY}`); }, true);
    addEventListener('mousedown', () => { dot.style.transform = 'scale(.7)'; }, true);
    addEventListener('mouseup', () => { dot.style.transform = ''; }, true);
  });
});
const page = await context.newPage();
const film = Date.now();
const at = () => (Date.now() - film) / 1000;
/** Spans of film to leave out, in seconds. */
const cuts = [];
const cut = async (fn) => { const from = at(); await fn(); cuts.push([from, at()]); };
let mouse = { x: 640, y: 400 };
async function point(locator, { click = true } = {}) {
  const box = await locator.boundingBox();
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const steps = 11;
  for (let i = 1; i <= steps; i += 1) {
    const k = i / steps;
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    await page.mouse.move(mouse.x + (to.x - mouse.x) * e, mouse.y + (to.y - mouse.y) * e);
    await page.waitForTimeout(12);
  }
  mouse = to;
  if (click) {
    await page.waitForTimeout(120);
    await page.mouse.down();
    await page.waitForTimeout(90);
    await page.mouse.up();
  }
}

// Scene 1: add Jo, and give Jo the transponder that just crossed.
await cut(async () => {
  await page.goto('/personal/setup#drivers');
  await page.locator('#add-driver-name').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
});
await page.waitForTimeout(200);
await point(page.locator('#add-driver-name'));
await page.keyboard.type('Jo', { delay: 90 });
await point(page.getByRole('button', { name: 'Add driver' }));
await page.waitForLoadState('networkidle');
await page.waitForTimeout(250);
const jo = page.locator('.roster > li', { hasText: 'Jo' });
await point(jo.locator('summary', { hasText: 'Add a transponder' }));
await page.waitForTimeout(250);
await point(jo.locator(`.pick-row[data-code="${CARS.Jo}"] summary`));
await page.waitForTimeout(250);
await point(jo.locator(`.pick-row[data-code="${CARS.Jo}"] button[type=submit]`));
await page.waitForLoadState('networkidle');
await page.waitForTimeout(600);
// Jo's car goes round again, now as Jo's.
anchor = { t: 60_000, wall: clock.now };
await cross(CARS.Jo);

// Scene 2: a race for everyone on the track.
await page.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' }));
await page.waitForTimeout(500);
await point(page.getByRole('link', { name: 'Board', exact: true }));
await page.waitForLoadState('networkidle');
await page.waitForTimeout(300);
await point(page.locator('.start-kind-option', { hasText: 'Race' }));
await page.waitForTimeout(400);
await point(page.locator('.start-go'));
await page.waitForTimeout(700);
// The countdown: its last three seconds stay in. The test server ticks only when told.
await cut(() => page.waitForTimeout(6600));
const ticks = setInterval(() => app.engine.tick(), 50);
await page.waitForFunction(() => document.querySelector('[data-clock]')?.dataset.state === 'running', null, { timeout: 10_000 });
clearInterval(ticks);
await page.waitForTimeout(300);

// Scene 3: the field crosses, then laps every half second of film.
const field = ['Ana', 'Ben Okafor', 'Dara', 'Mia Schulz', 'Jo'];
anchor = { t: 100_000, wall: clock.now };
for (const name of field) { await cross(CARS[name]); await page.waitForTimeout(220); }
await drive({
  Ana: [7450, 7380, 7402],
  'Ben Okafor': [7390, 7300, 7344],
  Dara: [7330, 7290, 7302],
  'Mia Schulz': [7720, 7650, 7700],
  Jo: [7760, 7810, 7900],
}, 400);

// Scene 4: Mia beats her own best, not the race's fastest lap.
await drive({ 'Mia Schulz': [7588] });
await page.waitForTimeout(1700);
await drive({ 'Ben Okafor': [7330], Dara: [7310], Jo: [7950] }, 400);

// Scene 5: Ana takes the track record from Dara.
await drive({ Ana: [7050] });
await page.waitForTimeout(3400);

const video = page.video();
await context.close();
renameSync(await video.path(), join(out, 'raw.webm'));
writeFileSync(join(out, 'cuts.json'), JSON.stringify({ end: at(), cuts }));
await browser.close();
await app.close();
