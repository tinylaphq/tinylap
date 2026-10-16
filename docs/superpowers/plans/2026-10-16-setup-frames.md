# Setup frames and copy: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans (native). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Setup keeps your place. Its card forms submit with fetch and swap in the server's new card. Tokens and the watchers link get a Copy button. Without JavaScript, everything works as today.

**Architecture:**
- Two light-DOM custom elements live in `@tinylap/design/elements/`: `tl-frame` and `tl-copy`.
- The server renders all their markup. The scripts only intercept submits, swap nodes, and show or hide things.
- The timing app's Setup view wraps four cards in `<tl-frame>` and loads the two modules.

**Tech stack:** plain ES modules, checked by tsc `--checkJs` and eslint. Tests use node:test and playwright-core browser tests.

**Spec:** `docs/superpowers/specs/2026-10-16-custom-elements-step-one-design.md` (revision 3). Read it; it is the authority.

## Global constraints

- AGENTS.md "Web platform first": no markup built in script, light DOM, `tl-*` names, start in `connectedCallback` and stop in `disconnectedCallback`.
- **UI work uses the `frontend-design` skill**, here the Copy layout and button placement. The look is palace-ui plus `@tinylap/design`; there is no new visual language.
- **Licenses:** new files in `packages/design` are `MPL-2.0`, files in `apps/timing` are `AGPL-3.0-or-later`. Both use the SPDX header of their neighbours, and REUSE lint must pass.
- **Commits:** conventional, `git commit -s`, author `1009814+jostsg@users.noreply.github.com`, no AI attribution.
- **Before each commit:** `pnpm turbo run test lint typecheck --filter=@tinylap/design --filter=@tinylap/timing-app`. Browser tests run with `pnpm --filter @tinylap/timing-app test:browser`.
- Server code never imports `@tinylap/design/elements/*`.

## Review focus

1. A failure after the fetch started must load the page, never re-POST.
2. A submit while one is in flight must be prevented and dropped, also when it comes from another frame.
3. An error status (422, 404, 409, 502) must swap in the message and the kept input. It must not silently load an unchanged page.
4. The one-time pairing token must never be replaced by a swap.
5. Without JS, nothing visible may change (no Copy button, no hint).

---

### Task 1: design package tooling, exports and CSS

**Files:**
- Modify: `packages/design/package.json`, `packages/design/design.css`, `packages/design/README.md`
- Create: `packages/design/tsconfig.json`, `packages/design/test/design-css.test.js`

- [ ] **`package.json`:**
  - `exports` gets `"./elements/*": "./elements/*"`, next to `"./design.css"`.
  - `files` gets `"elements"`.
  - The scripts become:
    - `"test": "node --test 'test/*.test.js'"`
    - `"lint": "eslint ."`
    - `"typecheck": "tsc -p tsconfig.json"`

    Keep `prepack`.
- [ ] **`tsconfig.json`:** `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "strict": true }, "include": ["elements/*.js", "test/*.js"] }`.
- [ ] **`test/design-css.test.js`:** with the MPL header, it reads `design.css` and asserts:
  - it contains `--tl-track-mat:` (today's check);
  - it has a rule `tl-frame { display: block; }`;
  - it has `[hidden] { display: none !important; }`.
- [ ] **Run the test; expect it to FAIL** on the two new rules.
- [ ] **`design.css`:** add, with a short comment each:

  ```css
  /* Custom elements are inline by default; a frame holds a card. */
  tl-frame { display: block; }
  /* palace's `button, .btn { display: inline-block }` beats the browser's [hidden];
     a hidden control must stay hidden. Upstream to palace-ui, then drop. */
  [hidden] { display: none !important; }
  ```
- [ ] **README:** add a short "Elements" section. It lists `tl-frame` and `tl-copy`, the import path `@tinylap/design/elements/<name>.js`, and the rule that they run only in the browser.
- [ ] **Run the checks; they pass.** Commit `feat(design): elements export, tooling, and hidden/frame base rules`.

### Task 2: `tl-copy`

**Files:**
- Create: `packages/design/elements/copy.js`
- Modify:
  - `apps/timing/server/views/form-parts.js`: a `copyable(inner)` helper, and the `copy` option on `textField`;
  - `apps/timing/server/views/setup.js`: the token, the decoder id, the watchers link;
  - `apps/timing/public/app.css`: `.copy`.
- Test: `apps/timing/test/views.test.js` (or the existing form-parts tests), and `test/server/setup-pages.test.js`.

- [ ] **Server markup** (`form-parts.js`):

  ```js
  /** A value with a Copy button, hidden until tl-copy finds the clipboard API (no JS: the value alone). */
  export const copyable = (inner) => html`<tl-copy class="copy">${inner}<button type="button" class="btn btn-sm btn-outline" hidden>Copy</button><span class="visually-hidden" role="status"></span><p class="field-hint copy-hint" hidden>Select it and copy it yourself.</p></tl-copy>`;
  ```

  `textField({ …, copy: true })` renders `copyable(<input …>)` in place of the bare `<input>`. The label, hint and error stay outside.
- [ ] **Failing view tests:**
  - `copyable` renders the button and the hint with `hidden`, and the status span empty;
  - `textField({ copy: true })` wraps the input in `<tl-copy class="copy">`.
- [ ] **Implement, then `setup.js`:**
  - the token is `copyable(html\`<code class="token">${token}</code>\`)`;
  - the decoder id the same, with `.token-id`;
  - the watchers link field gets `copy: true`.
- [ ] **`copy.js`** (MPL header):

  ```js
  // <tl-copy>: shows the server-rendered Copy button where the browser can
  // copy, and copies the input's value or the code's text. Without it, or
  // without the clipboard API, the value stays selectable and the button hidden.
  class TlCopy extends HTMLElement {
    connectedCallback() {
      const button = this.querySelector('button');
      if (!button || !navigator.clipboard?.writeText) return;
      button.hidden = false;
      button.addEventListener('click', this);
    }
    disconnectedCallback() { this.querySelector('button')?.removeEventListener('click', this); }
    async handleEvent() {
      const input = this.querySelector('input');
      const code = this.querySelector('code');
      const status = this.querySelector('[role="status"]');
      const hint = /** @type {HTMLElement | null} */ (this.querySelector('.copy-hint'));
      try {
        await navigator.clipboard.writeText(input ? input.value : code?.textContent ?? '');
        if (hint) hint.hidden = true;
        if (status) status.textContent = 'Copied';
      } catch {
        if (hint) hint.hidden = false;
        if (input) input.select();
        else if (code) getSelection()?.selectAllChildren(code);
      }
    }
  }
  if (globalThis.customElements && !customElements.get('tl-copy')) customElements.define('tl-copy', TlCopy);
  ```

  When "Copied" is announced a second time, clear the status first and set it in the next frame (`requestAnimationFrame`), so the repeat is spoken.
- [ ] **`app.css` `.copy`** (use frontend-design; palace tokens only):
  - a flex row that wraps, with gap `var(--p-space-sm)`, items aligned to the center;
  - inside `.field` (the watchers link) the input takes the remaining width;
  - the hint takes a full line (`flex-basis: 100%`).

  Check in the browser at 390 px and at 1280 px, then screenshot both.
- [ ] **Run the checks.** Commit `feat(timing-app): copy the pairing token and the watchers link`.

### Task 3: `tl-frame` and the Setup frames

**Files:**
- Create: `packages/design/elements/frame.js`
- Modify:
  - `apps/timing/server/views/setup.js`: the frames, `#page-status`, the `#frame-status` live region, `data-frame="off"`;
  - `apps/timing/server/views/layout.js`: the `modules` option;
  - `apps/timing/test/server/setup-pages.test.js`: line 36, the section/frame check;
  - a new `apps/timing/test/server/frames.test.js`.

- [ ] **Failing server tests** in `frames.test.js`, on Setup's HTML as the owner:
  - `<tl-frame id="track">`, `<tl-frame id="drivers" refreshes="transponders">`, `<tl-frame id="transponders">` and `<tl-frame id="watchers">` are present;
  - decoders is `<section … id="decoders">`, outside any frame;
  - `<div id="page-status"></div>` comes right after the `<h1>`, and on a 422 it holds the `role="alert"` summary;
  - `<p class="visually-hidden" role="status" id="frame-status"></p>` is present;
  - the pairing form has `data-frame="off"`;
  - the page has `<script type="module" src="/pkg/design/elements/frame.js">` and the same for `copy.js`;
  - no file under `apps/timing/server` contains `@tinylap/design/elements` (read the files with `fs` and match).

  Update `setup-pages.test.js:36`: the id regex accepts `<tl-frame[^>]* id=` for the four frames, and `<section[^>]* id=` for decoders.
- [ ] **`layout.js`:** add `modules = []` to the page options, rendered like `scripts` but from `asset(request, m)` (package paths such as `pkg/design/elements/frame.js`). Update the JSDoc type.
- [ ] **`setup.js`:**
  - Move the `id` from each of the four `<section>`s onto a wrapping `<tl-frame id>`. Keep `aria-labelledby` on the section.
  - `errorSummary` goes inside `<div id="page-status">…</div>`, which is always rendered.
  - Add `#frame-status`.
  - Put `data-frame="off"` on the pairing form.
  - Pass `modules: ['pkg/design/elements/frame.js', 'pkg/design/elements/copy.js']`.
- [ ] **`frame.js`** (MPL header): implement spec §3 exactly:
  - The module-level `let busy = false` is the one-submit-per-page lock.
  - `connectedCallback` and `disconnectedCallback` add and remove the `submit` listener on the frame.
  - The handler, in order:
    1. Leave the submit to the browser in the spec's step 1 cases: not POST, other origin, `target` or `formtarget`, a file input, `data-frame="off"`, `defaultPrevented`, or a frame without an id.
    2. Otherwise `preventDefault()`. If `busy`, return.
    3. Set `busy`, remember the first field's id of the submitted form, set `aria-busy` and disable the form's buttons.
    4. `fetch` with a 30 s timeout. If the response isn't `text/html`, throw.
    5. `DOMParser`. The response's frame must be `getElementById(this.id)` with `localName === 'tl-frame'`, else throw.
    6. Swap:
       - this frame's children;
       - each `refreshes` frame that is unchanged and doesn't hold focus;
       - `#page-status` replaced as a node;
       - the title.
    7. `history.replaceState` only on `res.redirected`, keeping `location.hash`.
    8. Focus, with `preventScroll` everywhere:
       - **success:** the first field by id, else the heading with `tabindex=-1`. Then announce "<heading> saved" in `#frame-status`: clear it, then set it in the next animation frame.
       - **failure** (`!res.ok`): the first `[aria-invalid="true"]` in the frame, else the summary with `tabindex=-1`.
    9. `busy = false`.
  - Any throw from step 4 on runs `location.assign(action)` and leaves `busy` set, because the page is leaving.
  - The `changed(root)` helper follows spec §3.2 step 5, `select` included.
  - Define the element only when `globalThis.customElements` exists and the name is free.
- [ ] **Run the checks.** Commit `feat(timing-app): setup cards save in place`.

### Task 4: browser tests

**Files:**
- Create: `apps/timing/test/browser/frames.test.js`
- Modify: `apps/timing/test/browser/no-js.test.js` (no visible Copy button or hint), `apps/timing/test/browser/assembled.test.js` (both element modules load under `/v/<sha>/`, with no errors on Setup).

Write the spec's §5 browser cases 1–9. Each counts POSTs with `page.on('request')` and asserts `errors` stays empty.

Helpers:
- **Planner outage:** the planner stub (`test/server/planner-stub.js`) answers 502. Check its API before you start.
- **Expired session:** `context.clearCookies()`, as `tap.test.js:104` does.
- **Clipboard:** `context.grantPermissions(['clipboard-read', 'clipboard-write'])`.
- **Double submit:** `page.evaluate` calls `requestSubmit()` twice, and on two frames.
- **Network failure:** `page.route` aborts POSTs only.

- [ ] Write the tests and run them. They must pass against Tasks 1–3. A failure is a bug in the element, fixed there.
- [ ] Run the whole browser suite twice; green both times.
- [ ] Commit `test(timing-app): setup frames and copy in the browser`.

### Task 5: finish

- [ ] **Changelog:** `@tinylap/design` takes a minor bump through release-please, from the `feat(design)` commit. Check that no manual changelog edit is expected; `CHANGELOG.md` is generated.
- [ ] **Follow-up list:** add "upstream `[hidden]` to palace-ui" to the design follow-ups.
- [ ] **Senior review:** the whole branch, on the most capable model. Fix the findings and review again until it comes back clean.
- [ ] **PR:** push and open it. Do not merge without the user's OK.
