# Custom elements, step three: the bridge

It follows the step-one spec (`2026-10-16-custom-elements-step-one-design.md`), the step-two spec (`2026-10-18-custom-elements-step-two-board.md`) and AGENTS.md "Web platform first". Paths are relative to `apps/timing/` unless they say otherwise.

Product owner rulings recorded here:
- **Why this step.** Users gain little from it. It is for consistency and testability.
- **Two roles for an element.** A custom element can:
  - enhance existing server HTML, with a managed lifecycle;
  - load behaviour into a page: an element whose presence has a side effect.
- **The bridge becomes `tl-bridge`.** It is mainly the second role: its job, the link from the serial port to the server, lasts as long as the element is on the page. It is partly the first: it fills the server-rendered state sections. It stays a thin wrapper, migrated in steps (§3.5).
- **The bridge's preview rows become server `<template>`s**, inside `tl-bridge` (§3.4).
- **One fix in `bridge.js`:** a closed `Bridge` no longer flushes (§3.1). This is the only change to that file.
- **The element file** is `public/elements/bridge.js`, so `bridge-pages.test.js:35` changes.

## 1. Goal and scope

| Element | Where | Job |
|---|---|---|
| `tl-bridge` | `public/elements/bridge.js` | While it is on the page, it runs the page side of the bridge: the Connect buttons, pairing, the state sections, the preview, the earlier-passings note and the leave-page guard. It replaces `public/bridge-page.js`. The preview rows are cloned from server templates. |

**Unchanged:**
- `public/bridge.js` (`Bridge`, `sendOutbox`), except that a closed bridge no longer flushes (§3.1);
- `public/outbox.js` and `public/sim-port.js`;
- the import map and its CSP hash;
- the decoder protocol (`docs/timing.md`) and the ingest API.

## 2. Tap

Laps are timed only by decoders, so there is no tap element. The section number is kept so that references to §3 and §4 stay valid.

## 3. `tl-bridge`

### 3.1 What it is

A thin wrapper. The body of `bridge-page.js` moves into the element nearly line for line. The DOM-free modules stay as they are, each with its Node tests:
- `Bridge` and `sendOutbox` (`bridge.js`): `test/bridge.test.js`, seven tests;
- the outbox (`outbox.js`): `test/outbox.test.js`;
- the simulated port (`sim-port.js`).

**The one exception: a closed `Bridge` no longer flushes** (owner's ruling). Today two paths send again after `close()`:
- a flush already running arms a fresh retry when its POST fails (`bridge.js:187`);
- a lap still being handled calls `flush()` after its `outbox.add` (`:134-136`).

While offline, either one is a 5 s POST loop held by a bridge the page no longer has. The fix is two checks in `flush` (`:172-198`):
- `flush()` starts with `if (this.#closed) return Promise.resolve();`;
- the `catch` arms the retry only `if (!this.#closed)` (`:187`).

Nothing else in `bridge.js` changes. A new Node test pins the fix (§4).

**Leaving the page closes the port, as today.** Nothing on the bridge page removes or moves `tl-bridge`. In practice, the element disconnects only when the page goes away. The browser then closes the serial port and drops the page's state anyway. So `disconnectedCallback` adds no new risk mid-race. It makes explicit what leaving the page already does, and lets tests check it.

### 3.2 What moves where

| Today in `public/bridge-page.js` | Becomes |
|---|---|
| imports (`:9-12`) | `elements/bridge.js` imports `../bridge.js`, `../format.js`, `../outbox.js` and `../sim-port.js`. `bridge.js` keeps importing `@tinylap/timing` through the import map. |
| `simulate`, `supported` (`:17-18`) | module constants, unchanged. They read `location` and `navigator`, which don't change while the page is open. |
| `root`, `workspaceId`, `$` (`:14-16`) | from the element: `root = this.querySelector('#bridge')`, read on each start |
| `api`, `post` (`:21-33`) | module functions, verbatim |
| module state: `bridge`, `preview`, `names`, `asked` (`:36-44`); `made` (`:164`) | one **run** object, `{ bridge, preview, names, asked, made }`, made fresh by each start. Every closure captures its run (§3.3). |
| `error`, `live`, `announce`, `nameOf`, `fail`, `ok` (`:38-50`), `show`, `STATE_TEXT`, `update` (`:52-88`), `learnName` (`:91-103`), `pickPort` (`:106-114`), `connect` (`:116-141`), `sendEarlier` (`:144-158`) | methods or functions taking the run. Their bodies are verbatim, apart from the run guard (§3.3) and the preview templates (§3.4). |
| the start-up (`:160-195`) | `start()`, called by `connectedCallback` |
| `click` listeners on each `[data-bridge-connect]` (`:162`), `submit` on `[data-bridge-pair]` (`:167`) | delegated `click` and `submit` listeners on the element. A click counts when `event.target.closest('[data-bridge-connect]')` is inside the element. A submit counts when `event.target` matches `[data-bridge-pair]`. |
| `beforeunload` on `window` (`:191-193`) | the element's `handleEvent`, which also serves `click` and `submit`. It is added in `start` and removed in `stop`. It prevents the unload only when `this.run?.bridge?.state === 'ready'` (`:192`), so a stopped element never blocks leaving. |

### 3.3 Lifecycle

```
connectedCallback    → start()
start()              → return if this.run is set (no second start without a stop)
                       root = #bridge inside; return if !root or !supported (as :160)
                       this.run = { bridge: null, preview: [], names: new Map(), asked: new Set(), made: null }
                       reset what an earlier run wrote (below)
                       show(run, 'connect')                                   (:161)
                       this.addEventListener('click', this); this.addEventListener('submit', this)
                       addEventListener('beforeunload', this)                 (:191)
                       void sendEarlier(run).catch(() => {})                  (:194)
disconnectedCallback → stop()
stop()               → run = this.run; this.run = null; if !run return
                       remove the click, submit and beforeunload listeners
                       const b = run.bridge; run.bridge = null; void b?.close()
```

**The reset in `start()`.** On a first start these nodes are already as the server rendered them, so the reset changes nothing. After a move or a clone it puts back what a run wrote:
- the error box (`[data-bridge-error]`): `hidden`, with its text emptied (`:47-48`);
- the earlier-passings note: `hidden` (`:148`). `sendEarlier` returns at `count === 0` without hiding it (`:153`);
- the live region: emptied;
- the name field: `readOnly = false` (`:178`);
- the Pair button: `disabled = false` (`:173`). A clone made during a pairing copies `disabled`, and the old run's `finally` enables only the old button.

**Kept exactly:**
1. **Start-up.** It does what `:160-195` do, in the same order. Without `#bridge`, or without Web Serial and `?simulate`, the element does nothing, and the server's "unsupported" section stays visible (`views/bridge.js:34-37`).
2. **Connect** (`:116-141`):
   - the picker: closing it is no error (`:111`), and `?simulate` gives the simulated port (`:107`);
   - the old bridge is closed before the next opens (`:119`);
   - a bridge that answers `not-tinylap` is closed, whether it is current or not (`:122`);
   - the listeners that show or update check `run.bridge === next` (`:123`, `:125`, `:129`);
   - the passing listener adds to `run.preview` first, keeping at most 20 (`:127-128`), and updates only when current (`:129`);
   - a failed start closes the bridge, shows Connect again and rethrows (`:135-139`);
   - a successful connect hides the error box, and a failed one shows the thrown message (`:162`).
3. **Pairing** (`:167-190`):
   - `preventDefault()` first;
   - a blank name is refused before any request (`:172`);
   - the server creates the decoder once (`:175-179`). Its id and one-time token stay in `run.made`, with the name field read-only, until the cable has them;
   - a failure keeps `made`, and says to press Pair again (`:186`). The next Pair reuses it (`:175`, `test/browser/bridge.test.js:94-119`);
   - Wi-Fi is sent only with an SSID (`:180-181`);
   - the button is disabled during the request, and enabled again in `finally` (`:173`, `:188`).
4. **States, words and the live region:**
   - one `[data-bridge-state]` section at a time (`:53`);
   - `STATE_TEXT` (`:58-64`);
   - an announcement only when the text changes (`:41`);
   - the offline and refused texts (`:69`, `:75`);
   - the outbox count (`:76`).
5. **Names.** The short id stands in (`:45`). An earlier decoder's name is looked up once per run (`:72`, `:91-103`).
6. **The leave-page guard.** `beforeunload` is prevented while a bridge is `ready` (`:191-193`).
7. **Earlier passings.** One `sendEarlier` per start (`:194`), with its texts (`:147-157`). It runs alongside `Bridge.flush` on the same outbox. That is safe, because resending is safe (`docs/timing.md:43`).
8. **The `Bridge` itself:** the hello and its 2 s timeout, the re-hello when the clock goes back, the reply queue, the outbox, `flush` and its 5 s retry, the batching and `through` (`bridge.js:63-207`). The only change is the two `#closed` checks (§3.1).

**Teardown (`stop`):**
- **The port.** `Bridge.close()`:
  - cancels the reader, releases the writer and closes the port (`bridge.js:200-207`);
  - clears the hello and retry timers (`:202-203`). With the §3.1 checks, a flush still running, or a lap still being handled, arms no new one.

  The simulated port's interval stops on `close` and on `cancel` (`sim-port.js:19`, `:30-32`). Once closed, the bridge reports no `disconnected` state (`bridge.js:108`).
- **Listeners.** The element's `click` and `submit` listeners and the window's `beforeunload` are removed. The page glue keeps no timers of its own.
- **Lost on teardown, as on leaving the page:**
  - the preview;
  - the names learnt;
  - an unsent `made`, with the token it holds. The server keeps that decoder; Setup can unpair it.

  A new start is a fresh run, and the reset puts the page's nodes back as the server rendered them, as a new page load would.
- **Work in flight.** These can't be cancelled cleanly. They finish, and the run guard keeps their results off the page:
  - a picker the user hasn't answered;
  - `openOutbox` or `next.start()`;
  - a pairing request;
  - `learnName`;
  - `sendEarlier`.

  After a move, the old run's `sendEarlier` can still be sending while the new run starts its own on the same outbox. That is safe, because resending is safe (`docs/timing.md:43`). The server keeps one copy.

**The run guard.** After each `await`, an async path continues only while `run === this.run`. Otherwise it closes any bridge it has just made, and writes nothing to the page:
- `connect`, after `pickPort` (`:117`), after `openOutbox` (`:120`) and after `next.start()` (`:134`);
- `connect`'s `catch`: `show('connect')` only while current (`:138`). The bridge is still closed, and the error is rethrown;
- `connect`'s caller: `ok` and `fail` run only while current (`:162`);
- pairing:
  - right after the decoder is created (`:176`), before `names.set` and `nameField.readOnly` (`:177-178`);
  - again before `ok` and `fail` (`:184-186`).

  `finally` enables the button (`:188`) only while the run is current. After a move the old and the new run share the button, so an old pairing that settles while a new one runs would turn it back on mid-request, and a second press could create a second decoder. The reset enables it for a new run, and covers a clone;
- `update`'s outbox count, before it writes `[data-bridge-outbox]` (`:76`);
- `learnName`, before `update` (`:98`);
- `sendEarlier`'s `say` (`:147`).

After a stop, `run.bridge` is null, so an old bridge's late events fail `run.bridge === next` and change nothing on the page. A late passing goes only into the old run's preview, which nothing shows.

**A move is a stop and a fresh start.**
- The port closes, the page shows Connect again, and the next Connect needs a click, because `requestPort` needs a user gesture.
- A real port picked again before the old `close()` has finished can fail to open. It shows as an error, and Connect works again.

  Nothing in the app moves `tl-bridge`. The tests pin this behaviour so that it stays defined.
- **No `pagehide`/`pageshow` handling,** as today.

### 3.4 Markup (`views/bridge.js:31-75`)

```html
<tl-bridge>
<div id="bridge" data-workspace="…">
  <p class="visually-hidden" role="status" data-bridge-live></p>
  …the seven [data-bridge-state] sections, unchanged…
    <div class="bridge-preview">
      <p class="bridge-head"><span>Transponder</span><span>Lap</span></p>
      <ol class="board-laps" data-bridge-preview></ol>
      <template data-bridge-row="first"><li><span class="bridge-code"></span><span class="bridge-first">first pass</span></li></template>
      <template data-bridge-row="lap"><li><span class="bridge-code"></span><span class="num"></span></li></template>
    </div>
  …
  <p class="status status-error" role="alert" data-bridge-error hidden></p>
</div>
</tl-bridge>
```

- **The wrapper.** `tl-bridge` wraps `<div id="bridge">`, which keeps its id and `data-workspace`. So these tests hold unchanged:
  - `bridge-pages.test.js:24`;
  - `#bridge > [role="status"]` (`test/browser/bridge.test.js:87-89`).

  `app.css` gets `tl-bridge { display: block; }`, so palace's `.stack-lg > * + *` margin applies to it as it did to `#bridge`.
- **The preview templates go right after the `<ol>`, never inside it.** `update()` empties the list with `replaceChildren` (`bridge-page.js:78`).
  - `update()` clones `first` when `p.lapMs` is `null` or `undefined`, and `lap` otherwise (`:81`).
  - It sets `.bridge-code` to `p.transponder`, and `.num` to `formatLap(p.lapMs)`.
  - Each template is one line in the view, with no whitespace inside the `<li>`, matching today's nodes (`:79-85`).
  - "first pass" moves to the server. The element builds no markup.
  - `.bridge-preview li:last-child` (`app.css:216`) is unaffected, because a `<template>` is not an `li`.
- **The import map stays as it is:** emitted by `bridgeImportMap` (`views/bridge.js:13-16`), allowed by its hash (`bridge-pages.js:12-14`), and placed before every module (`layout.js:50`).
- **The script:** `scripts: ['elements/bridge.js']` (`views/bridge.js:28`), and `public/bridge-page.js` is deleted. The element lives in `public/elements/`, like every other app element, so `bridge-pages.test.js:35` changes (owner's ruling).
- **Naming.** `public/elements/bridge.js` holds the element, and `public/bridge.js` the `Bridge` class. The new element's header comment says which is which. `bridge.js`'s header (`:5-9`) already describes the `Bridge` class and stays unchanged.
- **Comments.** `views/bridge.js:5-7` and `bridge-pages.js:5-6` name `tl-bridge`.
- **Design check.** No visual change. The implementer confirms it with the `frontend-design` skill (CLAUDE.local.md).

### 3.5 Migration, in four commits on one branch

The bridge's four existing suites stay green after each commit (§4).

0. **The `#closed` checks first, in their own commit.** The two checks in `bridge.js` (§3.1) and the new `bridge.test.js` case land before the element, so E2's 6 s check never runs without them.

1. **Templates, still in the page script.** The view gains the two row templates, and `update()` clones them. Nothing else changes.
   - Tests: the template check in `bridge-pages.test.js`, and E5.
2. **The wrapper, starting what the page started.**
   - `bridge-page.js` moves into `elements/bridge.js` as `TlBridge`. The module state becomes the run, and the listeners are delegated.
   - The view wraps `#bridge` and loads `elements/bridge.js`.
   - `disconnectedCallback` is still empty.
   - Tests: `bridge-pages.test.js:35` and the wrapper check, the assembled check, and E1.
3. **Teardown.**
   - `stop()`, the reset in `start()` and the run guard.
   - Tests: E2, E3a, E3b, E4 and E6.

The branch review added E4c and E7, a `beforeunload` listener count in E2, and the `finally` guard (§3.3), in follow-up commits.

## 4. Tests

**Must pass unchanged:**
- **The bridge's tests:**
  - `test/bridge.test.js`, its seven tests (one test is added), and `test/outbox.test.js`;
  - `test/browser/bridge.test.js`, all seven tests;
  - `test/server/bridge-pages.test.js:19-34`.
- `test/browser/no-js.test.js`, including `:127-134` (the bridge's links).
- `test/browser/navigation.test.js`, `test/server/csp.test.js`.
- `test/server/frames.test.js:46-48`. The no-import rule already covers `public/elements/`.

**Changed tests:**

| File | Change |
|---|---|
| `test/server/bridge-pages.test.js` | - `:35` expects `/public/elements/bridge.js` (owner's ruling).<br>- New: `<tl-bridge>\s*<div id="bridge"`, and both row templates as exact strings from §3.4, right after `<ol class="board-laps" data-bridge-preview></ol>`. |
| `test/browser/assembled.test.js:39-61` | - On the bridge: `/v/<sha>/public/elements/bridge.js` loads and `tl-bridge` is defined. The import map check (`:55-61`) stays. |

**New: `test/browser/bridge-element.test.js`.** It uses `?simulate=fast` (laps every 2 s).
- **Counting ports.** An init script wraps `WritableStream` and `ReadableStream`, as `bridge.test.js:99-108` does. Only `sim-port.js` constructs them with a JS sink or source (`sim-port.js:19-20`).
  - `window.__opened` counts **opened** ports. A port counts the first time its `WritableStream` sink gets a write, and `Bridge.start` always writes the hello (`bridge.js:78`).
  - `window.__cancelled` counts readable sources whose `cancel` ran, and `window.__cancelledAt` records `performance.now()` when one does.
  - `window.__writes` keeps a `performance.now()` timestamp for each sink write.

  Every port assertion is `__cancelled === __opened`.
- **E1 Connect starts the link.**
  - Before any click: `tl-bridge` is defined, the Connect section is shown, and `__opened === 0`.
  - One click: `__opened === 1`, and the pairing form shows.
  - **Earlier passings.**
    1. Pair a decoder through `app.api`.
    2. After the first load, with the import map in place, seed the outbox through its module: `await (await import('/public/outbox.js')).openOutbox()`, then `.add(passing)`, in `page.evaluate`. That keeps the key path (`outbox.js:48`) out of the test.
    3. Hold the POST to `/decoders/*/passings`, then reload.
    4. The note says "1 passing from earlier is waiting. Sending them now…". Release the POST: exactly one POST went to `/decoders/<id>/passings`, answered 200.
- **E2 A removal closes the port, stops the retries and never blocks leaving.**
  - Pair and wait for "Forwarding from …". A cancelable `beforeunload` dispatched on `window` is now `defaultPrevented`.
  - Route `/decoders/*/passings` to `abort()` and wait for the "Offline" status, so the 5 s retry is armed. Then call `tl-bridge.remove()`.
  - Expect:
    - `window` holds one `beforeunload` listener before the removal and none after, counted over DevTools (`DOMDebugger.getEventListeners`), so a removed element isn't kept alive;
    - `__opened === 1` and `__cancelled === __opened`: the port is closed;
    - no request to `/decoders/*/passings` in the next 6 s, so no retry, no late flush and no simulator is left running (§3.1);
    - a `beforeunload` dispatched now is not `defaultPrevented`;
    - `button.click()` on the detached Connect button opens no port;
    - a `SubmitEvent` on the detached pair form sends no POST.
- **E3a A removal right after the click.** In one `page.evaluate`, click Connect and remove the element.
  - `pickPort` builds the simulated port synchronously, so the guard after `pickPort` returns before any `Bridge` exists.
  - Expect: `__opened === 0`, no state section is shown, and no request goes to the decoders API.
- **E3b A removal during start.**
  1. In one `page.evaluate`, a `MutationObserver` waits for `[data-bridge-state="connecting"]` to lose `hidden`. That happens at `:132`, after `run.bridge = next`.
  2. The observer removes the element. Its callback runs before `port.open` resolves.
  3. Wait 1 s.
  4. Expect: `__cancelled === __opened === 1`, no state section shown, and every `__writes` entry is `<= __cancelledAt`.

  Only the guard after `next.start()` closes this bridge, because `stop()`'s `close()` ran before the reader existed.
- **E4 No double start on a move, from a failed pairing.**
  1. Use the dropped `%TLPAIR` of `bridge.test.js:99-108`: connect, Pair, and wait for the "didn't answer" alert. The name field is read-only, and `made` is held.
  2. `document.querySelector('main .container').append(tlBridge)`, which stops and starts it. Expect:
     - the Connect section shows;
     - no alert is visible;
     - the name field is editable, and the Pair button is enabled;
     - `__cancelled === __opened` for the first port, waited for: `stop()` doesn't await `close()`.
  3. One click opens exactly one more port. One Pair sends exactly one `POST /workspaces/<id>/decoders`, and the store gains exactly one decoder. The old run's decoder stays orphaned, as §3.3 says.
  4. In a new page (`toPairing` again, with the dropped `%TLPAIR`), repeat steps 1–3 with `tlBridge.replaceWith(tlBridge.cloneNode(true))` in place of the move. After step 3 the first page is paired and its dropped command is used up.
- **E4c One click, one picker, on real Web Serial.** Every other bridge test uses `?simulate`, where `pickPort` builds the port without a picker.
  - An init script defines `navigator.serial` with a `requestPort` that counts its calls and rejects with a `NotFoundError`, as a closed picker does.
  - Load `/personal/bridge`, move `tl-bridge`, and click Connect once.
  - Expect: one `requestPort` call, no alert, and the Connect section still shown. Closing the picker is no error (§3.3, Kept 2).
- **E5 The lap row's template.** Wait for a row `li > .bridge-code + .num` whose text matches `/\d+\.\d{3}/`. The first-pass row is already covered by `bridge.test.js:85`.
- **E6 A pairing answer across a move.**
  1. On the pairing form, `page.route('**/workspaces/*/decoders', …)` holds the POST only: `route.request().method() === 'POST'`, otherwise `route.continue()`. The GET of `learnName` (`bridge-page.js:94`) matches the same pattern.
  2. Press Pair, move the element, then release the answer. Wait for `page.waitForEvent('requestfinished')`, and then two frames.
  3. Then expect: the Connect section shows, the name field is editable, no alert is visible, and exactly one decoder is added to the store, orphaned as §3.3 says.
- **E7 An old pairing's answer after a move leaves the new pairing alone.**
  1. Hold every `POST …/decoders`, in order. Pair as `Old run`, move the element, Connect again, and Pair as `New run`. The Pair button is disabled.
  2. Release the old POST, wait for `requestfinished` and two frames: the Pair button is still disabled.
  3. Release the new POST: "Forwarding from New run".

**New, in `test/bridge.test.js`: a closed bridge sends nothing more.** The file's seven tests stay unchanged.
- Set up: a `Bridge` with a `memoryOutbox` holding one passing, `retryMs: 20`, and a `post` that counts its calls, waits on a gate and then throws an `Error` with no status (offline).
- Call `flush()`, then `close()` while the post is held, then release the gate.
- After 100 ms: `post` was called once, and a further `flush()` calls it no more.
- Without the §3.1 checks, the retry fires every 20 ms and the count grows.

**Mutation targets.** Each change must fail at least one test.

| Mutation | Caught by |
|---|---|
| bridge: drop the `#closed` checks in `flush`, or only the first one | the new `bridge.test.js` case, E2 |
| bridge: drop `run.bridge.close()` in `stop` | E2 (`__cancelled`, passings) |
| bridge: keep the `beforeunload` listener after `stop`, or let it read a stale bridge rather than `this.run?.bridge` | E2 (the listener count; `defaultPrevented`) |
| bridge: drop the guards after both `pickPort` and `openOutbox` | E3a |
| bridge: drop the run guard after `next.start()` | E3b |
| bridge: drop the reset in `start()` | E4 |
| bridge: start in the constructor, or once per element | E4 (nothing starts after the move) |
| bridge: per-button arrow listeners, as today's `:162` | E4c (one click, one picker) |
| bridge: drop the pairing guard | E6 |
| bridge: `finally` enables the Pair button while the run isn't current | E7 |
| bridge: a row template with a wrong class, or no lap template | E5, `bridge-pages.test.js` |

**Covered by review only:**
- **Each of the guards after `pickPort` and `openOutbox` alone.** Each covers for the other, so E3a fails only when both are dropped.
- **The guards on `connect`'s caller, its `catch`, the outbox count, `learnName` and `say`.** Each writes text or `hidden` into the page after a move. They are short, and they follow the same pattern as the tested guards.
- **Keeping the `click` or `submit` listener after `stop`.** It is on the element itself, so it keeps nothing alive. `handleEvent` returns while `this.run` is null, and a reconnect's `addEventListener` with the same `handleEvent` object adds no second listener. No test can tell it apart.
- **The `catch` `#closed` check in `Bridge.flush` alone** (`bridge.js:188`). It is defence in depth: a retry armed after `close()` fires into the first check (`:173`) and returns, so dropping only the `catch` check leaves one dead timer for `retryMs`, and nothing a test sees.
- **The `bridge === next` checks** (`:123`, `:125`, `:129`). They are kept verbatim. With the run guard they are defence in depth: after a stop `run.bridge` is null, and `update` returns early (`:67`), so no test can tell them apart.

## 5. Risks

- **The bridge rewrite touches timing-sensitive glue.** These paths are carried over verbatim; only the run guard, the reset and the two `#closed` checks are new:
  - the old bridge closed before the next opens;
  - the `bridge === next` checks;
  - the pairing retry with `made`;
  - two senders on one outbox.

  The three-commit migration (§3.5) keeps every existing bridge test green at each step.
- **Teardown has no real trigger.** It runs only in tests, and when the page goes away, where the browser does the same. E3a, E3b, E4 and E6 exercise the run guard and the reset; §4 lists the guards that only review covers.
- **Requests.** `elements/bridge.js` loads the same four modules that `bridge-page.js` loads today, so there is no new request.

## 6. Non-goals

- Any change to `bridge.js` beyond the two `#closed` checks (§3.1).
- Any change to `outbox.js`, `sim-port.js`, the decoder protocol, the ingest API, the import map or the pairing flow.
- Re-opening a granted port without a click after a move (`navigator.serial.getPorts()`).
- `pagehide`/`pageshow` handling on the bridge.
- A new look for the bridge screen.

## 7. Decided

1. **The element file.** `public/elements/bridge.js`, and `bridge-pages.test.js:35` changes (§4).
2. **`bridge.js`.** Two `#closed` checks in `flush`, with a Node test (§3.1).
