// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Records the Planner walkthrough for the landing page: an L-shaped circuit laid from the keyboard,
// two large corners among the small ones, the materials falling short and the
// large-corner kit added to cover them. Writes the raw video and the cuts (the
// waits to leave out) for apps/timing/test/layout/make-walkthrough-gif.sh.
// Run by hand: node apps/track-planner/test/layout/record-walkthrough.js <out-dir>
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from '../server/helpers.js';
import { openBrowser } from '../../../timing/test/browser/browser.js';

const out = process.argv[2];
if (!out) throw new Error('usage: record-walkthrough.js <out-dir>');
mkdirSync(out, { recursive: true });

const app = await startServer();
const browser = await openBrowser();
const viewport = { width: 1280, height: 800 };
const context = await browser.newContext({ baseURL: app.base, viewport, recordVideo: { dir: out, size: viewport }, reducedMotion: 'no-preference' });
// A pointer the film can see: a dot that follows the mouse and pulses on a click.
// And a keycap that shows each key as it is pressed, below the canvas.
await context.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;z-index:99999;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(10,10,10,.55);border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4);pointer-events:none;transition:transform .12s;left:640px;top:400px';
    document.body.append(dot);
    const move = (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; };
    addEventListener('mousemove', move, true);
    addEventListener('dragover', move, true);
    addEventListener('mousedown', () => { dot.style.transform = 'scale(.7)'; }, true);
    addEventListener('mouseup', () => { dot.style.transform = ''; }, true);
    addEventListener('drop', () => { dot.style.transform = ''; }, true);
    const cap = document.createElement('div');
    cap.style.cssText = "position:fixed;z-index:99998;left:615px;bottom:72px;transform:translateX(-50%);min-width:44px;padding:8px 14px;background:#fff;color:#0a0a0a;border:2px solid #0a0a0a;box-shadow:4px 4px 0 #ff2d95;font:700 18px/1 'Space Grotesk',system-ui,sans-serif;letter-spacing:.06em;text-align:center;text-transform:uppercase;pointer-events:none;opacity:0;transition:opacity .25s";
    document.body.append(cap);
    let hide;
    addEventListener('keydown', (e) => {
      if (e.target.matches('input')) return;
      cap.textContent = { ' ': 'Space', Escape: 'Esc' }[e.key] ?? e.key;
      cap.style.opacity = '1';
      clearTimeout(hide);
      hide = setTimeout(() => { cap.style.opacity = '0'; }, 420);
    }, true);
  });
});
const page = await context.newPage();
const film = Date.now();
const at = () => (Date.now() - film) / 1000;
/** Spans of film to leave out, in seconds. */
const cuts = [];
const cut = async (fn) => { const from = at(); await fn(); cuts.push([from, at()]); };
let mouse = { x: 640, y: 400 };
async function glide(to) {
  const steps = 14;
  for (let i = 1; i <= steps; i += 1) {
    const k = i / steps;
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    await page.mouse.move(mouse.x + (to.x - mouse.x) * e, mouse.y + (to.y - mouse.y) * e);
    await page.waitForTimeout(14);
  }
  mouse = to;
}
async function point(locator, { click = true } = {}) {
  const box = await locator.boundingBox();
  await glide({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  if (click) {
    await page.waitForTimeout(120);
    await page.mouse.down();
    await page.waitForTimeout(90);
    await page.mouse.up();
  }
}
/** Presses each key in turn: S is Space. */
async function keys(seq, gap = 330) {
  for (const k of seq.split(' ')) {
    await page.keyboard.press(k === 'S' ? 'Space' : k);
    await page.waitForTimeout(gap);
  }
}

await cut(async () => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
});
await page.waitForTimeout(500);

// Scene 1: drag the first straight onto the canvas.
const straight = page.locator('#palette-list li[data-type=straight]');
await point(straight, { click: false });
await page.waitForTimeout(200);
await page.mouse.down();
const canvas = await page.locator('#canvas').boundingBox();
await glide({ x: canvas.x + canvas.width * 0.6, y: canvas.y + canvas.height * 0.4 });
await page.waitForTimeout(250);
await page.mouse.up();
await page.waitForTimeout(400);
// The pointer steps aside for the keyboard.
await glide({ x: 140, y: 680 });
await page.waitForTimeout(300);

// Scene 2: Space lays the next piece, C swaps it for a corner (twice for the large one), R turns it the other way.
await keys('S S');
await keys('S c c', 420); // a large corner
await keys('S c c', 420); // and another
await keys('S');
await keys('S c r', 420); // a small corner, turned left
await keys('S');
await keys('S c', 420);
await keys('S c', 420);
await keys('S S S S S', 260);
await keys('S c r', 420); // the last corner closes the circuit
await page.keyboard.press('Escape');
await page.waitForTimeout(1800);

// Scene 3: the large corners need their kit; add it and the warning goes.
await point(page.locator('#btn-inventory'));
await page.waitForTimeout(600);
await point(page.locator('#kit-87033-02'));
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.type('1', { delay: 90 });
await page.waitForTimeout(400);
await point(page.locator('#inventory-form button[value=save]'));
await page.waitForTimeout(400);
await glide({ x: 1120, y: 700 });
await page.waitForTimeout(2600);

const video = page.video();
await context.close();
renameSync(await video.path(), join(out, 'raw.webm'));
writeFileSync(join(out, 'cuts.json'), JSON.stringify({ end: at(), cuts }));
await browser.close();
await app.close();
