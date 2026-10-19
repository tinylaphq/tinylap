# Custom elements, step two: the board

Status: draft 4, after a review and a measured re-review (the scripts are in the session scratchpad, `board-measure/`). It follows the step-one spec (`2026-10-16-custom-elements-step-one-design.md`, §1) and AGENTS.md "Web platform first".

Product owner rulings recorded here:
- "last lap N min ago" on the board;
- the race page reloads once at a phase change, never at `done`, nor at `closesAt + MAX_LAP_MS`;
- "Reconnecting…" stays on a restore;
- the full-screen button becomes server markup;
- no promise of instant Back.

## 1. Goal and scope

The board's page script (`apps/timing/public/board.js`) becomes light-DOM elements around the HTML the server already renders. The board also gains one piece of information: how long ago each driver last crossed the line.

| Element | Where | Job |
|---|---|---|
| `tl-board` | `apps/timing/public/elements/board.js` | Owns the board's `EventSource`: swaps in each streamed `#board-live`, shows the live status, reloads once the stream gives up. |
| `tl-countdown` | `apps/timing/public/elements/countdown.js` | Ticks a session clock on the server's time, on the board and on the race page. On the race page it reloads once at a phase change. |
| `tl-relative-time` | `packages/design/elements/relative-time.js` | Keeps "last lap 3 min ago" current on server time. The text comes from the DOM-free `packages/design/format-ago.js`, which the server imports too. |

`board.js` stays as the page script for the full-screen button only (§6).

**Not in this step:**
- `tl-tap` and `tl-bridge`.
- A ticking time on Setup (§2.3).
- Stream formats. The SSE and `/live` formats are unchanged. Their `standings` payloads gain one additive field, `lastAt` (§2.3).

## 2. What moves where

### 2.1 `tl-board`: timing app

| Today in `public/board.js` | Becomes |
|---|---|
| `STATES`, `RELOAD_MS`, the `tinylapReloadMs` hook (`:11-14`, `:72`) | `tl-board`, unchanged |
| `setStatus` (`:36-43`) | `tl-board`. It finds the element by the id in its `status` attribute. |
| `counterpart`, `swap` (`:45-61`) | `tl-board`, verbatim |
| the stream set-up (`:63-84`) | `tl-board` (§3) |
| `skew`, `adopt`, `tick`, `remaining` (`:15-34`) | `tl-countdown` (§2.2) |
| full screen (`:86-95`) | stays in `board.js`. The button becomes server markup (§5.4). |

**What changes in behaviour:**
- **The label follows the phase.** Today `tick` writes only the time, so across `opensAt` the board shows "Starts in 0:00" until the next streamed board. `tl-countdown` also rewrites `[data-clock-label]` when the derived phase changes.
- **The clock ticks without `EventSource`.** Today `board.js:64` starts the clock only when `EventSource` exists. `tl-countdown` is separate from the stream, so it ticks anyway.

### 2.2 `tl-countdown`: timing app

**Where it lives.** Practice counting up, races counting down and countdowns are TinyLap Timing's rules. No other app has a session clock, so the element lives in the app.

**One clock rule.** `clockOf` (`server/views/board.js:16-24`) and `remaining` (`public/board.js:17-24`) become one DOM-free function in `public/format.js`, which the server already imports (`views/board.js:8`):

```js
/** What a session clock shows at server time `now`: { phase, label, ms }. opensAt/closesAt may be null. */
export function clockAt({ kind, state, opensAt, closesAt }, now) { … }
```

- **Derived phases.** `phase` is the state after the moves that time alone decides:
  - a `countdown` with `now >= opensAt` is `running`;
  - a race or qualifying `running` with `now >= closesAt` is `finishing` ("Last lap", 0:00).

  These are the engine's own moves on its 250 ms tick (`server/engine.js:184-191`). `done` and `aborted` are never derived.
- **The wrapper.** `clockOf` in `views/board.js` stays a wrapper and still returns `{ label, ms }` only, so `test/views.test.js:39-46` is unchanged.

  On the server, a running race rendered after `closesAt` but before the next tick now says "Last lap 0:00" rather than "Remaining 0:00". That is intended.
- **Reading the attributes.** The element reads `data-opens` and `data-closes` with `''` → `null`. Practice renders `data-closes=""` (`views/board.js:38`), and `Number('')` would be 0.

**Ticking.**
- The element runs `setInterval(tick, 200)` from connect to disconnect.
- Once the derived phase is `finishing`, `done` or `aborted`, the clock is a fixed 0:00. The element writes it once and clears its interval.
- **With `reload-on-phase`, the reload is decided first.** The interval stops only after one of these:
  - the element has scheduled the reload with `setTimeout` for the boundary + 1 s;
  - it has found the key already there;
  - storage is blocked.

  Otherwise clearing the interval at `finishing` would cancel the reload at `closesAt`.
- **`visibilitychange`.** The element adds its listener only with `reload-on-phase` (for step 2 below). It adds it on connect and removes it on disconnect, with the interval.

**Skew.** Each element takes `skew = data-now − Date.now()` once, on its first connect. Every streamed board brings a new `tl-countdown` with a fresh `data-now`, so this matches today's update on each swap (`board.js:26-29`, `:81`).

**Prefetch (race page).** Navbar links are prefetched (`packages/design/html/speculation.js`; `test/browser/navigation.test.js:26`), so `data-now` can be minutes old.
- When `performance.getEntriesByType('navigation')[0].deliveryType === 'navigational-prefetch'`, an element that came in the page's own HTML uses `skew = 0`, the device clock, and is marked `prefetched`.
- Such elements are the ones upgraded inside the `customElements.define` call: the module sets a flag around that call.
- The board needs nothing: its stream sends a fresh board as soon as it opens (`server/board-stream.js:51`).

**Reload on a phase change (race page only): the boolean attribute `reload-on-phase`.** A phase change here means the countdown reaching zero (`opensAt`), or a race or qualifying running out (`closesAt`).
1. **When.** The element reloads once its derived phase at server time differs from `data-state`, 1 s after the boundary, so the engine's tick has moved the session first.
2. **Hidden pages.** A hidden page waits. On `visibilitychange` to visible it checks again.
3. **By GET only.** The element calls `location.reload()`.
   - **Why it is safe:** the server renders `reload-on-phase` only on the 200 answer to `GET /race`, so a reload re-sends that GET and nothing else. That GET-only attribute is the guard against sending a form again.
   - **Answers to a POST:** the race page can also be the answer to the 422 or 409 of `POST /sessions` (`race-pages.js:17-21`, `:31`, `:40`), or to the error of abort (`:61`). Those answers carry no attribute, and their clock just ticks.
   - **Not `location.replace(location.href)`:** both can be served from a prefetch of the same URL. Measured in Chrome during implementation, `location.reload()` too, after the Race tab was hovered. So the speculation rules (`@tinylap/design/html/speculation.js`) leave out links to the page itself (`[aria-current="page"]`): the race page is never fetched ahead, and its reload always comes from the server.
4. **No loops.**
   - A server clock behind the device: the boundary is measured in server time, so the device doesn't reload early. The reload is a normal load, with a fresh `data-now` and skew. The new page's derived phase still equals `data-state`, and it waits.
   - A stalled server tick: the derived phase differs from `data-state`, so step 5 stops a second reload.
5. **Once per boundary.** Before reloading, the element writes `tl-countdown reload <pathname> <data-opens> <data-state>` to `sessionStorage`. If that key is already there, it doesn't reload.
   - **Prefetch.** A `prefetched` element (skew 0) neither reads nor writes the key. It reloads once its derived phase differs from `data-state`.
     - The page it loads is a normal navigation, with a real skew, and it uses the key as usual. So a prefetched page can't use up the reload for the real boundary.
     - It can't loop either: the page itself is never prefetched (see above), and each normal load waits for the server.
   - **No storage.** If `sessionStorage` throws, the element never reloads, and the clock stays at 0:00.
6. **Not at `done`, not at `closesAt + MAX_LAP_MS`.** Neither is decided by the time alone. The race page then shows "finishing the last lap", with a stopped 0:00, until it is loaded again.
7. **Never on the board.** The board has the stream.

### 2.3 `tl-relative-time`: shared, live on the board

**What time a lap has.**
- **Decoder passings** arrive in decoder time `t`. `ingest` maps each to server wall time: `t` plus the smallest receive offset of the last minute (`engine.js:99-104`), so `at ≤ receivedAt`. The result is stored as `crossing.at` (`engine.js:106-117`).
- **Taps** use `now()` (`engine.js:153`).
- **The session state** sets `d.lastAt = at` for every crossing of a roster driver, counted or not (`packages/timing/sessions.js:39-40`). Standings don't expose it (`sessions.js:81`).

**The minimal server change.** `standings()` adds `lastAt: d.lastAt` to each row (`sessions.js:81`), and `Standing` (`packages/timing/types.d.ts:70-80`) gains `lastAt: number | null`.
- `engine-sessions.test.js:154` still holds: a done session's standings are frozen, since `assignCrossings` touches only practice or active sessions (`store.js:164`).
- `snap.crossings` is not used: it holds only the 30 newest crossings (`engine.js:225`).
- Watchers already see `crossing.at` (`engine.js:24-26`), so `lastAt` leaks nothing new.

**Where it shows.** The purpose is to spot a driver who has stopped. The note goes in the standings table (`views/board.js:42-59`), in the Driver cell, on its own line under the name. It is rendered only when all of these hold:
- the table is the current session's;
- the session is not in `countdown`;
- `row.lastAt !== null`;
- the row isn't `is-finished`;
- for qualifying and race, `row.lastAt >= session.opensAt`. Warm-up laps before the start don't count.

A roster driver with no crossing since the start shows nothing; "Laps 0" already says it. It is hidden while `now − lastAt < 60_000`, so drivers still lapping show nothing.

| Board | Shown |
|---|---|
| Normal board, current session | yes |
| Big board (`?big`) | yes, smaller (§5.2) |
| Watchers board | yes |
| Countdown, finished race rows, previous results, "Last laps" feed | no |

**Wording.** "last lap 3 min ago", all visible. `last lap ` is plain text in the element. Only the `<time>` text ticks. There is no visually hidden text, so a screen reader reads it once. `formatAgo` gives "N min ago", then "N h ago", then a date ("last lap 14 Oct 2026"). The note is never visible while `formatAgo` would say "just now".

**Format helper.** `formatAgo` moves, unchanged, from `apps/timing/public/format.js:19-26` to `packages/design/format-ago.js`:
- **Licence:** its SPDX header becomes `MPL-2.0`, the package's licence. The contributors are the same.
- **Package:** `exports` gains `"./format-ago.js"`, `files` gains the file, and `tsconfig.json` `include` gains `"format-ago.js"`. It is a minor version bump. `README.md` lists it next to the `html/` helpers as a DOM-free server helper.
- **Server:** imports `@tinylap/design/format-ago.js` (`views/board.js`, `views/setup.js:7`).
- **Element:** imports `../format-ago.js` by relative path, served as `/pkg/design/format-ago.js` (`tools/assemble.js:49-50`).
- **Timing app:** `public/format.js` drops `formatAgo`.

**The element reads:**
- the crossing time: `Date.parse(time.dateTime)` of its `<time>` child. Without a parsable `<time>`, it does nothing;
- server time: its `now` attribute (server ms at render). `skew = now − Date.now()` is taken once, on connect. There is no prefetch rule: on the board the stream replaces a stale board within a second, and the note has minute resolution;
- `min`: ms below which the element keeps itself `hidden`.

**Cadence.**
- One module-level timer serves every connected element. It updates every 15 s, and once on connect.
- It stops while `document.hidden`. On `visibilitychange` to visible, it updates at once and restarts.
- It stops when no element is connected.
- The `visibilitychange` listener is module-level. It is added when the first element connects and removed when the last one disconnects, together with the timer.
- Each update writes the `<time>`'s text and the element's `hidden`. No markup is built.
- In a busy session every lap re-renders the board, and the server unhides a note at 60 s. On an idle stream the timer unhides it 60–75 s after the last crossing. Each swap reconnects every note and restarts the timer, which is harmless.

**Without JavaScript.** The server renders the text and `hidden` at page time. The board's `<noscript>` refresh (`views/board.js:119`) renews it every 10 s.

**Setup's "seen … ago"** (`views/setup.js:94`) gets no element. Setup isn't live, and `lastSeenAt` changes as the decoder sends. Only the import changes.

## 3. The lifecycle of the board stream

```
connectedCallback   → open(); listen for pagehide and pageshow on window
open()              → url = this.querySelector('#board-live').dataset.events
                      source = new EventSource(url); 'open', 'error' and 'board' → this
'open'              → status "live"
'error'             → CONNECTING: status "reconnecting" (the browser retries after `retry: 2000`)
                      CLOSED:     status "off"; timer = setTimeout(location.reload,
                                  Number(globalThis.tinylapReloadMs) || RELOAD_MS)
'board'             → <template> parse, swap(current #board-live, next): as board.js:74-83
close()             → source?.close(); source = null; clearTimeout(timer)
disconnectedCallback→ close(); remove the window listeners
pagehide            → close()
pageshow (persisted)→ if connected and no source: status "reconnecting"; open()
```

- **Kept exactly:**
  - the three states and their words;
  - the reconnect at `retry: 2000` (`board-stream.js:49`);
  - one reload 10 s after CLOSED, with `tinylapReloadMs` read when the timer is scheduled;
  - the swap that keeps focus and an unchanged notice;
  - without `EventSource`, no stream.
- **The URL** is read from the current `#board-live` each time the stream opens, so `?big` carries over (`board-stream.js:24-25`).
- **The swap.** `tl-board` swaps its `#board-live` child and is never itself replaced. The old board's `tl-countdown` and `tl-relative-time` disconnect. The new ones upgrade on insertion: template content has no registry, so they upgrade when they join the document, each with a fresh skew.
- **Restore status.** After a restore, the status says "Reconnecting…" until the stream opens.

**What closing on `pagehide` buys.**
- Every page is sent `Cache-Control: no-store` (`server/respond.js:30`). Whether a browser keeps such a page in the back/forward cache is its decision. Recent Chrome may, under some conditions; other browsers may not. An open `EventSource` is an outstanding request, which can also keep a page out.
- Whatever the browser does, a hidden, cached or discarded board holds no connection. The server drops its subscription and heartbeat (`board-stream.js:54-58`).
- If the page is restored, the stream reopens. Its first message is a whole board (`board-stream.js:51`).
- No instant Back is promised. Most often, Back loads the board again, as today.

## 4. `tl-countdown` and `tl-relative-time` at a glance

| | `tl-countdown` | `tl-relative-time` |
|---|---|---|
| Server time | `data-now` on its `<time data-clock>`. It stays there so `board-pages.test.js:62` matches unchanged. | `now` on the element |
| Target time | `data-opens` / `data-closes` (`''` → null) | `<time datetime>` |
| Skew | once, on first connect; 0 when prefetched | once, on connect |
| Ticks | 200 ms per element; stops at a fixed 0:00, after the reload decision | one shared 15 s timer, paused while hidden |
| Writes | `<time>` text, `[data-clock-label]` text | `<time>` text, its own `hidden` |
| Extra | `reload-on-phase` (race page, GET only; reloads with `location.reload()`) | `min` |

## 5. Server markup

### 5.1 The board (`views/board.js:38`, `:42-59`, `:104-109`, `:118`)

```html
<tl-board status="live-status">
<div id="board-live" class="board" data-events="/personal/board/events">
<header class="board-head">
  <div><p class="eyebrow">Office loop · clockwise</p><h1 class="board-title">Race</h1></div>
  <tl-countdown class="board-clock"><span class="stat-label board-clock-label" data-clock-label>Remaining</span><time class="board-clock-time" data-clock data-kind="race" data-state="running" data-opens="1760781600000" data-closes="1760781900000" data-now="1760781648000">4:12</time></tl-countdown>
</header>
…
<tr>
  <td class="pos">2</td>
  <td class="board-driver"><span class="driver" style="--driver: #e4572e">Ben</span><tl-relative-time class="board-ago" now="1760781648000" min="60000">last lap <time datetime="2026-10-18T10:37:48.000Z">3 min ago</time></tl-relative-time></td>
  …
</tr>
…
</div>
</tl-board>
```

- `tl-board` wraps `boardLive(…)` in `boardPage` only. The streamed fragment still starts `<div id="board-live"`.
- The driver cell gets the class `board-driver` (the results table's cells too, for the same column width).
- The note is rendered under the §2.3 conditions, with `hidden` when `snap.now − lastAt < 60_000`. Its text is `formatAgo(lastAt, snap.now)`, and `now` is `snap.now`.
- `scripts: ['board.js', 'elements/board.js', 'elements/countdown.js']`, and `modules: ['pkg/design/elements/relative-time.js']` (`layout.js:31-50`). The `<noscript>` refresh stays.

### 5.2 Layout and styles

The note is secondary: quiet, no colour, no badge, no motion.

**The layout stays stable.** The note sits on its own line under the name. The Driver column has a minimum width that holds the note, so a note appearing or disappearing never moves the other columns. Measured in Chrome with the real CSS: without a minimum, short names move the columns, by 77 px at 1280 px and 15 px at 390 px.

```css
tl-board { display: block; }
.board-table .board-driver { min-width: 9.5em; }
@media (max-width: 720px) { .board-table .board-driver { min-width: 6em; } }
.board-ago { display: block; color: var(--p-text-secondary); font-weight: 400; font-size: 0.75em; line-height: 1.2; font-variant-numeric: tabular-nums; }
.board-ago time { white-space: nowrap; }
body.big .board-ago { font-size: 0.6em; }
```

- **Above 720 px:** 9.5em holds "last lap 14 Oct 2026" on one line. A stopped row grows by one short line.
- **At 720 px or less:** 6em. "last lap" wraps above the `<time>`, so on a phone a stopped row grows by two short lines.

  Measured at 390×844: the columns are stable for long and short names, at 6 and 20 rows, and with "14 Oct 2026". The race table's sideways scroll in `.board-scroll` stays at 14–20 px, as today's 18 px. At 9.5em it would have been 63 px.
- **Both tables:** the results table's Driver cells (`results()`, `views/board.js:61-72`) carry `board-driver` too, so the same min-width rules apply there.
- **Big mode** keeps "last lap N min ago" at 0.6em, unconditionally.
  - At 1920×1080 the Driver column is already 426 px wide, so the columns are stable.
  - The wall table already scrolls past 1080 px with about 6 or more drivers (measured: 1592 px at 10 rows, 2835 px at 20).
  - Each note adds about 10 px to its row, since the 1.25em `.pos` cell sets the row height. That is at most +7 % with every note visible.
  - Driver counts: up to 20 in a qualifying or race (`MAX_ROSTER`, `server/operations.js:18`), and up to 200 in practice (`MAX_DRIVERS`, `:17`).
- **Contrast:** the implementer checks `--p-text-secondary` on `.board-table`'s surface at 0.6em, with the `frontend-design` skill (CLAUDE.local.md).
- `.board-clock` already sets `display: grid`, which applies to `tl-countdown`.

### 5.3 The race page's running panel (`views/race.js:47-58`)

```html
<div class="card-static stack-md">
  <h2 class="h3">Race, counting down</h2>
  <p>Ana, Ben. 5 minutes.</p>
  <tl-countdown class="race-clock" reload-on-phase><span class="stat-label" data-clock-label>Starts in</span> <time class="race-clock-time" data-clock data-kind="race" data-state="countdown" data-opens="…" data-closes="…" data-now="…">0:08</time></tl-countdown>
  <div class="button-row">…Show the board, Abort…</div>
</div>
```

- The label and time come from `clockAt(session, request.now())`.
- `reload-on-phase` is rendered only on the 200 `GET /race` (`renderRace(request, 200)`, `race-pages.js:67`). It is never on a 409, a 422 or an abort error.
- `racePage` passes `scripts: ['elements/countdown.js']` only while a session is active.
- `.race-clock` gets a small style, made with the `frontend-design` skill and palace tokens.

### 5.4 Full screen (`layout.js:55-57`)

```html
<div class="navbar-right">
    <button type="button" class="btn btn-sm btn-outline" data-fullscreen hidden>Full screen</button>
    <span class="live-status" id="live-status" data-state="off" hidden></span>
    <a class="btn btn-sm btn-outline" href="/personal/board">Leave big screen</a>
```

The button is rendered only when `big`, and stays hidden without JavaScript, by the `[hidden]` rule.

## 6. What stays a page script

`public/board.js` shrinks to full screen. On `body.big`, when `requestFullscreen` exists, it:
- unhides `[data-fullscreen]`;
- toggles full screen on click;
- relabels the button on `fullscreenchange`.

## 7. Tests

**Must pass unchanged:**
- `test/browser/live.test.js`, all nine tests (the reload with `tinylapReloadMs` is at `:110-131`).
- `test/server/board-pages.test.js:41-43`, `:62`.
- `test/server/board-stream.test.js`.
- `test/server/engine-sessions.test.js`.
- `test/views.test.js`: the wrapper returns `{ label, ms }`.
- `navigation.test.js`, `csp.test.js`, `race-pages.test.js:44-47`.
- `setup-seen.test.js`: only the import changes.

**How `globalThis.tinylapReloadMs` maps:** `tl-board` reads it when the CLOSED timer is scheduled, as `board.js:72` does. `live.test.js:114` keeps setting it.

**Driving the engine.** `startTiming` runs no ticker (`test/server/helpers.js:35-53`). Only `server/main.js:69-75` does. Tests that need a phase to move drive it explicitly: `const ticker = setInterval(() => app.engine.tick(), 100)`, cleared in `t.after`, as `main.js` does. The helper doesn't change. With a fake `clock`, the test moves `clock.now` and then calls `app.engine.tick()` itself.

**Changed tests:**

| File | Change |
|---|---|
| `apps/timing/test/format.test.js` | The `formatAgo` cases leave; `clockAt` cases are added:<br>- phase, label and ms before and after `opensAt` and `closesAt`;<br>- practice counting up with `closesAt: null`;<br>- `done` and `aborted` at 0. |
| `packages/design/test/format-ago.test.js` (new) | The moved `formatAgo` cases. |
| `packages/timing/test/sessions.test.js` | Rows carry `lastAt`, including for a crossing that isn't counted and for one before `opensAt`. |
| `test/server/board-pages.test.js` (has a clock, `:20`, `:30-31`) | - `<tl-board status="live-status">\s*<div id="board-live"`; `<tl-countdown class="board-clock">`; the three element scripts.<br>- A driver stopped 3 min shows `<tl-relative-time class="board-ago" now="…" min="60000">last lap <time datetime="…">3 min ago</time>`; within the minute it carries `hidden`.<br>- No note: during a race countdown; for a race driver with only a pre-start crossing; on a finished row; in the results table.<br>- The watchers board and `?big` have the note.<br>- `?big` renders `data-fullscreen hidden`. |
| `test/server/race-pages.test.js` | - `GET /race` while running: `tl-countdown … reload-on-phase` and `elements/countdown.js`.<br>- The 409 of a second start renders the panel without `reload-on-phase`.<br>- The start form has neither. |
| `test/server/frames.test.js:46-48` | The no-import regex also forbids `public\/elements\/`. |
| `test/browser/assembled.test.js` | The board loads `/v/<sha>/public/elements/board.js`, `countdown.js` and `/v/<sha>/pkg/design/elements/relative-time.js`, and defines all three. |
| `test/browser/no-js.test.js` | - **Clock:** the suite gains a running clock with an offset, `const clock = { offset: 0, get now() { return Date.now() + this.offset; } }`, passed to `startTiming({ plannerUrl, clock })`. Only `offset` is ever increased, so sessions and cookies stay valid across its ordered tests.<br>- A big board shows no Full screen button.<br>- A stopped driver: post two passings 8 s apart (one lap, so practice has a row), add 3 min to `clock.offset`, load the board: "last lap 3 min ago" is visible. |

**New: `test/browser/board-elements.test.js`.**
- **Clocks.** Both new suites start the server with a running clock, `const clock = { offset: 0, get now() { return Date.now() + this.offset; } }; startTiming({ clock })`. It runs with real time, and a test jumps it only forward with `clock.offset += …`, as `no-js.test.js` does. `page.clock` moves the device clock.
- **What `page.clock.install()` fakes:** the page's timers, including the 15 s timer. It fakes neither `EventSource` nor the server.
- **B1** **Restore.** Dispatch `pagehide` with `persisted: true` (as `menu.test.js:121`): the subscription ends (wrap `app.hub.subscribe` as `live.test.js:84-96` does). Post a passing, then dispatch `pageshow` with `persisted: true`: "reconnecting", then "live", and the lap shows.
- **B2** **Disconnect.** `tl-board.remove()` ends the subscription, and no reload follows within `tinylapReloadMs`. Re-appending reopens the stream.
- **B3** **Server time.** `page.clock.setSystemTime` puts the device an hour behind the server: the practice clock and the note follow the server.
- **B4** **The note appears on its own.** `page.clock.install()` before `goto`. A driver with one lap (two passings 8 s apart), whose last crossing is 40 s old by server time, shows no note. `page.clock.runFor(15_000)` (55 s) → still none. Another `runFor(15_000)` (70 s) → "last lap 1 min ago", with the stream idle.
- **B5** **Paused when hidden.** Override `document.hidden` to true and dispatch `visibilitychange`, then `runFor(120_000)`: the text is unchanged. Set it visible and dispatch again: it updates at once.
- **B6** **A stable layout.** At 390×844, 1280×800 and 1920×1080 `?big`, with short and long names: the left edge of each column header is the same before and after a note appears, and `document.documentElement.scrollWidth <= innerWidth`.

**New: `test/browser/race-countdown.test.js`.** Each test runs the engine ticker described above.
- **C1** **One reload by GET.** Start a race with a 2 s countdown (`app.form`), open `/personal/race`: "Starts in" ticks, then exactly one load (`page.on('load')`), whose request is a GET, and no POST (`page.on('request')`). The panel then says "Race, running" and "Remaining".
- **C2** **Stalled server.** The ticker stopped, and `page.route` with `route.fetch()` rewrites the race page to `data-state="countdown"` with a past `data-opens`, keeping its headers and CSP: one load, then none.
- **C3** **Blocked storage.** An init script makes `sessionStorage` throw. The test first checks, in the page, that reading `sessionStorage` really throws, then expects no load.
- **C4** **Prefetch, simulated.** An init script makes `performance.getEntriesByType('navigation')[0].deliveryType` report `'navigational-prefetch'` on the first load only, with the device clock 5 s ahead through `page.clock.setSystemTime(clock.now + 5000)`, without `install()`, so real timers run.
  - "First load only" is tracked in `window.name`: the init script sets it on the first run and checks it later. The element's own `sessionStorage` key is never used for this.
  - Expected: the page reloads early, reading and writing no key. The next, normal page waits. Then exactly one more load, at the server's boundary.
- **C5** **Prefetch, real.** On a running countdown's race page, hover the navbar's Race tab and wait for the prefetch request (`sec-purpose`, as `navigation.test.js:30`). Then cross the boundary: exactly one load, and the panel says "Race, running". The hover waits at most 5 s for the prefetch. If Chrome doesn't prefetch a link to the document's own URL, the R1 hazard can't arise there: the test notes it and passes, and C4 stays the guard.
- **C6** **Never after a POST.** A second start answers 409 with the panel: past the boundary, no reload and no request.
- **C7** **Reload at `closesAt`.** A 1-minute race with a 0 s countdown, driven by the fake server clock (`startTiming({ clock })`, moved forward, with `app.engine.tick()` after each move) and `page.clock`, installed with `page.clock.install({ time: clock.now })` before `goto`. `page.clock` moves together with the server clock: each step adds the same amount to `clock.offset` and to `page.clock.runFor`. Past `closesAt`: exactly one load, and the panel then says "Race, finishing the last lap" with a stopped 0:00.

**A real back/forward cache restore** is not tested. Playwright starts Chrome with that cache turned off (confirm in playwright-core's Chromium switches), and `no-store` may keep these pages out anyway. As in `frames.test.js:215`, the tests dispatch the events.

## 8. Risks

- **Race-page reloads.** One at the end of the countdown, one at `closesAt`. A user about to press Abort gets a fresh page, with Abort still there. `done` shows only after a load (ruling).
- **Prefetched race page.** It uses the device clock until its early reload. The reload costs one extra page load.
- **`lastAt` is any crossing.** A car that keeps crossing with uncounted laps isn't shown as stopped. That is intended: it is moving.
- **Mapped time.**
  - A decoder whose offset jumps moves the note by the jump; the note's minute resolution hides small errors.
  - After an outbox flush following an outage (`engine.js:93-98` keeps one minute of offsets), the batch's newest passing sets the offset. If a car stopped during the outage, its `at` is late by the gap, and "last lap" understates how long it has been stopped.
- **Row height.** A stopped driver's row grows by one short line (two on a phone). On the wall screen, which already scrolls with about 6 or more drivers, every note visible adds at most 7 % height (§5.2).
- **Contrast** of muted text at 0.6em on the wall: checked in §5.2.
- **Status after a restore:** "Reconnecting…" lights the wall lamp briefly (`app.css:117`).
- **Requests:** three more modules on the board, versioned under `/v/<build>/`.
- **The `status` id** points into the navbar, so the element and the layout must agree.

## 9. Non-goals

- `tl-tap` and `tl-bridge`.
- A ticking "seen … ago" on Setup.
- A live race-page state beyond the two reloads; no reload at `done` or at `closesAt + MAX_LAP_MS`.
- Changes to the SSE framing, the throttle, the retry or `/live`, beyond the additive `lastAt`.
- An instant Back from the back/forward cache.
- View transitions; speculation-rule changes.
