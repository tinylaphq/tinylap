# Tap and bridge as custom elements: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans (native). Steps use checkbox (`- [ ]`) syntax.

**Goal:** The last two page scripts of the timing app become light-DOM elements around the HTML the server already renders:
- `tl-tap` submits the tap forms in place;
- `tl-bridge` runs the page side of the USB bridge while it is on the page.

Users see no change, except one fix: a tap error no longer leaves a stale result under the alert. Without JavaScript both pages work as today.

**Architecture:**
- Both elements are timing-app elements, in `apps/timing/public/elements/`: `tap.js` replaces `public/tap.js`, and `bridge.js` replaces `public/bridge-page.js`.
- Neither element builds markup. They clone server `<template>`s:
  - tap's result, alert and signed-out pieces;
  - the bridge's two preview rows.
- `tl-bridge` keeps the page's state in one **run** object per start. Every async path writes to the page only while its run is current.
- `Bridge`, `sendOutbox`, `outbox.js`, `sim-port.js`, the import map and the decoder protocol stay as they are. The one exception is two `#closed` checks in `Bridge.flush`.

**Tech stack:** plain ES modules, checked by tsc `--checkJs` and eslint. Tests use node:test and playwright-core browser tests.

**Spec:** `docs/superpowers/specs/2026-10-19-custom-elements-step-three-tap-bridge.md` (draft 3, committed in b385b36). The five test corrections of "Re-review 2" are in the working tree, uncommitted (see "Before Task 1"). The spec is the authority. Section and test ids below (§2.2, T1–T9, E1–E6) are the spec's.

## Global constraints

- **Logs:** `$LOGS` is a folder for test logs, outside the repository: the implementer's own scratch folder, or `/tmp/tinylap-step3`. Create it first (`mkdir -p "$LOGS"`).

- **AGENTS.md "Web platform first":**
  - light DOM, `tl-*` names, start in `connectedCallback`, stop in `disconnectedCallback`;
  - no markup built in script: elements clone server templates and write text and attributes only;
  - each element file defines its element only when the name is free: `if (!customElements.get('tl-x')) customElements.define('tl-x', TlX);`;
  - server code never imports `public/elements/*`. `test/server/frames.test.js:46-48` enforces this.
- **UI and markup use the `frontend-design` skill.** This covers the templates, the wrappers, the `display: block` rules, and the visual check that nothing moved, at 390×844 and 1280×800. The look is palace-ui plus `@tinylap/design`: palace tokens only, and no new visual language.
- **Licences:** every new `apps/timing` file starts with the SPDX header of its neighbours:

  ```
  // SPDX-FileCopyrightText: 2026 The TinyLap contributors
  //
  // SPDX-License-Identifier: AGPL-3.0-or-later
  ```

  REUSE lint must pass.
- **Commits:**
  - conventional, lower case, signed off: `git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "…"`;
  - no `Co-Authored-By`, no "Generated with", and no mention of an AI tool in commits or in the PR.
- **Logs.** Every test run writes its whole output to a file in the session scratchpad, `$LOGS/`, then prints the exit code and the tail. Create the directory once: `mkdir -p $LOGS`. Read the log file when a run fails; don't rerun only to grep.
- **Before each commit, the checks.** Run all four from the repo root, each green:

  ```sh
  pnpm turbo run test lint typecheck --filter=@tinylap/timing-app --filter=@tinylap/timing --filter=@tinylap/design > $LOGS/checks.log 2>&1; echo "exit $?"; tail -n 30 $LOGS/checks.log
  pnpm --filter @tinylap/timing-app test:browser > $LOGS/browser.log 2>&1; echo "exit $?"; tail -n 40 $LOGS/browser.log
  pnpm test:e2e > $LOGS/e2e.log 2>&1; echo "exit $?"; tail -n 30 $LOGS/e2e.log
  pipx run reuse lint > $LOGS/reuse.log 2>&1; echo "exit $?"; tail -n 5 $LOGS/reuse.log
  ```

  `test:browser` already runs with `--test-concurrency=1 --test-timeout=60000` (`apps/timing/package.json:16`).
- **Single test files**, from the repo root:
  - one browser file:

    ```sh
    pnpm --filter @tinylap/timing-app exec node --disable-warning=ExperimentalWarning --test --test-concurrency=1 --test-timeout=60000 test/browser/<file>.test.js > $LOGS/<file>.log 2>&1; echo "exit $?"; tail -n 40 $LOGS/<file>.log
    ```

  - one Node or server file:

    ```sh
    pnpm --filter @tinylap/timing-app exec node --disable-warning=ExperimentalWarning --test test/<path>.test.js > $LOGS/<name>.log 2>&1; echo "exit $?"; tail -n 30 $LOGS/<name>.log
    ```
- **Branch:** `feat/tap-bridge-elements` (checked out). Never push to or merge into `main`.

## Review focus

1. **Tap never resubmits.**
   - `preventDefault()` is the handler's first statement.
   - No `form.submit()`, `location.assign` or retry on any failure.
   - `redirect: 'manual'`, and `opaqueredirect` means signed out.
2. **The tap request counter and the bar.** `mine === latest`. The result is cleared and then filled in the next frame. `cancelAnimationFrame` is the only behaviour change. The colour is taken from the submitted form's tile, and never set on errors.
3. **The templates match today's DOM node for node:** one line each, with no stray whitespace, and placed outside `.tap-screen`, `#tap-alert` and the preview `<ol>`.
4. **`tl-bridge` starts exactly what `bridge-page.js:160-195` started,** in the same order, and keeps every behaviour of spec §3.3, items 1–8, with the file:line references there.
5. **Teardown is complete.**
   - The port is closed.
   - No hello or retry timer is left.
   - A closed `Bridge` doesn't flush again (`#closed`).
   - No `click`, `submit` or `beforeunload` listener remains.
   - `beforeunload` reads `this.run?.bridge`.
6. **The run guard and the reset.**
   - Every write after an `await` checks `run === this.run`, at the points spec §3.3 lists.
   - `start()` resets the error box, the note, the live region, `readOnly` and `disabled`.
   - `start()` returns at once while a run is set.
7. **Unchanged:** the import map and its CSP hash, `outbox.js`, `sim-port.js`, the protocol, and `bridge.js` apart from the two checks.
8. **No JavaScript, and no visual change** on either page.

---

### Before Task 1: commit the spec's last corrections

- [ ] `git diff --stat` shows only `docs/superpowers/specs/2026-10-19-custom-elements-step-three-tap-bridge.md` (and this plan, untracked).
- [ ] `git add docs/superpowers/specs/2026-10-19-custom-elements-step-three-tap-bridge.md docs/superpowers/plans/2026-10-19-tap-bridge-elements.md`
- [ ] **Commit** `docs: step three spec, last test corrections, and its plan`.

### Task 1: `tl-tap`, with its templates and T1–T9

**Files:**
- Create: `apps/timing/public/elements/tap.js`, `apps/timing/test/browser/tap-element.test.js`
- Modify:
  - `apps/timing/server/views/tap.js` (`:5-6`, `:35-49`);
  - `apps/timing/server/tap-pages.js:5-7` (comment);
  - `apps/timing/public/app.css` (`tl-tap`, next to `tl-board` at `:77`);
  - `apps/timing/test/server/tap-pages.test.js` (`:32`, `:55`, `:72`, new cases)
- Delete: `apps/timing/public/tap.js`
- Unchanged and must pass: `apps/timing/test/browser/tap.test.js`, `no-js.test.js:92-125`

- [ ] **Failing server tests** in `test/server/tap-pages.test.js`:
  - `:32` becomes `assert.match(body, /<script type="module" src="\/public\/elements\/tap.js"><\/script>/);`
  - `:55`: `const bar = /<div class="tap-bar"[\s\S]*?<\/p><\/div>/.exec(body)[0]; assert.doesNotMatch(bar, /tap-state/, query); assert.doesNotMatch(body, /<script>alert/, query);`
  - `:72`: `assert.match(await bad.text(), /<div id="tap-alert"><p class="status status-error" role="alert">/);`
  - **new `test('the tap page wraps its screen in tl-tap, with the three templates', …)`.** On `GET ${base}/tap`:
    - `/<tl-tap>\s*<div class="tap-screen">/`;
    - each template as an exact string, escaped for the regex, with no `\s*`:
      - `<template data-tap="result"><span class="tap-state"></span> <span class="tap-text"></span></template>`;
      - `<template data-tap="alert"><p class="status status-error" role="alert"><span class="tap-state">Failed</span> <span class="tap-text"></span></p></template>`;
    - on `GET ${base}/tap?driver=${ana.id}&result=started`, the string `<template data-tap="signed-out"><a href="${base}/tap?driver=${ana.id}&amp;result=started">Sign in again</a> to keep tapping.</template>`. `base` is the club path here (`:21`).
  - **new: the 422 page with tiles** (`app.form(member, `${base}/tap`, { driver: 'nobody' })`) has `<tl-tap>` and `/public/elements/tap.js`. **The page without drivers** (`:99-105`) has neither.
- [ ] **Run; expect FAIL:**

  ```sh
  pnpm --filter @tinylap/timing-app exec node --disable-warning=ExperimentalWarning --test test/server/tap-pages.test.js > $LOGS/tap-pages.log 2>&1; echo "exit $?"; tail -n 30 $LOGS/tap-pages.log
  ```

- [ ] **Failing browser tests: `test/browser/tap-element.test.js`,** with T1–T9 from spec §4.
  - **Set-up:** `const clock = { now: Date.now() }`, then `app = await startTiming({ clock })`, `member = await app.login(await app.signUp('Ana'))`. Add two drivers, `Ana` and `Ben`, with `app.form(member, '/personal/drivers', { name })`; colours are handed out in order (`server/operations.js:56`), so they differ. `personal` comes from `/auth/me`. `[ana, ben] = app.store.drivers(personal)`.
  - **A moving clock:** every test except T5 starts with `clock.now += 1000`, so its first tap on a driver is a fresh lap or start, whatever ran before.
  - **Counting:** each test counts POSTs with `page.on('request', (r) => { if (r.method() === 'POST') posts += 1; })` and asserts `errors` is `[]`.
  - **T1:**

    ```js
    page.evaluate(() => {
      const el = document.querySelector('tl-tap');
      el.remove();
      el.querySelector('form').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    })
    ```

    Then `waitForTimeout(300)`: `posts === 0`.
  - **T2:** `document.querySelector('main').append(document.querySelector('tl-tap'))`, then one click on Ana: `posts === 1`, and the status shows "Ana: …".
  - **T3:** `el.replaceWith(el.cloneNode(true))`, then one click on Ana: `posts === 1`, and the result is in the (new) bar.
  - **T4:** hold the answer with `page.route('**/personal/tap', …)` and `route.fetch()`, as `tap.test.js:74-82` does. Move the element as in T2, release: the status shows the result.
  - **T5:**
    - `await app.form(member, '/personal/tap', { driver: ana.id })` at the current `clock.now`, then two clicks on Ana without moving `clock`;
    - before the clicks, install an observer:

      ```js
      page.evaluate(() => {
        window.__lengths = [];
        new MutationObserver(() => window.__lengths.push(document.querySelector('#tap-result').childNodes.length)).observe(document.querySelector('#tap-result'), { childList: true });
      })
      ```

    - for each click, create the response promise first (`const answer = page.waitForResponse((r) => r.request().method() === 'POST')`), click, then `await answer`, then for both mutations of that answer: `page.waitForFunction((n) => window.__lengths.length >= n, 2)` after the first click, and `… 4` after the second. The text is already "Too fast, tap again." after the first click, so waiting on the text would return at once;
    - only then: in `__lengths`, after the first non-zero entry, a `0` comes before the next non-zero one.
  - **T6:** `goto('/personal/tap')`, then `page.route('**/personal/tap', (r) => r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"Try again in 5 seconds."}' }))`, then click Ana. The alert has the text, `.tap-bar` has `data-state="error"`, `bar.style.getPropertyValue('--driver') === ''`, and `#tap-result` has no child nodes.
  - **T7:** click Ben. The bar's `--driver` equals Ben's tile's `--driver` and differs from Ana's.
  - **T8:**
    1. `page.clock.install()` before `goto`.
    2. After `goto` (the pattern also matches the page's own GET), a route that answers the first POST with `{ status: 200, contentType: 'application/json', body: '{"stored":true,"lapMs":null,"text":"Ana: started"}' }` and the second with a 429 as in T6.
    3. Click Ana and wait for `.tap-bar[data-state="started"]`.
    4. Click Ana and wait for `getByRole('alert')`.
    5. `page.clock.runFor(100)`.
    6. `#tap-result` has `childNodes.length === 0`, and `data-state="error"`.
  - **T9:**
    1. `page.clock.install()` before `goto`. Click Ben: Ben's tile has `is-tapped`, and Ana's doesn't.
    2. `runFor(149)`: still there. `runFor(2)`: gone.
    3. Click Ben, `runFor(100)`, click Ben, `runFor(140)`: still there.
- [ ] **Run; expect FAIL** (no `tl-tap` yet):

  ```sh
  pnpm --filter @tinylap/timing-app exec node --disable-warning=ExperimentalWarning --test --test-concurrency=1 --test-timeout=60000 test/browser/tap-element.test.js > $LOGS/tap-element.log 2>&1; echo "exit $?"; tail -n 40 $LOGS/tap-element.log
  ```

- [ ] **The view** (`views/tap.js`), using the `frontend-design` skill.
  - **The tiles branch** becomes `html`<tl-tap>\n<div class="tap-screen">…unchanged…</div>\n${tapTemplates(request)}</tl-tap>``, with:

    ```js
    /** The pieces tl-tap clones; one line each, so they add no text nodes. */
    const tapTemplates = (request) => html`<template data-tap="result"><span class="tap-state"></span> <span class="tap-text"></span></template>
    <template data-tap="alert"><p class="status status-error" role="alert"><span class="tap-state">Failed</span> <span class="tap-text"></span></p></template>
    <template data-tap="signed-out"><a href="${request.url.pathname + request.url.search}">Sign in again</a> to keep tapping.</template>
    `;
    ```

  - `scripts: drivers.length ? ['elements/tap.js'] : []`.
  - The header comment (`:5-6`) says that `tl-tap` submits them in place. The same goes for `tap-pages.js:5-7` ("asked for JSON (tl-tap)").
- [ ] **`app.css`:** `tl-tap { display: block; }`, under `tl-board { display: block; }` (`:77`).
- [ ] **`public/elements/tap.js`** (AGPL header).
  - **Header comment:** what `<tl-tap>` does, and the reason from `public/tap.js:5-9` (never retried, never a normal submit: the server may have stored the tap already). Also the one change (a pending fill is cancelled) and why a disconnect doesn't abort (the request can't be unsent, and after a move its answer is still the latest).
  - **Body:**

    ```js
    const NO_ANSWER = 'No answer from the server. Check the board before tapping again.';
    const LABEL = { started: 'Started', lap: 'Lap', again: 'Again' };

    class TlTap extends HTMLElement {
      latest = 0;
      frame = 0;
      timers = new WeakMap();

      connectedCallback() { this.addEventListener('submit', this); }
      disconnectedCallback() { this.removeEventListener('submit', this); }

      /** @param {string} name */
      template(name) { return /** @type {HTMLTemplateElement | null} */ (this.querySelector(`template[data-tap="${name}"]`)); }

      show(state, text, colour, signedOut = false) {
        cancelAnimationFrame(this.frame);
        const bar = /** @type {HTMLElement | null} */ (this.querySelector('.tap-bar'));
        const status = this.querySelector('#tap-result');
        const alertBox = this.querySelector('#tap-alert');
        const alert = this.template('alert');
        const result = this.template('result');
        const out = this.template('signed-out');
        const ready = state === 'error' ? alert && (!signedOut || out) : result;
        if (!bar || !status || !alertBox || !ready) return;
        bar.dataset.state = state;
        if (colour) bar.style.setProperty('--driver', colour);
        alertBox.replaceChildren();
        if (state === 'error') {
          const box = /** @type {DocumentFragment} */ (alert.content.cloneNode(true));
          const words = box.querySelector('.tap-text');
          if (signedOut) words.replaceChildren(out.content.cloneNode(true));
          else words.textContent = text;
          alertBox.append(box);
          status.replaceChildren();
          return;
        }
        // Cleared first, so that identical text is announced again.
        status.replaceChildren();
        this.frame = requestAnimationFrame(() => {
          const line = /** @type {DocumentFragment} */ (result.content.cloneNode(true));
          line.querySelector('.tap-state').textContent = LABEL[state];
          line.querySelector('.tap-text').textContent = text;
          status.replaceChildren(line);
        });
      }

      /** @param {Event} event */
      handleEvent(event) {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || !form.matches('form.tap-form') || !this.contains(form)) return;
        event.preventDefault();
        void this.tap(form);
      }

      /** @param {HTMLFormElement} form */
      async tap(form) {
        // public/tap.js:59-90, verbatim, with this.latest, this.timers and this.show.
      }
    }

    if (!customElements.get('tl-tap')) customElements.define('tl-tap', TlTap);
    ```

  - **`tap(form)`:** copy `public/tap.js:59-90` exactly:
    - the tile from `form.querySelector('.tap-tile')`;
    - the 150 ms flash;
    - the fetch options;
    - the outcome;
    - `if (mine === this.latest) this.show(state, text, state === 'error' ? '' : colour, signedOut);`.
- [ ] **Delete `public/tap.js`:** `git rm apps/timing/public/tap.js`.
- [ ] **Run both files again; expect PASS.** Then run `tap.test.js` alone; all four tests pass unchanged:

  ```sh
  pnpm --filter @tinylap/timing-app exec node --disable-warning=ExperimentalWarning --test --test-concurrency=1 --test-timeout=60000 test/browser/tap.test.js > $LOGS/tap.log 2>&1; echo "exit $?"; tail -n 40 $LOGS/tap.log
  ```

- [ ] **Mutation check, by hand:** every `tap:` row of spec §4's mutation table, 17 rows, reverting each change afterwards. Each must fail the test the table names:
  - `'follow'`;
  - `preventDefault` dropped, or moved after an `await`;
  - `form.submit()` in the `catch`;
  - `mine === latest` dropped;
  - the clear dropped, or the fill in the same task;
  - `cancelAnimationFrame` dropped;
  - `removeEventListener` dropped;
  - a listener per form;
  - the nodes looked up once;
  - an `AbortController`;
  - `latest` bumped on disconnect;
  - the `error` text ignored;
  - the colour set on errors, or not on success;
  - the tile from `this`;
  - the flash dropped or not restarted;
  - the `href` without its query;
  - template whitespace or a wrong class.

  Record each result (mutation → failing test) in the commit body.
- [ ] **Visual check** with the `frontend-design` skill, at 390×844 and 1280×800 on `main` and on this branch: the idle, result, error and signed-out bars look the same.
- [ ] **Run the checks.**
- [ ] **Commit** `feat(timing-app): tl-tap submits taps in place from server templates`.

### Task 2: a closed `Bridge` sends nothing more

**Files:**
- Modify: `apps/timing/public/bridge.js` (`flush`, `:172-198`), `apps/timing/test/bridge.test.js` (one new test)
- Unchanged and must pass: the seven existing tests in `test/bridge.test.js`

- [ ] **Failing test**, at the end of `test/bridge.test.js`:

  ```js
  test('a closed bridge sends nothing more, and arms no retry', async () => {
    const { port } = fakePort(null);
    const outbox = memoryOutbox();
    await outbox.add({ decoder: 'd1', boot: 'b00tb00t', transponder: '0A', t: 1000 });
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const bridge = new Bridge({ port, outbox, retryMs: 20, post: async () => { calls += 1; await gate; throw new Error('offline'); } });
    const flushing = bridge.flush();
    await until(() => calls === 1);
    await bridge.close();
    release();
    await flushing;
    await new Promise((done) => setTimeout(done, 100));
    assert.equal(calls, 1, 'no retry after close');
    await bridge.flush();
    assert.equal(calls, 1, 'no flush after close');
  });
  ```

- [ ] **Run; expect FAIL** (the 20 ms retry grows `calls`):

  ```sh
  pnpm --filter @tinylap/timing-app exec node --disable-warning=ExperimentalWarning --test test/bridge.test.js > $LOGS/bridge-node.log 2>&1; echo "exit $?"; tail -n 30 $LOGS/bridge-node.log
  ```

- [ ] **Implement** in `flush()`:
  - first line: `if (this.#closed) return Promise.resolve();`;
  - in the `catch` (`:185-188`), arm the retry only when open: `if (!this.#closed) this.#retryTimer = setTimeout(() => void this.flush(), this.retryMs);`.

  Nothing else in the file changes. Its header comment (`bridge.js:5-9`) already describes the `Bridge` class, so it stays as it is. The early return also covers `#again` (`:192-194`) and the lap path (`:136`).
- [ ] **Run; expect PASS**, all eight tests.
- [ ] **Run the checks.**
- [ ] **Commit** `fix(timing-app): a closed bridge neither flushes nor retries`.

### Task 3: the bridge preview rows from server templates (E5)

**Files:**
- Create: `apps/timing/test/browser/bridge-element.test.js` (E5 now; E1–E4 and E6 in Tasks 4 and 5)
- Modify:
  - `apps/timing/server/views/bridge.js:64-67`;
  - `apps/timing/public/bridge-page.js:77-86` (still the page script);
  - `apps/timing/test/server/bridge-pages.test.js` (new test)
- Unchanged and must pass: `test/browser/bridge.test.js`, all seven tests (`:85-86` read the first-pass rows)

- [ ] **Failing server test** `test('the preview rows are server templates, right after the list', …)`, matching this exact string, escaped for the regex:

  `<ol class="board-laps" data-bridge-preview></ol>\n      <template data-bridge-row="first"><li><span class="bridge-code"></span><span class="bridge-first">first pass</span></li></template>\n      <template data-bridge-row="lap"><li><span class="bridge-code"></span><span class="num"></span></li></template>`

  The indentation follows `views/bridge.js:66`. Use `\s*` between the tags if the view's indentation differs, but never inside a template.
- [ ] **Failing browser test,** `bridge-element.test.js`, **E5.**
  - Set-up as in `test/browser/bridge.test.js:10-24`, plus `toPairing` copied from `:62-70`.
  - Pair as `Gate`, then `page.locator('[data-bridge-preview] li', { has: page.locator('.bridge-code + .num') }).first().waitFor({ timeout: 20_000 })`. Its `.num` text matches `/^\d+\.\d{3}$/`.

  Both tests fail until the templates exist. E5 already passes on today's markup, so for this step add a template-presence assertion to it:

  ```js
  assert.equal(await page.locator('template[data-bridge-row]').count(), 2)
  ```

- [ ] **Run both; expect FAIL:**

  ```sh
  pnpm --filter @tinylap/timing-app exec node --disable-warning=ExperimentalWarning --test test/server/bridge-pages.test.js > $LOGS/bridge-pages.log 2>&1; echo "exit $?"; tail -n 30 $LOGS/bridge-pages.log
  pnpm --filter @tinylap/timing-app exec node --disable-warning=ExperimentalWarning --test --test-concurrency=1 --test-timeout=60000 test/browser/bridge-element.test.js > $LOGS/bridge-element.log 2>&1; echo "exit $?"; tail -n 40 $LOGS/bridge-element.log
  ```

- [ ] **The view,** using the `frontend-design` skill: the two templates go right after the `<ol>` (`views/bridge.js:66`), each on one line, exactly as in spec §3.4.
- [ ] **`update()` in `bridge-page.js`**, in place of `:78-86`:

  ```js
  const row = (kind) => /** @type {HTMLTemplateElement} */ ($(`template[data-bridge-row="${kind}"]`)).content.firstElementChild;
  list.replaceChildren(...preview.map((p) => {
    const first = p.lapMs === null || p.lapMs === undefined;
    const li = /** @type {HTMLElement} */ (row(first ? 'first' : 'lap').cloneNode(true));
    li.querySelector('.bridge-code').textContent = p.transponder;
    if (!first) li.querySelector('.num').textContent = formatLap(p.lapMs);
    return li;
  }));
  ```

- [ ] **Run both again; expect PASS.** Then run `test/browser/bridge.test.js` alone: all seven pass unchanged.
- [ ] **Run the checks.**
- [ ] **Commit** `feat(timing-app): the bridge preview rows come from server templates`.

### Task 4: `tl-bridge`, starting what the page started (E1)

Spec §3.5, commit 2. `disconnectedCallback` stays empty in this task.

**Files:**
- Create: `apps/timing/public/elements/bridge.js`
- Modify:
  - `apps/timing/server/views/bridge.js` (`:5-7`, `:28`, `:31`, `:75`);
  - `apps/timing/server/bridge-pages.js:5-6` (comment);
  - `apps/timing/public/app.css`;
  - `apps/timing/test/server/bridge-pages.test.js:35`, plus a wrapper check;
  - `apps/timing/test/browser/bridge-element.test.js` (E1)
- Delete: `apps/timing/public/bridge-page.js`
- Unchanged and must pass: `test/browser/bridge.test.js`, `bridge-pages.test.js:19-34`, `no-js.test.js:127-134`, `assembled.test.js` (its bridge check, `:55-61`, still holds)

- [ ] **Failing server test:**
  - `:35` becomes `assert.match(body, /<script type="module" src="\/public\/elements\/bridge.js"><\/script>/);`;
  - add `assert.match(body, /<tl-bridge>\s*<div id="bridge" data-workspace=/);`.
- [ ] **Failing browser test, E1.**
  - **The init script `COUNT`**, at the top of the file, for every E test:

    ```js
    const COUNT = () => {
      Object.assign(window, { __opened: 0, __cancelled: 0, __cancelledAt: null, __writes: [] });
      const W = window.WritableStream;
      const R = window.ReadableStream;
      window.WritableStream = class extends W {
        constructor(sink, ...rest) {
          let opened = false;
          super(sink && { ...sink, write: (chunk, c) => {
            if (!opened) { opened = true; window.__opened += 1; }
            window.__writes.push(performance.now());
            return sink.write(chunk, c);
          } }, ...rest);
        }
      };
      window.ReadableStream = class extends R {
        constructor(source, ...rest) {
          super(source && { ...source, cancel: (reason) => {
            window.__cancelled += 1;
            window.__cancelledAt = performance.now();
            return source.cancel?.(reason);
          } }, ...rest);
        }
      };
    };
    ```

    Only `sim-port.js:19-20` constructs these streams, so `__opened` counts opened ports. `toPairing` takes `init` as an array and adds each script.
  - **E1a:** `goto('/personal/bridge?simulate=fast')`. `customElements.get('tl-bridge')` is defined, `Connect decoder` is visible, and `__opened === 0`. One click: the pairing heading shows, and `__opened === 1`.
  - **E1b, earlier passings:**
    1. `const old = await (await app.api(member, 'POST', `/workspaces/${personal}/decoders`, { name: 'Old' })).json()`.
    2. `goto('/personal/bridge')`, then seed the outbox:

       ```js
       page.evaluate(async (id) => {
         const { openOutbox } = await import('/public/outbox.js');
         await (await openOutbox()).add({ decoder: id, boot: 'b00tb00t', transponder: '0A', t: 1000 });
       }, old.id)
       ```

    3. Register a route that holds the POST to `**/decoders/*/passings` until released.
    4. `reload()`.
    5. Wait for the note "1 passing from earlier is waiting. Sending them now…".
    6. Release.
    7. Exactly one POST went to `/decoders/${old.id}/passings`, answered 200.
- [ ] **Run; expect FAIL.**
- [ ] **The view**, using the `frontend-design` skill:
  - wrap `<div id="bridge" …>…</div>` in `<tl-bridge>\n…\n</tl-bridge>`;
  - `scripts: ['elements/bridge.js']`;
  - the header comment (`:5-7`) says "`tl-bridge` shows the one that applies";
  - the same in `bridge-pages.js:5-6`.
- [ ] **`app.css`:** `tl-bridge { display: block; }`, under `tl-tap`.
- [ ] **`public/elements/bridge.js`** (AGPL header). Its header comment says what `<tl-bridge>` does, and that `../bridge.js` is the `Bridge` class. The body is `bridge-page.js` moved into a class:
  - the imports become `../bridge.js`, `../format.js`, `../outbox.js` and `../sim-port.js`;
  - `simulate`, `supported`, `api`, `post`, `STATE_TEXT` and `pickPort` stay module-level, verbatim (`:17-33`, `:58-64`, `:106-114`);
  - **the run:**

    ```js
    /** @typedef {{ root: HTMLElement, workspaceId: string, bridge: Bridge | null, preview: any[], names: Map<string, string>, asked: Set<string>, made: any }} Run */
    /** @type {Run | null} */ run = null;
    ```

  - `connectedCallback() { this.start(); }` and `disconnectedCallback() {}`, with a comment: "teardown follows (Task 5)";
  - **`start()`:**

    ```js
    start() {
      if (this.run) return;
      const root = /** @type {HTMLElement | null} */ (this.querySelector('#bridge'));
      if (!root || !supported) return;
      const run = { root, workspaceId: root.dataset.workspace ?? '', bridge: null, preview: [], names: new Map(), asked: new Set(), made: null };
      this.run = run;
      this.show(run, 'connect');
      this.addEventListener('click', this);
      this.addEventListener('submit', this);
      addEventListener('beforeunload', this);
      void this.sendEarlier(run).catch(() => {});
    }
    ```

  - **`handleEvent(event)`:**
    - `beforeunload`: `if (this.run?.bridge?.state === 'ready') event.preventDefault();`.
    - `click`: `const button = event.target instanceof Element ? event.target.closest('[data-bridge-connect]') : null;`. If `button && this.contains(button)`, then `this.connect(run).then(() => this.ok(run), (caught) => this.fail(run, caught))`.
    - `submit`: if `event.target` is an `HTMLFormElement` matching `[data-bridge-pair]` inside the element, then `event.preventDefault()` and `void this.pair(run, event.target)`.
  - **Methods, each taking `run`, with bodies verbatim from `bridge-page.js`:**
    - `$` (`:16`, on `run.root`), `announce` (`:41`), `nameOf` (`:45`), `fail` and `ok` (`:46-50`);
    - `show` (`:52-56`), `update` (`:66-88`, with Task 3's rows), `learnName` (`:91-103`);
    - `connect` (`:116-141`), `sendEarlier` (`:144-158`);
    - `pair`: the submit body (`:168-189`), with `made` read and written as `run.made`;
    - module variables become run fields: `bridge` → `run.bridge`, `preview` → `run.preview`, `names` → `run.names`, `asked` → `run.asked`.
  - `if (!customElements.get('tl-bridge')) customElements.define('tl-bridge', TlBridge);`
- [ ] **Delete `public/bridge-page.js`:** `git rm apps/timing/public/bridge-page.js`.
- [ ] **Run `bridge-pages.test.js`, `bridge-element.test.js` and `bridge.test.js`; expect PASS.** `bridge.test.js` must pass unchanged, all seven tests.
- [ ] **Run the checks.**
- [ ] **Commit** `feat(timing-app): tl-bridge runs the bridge page`.

### Task 5: `tl-bridge` teardown, the reset and the run guard (E2–E4, E6)

Spec §3.3 and §3.5, commit 3.

**Files:**
- Modify: `apps/timing/public/elements/bridge.js`, `apps/timing/test/browser/bridge-element.test.js`

- [ ] **Failing browser tests** E2, E3a, E3b, E4 and E6, written as in spec §4. Each one uses `COUNT`.
  - **E2:**
    1. `toPairing`, then pair as `Gate` and wait for "Forwarding from Gate".
    2. A cancelable `beforeunload` is prevented: `page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); dispatchEvent(e); return e.defaultPrevented; })` is `true`.
    3. `page.route('**/decoders/*/passings', (r) => r.abort())`, then wait for `[data-bridge-status]` to match `/^Offline: passings wait here/`.
    4. Collect requests to `/decoders/` with `page.on('request')`, from this point on.
    5. Keep a handle, `const el = await page.evaluateHandle(() => document.querySelector('tl-bridge'))`, then remove it: `el.evaluate((x) => x.remove())`.
    6. `waitForTimeout(6000)`. Expect:
       - `__cancelled === __opened`;
       - no request to `/decoders/*/passings`;
       - the `beforeunload` check gives `false`;
       - `el.evaluate((x) => x.querySelector('[data-bridge-connect]').click())` leaves `__opened` unchanged;
       - a detached `SubmitEvent` on `[data-bridge-pair]` sends no POST.
  - **E3a:**

    ```js
    page.evaluate(() => {
      const el = document.querySelector('tl-bridge');
      window.__el = el;
      el.querySelector('[data-bridge-connect]').click();
      el.remove();
    })
    ```

    Later `evaluate`s reach the detached element as `window.__el`. Then `waitForTimeout(1000)`: `__opened === 0`, `__el.querySelectorAll('[data-bridge-state]:not([hidden])')` holds only the Connect section, and no request went to `/decoders/` or `/workspaces/`.
  - **E3b:** in one `page.evaluate`:
    - a `MutationObserver` on `[data-bridge-state="connecting"]` (`attributeFilter: ['hidden']`) removes the element once `hidden` is gone;
    - then `click()` Connect.

    After `waitForTimeout(1000)`:
    - `__opened === 1` and `__cancelled === 1`;
    - `__writes.every((t) => t <= __cancelledAt)`;
    - no state section other than `connecting` is shown, and nothing changes after the removal.
  - **E4:**
    1. `toPairing(t, { init: [COUNT, DROP_FIRST_PAIR] })`. `DROP_FIRST_PAIR` is copied from `bridge.test.js:99-108`. Pair as `Pit`, and wait for the "didn't answer" alert.
    2. `document.querySelector('main .container').append(document.querySelector('tl-bridge'))`. Then:
       - `Connect decoder` is visible;
       - `getByRole('alert')` has no visible match;
       - `#bridge-name` has `readOnly === false`;
       - the Pair button has `disabled === false`;
       - `page.waitForFunction(() => window.__cancelled === window.__opened)`, because `stop()` doesn't await `close()`, so the cancel lands a little later.
    3. Note `before = app.store.decoders(personal).length`. Click Connect: `__opened` grows by exactly 1. Pair as `Pit2`: exactly one `POST /workspaces/${personal}/decoders`, and the store length is `before + 1`.
    4. In a new page (`toPairing` again, with both init scripts), repeat steps 1–3 with `el.replaceWith(el.cloneNode(true))` in place of the move.
  - **E6:**
    1. `toPairing`, then hold the POST only:

       ```js
       page.route('**/workspaces/*/decoders', (route) => (route.request().method() === 'POST' ? held.then(() => route.continue()) : route.continue()))
       ```

    2. Note `before`, fill `Late`, press Pair, then move the element as in E4.
    3. Release `held`, then `await page.waitForEvent('requestfinished')`. Then wait two frames, as `tap.test.js:93` does, so the code after `res.json()` and the guard has run.
    4. Expect:
       - `Connect decoder` is visible;
       - `#bridge-name` is editable;
       - no visible alert;
       - the store length is `before + 1`.
- [ ] **Run; expect FAIL:**

  ```sh
  pnpm --filter @tinylap/timing-app exec node --disable-warning=ExperimentalWarning --test --test-concurrency=1 --test-timeout=60000 test/browser/bridge-element.test.js > $LOGS/bridge-element.log 2>&1; echo "exit $?"; tail -n 40 $LOGS/bridge-element.log
  ```

- [ ] **`stop()` and `disconnectedCallback`:**

  ```js
  disconnectedCallback() { this.stop(); }

  stop() {
    const run = this.run;
    this.run = null;
    if (!run) return;
    this.removeEventListener('click', this);
    this.removeEventListener('submit', this);
    removeEventListener('beforeunload', this);
    const bridge = run.bridge;
    run.bridge = null;
    void bridge?.close();
  }
  ```

- [ ] **Types:** keep today's casts on the moved code (`bridge-page.js:165-166`, `:169`): the form as `HTMLFormElement`, the name field as `HTMLInputElement`, the button as `HTMLButtonElement`. Leave `$`'s `selector` untyped, as `:16` does. A typed `selector` makes these `Element`, and tsc fails with TS2339 even without `strict`.
- [ ] **The reset**, called in `start()` right after `this.run = run`, before `show`:

  ```js
  reset(run) {
    const error = this.$(run, '[data-bridge-error]');
    error.hidden = true;
    error.textContent = '';
    this.$(run, '[data-bridge-earlier]').hidden = true;
    this.$(run, '[data-bridge-live]').textContent = '';
    const form = /** @type {HTMLFormElement} */ (this.$(run, '[data-bridge-pair]'));
    /** @type {HTMLInputElement} */ (form.elements.namedItem('name')).readOnly = false;
    /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]')).disabled = false;
  }
  ```

- [ ] **The run guard,** `run === this.run`, at exactly the points of spec §3.3:
  - **`connect`:**
    - after `const port = await pickPort();` → `if (run !== this.run) return;`;
    - after `const outbox = await openOutbox();` (split out of the `new Bridge(…)` call, still after `await run.bridge?.close()`) → `if (run !== this.run) return;`;
    - in the `catch`, `if (run === this.run) this.show(run, 'connect');` before the rethrow;
    - after `await next.start();` → `if (run !== this.run) await next.close();`.
  - **`connect`'s caller** in `handleEvent`: `() => { if (run === this.run) this.ok(run); }` and `(caught) => { if (run === this.run) this.fail(run, caught); }`.
  - **`pair`:**
    - `const made = await api('POST', …); if (run !== this.run) return; run.made = made;`, and then `names.set` and `readOnly`;
    - `ok` and `fail` only `if (run === this.run)`;
    - `finally` still enables the button.
  - **`update`'s outbox count:** `.then((n) => { if (run === this.run) this.$(run, '[data-bridge-outbox]').textContent = String(n); })`.
  - **`learnName`:** `if (found) { run.names.set(id, found.name); if (run === this.run) this.update(run); }`.
  - **`sendEarlier`'s `say`:** starts with `if (run !== this.run) return;`.
- [ ] **Run `bridge-element.test.js` and `test/browser/bridge.test.js`; expect PASS.**
- [ ] **Mutation check, by hand,** reverting each change afterwards. Each one must fail its test, as in the spec §4 table:
  - drop `bridge?.close()` in `stop` → E2;
  - keep the `beforeunload` listener → E2;
  - drop the guards after both `pickPort` and `openOutbox` → E3a;
  - drop the guard after `next.start()` → E3b;
  - drop the reset → E4;
  - drop the pairing guard → E6;
  - per-button arrow listeners → E4;
  - start in the constructor, or once per element → E4;
  - a row template with a wrong class, or no lap template → E5 and the server test (Task 3).

  The `#closed` row is already covered by Task 2's failing-first step. Record the results in the commit body.
- [ ] **Run the browser file twice; green both times.**
- [ ] **Run the checks.**
- [ ] **Commit** `feat(timing-app): tl-bridge closes the port and stops when it leaves the page`.

### Task 6: no-JS and assembled

**Files:**
- Modify: `apps/timing/test/browser/no-js.test.js`, `apps/timing/test/browser/assembled.test.js:39-61`

- [ ] **`assembled.test.js`:**
  - on the `tap` screen: the scripts include `/v/${SHA}/public/elements/tap.js`, and `customElements.get('tl-tap')` is defined;
  - on the `bridge` screen: the scripts include `/v/${SHA}/public/elements/bridge.js`, and `tl-bridge` is defined. The import map check (`:55-61`) stays as it is.
- [ ] **`no-js.test.js`:** a new test, `without JavaScript the tap and bridge templates stay inert`.
  - On `/personal/tap`, with `plainPage`: `getByText('Sign in again')` is not visible, and `getByRole('alert')` has no match.
  - On `/personal/bridge`: `getByText('first pass')` is not visible.
- [ ] **Run both files:**

  ```sh
  pnpm --filter @tinylap/timing-app exec node --disable-warning=ExperimentalWarning --test --test-concurrency=1 --test-timeout=60000 test/browser/assembled.test.js > $LOGS/assembled.log 2>&1; echo "exit $?"; tail -n 40 $LOGS/assembled.log
  pnpm --filter @tinylap/timing-app exec node --disable-warning=ExperimentalWarning --test --test-concurrency=1 --test-timeout=60000 test/browser/no-js.test.js > $LOGS/no-js.log 2>&1; echo "exit $?"; tail -n 40 $LOGS/no-js.log
  ```

- [ ] **Run the checks.**
- [ ] **Commit** `test(timing-app): tap and bridge elements load from the build, and stay inert without javascript`.

### Task 7: review and PR

- [ ] **Full checks**, as in Global constraints, plus the whole browser suite a second time. Keep each run's log under `$LOGS/`.
- [ ] **Senior review:** the whole branch against the spec and the Review focus above, on the most capable model. Fix the findings in separate `fix(…)` commits, and review again until it comes back clean.
- [ ] **PR:**
  - `git push -u origin feat/tap-bridge-elements`;
  - `gh pr create --base main --title "feat: tap and bridge as custom elements"`;
  - the body summarises spec §1, names the one tap fix and the `bridge.js` `#closed` fix, and lists the test files. No AI attribution.
- [ ] **Do not merge** without the user's OK.
