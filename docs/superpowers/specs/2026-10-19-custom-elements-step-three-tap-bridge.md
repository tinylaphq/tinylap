# Custom elements, step three: tap and bridge

Status: draft 3, after a review and a re-review (scratchpad `review-tap-spec.md`: I1–I7, M1–M8, B1–B5, m1–m6) and the product owner's rulings. It follows the step-one spec (`2026-10-16-custom-elements-step-one-design.md`), the step-two spec (`2026-10-18-custom-elements-step-two-board.md`) and AGENTS.md "Web platform first". Paths are relative to `apps/timing/` unless they say otherwise.

Product owner rulings recorded here:
- **Why this step.** Users gain little from it. It is for consistency and testability, and tap comes first.
- **Two roles for an element.** A custom element can:
  - enhance existing server HTML, with a managed lifecycle;
  - load behaviour into a page: an element whose presence has a side effect.
- **The bridge becomes `tl-bridge`.** It is mainly the second role: its job, the link from the serial port to the server, lasts as long as the element is on the page. It is partly the first: it fills the server-rendered state sections. It stays a thin wrapper, migrated in steps (§3.5).
- **Tap: a pending fill is cancelled** (§2.2, item 10).
- **The bridge's preview rows become server `<template>`s**, inside `tl-bridge` (§3.4).
- **One fix in `bridge.js`:** a closed `Bridge` no longer flushes (§3.1). This is the only change to that file.
- **The element file** is `public/elements/bridge.js`, so `bridge-pages.test.js:35` changes.

## 1. Goal and scope

| Element | Where | Job |
|---|---|---|
| `tl-tap` | `public/elements/tap.js` | Submits the tap forms inside it with fetch and shows the answer in the result bar. It replaces `public/tap.js`. |
| `tl-bridge` | `public/elements/bridge.js` | While it is on the page, it runs the page side of the bridge: the Connect buttons, pairing, the state sections, the preview, the earlier-passings note and the leave-page guard. It replaces `public/bridge-page.js`. The preview rows are cloned from server templates. |

**Unchanged:**
- the tap routes, the JSON answer, the 303 flow, the rate limit and the tap screen's look;
- `public/bridge.js` (`Bridge`, `sendOutbox`), except that a closed bridge no longer flushes (§3.1);
- `public/outbox.js` and `public/sim-port.js`;
- the import map and its CSP hash;
- the decoder protocol (`docs/timing.md`) and the ingest API.

## 2. `tl-tap`

### 2.1 What moves where

| Today in `public/tap.js` | Becomes |
|---|---|
| `NO_ANSWER` (`:11`) | `tl-tap`, unchanged |
| `LABEL` (`:12`) | `tl-tap`, without `error`. The alert template carries "Failed", as `views/tap.js:23` does. |
| `SIGNED_OUT` (`:10`) | server markup: a `<template>` (§2.4) |
| `bar`, `status`, `alertBox`, read once from `document` (`:13-15`) | looked up inside the element on each `show`, never once at module level or in the constructor |
| `content()`, which builds spans and a link (`:20-35`) | gone. `show` clones server templates and sets `textContent`. The signed-out `href` comes from the server: the script never sets an attribute. |
| `show()` (`:37-54`) | `tl-tap`, same steps, plus item 10 of §2.2 |
| `timers` (`:16`), the tile flash (`:60-65`) | `tl-tap`, unchanged. The tile is `form.querySelector('.tap-tile')`, from the submitted form, never from the element. |
| `latest` (`:17`), module-level | a field of the element |
| — | `frame`: a field of the element, the pending `requestAnimationFrame` id |
| one `submit` listener per form (`:56-57`) | one delegated `submit` listener on the element |
| the request (`:66-90`) | `tl-tap`, verbatim |

**Header comment.** Like `elements/board.js:5-18`, it states the element's contract. It keeps the reason from `tap.js:5-9`: never retried, never a normal submit, because the server may already have stored the tap. It also notes the one change (§2.2, item 10), and why disconnect doesn't abort a request (§2.3).

### 2.2 Kept exactly, with one change

1. **The request** (`tap.js:71-78`):
   - `method: 'POST'`, `accept: application/json`;
   - the body is `new URLSearchParams(Object.fromEntries(new FormData(form)))`, with no submitter. The tile buttons have no name;
   - `credentials: 'same-origin'`;
   - `redirect: 'manual'`. An expired session answers 303 to sign-in, which then goes across origins. `res.type === 'opaqueredirect'` then means signed out (`:79`).

   Unlike `tl-frame` (step one §3.3), tap must not follow the redirect. Tap has no fallback load, so a followed redirect would only end in a CSP-blocked fetch and the "No answer" text.
2. **Never resubmitted.**
   - `preventDefault()` on every tap-form submit (`:58`), as the handler's first statement, before any `await`.
   - A failure never retries, and never falls back to `form.submit()` or `location.assign`: the server may already have stored the tap (`:5-9`).
3. **The request counter.**
   - `const mine = ++this.latest`, and the answer is shown only if `mine === this.latest` (`:59`, `:90`).
   - Every tap sends its own request, and none is dropped or serialised, because each tap is a crossing.
4. **The outcome** (`:80-86`):
   - `res.ok` with a string `text`: `started`, `lap` or `again`, from `stored` and `lapMs`;
   - otherwise a string `error`: that text, as an error. This covers 422 and 429;
   - otherwise, or on any throw: `NO_ANSWER`.
5. **The alert on errors** (`:42-49`):
   - `#tap-alert` gets a new `<p class="status status-error" role="alert">`, which is a new node, so it is announced;
   - `#tap-result` is emptied;
   - `--driver` is left as it is: `show` gets an empty colour on errors (`:90`);
   - `data-state="error"`.
6. **The sticky result bar.** The bar stays the server's `.tap-bar` inside `.tap-screen`, its sticky containing block (`app.css:179-187`). On success:
   - `data-state` is set;
   - `--driver` comes from the tapped tile;
   - `#tap-alert` is emptied;
   - `#tap-result` is emptied first, then filled in the next animation frame, so identical text is announced again (`:51-53`).
7. **The signed-out message.** "Sign in again to keep tapping.", inside the alert's `.tap-text` (`:26-30`). "Sign in again" links to the current path and query.
8. **The tile flash.** The submitted form's tile gets `is-tapped` for 150 ms. Each tap restarts the timer (`:60-65`).
9. **Missing nodes.** If the bar, `#tap-result`, `#tap-alert` or a template that `show` needs is missing, `show` does nothing (`:38`).
10. **The one change: a pending fill is cancelled.** `show` starts with `cancelAnimationFrame(this.frame)`. The success path keeps the id: `this.frame = requestAnimationFrame(() => status.replaceChildren(…))`.
    - An error that lands before a success's frame now leaves `#tap-result` empty. Today the frame still fills it, under the alert (`tap.js:48`, `:53`).
    - Two successes within one frame end as today: the later one shows.

Before the module runs, a tap submits normally, as a POST and a 303 (`tap-pages.js:49-50`). This is unchanged: module scripts already run after parsing today.

### 2.3 Lifecycle and teardown

```
connectedCallback    → this.addEventListener('submit', this)
disconnectedCallback → this.removeEventListener('submit', this)
handleEvent(submit)  → form = event.target. It does nothing unless that is an
                       HTMLFormElement matching form.tap-form inside this element.
                       Otherwise preventDefault(), then the steps of §2.2.
```

- **Delegation.** One listener on the element, as `tl-frame` does (`packages/design/elements/frame.js:80`). There is no listener per form. A move adds the same `handleEvent` object again, and the browser keeps one.
- **What disconnect does not stop, and why:**
  - **A request in flight** is neither aborted nor ignored. An abort can't unsend a tap the server may have stored. The answer writes only into the element's own children, looked up on each `show`. That is harmless while detached, and correct after a move: it is still the latest tap.
  - **The flash timers and a pending frame.** Each one touches one of the element's own nodes and ends within 150 ms, or within one frame.
- **A swap hides the old element's pending answer.** The answer lands in the detached bar, and the new bar never shows it. The tap is still stored. Nothing in the app swaps `tl-tap`.
- **A move to another document** is neither supported nor tested. Tap lives in one document.
- **No `pagehide`/`pageshow` handling.** Tap holds no connection.
- **Define guard:** `if (!customElements.get('tl-tap')) customElements.define('tl-tap', TlTap)`, as `elements/board.js:120` does.

### 2.4 Markup (`views/tap.js:35-49`)

```html
<tl-tap>
<div class="tap-screen">
  <h1 class="visually-hidden">Tap</h1>
  <div class="tap-bar" data-state="idle"><div id="tap-alert"></div>
  <p class="tap-result" id="tap-result" role="status" aria-live="polite"><span class="tap-text">Tap a driver as their car crosses the line.</span></p></div>
  <div class="tap-grid"><form method="post" action="/personal/tap" class="tap-form">
    <input type="hidden" name="driver" value="…">
    <button type="submit" class="tap-tile" style="--driver: #e4572e">Ana</button>
  </form>…</div>
</div>
<template data-tap="result"><span class="tap-state"></span> <span class="tap-text"></span></template>
<template data-tap="alert"><p class="status status-error" role="alert"><span class="tap-state">Failed</span> <span class="tap-text"></span></p></template>
<template data-tap="signed-out"><a href="/personal/tap?driver=…&amp;result=started">Sign in again</a> to keep tapping.</template>
</tl-tap>
```

- **The wrapper.** `tl-tap` wraps the whole `.tap-screen`, as `tl-board` wraps `#board-live`.
  - `app.css` gets `tl-tap { display: block; }`, next to `tl-board` (`app.css:77`).
  - Neither `palace.css` 0.12 nor `app.css` has a `main > …` selector, so the wrapper changes nothing on screen.
- **The templates sit outside `.tap-screen`.** They don't become grid items, and they stay out of `#tap-alert`, where `.tap-bar:has(#tap-alert > *)` (`app.css:198`) would match them. Template content is inert, so `getByRole('alert')` doesn't see it.
- **Each template is one line in the view,** exactly as above, with no whitespace beyond the single space between the spans. A multi-line `html` literal would add text nodes. The server tests pin the strings (§4).
- **Composition.**
  - Success: clone `result`, set `.tap-state` to `LABEL[state]` and `.tap-text` to the text, and put the clone in `#tap-result`.
  - Error: clone `alert`, set its `.tap-text` to the text, and put the clone in `#tap-alert`.
  - Signed out: clone `alert`, then `.tap-text.replaceChildren(signed-out clone)`. No other text is shown.

  These clones match today's DOM node for node: `content()`'s `[label, ' ', words]` (`:34`), and the alert `show` builds (`:43-47`).
- **The signed-out `href`** is `request.url.pathname + request.url.search`, escaped by `html`, as the navbar's sign-in link already does (`views/layout.js:35`). It is the same string as `location.pathname + location.search` on every page with tiles:
  - a GET carries the page URL;
  - the 422 and 429 answers carry the POST URL, which is also what `location` shows.
- **The wrapper and templates are rendered with tiles only.** They are on the 200 `GET` and on the 422 and 429 answers (`tap-pages.js:42`). A page without drivers (`views/tap.js:50-54`) has no `tl-tap` and no script, as today.
- **The script:** `scripts: drivers.length ? ['elements/tap.js'] : []` (`views/tap.js:40`), and `public/tap.js` is deleted.
- **Comments.** The ones that name `tap.js` (`views/tap.js:5-6`, `tap-pages.js:5-7`) now name `tl-tap`.
- **Design check.** The look must not change. The implementer confirms it at 390×844 and 1280×800 with the `frontend-design` skill (CLAUDE.local.md).

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

  `finally` still enables the button (`:188`), since that is the run's own node, and the reset covers a clone;
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
- **Naming.** `public/elements/bridge.js` holds the element, and `public/bridge.js` the `Bridge` class. The header comment of each says which is which.
- **Comments.** `views/bridge.js:5-7` and `bridge-pages.js:5-6` name `tl-bridge`.
- **Design check.** No visual change. The implementer confirms it with the `frontend-design` skill (CLAUDE.local.md).

### 3.5 Migration, in three commits on one branch

The bridge's four existing suites stay green after each commit (§4).

1. **Templates, still in the page script.** The view gains the two row templates, and `update()` clones them. Nothing else changes.
   - Tests: the template check in `bridge-pages.test.js`, and E5.
2. **The wrapper, starting what the page started.**
   - `bridge-page.js` moves into `elements/bridge.js` as `TlBridge`. The module state becomes the run, and the listeners are delegated.
   - The view wraps `#bridge` and loads `elements/bridge.js`.
   - `disconnectedCallback` is still empty.
   - Tests: `bridge-pages.test.js:35` and the wrapper check, the assembled check, and E1.
3. **Teardown.**
   - `stop()`, the reset in `start()`, the run guard, and the two `#closed` checks in `bridge.js` (§3.1).
   - Tests: the new `bridge.test.js` case, E2, E3a, E3b, E4 and E6.

## 4. Tests

**Must pass unchanged:**
- `test/browser/tap.test.js`, all four tests:
  - in place, with no load (`:27-41`);
  - the alert, one POST and no navigation on a network failure (`:43-61`);
  - a stale answer doesn't overwrite the latest (`:63-96`);
  - the signed-out link (`:98-111`).
- `test/server/tap-pages.test.js`, every test but `:32`, `:55` and `:72`.
- **The bridge's tests:**
  - `test/bridge.test.js`, its seven tests (one test is added), and `test/outbox.test.js`;
  - `test/browser/bridge.test.js`, all seven tests;
  - `test/server/bridge-pages.test.js:19-34`.
- `test/browser/no-js.test.js`, including `:92-125` (no tap again on Back and Forward) and `:127-134` (the bridge's links).
- `test/browser/navigation.test.js`, `test/server/csp.test.js`.
- `test/server/frames.test.js:46-48`. The no-import rule already covers `public/elements/`.

**Changed tests:**

| File | Change |
|---|---|
| `test/server/tap-pages.test.js` | - `:32` expects `/public/elements/tap.js`.<br>- `:55` tests the bar only: `doesNotMatch(bar, /tap-state/)` with `bar = /<div class="tap-bar"[\s\S]*?<\/p><\/div>/.exec(body)[0]`. `doesNotMatch(body, /<script>alert/)` stays on the whole body.<br>- `:72` is anchored to the slot: `/<div id="tap-alert"><p class="status status-error" role="alert">/`.<br>- New: `<tl-tap>\s*<div class="tap-screen">`, and the three templates as exact strings from §2.4, with no `\s*`.<br>- New: on a club, a GET of `/clubs/<id>/tap?driver=<id>&result=started` has `href="/clubs/<id>/tap?driver=<id>&amp;result=started"` in the signed-out template.<br>- The 422 page with tiles has the wrapper and the script. The page without drivers has neither. |
| `test/server/bridge-pages.test.js` | - `:35` expects `/public/elements/bridge.js` (owner's ruling).<br>- New: `<tl-bridge>\s*<div id="bridge"`, and both row templates as exact strings from §3.4, right after `<ol class="board-laps" data-bridge-preview></ol>`. |
| `test/browser/assembled.test.js:39-61` | - On tap: `/v/<sha>/public/elements/tap.js` loads, and `tl-tap` is defined.<br>- On the bridge: `/v/<sha>/public/elements/bridge.js` loads and `tl-bridge` is defined. The import map check (`:55-61`) stays. |

**New: `test/browser/tap-element.test.js`.** It has its own app, `startTiming({ clock })` with a fixed `clock = { now: Date.now() }`, and two drivers, Ana and Ben, in different colours. `tap.test.js` stays unchanged. Each case counts POSTs with `page.on('request')`, as `tap.test.js:49` does.
- **T1 Disconnect tears down.** Call `tl-tap.remove()`, then dispatch `new SubmitEvent('submit', { bubbles: true, cancelable: true })` on a detached form. (`requestSubmit` does nothing on a detached form.) No POST.
- **T2 No double listeners after a move.** `document.querySelector('main').append(tlTap)`, then one click: exactly one POST, and one result.
- **T3 A swap.** `tlTap.replaceWith(tlTap.cloneNode(true))`, then one click on the new tile: exactly one POST, with the result in the new bar.
- **T4 An answer across a move.** Hold the answer (`page.route` and `route.fetch()`, as `tap.test.js:74-82` does). Move the element, then release: the result shows in the bar.
- **T5 The same text twice is announced again.**
  - Set up: the personal space id comes from `/auth/me` (`board-elements.test.js:38`). One `app.form` tap for Ana, and then two clicks on Ana, at the same `clock.now`: both clicks answer "Too fast, tap again." (`server/engine.js:152`). `clock.now` doesn't move between the `app.form` and the clicks.
  - A `MutationObserver` on `#tap-result` records `childNodes.length` in each callback. After the first "Again" fill, some callback sees `0` before a callback sees the second fill.
  - Callbacks run at the end of a task, so a clear and a fill in the same task show up as filled.
- **T6 The server's error text.**
  - Load a fresh `GET /personal/tap`, idle and with no `style` on the bar. Register the route after `goto`, as `tap.test.js:51` does.
  - The route answers `{ status: 429, contentType: 'application/json', body: '{"error":"Try again in 5 seconds."}' }`.
  - Expect: the alert shows that text, `data-state="error"`, `bar.style.getPropertyValue('--driver') === ''`, and `#tap-result` is empty.
- **T7 The colour follows the tapped tile.** Tap Ben: the bar's `--driver` is Ben's, not Ana's.
- **T8 An error cancels a pending fill.**
  1. `page.clock.install()` before `goto`, so frames run only when the test says.
  2. Route the first POST to `{"stored":true,"lapMs":null,"text":"Ana: started"}`, and the second to a 429 with `{"error":"…"}`.
  3. Click once, then wait for `.tap-bar[data-state="started"]`. The fill is now pending.
  4. Click again, then wait for the alert.
  5. `page.clock.runFor(100)`.
  6. `#tap-result` has no child nodes, and `data-state="error"`.
- **T9 The flash.**
  1. `page.clock.install()`, then tap Ben: Ben's tile has `is-tapped`, and Ana's doesn't.
  2. `runFor(149)`: it is still there. `runFor(2)`: it is gone.
  3. Tap twice, 100 ms apart: it is still there 140 ms after the second tap.

**New: `test/browser/bridge-element.test.js`.** It uses `?simulate=fast` (laps every 2 s).
- **Counting ports.** An init script wraps `WritableStream` and `ReadableStream`, as `bridge.test.js:99-108` does. Only `sim-port.js` constructs them with a JS sink or source (`sim-port.js:19-20`).
  - `window.__opened` counts **opened** ports. A port counts the first time its `WritableStream` sink gets a write, and `Bridge.start` always writes the hello (`bridge.js:78`).
  - `window.__cancelled` counts readable sources whose `cancel` ran.
  - `window.__writes` keeps a timestamp for each sink write.

  Every port assertion is `__cancelled === __opened`.
- **E1 Connect starts the link.**
  - Before any click: `tl-bridge` is defined, the Connect section is shown, and `__opened === 0`.
  - One click: `__opened === 1`, and the pairing form shows.
  - **Earlier passings.**
    1. Pair a decoder through `app.api`.
    2. After the first load, with the import map in place, seed the outbox through its module: `await (await import('/public/outbox.js')).openOutbox()`, then `.add(passing)`, in `page.evaluate`. That keeps the key path (`outbox.js:48`) out of the test.
    3. Reload. The note says "1 passing from earlier is waiting", and exactly one POST goes to `/decoders/<id>/passings`.
- **E2 A removal tears everything down.**
  - Pair and wait for "Forwarding from …". A cancelable `beforeunload` dispatched on `window` is now `defaultPrevented`.
  - Route `/decoders/*/passings` to `abort()` and wait for the "Offline" status, so the 5 s retry is armed. Then call `tl-bridge.remove()`.
  - Expect:
    - `__cancelled === __opened`: the port is closed;
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
  4. Expect: `__cancelled === __opened === 1`, no state section shown, and no entry in `__writes` after the cancel.

  Only the guard after `next.start()` closes this bridge, because `stop()`'s `close()` ran before the reader existed.
- **E4 No double start on a move, from a failed pairing.**
  1. Use the dropped `%TLPAIR` of `bridge.test.js:99-108`: connect, Pair, and wait for the "didn't answer" alert. The name field is read-only, and `made` is held.
  2. `document.querySelector('main .container').append(tlBridge)`, which stops and starts it. Expect:
     - the Connect section shows;
     - no alert is visible;
     - the name field is editable, and the Pair button is enabled;
     - `__cancelled === __opened` for the first port.
  3. One click opens exactly one more port. One Pair sends exactly one `POST /workspaces/<id>/decoders`, and the store gains exactly one decoder. The old run's decoder stays orphaned, as §3.3 says.
  4. Repeat steps 1–3 with `tlBridge.replaceWith(tlBridge.cloneNode(true))` in place of the move.
- **E5 The lap row's template.** Wait for a row `li > .bridge-code + .num` whose text matches `/\d+\.\d{3}/`. The first-pass row is already covered by `bridge.test.js:85`.
- **E6 A pairing answer across a move.**
  1. On the pairing form, `page.route('**/workspaces/*/decoders', …)` holds the answer.
  2. Press Pair, move the element, then release the answer.
  3. Expect: the Connect section shows, the name field is editable, no alert is visible, and exactly one decoder is added to the store, orphaned as §3.3 says.

**New, in `test/bridge.test.js`: a closed bridge sends nothing more.** The file's seven tests stay unchanged.
- Set up: a `Bridge` with a `memoryOutbox` holding one passing, `retryMs: 20`, and a `post` that counts its calls, waits on a gate and then throws an `Error` with no status (offline).
- Call `flush()`, then `close()` while the post is held, then release the gate.
- After 100 ms: `post` was called once, and a further `flush()` calls it no more.
- Without the §3.1 checks, the retry fires every 20 ms and the count grows.

**Mutation targets.** Each change must fail at least one test.

| Mutation | Caught by |
|---|---|
| tap: `redirect: 'manual'` → `'follow'` | signed-out (`tap.test.js:98-111`) |
| tap: drop `preventDefault()`, or call it after an `await` | in place (`tap.test.js:38`, `loads === 0`) |
| tap: fall back to `form.submit()` in `catch` | failed request (`tap.test.js:57-58`) |
| tap: drop `mine === latest` | rapid taps (`tap.test.js:94`) |
| tap: drop the clear, or fill in the same task as the clear | T5 |
| tap: drop `cancelAnimationFrame` in `show` | T8 |
| tap: drop `removeEventListener` in `disconnectedCallback` | T1 |
| tap: a listener per form, never removed | T2 |
| tap: the bar, result or alert looked up once (module level or constructor) | T3 |
| tap: abort the request on disconnect (`AbortController`) | T4 |
| tap: a disconnect bumps `latest`, or sets a flag that is never cleared | T4 |
| tap: `error` text ignored | T6 |
| tap: colour set on errors, or not on success | T6, T7 |
| tap: the tile from the element, not the form | T7, T9 |
| tap: drop the flash, or don't restart its timer | T9 |
| tap: the signed-out `href` without the query | `tap-pages.test.js`, club case |
| tap: a template with extra whitespace or a wrong class | `tap-pages.test.js`, exact strings |
| bridge: drop the `#closed` checks in `flush` | the new `bridge.test.js` case, E2 |
| bridge: drop `run.bridge.close()` in `stop` | E2 (`__cancelled`, passings) |
| bridge: keep the `click`, `submit` or `beforeunload` listener after `stop` | E2 |
| bridge: `beforeunload` reading a stale bridge, not `this.run?.bridge` | E2 |
| bridge: drop the run guard after `pickPort` | E3a |
| bridge: drop the run guard after `next.start()` | E3b |
| bridge: drop the reset in `start()` | E4 |
| bridge: start in the constructor, or once per element | E4 (nothing starts after the move) |
| bridge: per-button arrow listeners, as today's `:162` | E4 (two ports from one click) |
| bridge: drop the pairing guard | E6 |
| bridge: a row template with a wrong class, or no lap template | E5, `bridge-pages.test.js` |

**Covered by review only:**
- **The guard after `openOutbox`.** The guard after `pickPort` returns first in E3a. A test would have to delay `indexedDB.open` from an init script to reach it.
- **The guards on `connect`'s caller, its `catch`, the outbox count, `learnName` and `say`.** Each writes text or `hidden` into the page after a move. They are short, and they follow the same pattern as the tested guards.
- **The `bridge === next` checks** (`:123`, `:125`, `:129`). They are kept verbatim. With the run guard they are defence in depth: after a stop `run.bridge` is null, and `update` returns early (`:67`), so no test can tell them apart.

## 5. Risks

- **Tap is the timing path when there is no decoder.** A bug drops laps silently, which is why the §4 mutation table is part of the definition of done.
- **The tap templates must match the old DOM.** `.tap-state`, `.tap-text` and `role="alert"` are styled (`app.css:190-198`). The exact-string server tests and the `frontend-design` check guard them.
- **The pending-frame fix (§2.2, item 10)** is tap's only behaviour change. T8 guards it.
- **No abort on disconnect** is intended (§2.3). Adding an `AbortController` changes nothing on the server, but it would hide the latest result after a move (T4).
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
- `pagehide`/`pageshow` handling on tap or on the bridge.
- A queue, a retry or a debounce for taps.
- A new look for the tap or bridge screens.

## 7. Decided

1. **The element file.** `public/elements/bridge.js`, and `bridge-pages.test.js:35` changes (§4).
2. **`bridge.js`.** Two `#closed` checks in `flush`, with a Node test (§3.1).
