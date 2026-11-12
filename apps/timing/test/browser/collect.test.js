// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Collect in the browser (drivers and transponders spec §3.6): each form's field
// and button share one height, at a phone's and a laptop's width; a passing of one
// transponder lights only its row ("Crossing now", the accent), and assigning that
// row swaps the list in place, with one POST.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs, postPassings } from './browser.js';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
let app;
let browser;
let member;
let decoder;
let personal;
// The decoder's clock runs with real time, so a passing's server time is now.
const T0 = Date.now();
let last = 0;
const tick = () => { last = Math.max(last + 1, Date.now() - T0 + 1000); return last; };

before(async () => {
  app = await startTiming();
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  for (const name of ['Ana', 'Ben Okafor']) await app.form(member, '/personal/drivers', { name });
  const me = await (await app.api(member, 'GET', '/auth/me')).json();
  personal = me.workspaces[0].id;
  decoder = await (await app.api(member, 'POST', `/workspaces/${me.workspaces[0].id}/decoders`, { name: 'Start line' })).json();
  await postPassings(app, decoder, ['41', '52', '66'].map((transponder) => ({ transponder, t: tick() })));
});
after(async () => {
  await browser?.close();
  await app?.close();
});

for (const [size, viewport] of [['phone', PHONE], ['desktop', DESKTOP]]) {
  test(`collect at ${size} width: each form's field and button have one height, inside the page`, async (tc) => {
    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    tc.after(() => context.close());
    await page.goto('/personal/transponders/new');
    const forms = await page.locator('.collect-row form').evaluateAll((els) => els.map((form) => {
      const field = form.querySelector('select, input:not([type="hidden"])').getBoundingClientRect();
      const button = form.querySelector('button').getBoundingClientRect();
      return { field: field.height, button: button.height, right: Math.max(field.right, button.right) };
    }));
    assert.equal(forms.length, 6);
    for (const f of forms) {
      assert.ok(Math.abs(f.field - f.button) <= 0.5, `field ${f.field}px, button ${f.button}px`);
      assert.ok(f.right <= viewport.width, 'inside the page');
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
    assert.deepEqual(errors, []);
  });
}

test('at 390 px a passing lights only its row, and assigning it swaps the list in place', async (tc) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: PHONE });
  tc.after(() => context.close());
  const posts = [];
  page.on('request', (r) => { if (r.method() === 'POST') posts.push(new URL(r.url()).pathname); });
  const live = page.waitForResponse((r) => r.url().endsWith('/live'));
  await page.goto('/personal/transponders/new');
  await live;
  const row = (code) => page.locator(`.collect-row[data-code="${code}"]`);
  await assert.doesNotReject(row('52').locator('.crossing-now').waitFor({ state: 'hidden' }));
  await postPassings(app, decoder, [{ transponder: '52', t: tick() }]);
  await row('52').locator('.crossing-now').waitFor({ state: 'visible' });
  // The shadow eases in: read the rows once it has.
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.collect-row[data-code="52"]')).transitionProperty === 'box-shadow'
    && document.getAnimations().length === 0);
  const lit = await page.locator('.collect-row').evaluateAll((els) => els.map((el) => ({
    code: el.dataset.code,
    crossing: el.classList.contains('is-crossing'),
    now: !el.querySelector('.crossing-now').hidden,
    shadow: getComputedStyle(el).boxShadow,
    buttons: [...el.querySelectorAll('button')].map((b) => getComputedStyle(b).backgroundColor),
  })));
  const accent = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--p-accent-1)';
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  for (const r of lit) {
    const on = r.code === '52';
    assert.equal(r.crossing, on, `${r.code} is-crossing`);
    assert.equal(r.now, on, `${r.code} Crossing now`);
    assert.equal(r.shadow.includes(accent), on, `${r.code} accent shadow`);
    for (const bg of r.buttons) assert.equal(bg === accent, on, `${r.code} buttons ${on ? 'primary' : 'outlined'}`);
  }
  await row('52').locator('select').selectOption({ label: 'Ben Okafor' });
  await row('52').getByRole('button', { name: 'Assign transponder 52', exact: true }).click();
  await page.locator('[role="status"]', { hasText: "Transponder 52 is Ben Okafor's now. Change" }).waitFor();
  assert.equal(await row('52').count(), 0, 'its row is gone');
  assert.equal(await page.locator('.collect-row').count(), 2);
  assert.deepEqual(posts, ['/personal/transponders/52']);
  assert.equal(new URL(page.url()).search, '?assigned=52');
  assert.equal(await page.locator('tl-crossing-now').count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Transponder 52 is Ben Okafor's now. Change", 'the line has the focus');
  await page.locator('#frame-status', { hasText: 'New transponders saved' }).waitFor({ state: 'attached' });
  assert.deepEqual(errors, []);
});

/** Gives `code` to Ana behind the page's back, as another member would. */
const takenMeanwhile = (code) => app.form(member, `/personal/transponders/${code}`, { driver: anaId(), name: '', returnTo: '/personal/setup' });
const anaId = () => app.store.drivers(personal).find((d) => d.name === 'Ana').id;

test("with script, a row whose number became someone else's asks in the row, then gives it", async (tc) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: PHONE });
  tc.after(() => context.close());
  const posts = [];
  page.on('request', (r) => { if (r.method() === 'POST') posts.push(new URL(r.url()).pathname); });
  await page.goto('/personal/transponders/new');
  assert.equal((await takenMeanwhile('66')).status, 303);
  const row = page.locator('.collect-row[data-code="66"]');
  await row.locator('select').selectOption({ label: 'Ben Okafor' });
  await row.getByRole('button', { name: 'Assign transponder 66', exact: true }).click();
  await row.getByText("Transponder 66 is Ana's. Giving it to Ben Okafor takes it off Ana.").waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Give it to Ben Okafor', 'the answer has the focus');
  assert.equal(await page.locator('#frame-status').textContent(), '', 'nothing saved yet');
  await page.getByRole('button', { name: 'Give it to Ben Okafor' }).click();
  await page.locator('[role="status"]', { hasText: "Transponder 66 is Ben Okafor's now." }).waitFor();
  assert.equal(await page.locator('.collect-row[data-code="66"]').count(), 0);
  assert.deepEqual(posts, ['/personal/transponders/66', '/personal/transponders/66']);
  assert.deepEqual(errors, []);
});

test("without script, the same question comes as the collect page, and Give it comes back to collect", async (tc) => {
  const { context, page } = await pageAs(browser, app, member, { viewport: PHONE, javaScriptEnabled: false });
  tc.after(() => context.close());
  await page.goto('/personal/transponders/new');
  assert.equal((await takenMeanwhile('41')).status, 303);
  const row = page.locator('.collect-row[data-code="41"]');
  await row.locator('input[name="name"]').fill('Lena');
  await row.getByRole('button', { name: 'Add and assign transponder 41' }).click();
  await page.getByText("Transponder 41 is Ana's. Giving it to Lena takes it off Ana.").waitFor();
  await page.getByRole('button', { name: 'Give it to Lena' }).click();
  await page.getByText("Transponder 41 is Lena's now, a new driver.").waitFor();
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, '/personal/transponders/new?assigned=41&added=1');
});
