# The board as custom elements: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans (native). Steps use checkbox (`- [ ]`) syntax.

**Goal:** The live board's page script becomes three light-DOM elements:
- `tl-board` (the stream);
- `tl-countdown` (the session clock on server time; on the race page it reloads once at a phase change);
- `tl-relative-time` (a quiet "last lap N min ago" under a driver who has stopped).

Without JavaScript the board works as today, and the note is rendered by the server.

**Architecture:**
- `tl-board` and `tl-countdown` are timing-app elements in `apps/timing/public/elements/`.
- `tl-relative-time` is shared, in `packages/design/elements/`, with the DOM-free `packages/design/format-ago.js` that the server imports too.
- One clock rule, `clockAt()` in `apps/timing/public/format.js`, serves the server and the browser.
- `packages/timing` adds `lastAt` to the standings rows.
- `public/board.js` keeps only the full-screen button, which becomes server markup.

**Tech stack:** plain ES modules, checked by tsc `--checkJs` and eslint. Tests use node:test and playwright-core browser tests.

**Spec:** `docs/superpowers/specs/2026-10-18-custom-elements-step-two-board.md` (draft 4, committed in dcff143). Read it; it is the authority. Section and test ids below (§2.2, B1–B6, C1–C7) are the spec's.

**Changed after implementation:** Chrome served `location.reload()` from a prefetch of the same page, so the speculation rules now leave out links to the page itself (`[aria-current="page"]`, commit 379307d), and C5 checks that nothing is fetched ahead. The review added B7, B8, C8 and C9 and a browser test timeout. Where this plan and the spec differ, the spec supersedes it.

## Global constraints

- **AGENTS.md "Web platform first":**
  - light DOM, `tl-*` names, start in `connectedCallback`, stop in `disconnectedCallback`;
  - no markup built in script: elements write text and attributes only;
  - each element file defines its element only when the name is free: `if (!customElements.get('tl-x')) customElements.define('tl-x', TlX);`.
- **UI work uses the `frontend-design` skill:** the note's placement and styles, the race clock, the min-widths. The look is palace-ui plus `@tinylap/design`, with palace tokens only and no new visual language.
- **Licences:**
  - `packages/design` and `packages/timing` files are `MPL-2.0`, and `apps/timing` files are `AGPL-3.0-or-later`;
  - every file uses the SPDX header of its neighbours (`// SPDX-FileCopyrightText: 2026 The TinyLap contributors` / `//` / `// SPDX-License-Identifier: …`);
  - REUSE lint must pass.
- **Commits:**
  - conventional, `git commit -s`;
  - author `1009814+jostsg@users.noreply.github.com`: `git -c user.email=1009814+jostsg@users.noreply.github.com commit -s …`;
  - no `Co-Authored-By`, and no mention of an AI tool anywhere.
- **Before each commit, the checks:**
  - `pnpm turbo run test lint typecheck --filter=@tinylap/design --filter=@tinylap/timing --filter=@tinylap/timing-app`;
  - when `@tinylap/design` changes (Tasks 1 and 6), also run its consumers:
    - `pnpm turbo run test lint typecheck --filter=@tinylap/accounts`;
    - `pnpm turbo run test lint typecheck --filter=@tinylap/track-planner` (its unit and server tests take about 5 s; its browser tests are unaffected by this branch);
  - from Task 4 on, also `pnpm --filter @tinylap/timing-app test:browser`;
  - `pipx run reuse lint`, or `reuse lint` if it is installed.
- **Server code:**
  - never imports `@tinylap/design/elements/*` or `public/elements/*`;
  - imports the DOM-free `@tinylap/design/format-ago.js` and `public/format.js` only.
- **Branch:** `feat/board-elements` (checked out). Never push to or merge into `main`.

## Review focus

1. **Never re-POST.** `reload-on-phase` appears only on the 200 answer to `GET /race`, and the reload is `location.reload()`.
2. **No reload loops, and prefetch can't use up the reload.**
   - A server behind the device waits.
   - A stalled tick reloads once.
   - Blocked `sessionStorage` never reloads.
   - A `prefetched` element neither reads nor writes the key.
3. **The `closesAt` reload isn't cancelled** by stopping the 0:00 clock.
4. **The stream lifecycle.**
   - These behave exactly as today: the states, the reconnect, one reload 10 s after CLOSED, `tinylapReloadMs` read when the timer is scheduled.
   - `pagehide` closes the stream and clears the timer; `pageshow` with `persisted` reopens it, showing "Reconnecting…" until it opens.
   - Disconnect closes everything.
5. **The note's conditions.**
   - None during the countdown.
   - Qualifying and race only when `lastAt >= opensAt`.
   - None on finished rows, nor in the results.
   - `hidden` under a minute.
6. **Layout:** no column jump at 390, 1280 and 1920 `?big`, and no extra sideways scroll on a phone.
7. **No JavaScript:** the board, the note and the race panel are correct at page time, and the Full screen button stays hidden.
8. **Listeners and timers:** every timer and listener is removed on disconnect: `tl-countdown` per element, `tl-relative-time` at module level when the last element leaves.

---

### Task 1: `format-ago.js` in `@tinylap/design`

**Files:**
- Create: `packages/design/format-ago.js`, `packages/design/test/format-ago.test.js`
- Modify:
  - `packages/design/package.json` (`exports`, `files`, version);
  - `packages/design/tsconfig.json` (`include`);
  - `packages/design/README.md`;
  - `apps/timing/public/format.js` (drop `formatAgo`);
  - `apps/timing/server/views/setup.js:7` (the import);
  - `apps/timing/test/format.test.js` (drop the `formatAgo` test and import).

- [ ] **Failing test** `packages/design/test/format-ago.test.js` (MPL header): move the `formatAgo` test from `apps/timing/test/format.test.js:25-35` verbatim, importing `{ formatAgo } from '../format-ago.js'`.
- [ ] **Run it; expect FAIL** (module not found): `pnpm --filter @tinylap/design test`.
- [ ] **Create `packages/design/format-ago.js`** with the MPL header, the comment `// DOM-free: the server renders with it, and tl-relative-time ticks with it.`, and the function from `apps/timing/public/format.js:19-26`, unchanged.
- [ ] **`package.json`:**
  - `exports` gains `"./format-ago.js": "./format-ago.js"`;
  - `files` gains `"format-ago.js"`;
  - don't bump `version` by hand: release-please owns it (`.release-please-manifest.json`, `release-please-config.json`). The `feat(design)` commit makes the minor bump.
- [ ] **`tsconfig.json` `include`** gains `"format-ago.js"`.
- [ ] **README:** under "Markup" add `- \`format-ago.js\`: \`formatAgo(ms, now)\`, "3 min ago" for a time in the past; DOM-free, used by servers and by \`tl-relative-time\`.`
- [ ] **Timing:**
  - remove `formatAgo` from `apps/timing/public/format.js`;
  - `views/setup.js:7` becomes `import { formatAgo } from '@tinylap/design/format-ago.js';`;
  - in `test/format.test.js`, remove the `formatAgo` test and import.
- [ ] **Run the checks.** `setup-seen.test.js` must pass unchanged.
- [ ] **Commit** `feat(design): formatAgo as a DOM-free helper for servers and elements`.

### Task 2: `clockAt()` and the server's `clockOf`

**Files:**
- Modify: `apps/timing/public/format.js`, `apps/timing/server/views/board.js:15-24`, `apps/timing/test/format.test.js`
- Unchanged and must pass: `apps/timing/test/views.test.js:39-46`.

- [ ] **Failing tests** in `test/format.test.js`, `test('clockAt: the clock and the phase that time alone decides', …)`, with `race = { kind: 'race', state: 'running', opensAt: 10_000, closesAt: 310_000 }`:
  - `clockAt({ ...race, state: 'countdown' }, 5000)` → `{ phase: 'countdown', label: 'Starts in', ms: 5000 }`
  - `clockAt({ ...race, state: 'countdown' }, 10_000)` → `{ phase: 'running', label: 'Remaining', ms: 300_000 }`
  - `clockAt(race, 70_000)` → `{ phase: 'running', label: 'Remaining', ms: 240_000 }`
  - `clockAt(race, 310_000)` → `{ phase: 'finishing', label: 'Last lap', ms: 0 }`
  - `clockAt({ ...race, state: 'finishing' }, 400_000)` → `{ phase: 'finishing', label: 'Last lap', ms: 0 }`
  - `clockAt({ ...race, state: 'done' }, 400_000)` → `{ phase: 'done', label: 'Finished', ms: 0 }`; and `aborted` → `{ phase: 'aborted', label: 'Aborted', ms: 0 }`
  - `clockAt({ kind: 'qualifying', state: 'running', opensAt: 0, closesAt: 1000 }, 1000)` → `phase: 'finishing'`
  - `clockAt({ kind: 'practice', state: 'running', opensAt: 1000, closesAt: null }, 61_000)` → `{ phase: 'running', label: 'Practice', ms: 60_000 }`
  - `clockAt({ kind: 'practice', state: 'done', opensAt: 1000, closesAt: null }, 61_000)` → `{ phase: 'done', label: 'Practice ended', ms: 0 }`
- [ ] **Run; expect FAIL:** `pnpm --filter @tinylap/timing-app test`.
- [ ] **Implement in `public/format.js`:**

  ```js
  /**
   * What a session clock shows at server time `now`, and the phase time alone decides:
   * a countdown past opensAt is running; a race or qualifying past closesAt is finishing.
   * done and aborted are never derived. opensAt/closesAt may be null.
   * @param {{ kind: string, state: string, opensAt: number | null, closesAt: number | null }} session @param {number} now
   * @returns {{ phase: string, label: string, ms: number }}
   */
  export function clockAt({ kind, state, opensAt, closesAt }, now) {
    let phase = state;
    if (phase === 'countdown' && opensAt !== null && now >= opensAt) phase = 'running';
    if (phase === 'running' && kind !== 'practice' && closesAt !== null && now >= closesAt) phase = 'finishing';
    if (phase === 'countdown') return { phase, label: 'Starts in', ms: opensAt - now };
    if (kind === 'practice') return phase === 'done' || phase === 'aborted' ? { phase, label: 'Practice ended', ms: 0 } : { phase, label: 'Practice', ms: now - opensAt };
    if (phase === 'running') return { phase, label: 'Remaining', ms: Math.max(0, closesAt - now) };
    if (phase === 'finishing') return { phase, label: 'Last lap', ms: 0 };
    return { phase, label: phase === 'aborted' ? 'Aborted' : 'Finished', ms: 0 };
  }
  ```
- [ ] **`views/board.js`:**
  - import `clockAt`;
  - `clockOf` becomes `if (!session) return null; const { label, ms } = clockAt({ ...session, opensAt: session.opensAt ?? null, closesAt: session.closesAt ?? null }, now); return { label, ms };`;
  - keep its JSDoc.
- [ ] **Run the checks.** `views.test.js` passes unchanged.
- [ ] **Commit** `refactor(timing-app): one session clock rule for server and browser`.

### Task 3: `lastAt` on standings rows

**Files:**
- Modify: `packages/timing/sessions.js:81`, `packages/timing/types.d.ts:70-80`, `packages/timing/test/sessions.test.js`

- [ ] **Failing tests** in `sessions.test.js`, `test('standings carry each driver’s last crossing, counted or not', …)`:
  - practice: `run(practice, [['ana', 1000, null], ['ana', 9000, 8000]])` → `standings(...)[0].lastAt === 9000`;
  - race, using the file's `race` (`opensAt: 100_000`): `run(race, [['ana', 50_000, null]])`, a pre-start crossing → the `ana` row's `lastAt === 50_000`, and the `ben` row's `lastAt === null`;
  - qualifying: a crossing whose lap began before `opensAt` (not counted), `[['ana', 105_000, 10_000]]` → `lastAt === 105_000`, `laps === 0`.
- [ ] **Run; expect FAIL:** `pnpm --filter @tinylap/timing test`.
- [ ] **Implement:**
  - in `sessions.js:81`, add `lastAt: d.lastAt` to the pushed row (after `bestAt`);
  - in `types.d.ts`, `Standing` gains `/** Server time of the driver's last crossing in this session, counted or not. */ lastAt: number | null;`.
- [ ] **Run the checks for all three packages.** These pass unchanged: `engine-sessions.test.js`, `contract.test.js`, `auth.test.js:46`.
- [ ] **Commit** `feat(timing): standings rows carry the driver's last crossing time`.

### Task 4: board markup and CSS (server only)

The elements don't exist yet, so this task changes only the HTML and CSS. The old `public/board.js` keeps working: it still finds `#board-live` and `time[data-clock]`. The full-screen button markup waits until Task 7.

**Files:**
- Modify: `apps/timing/server/views/board.js`, `apps/timing/public/app.css`, `apps/timing/test/server/board-pages.test.js`
- Create: `apps/timing/test/layout/measure-board.js` (a hand-run measuring tool, not a test)

- [ ] **Set-up changes** in `board-pages.test.js`:
  - A login carries the memberships that exist when it is made (`test/server/helpers.js` `login`), so create the extra clubs in `before()`, between `app.club(user, 'Office')` and `app.login(user)`: `practiceClub = app.club(user, 'Practice')`, `countdownClub = app.club(user, 'Countdown')`, `finishClub = app.club(user, 'Finish')`.
  - `pass(t, transponder)` (`:28-31`) is hard-wired to `office`: it sets `clock.now = 1_000_000_000_000 + t` and ingests. Add next to it:

    ```js
    const passIn = (ws, t, transponder = '10') => {
      clock.now = 1_000_000_000_000 + t;
      app.engine.ingest({ workspaceId: ws, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder, t }] } });
    };
    ```
  - Each club gets its drivers with `app.form(member, `/clubs/${id}/drivers`, { name })`, and transponders with `app.engine.assign(id, code, driverId)`.
  - `t` only ever grows across the file, since `clock.now` is derived from it.
- [ ] **Failing tests** in `board-pages.test.js`, using `clock`, `pass`, `passIn` and `get`:
  1. The board page matches `/<tl-board status="live-status">\s*<div id="board-live"/` and `/<tl-countdown class="board-clock"><span class="stat-label board-clock-label" data-clock-label>/`. Lines `:41-43` and `:62` stay as they are and must pass.
  2. **A stopped practice driver** (club `Practice`): `passIn` at `t` and `t + 8000` for transponder `10`, assigned to a driver; that is one lap, so practice has a row. Set `clock.now` 3 min after the last pass, then GET the board. It matches:

     ```
     <td class="board-driver"><span class="driver" style="--driver: …">…</span><tl-relative-time class="board-ago" now="<clock.now>" min="60000">last lap <time datetime="<ISO of last pass>">3 min ago</time></tl-relative-time></td>
     ```

     Build the regex with the concrete values.
  3. **Within the minute** (club `Practice`): pass again with a lap, set `clock.now` 30 s later. The same element carries ` hidden` after `min="60000"`, with the text `just now`.
  4. **Race countdown** (club `Countdown`):
     - start the race first: `app.engine.start(countdownClub.id, { kind: 'race', roster: [driver.id], durationMs: 60_000, countdownMs: 30_000 })`. `start` ends the open practice (`engine.js:169-170`), so a pass made before it would land in the practice;
     - then `passIn(countdownClub.id, t + 5000)`, during the countdown, so the crossing is in the race with `at < opensAt`;
     - GET the board right after the pass: there is no `tl-relative-time`, because the state is `countdown`.
  5. **Race running, pre-start crossing only** (same club): set `clock.now` to `opensAt + 90_000` and call `app.engine.tick()`. The race is running, the driver's `lastAt` is before `opensAt`, and the board still has no `tl-relative-time`.
  6. **A finished row** (club `Finish`):
     - two roster drivers, A and B, and a race with `countdownMs: 0` and `durationMs: 60_000`;
     - each crosses once after the start (the start crossing), then once more with a lap;
     - set `clock.now` past `closesAt` and call `app.engine.tick()`: the race is `finishing`;
     - A crosses again with a lap, which makes A's row `is-finished`. B doesn't cross;
     - set `clock.now` 3 min later, then GET the board: A's row (`class="is-finished"`) has no `tl-relative-time`, and B's row has one.

     Then end the race (`app.engine.abort(finishClub.id, sessionId)`), so it becomes the last results. GET the board: the `board-results` section has no `tl-relative-time`, and its driver cells carry `class="board-driver"`.
  7. The watchers board (`/watch/<token>`) and `?big` have the note for a stopped driver.

  Tests 2–3, 4–5 and 6 each use their own club, so they don't depend on `office`'s state. Tests 1 and 7 use `office`.
- [ ] **Run; expect FAIL:** `pnpm --filter @tinylap/timing-app test`.
- [ ] **Implement in `views/board.js`:**
  - **`header()` (`:38`):** `<div class="board-clock">…</div>` becomes:

    ```js
    html`<tl-countdown class="board-clock"><span class="stat-label board-clock-label" data-clock-label>${clock.label}</span><time class="board-clock-time" data-clock data-kind="${s.kind}" data-state="${s.state}" data-opens="${s.opensAt ?? ''}" data-closes="${s.closesAt ?? ''}" data-now="${snap.now}">${formatClock(clock.ms)}</time></tl-countdown>`
    ```
  - **A new `ago(snap, row)`:**

    ```js
    /** "last lap 3 min ago" under a driver who has stopped (spec §2.3); hidden under a minute. */
    function ago(snap, row) {
      const s = snap.session;
      if (!s || s.state === 'countdown' || row.lastAt === null || row.finished) return null;
      if (s.kind !== 'practice' && row.lastAt < s.opensAt) return null;
      const hidden = snap.now - row.lastAt < 60_000;
      return html`<tl-relative-time class="board-ago" now="${snap.now}" min="60000"${hidden ? html` hidden` : null}>last lap <time datetime="${new Date(row.lastAt).toISOString()}">${formatAgo(row.lastAt, snap.now)}</time></tl-relative-time>`;
    }
    ```

    Import `formatAgo` from `@tinylap/design/format-ago.js`.
  - **`standingsTable()` (`:52`):** `<td>${chip(snap, row.driverId)}</td>` becomes `<td class="board-driver">${chip(snap, row.driverId)}${ago(snap, row)}</td>`.
  - **`results()` (`:69`):** `<td>${chip(snap, row.driverId)}</td>` becomes `<td class="board-driver">${chip(snap, row.driverId)}</td>`.
  - **`boardPage()` (`:120`):** `body: html\`<tl-board status="live-status">\n${boardLive(request, snap, { watcher, big, token })}\n</tl-board>\``.
- [ ] **`app.css`:** after the `.board-table` rules (`:66-70`), add:

  ```css
  /* The board element; the stream swaps the #board-live inside it. */
  tl-board { display: block; }
  /* Room for "last lap 14 Oct 2026", so a note appearing never moves a column (spec §5.2). */
  .board-table .board-driver { min-width: 9.5em; }
  /* A quiet second line under a driver who has stopped. */
  .board-ago { display: block; color: var(--p-text-secondary); font-weight: 400; font-size: 0.75em; line-height: 1.2; font-variant-numeric: tabular-nums; }
  .board-ago time { white-space: nowrap; }
  ```

  Inside the existing `@media (max-width: 720px)` block (`:126`), add `.board-table .board-driver { min-width: 6em; }`. Next to the `body.big` rules (`:104-108`), add `body.big .board-ago { font-size: 0.6em; }`.
- [ ] **Measure (frontend-design skill).** Create `apps/timing/test/layout/measure-board.js` (AGPL header). It is a hand-run tool, not a test: the `test` script's globs (`test/*.test.js`, `test/server/*.test.js`) don't reach it. It renders the real `boardPage()` from a fake snapshot, serves the real CSS, and prints the measurements:

  ```js
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
      session: { id: 's', kind: 'race', state: 'running', opensAt: now - 120_000, closesAt: now + 180_000 },
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
        try { return route.fulfill({ body: readFileSync(join(dir, pathname.slice(prefix.length))), contentType: pathname.endsWith('.css') ? 'text/css' : undefined }); } catch { return route.fulfill({ status: 404 }); }
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
  ```

  Run it: `node apps/timing/test/layout/measure-board.js "$(mktemp -d)"`. Expected, from the re-review's measurements:
  - for each viewport, `columns` is the same for `none`, `all` and `wide`;
  - `tableScroll` at 390 px is about 14–20 px, as today, and never above 20;
  - `pageScroll` is 0 everywhere;
  - at 1920 `?big`, `height` with `all` is at most about 7 % more than with `none`.

  If a number is off, adjust the CSS within the spec's rules and run it again. Also check the contrast of `--p-text-secondary` on `.board-table` at 0.6em, and look at the screenshots.
- [ ] **Lint the tool:** `eslint .` covers it, like the other files under `apps/timing/test/`. The timing tsconfig includes only `public` and `server`, so tsc doesn't.
- [ ] **Run the checks**, including `live.test.js`, which must stay green with the old `board.js`.
- [ ] **Commit** `feat(timing-app): the board shows how long ago a stopped driver last crossed the line`.

### Task 5: `tl-countdown` and the race page's `reload-on-phase`

**Files:**
- Create: `apps/timing/public/elements/countdown.js`
- Modify:
  - `apps/timing/server/views/race.js:47-58`;
  - `apps/timing/server/race-pages.js:17-21`, `:67`;
  - `apps/timing/server/views/board.js:118` (scripts);
  - `apps/timing/public/board.js` (drop `skew`, `adopt`, `tick`, `remaining`, `setInterval`);
  - `apps/timing/public/app.css` (`.race-clock`);
  - `apps/timing/test/server/race-pages.test.js`, `board-pages.test.js`, `frames.test.js:46-48`.

- [ ] **Failing server tests:**
  - **`race-pages.test.js`, running case (`:44`):** the body matches:

    ```
    /<tl-countdown class="race-clock" reload-on-phase><span class="stat-label" data-clock-label>Remaining<\/span> <time class="race-clock-time" data-clock data-kind="race" data-state="running" data-opens="\d+" data-closes="\d+" data-now="\d+">\d+:\d\d<\/time><\/tl-countdown>/
    ```

    It also has `<script type="module" src="/public/elements/countdown.js">`.
  - **The 409 of a second start** (`:49-52`): the body has `<tl-countdown class="race-clock">`, without `reload-on-phase`.
  - **The start form** (`:35`): no `tl-countdown`, no `countdown.js`.
  - **`board-pages.test.js`:** the board lists `/public/elements/countdown.js`.
  - **`frames.test.js:48`:** the regex becomes `/(from\s*|import\(\s*)['"][^'"]*(design\/elements\/|public\/elements\/)/`.
- [ ] **Run; expect FAIL.**
- [ ] **Server:**
  - **`views/race.js` `runningPanel(request, session, drivers, { reload })`:** add after the roster `<p>`:

    ```js
    const clock = clockOf(session, request.now());
    html`<tl-countdown class="race-clock"${reload ? html` reload-on-phase` : null}><span class="stat-label" data-clock-label>${clock.label}</span> <time class="race-clock-time" data-clock data-kind="${session.kind}" data-state="${session.state}" data-opens="${session.opensAt ?? ''}" data-closes="${session.closesAt ?? ''}" data-now="${request.now()}">${formatClock(clock.ms)}</time></tl-countdown>`
    ```

    Import `clockOf` from `./board.js` and `formatClock` from `../../public/format.js`.
  - **`racePage(request, { …, reload = false })`:**
    - passes `reload` through;
    - `scripts: session ? ['elements/countdown.js'] : []`.
  - **`race-pages.js`:** `renderRace(request, status, …)` passes `reload: status === 200`. Only the GET route (`:67`) calls it with 200. Confirm that every POST error path passes 4xx.
  - **`views/board.js` `boardPage`:** `scripts: ['board.js', 'elements/countdown.js']`.
- [ ] **`public/elements/countdown.js`** (AGPL header). Write the header comment from spec §2.2. The module:

  ```js
  import { clockAt, formatClock } from '../format.js';

  const TICK_MS = 200;
  const GRACE_MS = 1000;
  const prefetchedPage = /** @type {any} */ (performance.getEntriesByType('navigation')[0])?.deliveryType === 'navigational-prefetch';
  let upgrading = false; // true only inside define(): the elements that came with the page's HTML
  const num = (v) => (v === '' || v === undefined ? null : Number(v));
  ```

  `class TlCountdown extends HTMLElement`:
  - **Fields,** typed for tsc: `/** @type {number | null} */ skew = null;`, `prefetched = false;`, `/** @type {ReturnType<typeof setInterval> | 0} */ interval = 0;`, `/** @type {ReturnType<typeof setTimeout> | 0} */ reloadTimer = 0;`, `decided = false;`.
  - **`get time()`:** `this.querySelector('time[data-clock]')`.
  - **`connectedCallback()`:**
    - if no `time`, return;
    - on the first connect only (`skew === null`): `this.prefetched = upgrading && prefetchedPage`, and `this.skew = this.prefetched ? 0 : Number(time.dataset.now) - Date.now()`;
    - `this.tick()`, then `this.interval = setInterval(() => this.tick(), TICK_MS)`;
    - with `reload-on-phase`, `document.addEventListener('visibilitychange', this)`.
  - **`disconnectedCallback()`:** `clearInterval`, `clearTimeout(this.reloadTimer)`, remove the `visibilitychange` listener.
  - **`handleEvent()`** (visibilitychange): `if (!document.hidden) this.tick()`.
  - **`tick()`:**

    ```js
    const d = this.time.dataset;
    const c = clockAt({ kind: d.kind, state: d.state, opensAt: num(d.opens), closesAt: num(d.closes) }, Date.now() + this.skew);
    ```

    - set `time.textContent = formatClock(c.ms)` when it differs;
    - set the `[data-clock-label]` text to `c.label` when it differs;
    - if `this.hasAttribute('reload-on-phase') && c.phase !== d.state`, call `this.decide(c)`;
    - stop the interval (`clearInterval`) when `c.ms === 0 && ['finishing', 'done', 'aborted'].includes(c.phase)` and (`!this.hasAttribute('reload-on-phase') || this.decided || c.phase === d.state`). The last case is a page rendered as `finishing` (where C7 lands): there is nothing left to reload for.
  - **`decide()`:**
    - if `this.decided || document.hidden`, return. A hidden page decides on `visibilitychange`.
    - `this.decided = true`.
    - The boundary is `d.state === 'countdown' ? num(d.opens) : num(d.closes)`, and `wait = Math.max(0, boundary + GRACE_MS - (Date.now() + this.skew))`.
    - **A prefetched element:** `this.reloadTimer = setTimeout(() => location.reload(), wait)`, with no key.
    - **Otherwise:**

      ```js
      const key = `tl-countdown reload ${location.pathname} ${d.opens} ${d.state}`;
      try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { return; }
      this.reloadTimer = setTimeout(() => location.reload(), wait);
      ```

      A key that is already there, or storage that throws, leaves `decided` true, so the interval may stop.

  At the end: `upgrading = true; if (!customElements.get('tl-countdown')) customElements.define('tl-countdown', TlCountdown); upgrading = false;`
- [ ] **`public/board.js`:** remove `skew`, `remaining`, `adopt`, `tick`, `setInterval(tick, 200)`, the two `adopt(...)` calls and the `formatClock` import. The rest stays until Task 7.
- [ ] **`app.css` `.race-clock`** (frontend-design skill):
  - one row, `display: flex; align-items: baseline; gap: var(--p-space-sm)`;
  - the time in `var(--p-font-mono)` with `font-variant-numeric: tabular-nums`, at `1.5rem`, weight 700;
  - the label as palace's `.stat-label`.

  Screenshot `/personal/race` with a running race at 390 px and 1280 px.
- [ ] **Run the checks**, including `live.test.js` ("the board updates live and its clock ticks").
- [ ] **Commit** `feat(timing-app): tl-countdown ticks the session clock on server time, and reloads race control once at a phase change`.

### Task 6: `tl-relative-time`

**Files:**
- Create: `packages/design/elements/relative-time.js`
- Modify:
  - `packages/design/README.md` (Elements list);
  - `apps/timing/server/views/board.js` (`boardPage` gets `modules: ['pkg/design/elements/relative-time.js']`);
  - `apps/timing/test/server/board-pages.test.js`.

- [ ] **Failing server test:** the board page has `<script type="module" src="/pkg/design/elements/relative-time.js">`.
- [ ] **Implement `relative-time.js`** (MPL header). Header comment: what it does, the inputs (`now` server ms, `min` ms, its `<time datetime>`), one shared 15 s timer paused while hidden, and that it writes text and `hidden` only.

  ```js
  import { formatAgo } from '../format-ago.js';

  const EVERY_MS = 15_000;
  /** @type {Set<TlRelativeTime>} */
  const live = new Set();
  let timer = 0;

  function update() { for (const el of live) el.update(); }
  function start() { clearInterval(timer); timer = document.hidden ? 0 : setInterval(update, EVERY_MS); }
  function onVisibility() { if (!document.hidden) update(); start(); }

  class TlRelativeTime extends HTMLElement {
    /** @type {number | null} */
    skew = null;
    connectedCallback() {
      if (this.skew === null) this.skew = Number(this.getAttribute('now')) - Date.now();
      if (live.size === 0) document.addEventListener('visibilitychange', onVisibility);
      live.add(this);
      this.update();
      start();
    }
    disconnectedCallback() {
      live.delete(this);
      if (live.size === 0) {
        clearInterval(timer);
        timer = 0;
        document.removeEventListener('visibilitychange', onVisibility);
      }
    }
    update() {
      const time = this.querySelector('time');
      const at = Date.parse(time?.dateTime ?? '');
      if (!time || Number.isNaN(at)) return;
      const now = Date.now() + (Number.isNaN(this.skew) ? 0 : this.skew);
      const text = formatAgo(at, now);
      if (time.textContent !== text) time.textContent = text;
      const hidden = now - at < Number(this.getAttribute('min') ?? 0);
      if (this.hidden !== hidden) this.hidden = hidden;
    }
  }

  if (!customElements.get('tl-relative-time')) customElements.define('tl-relative-time', TlRelativeTime);
  ```

  `start()` is only called when `live` isn't empty, so the timer never runs with no element.
- [ ] **README** Elements list: `- \`tl-relative-time\`: keeps the "N min ago" text of the \`<time datetime>\` inside it current on server time (\`now\` attribute), hidden while younger than \`min\` ms; one shared timer, paused while the page is hidden.`
- [ ] **Run the checks** (design lint and typecheck cover `elements/`).
- [ ] **Commit** `feat(design): tl-relative-time keeps a time-ago current on server time`.

### Task 7: `tl-board`, and `board.js` down to full screen

**Files:**
- Create: `apps/timing/public/elements/board.js`
- Modify:
  - `apps/timing/public/board.js`;
  - `apps/timing/server/views/board.js` (scripts);
  - `apps/timing/server/views/layout.js:55-57` (the full-screen button);
  - `apps/timing/test/server/board-pages.test.js`.

- [ ] **Failing server tests:**
  - the board lists `/public/board.js`, `/public/elements/board.js`, `/public/elements/countdown.js` and the relative-time module;
  - `?big` has `<button type="button" class="btn btn-sm btn-outline" data-fullscreen hidden>Full screen</button>` as the first child of `.navbar-right`;
  - the plain board has no `data-fullscreen`.
- [ ] **`layout.js`:** in the `screen === 'board' || watcher` branch, before the `live-status` span, render the button when `big`, with the markup above.
- [ ] **`views/board.js`:** `scripts: ['board.js', 'elements/board.js', 'elements/countdown.js']`.
- [ ] **`public/elements/board.js`** (AGPL header). The header comment is spec §3. Move these from `public/board.js`, verbatim:
  - `STATES`;
  - `RELOAD_MS` with its comment about `globalThis.tinylapReloadMs`;
  - `counterpart`;
  - `swap`.

  `class TlBoard extends HTMLElement`:
  - **Fields:** `source = null`, `timer = 0`.
  - **`connectedCallback()`:** if `!('EventSource' in window)`, return. Otherwise `addEventListener('pagehide', this)`, `addEventListener('pageshow', this)`, `this.open()`.
  - **`disconnectedCallback()`:** `this.close()`, and remove both window listeners.
  - **`open()`:**

    ```js
    const url = /** @type {HTMLElement | null} */ (this.querySelector('#board-live'))?.dataset.events;
    if (!url) return;
    this.source = new EventSource(url);
    for (const type of ['open', 'error', 'board']) this.source.addEventListener(type, this);
    ```
  - **`close()`:** `this.source?.close(); this.source = null; clearTimeout(this.timer);`
  - **`setStatus(state)`:** as `board.js:36-43`, with `document.getElementById(this.getAttribute('status') ?? '')`.
  - **`handleEvent(event)`**, a switch on `event.type`:
    - `open` → `setStatus('live')`;
    - `error` → if `this.source?.readyState !== EventSource.CLOSED`, `setStatus('reconnecting')`; else `setStatus('off')` and `this.timer = setTimeout(() => location.reload(), Number(/** @type {any} */ (globalThis).tinylapReloadMs) || RELOAD_MS)`;
    - `board` → the `<template>` parse and `swap(current, next)`, as `board.js:74-83`, with `current = this.querySelector('#board-live')`;
    - `pagehide` → `this.close()`;
    - `pageshow` → if `/** @type {PageTransitionEvent} */ (event).persisted && this.isConnected && !this.source`, `setStatus('reconnecting')` and `this.open()`.

  Define it when the name is free.
- [ ] **`public/board.js`:**
  - **Header comment:** `// The board's full-screen button (spec step two §6): the server renders it hidden on ?big; this shows it where the browser can go full screen. The stream and the clock are tl-board and tl-countdown.`
  - **Body:**

    ```js
    const button = /** @type {HTMLButtonElement | null} */ (document.querySelector('[data-fullscreen]'));
    if (button && document.documentElement.requestFullscreen) {
      const label = () => { button.textContent = document.fullscreenElement ? 'Leave full screen' : 'Full screen'; };
      button.hidden = false;
      label();
      button.addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}));
      document.addEventListener('fullscreenchange', label);
    }
    ```
- [ ] **Run the checks and the whole browser suite.** `live.test.js` must pass unchanged, all nine tests.
- [ ] **Commit** `feat(timing-app): tl-board owns the board's stream, and full screen is server markup`.

### Task 8: browser tests, no-JS and assembled

**Files:**
- Create: `apps/timing/test/browser/board-elements.test.js`, `apps/timing/test/browser/race-countdown.test.js`
- Modify: `apps/timing/test/browser/no-js.test.js`, `apps/timing/test/browser/assembled.test.js`

Shared set-up for both new files:
- **A running server clock:** `const clock = { offset: 0, get now() { return Date.now() + this.offset; } }`, then `app = await startTiming({ clock })`. `startTiming` reads `clock.now` (`test/server/helpers.js:38`), so server time runs with real time, and races reach their boundaries on their own. A test jumps it only forward: `clock.offset += …`.
- A member with drivers assigned to transponders, as in `live.test.js:15-25`. Passings go through `postPassings` (`browser.js:33`) or `app.engine.ingest`.
- Engine ticks: `const ticker = setInterval(() => app.engine.tick(), 100)`, cleared in `t.after`. When a test increases `clock.offset`, it calls `app.engine.tick()` right after.
- Every test asserts `errors` is `[]`, except where a page load is expected mid-test.
- Load counting: `let loads = 0; page.on('load', () => { loads += 1; })`. Requests: `page.on('request', (r) => requests.push([r.method(), new URL(r.url()).pathname]))`.

- [ ] **`board-elements.test.js`:** B1–B6 from spec §7.
  - **B1 and B2:** a local `boardStreams()`, copied from `live.test.js:84-96`, extended to count `sub.unsubscribe` calls. Wrap the returned `sub`'s `unsubscribe`.
  - **B3:** `page.clock.setSystemTime(clock.now - 3_600_000)` before `goto`. Assert the practice clock's `m:ss` is within 2 s of `formatClock(clock.now - opensAt)`.
  - **B4:**
    - post two passings 8 s apart (`postPassings(app, decoder, [{ transponder: '10', t }, { transponder: '10', t: t + 8000 }])`): one lap, so practice has a row;
    - `clock.offset += 40_000`: the last crossing is now 40 s old by server time;
    - `page.clock.install({ time: clock.now })`, then `goto('/personal/board')`;
    - no visible `.board-ago`;
    - `page.clock.runFor(15_000)` (55 s): still none;
    - `runFor(15_000)` (70 s): `getByText('last lap 1 min ago')` is visible.

    The server clock isn't moved again, so no new board streams: the shared timer alone shows the note.
  - **B5:**

    ```js
    page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); })
    ```

    then the reverse.
  - **B6:** for each viewport in `[{ width: 390, height: 844 }, { width: 1280, height: 800 }, { width: 1920, height: 1080, big: true }]`:
    - a fresh club per viewport (made before the login, as in Task 4), with drivers `Al` (transponder `11`) and `Ana Fernández-Oliveira` (transponder `12`);
    - a race with `countdownMs: 0`, `durationMs: 600_000`, and both on the roster;
    - after the start: `Al` crosses at `t`, `t + 8000` and `t + 16_000`; `Ana Fernández-Oliveira` at `t + 1000` and `t + 9000`. Two laps for Al and one for Ana, so the race order (Al first) never changes in this test;
    - `goto` the board (with `?big` for the 1920 case) and record each `thead th`'s `getBoundingClientRect().left`;
    - Ana goes quiet: `clock.offset += 70_000`, `app.engine.tick()`, then Al crosses once more (`t + 70_000 + 16_000`). That third lap streams a fresh board in which Ana's note is visible and Al's is hidden. Wait for `getByText(/^last lap 1 min ago$/)`;
    - assert the lefts are equal within 0.5 px, the row order is unchanged, and `document.documentElement.scrollWidth <= innerWidth`.
- [ ] **`race-countdown.test.js`:** C1–C7 from spec §7.
  - **C2:** stop the ticker. `page.route('**/personal/race', async (route) => { const res = await route.fetch(); route.fulfill({ response: res, body: (await res.text()).replace(/data-state="running"/, 'data-state="countdown"') }); })` once the session has started running.
  - **C3:** `addInitScript(() => Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new Error('blocked'); } }))`. After `goto`, first assert in the page that storage really throws: `page.evaluate(() => { try { sessionStorage.length; return false; } catch { return true; } })` is `true`. Only then wait past the boundary and expect no load.
  - **C4:** an init script that, when `window.name !== 'seen'`, sets `window.name = 'seen'` and overrides `performance.getEntriesByType` to report `deliveryType: 'navigational-prefetch'` for `'navigation'`. Set the device clock 5 s ahead with `page.clock.setSystemTime(clock.now + 5000)` before `goto`, without `install()`: only `install()` fakes timers, so real timers run against the skewed clock. Start the race with a 10 s countdown, then expect: one early load about 4 s before the server's boundary, then exactly one more load after it, then none.
  - **C5:** hover `page.getByRole('link', { name: 'Race' })` and wait for the request with a `sec-purpose` header (as `navigation.test.js:30`), with `page.waitForRequest(…, { timeout: 5000 })`, then cross the boundary.
    - If no prefetch request comes within 5 s, Chrome doesn't prefetch a link to the document's own URL, and the R1 hazard can't arise there. The test then logs that (`t.diagnostic('no self-prefetch')`) and still checks the single load. C4 stays the guard.
  - **C6:** open `/personal/race` while no session runs, so the start form shows. Start a race server-side (`app.form(member, '/personal/sessions', …)`, with a 2 s countdown). Then submit the stale form on the page (`Start`): the browser POSTs and gets the 409 race page. Assert:
    - the 409 page is shown, with no `reload-on-phase`;
    - after the boundary + 2 s, `loads` is unchanged and no further request was made.
  - **C7:** stop the shared ticker for this test. `page.clock.install({ time: clock.now })` before `goto`, since the test steps the page's timers with `runFor`. `clock` and `page.clock` then move together in steps (`clock.offset += 10_000; app.engine.tick(); await page.clock.runFor(10_000)`) until past `closesAt` + 1 s. Then exactly one load, and the heading matches `/Race, finishing the last lap/` with the clock at `0:00`.
- [ ] **`no-js.test.js`:**
  - add `const clock = { offset: 0, get now() { return Date.now() + this.offset; } }`, passed to `startTiming({ plannerUrl: planner.url, clock })`. Only `offset` is ever increased, so the existing ordered tests keep real time;
  - a test: `/personal/board?big` without JavaScript has no visible `Full screen` button;
  - a test: post two passings 8 s apart for an assigned driver (one lap, so practice has a row), `clock.offset += 180_000`, load `/personal/board`: `getByText(/^last lap 3 min ago$/)` is visible.
- [ ] **`assembled.test.js`,** on the `board` screen (`:39`):
  - the scripts include `/v/${SHA}/public/elements/board.js`, `/v/${SHA}/public/elements/countdown.js` and `/v/${SHA}/pkg/design/elements/relative-time.js`;
  - `customElements.get` is defined for `tl-board`, `tl-countdown` and `tl-relative-time`.
- [ ] **Run the browser suite twice; green both times:** `pnpm --filter @tinylap/timing-app test:browser`. A failure is a bug in the element, fixed there in its own `fix(…)` commit.
- [ ] **Commit** `test(timing-app): the board elements and race control's reload in the browser`.

### Task 9: review and PR

- [ ] **Full checks:**
  - `pnpm turbo run test lint typecheck --filter=@tinylap/design --filter=@tinylap/timing --filter=@tinylap/timing-app --filter=@tinylap/accounts`;
  - `pnpm turbo run test lint typecheck --filter=@tinylap/track-planner` (its unit and server tests take about 5 s; its browser tests are unaffected by this branch);
  - `pnpm --filter @tinylap/timing-app test:browser`;
  - `reuse lint`.
- [ ] **Changelog:** `@tinylap/design` gets a minor bump from the `feat(design)` commits through release-please. Don't edit `CHANGELOG.md` by hand.
- [ ] **Senior review:** the whole branch against the spec and the Review focus above, on the most capable model. Fix the findings in separate commits, and review again until it comes back clean.
- [ ] **PR:**
  - `git push -u origin feat/board-elements`;
  - `gh pr create --base main --title "feat: the board as custom elements, with last lap times and a race clock"`;
  - the body summarises spec §1 and lists the test files, with no AI attribution.
  - Do not merge without the user's OK.
