// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Measures the board table with and without "last lap" notes (spec step two §5.2).
// Run by hand: node apps/timing/test/layout/measure-board.js [out-dir for screenshots]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { launchOptions } from '../../../accounts/playwright.config.js';
import { boardPage } from '../../server/views/board.js';
import { appDir } from '../server/helpers.js';

const NAMES = ['Ana Fernández', 'Al', 'Maximilian Weber', 'Cy', 'Dagmar Kowalczyk', 'Eli', 'Fatima Al-Sayed', 'Gus', 'Hanna Lindqvist', 'Ivo', 'Jonas Albrecht', 'Kim', 'Lou', 'Mia Schneider', 'Noah', 'Olga Petrova', 'Pia', 'Quentin Moreau', 'Rui', 'Sven Johansson'];
const now = Date.UTC(2026, 9, 18, 10, 40);
const ROOTS = { '/pkg/palace-ui/': join(appDir, 'node_modules/palace-ui/'), '/pkg/design/': join(appDir, 'node_modules/@tinylap/design/'), '/public/': join(appDir, 'public/') };

/** n drivers in a running race; notes: 'none' (all lapping), 'all' (all stopped 13+ min), 'wide' (all stopped days ago: a date). */
function page(n, notes, big) {
  const drivers = NAMES.slice(0, n).map((name, i) => ({ id: `d${i}`, name, colour: '#e4572e' }));
  const lastAt = (i) => (notes === 'none' ? now - 5000 : notes === 'wide' ? now - 4 * 86_400_000 : now - (i + 1) * 13 * 60_000);
  const snap = {
    now, track: { id: 't', name: 'Office loop' }, direction: 'cw',
    // Opened before every lastAt: a race shows no note for a crossing before its start.
    session: { id: 's', kind: 'race', state: 'running', opensAt: now - 5 * 86_400_000, closesAt: now + 180_000 },
    standings: drivers.map((d, i) => ({ driverId: d.id, position: i + 1, laps: 30 - i, bestMs: 8123 + i * 37, bestAt: 1, totalMs: 1, elapsedMs: 245_123 + i * 1000, finished: false, lastAt: lastAt(i) })),
    crossings: [], drivers, bests: [], lastResults: null, unknown: [],
  };
  const request = { space: { base: '/personal' }, url: new URL(`http://board.test/personal/board${big ? '?big' : ''}`), session: null, build: 'dev', spaces: [], auth: {} };
  return String(boardPage(request, snap, { big })).replace(/<script[^>]*src=[^>]*><\/script>/g, '');
}

const browser = await chromium.launch(launchOptions);
for (const [label, width, height, big, n] of [['phone', 390, 844, false, 6], ['phone', 390, 844, false, 20], ['desk', 1280, 800, false, 20], ['big', 1920, 1080, true, 20]]) {
  for (const notes of ['none', 'all', 'wide']) {
    const tab = await browser.newPage({ viewport: { width, height } });
    await tab.route('http://board.test/**', (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname.startsWith('/personal/board')) return route.fulfill({ contentType: 'text/html', body: page(n, notes, big) });
      const [prefix, dir] = Object.entries(ROOTS).find(([p]) => pathname.startsWith(p)) ?? [];
      if (!prefix) return route.fulfill({ status: 404 });
      try { return route.fulfill({ body: readFileSync(join(dir, pathname.slice(prefix.length))), contentType: pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.svg') ? 'image/svg+xml' : undefined }); } catch { return route.fulfill({ status: 404 }); }
    });
    await tab.goto(`http://board.test/personal/board${big ? '?big' : ''}`);
    await tab.evaluate(() => document.fonts.ready);
    const m = await tab.evaluate(() => {
      const scroll = document.querySelector('.board-scroll');
      return {
        columns: [...document.querySelectorAll('.board-table thead th')].map((th) => Math.round(th.getBoundingClientRect().left)).join(','),
        tableScroll: scroll.scrollWidth - scroll.clientWidth,
        pageScroll: document.documentElement.scrollWidth - innerWidth,
        height: document.documentElement.scrollHeight,
      };
    });
    console.log(label, `${width}x${height}`, `${n} drivers`, notes, JSON.stringify(m));
    if (process.argv[2]) await tab.screenshot({ path: join(process.argv[2], `${label}-${n}-${notes}.png`), fullPage: true });
    await tab.close();
  }
}
await browser.close();
