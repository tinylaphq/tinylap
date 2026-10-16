# Custom elements, step one: frames and copy

Status: revision 3, after a review and a re-review. Follows AGENTS.md "Web platform first" (PR #22).

## 1. Goal

The Setup page keeps your place. Renaming a driver, adding three drivers in a row, or assigning transponders reloads the page today. The browser lands on the section (the redirects carry `#drivers`), but the page flashes, focus is lost and cards can shift.

Step one adds two shared custom elements and uses them on Setup:

| Element | Job |
|---|---|
| `tl-frame` | Submits the forms inside it with fetch and swaps in the card the server answers with. |
| `tl-copy` | Adds a Copy button next to a token or link, where the browser can copy. |

Without JavaScript nothing changes: the forms, redirects and server text work as now.

**Not in this step:**
- `tl-relative-time` moved out of this step. Ticking "seen 5 min ago" forward while `lastSeenAt` stays a snapshot from page load makes a working decoder look stale. It comes back with step two, where the live stream updates the value.
- Moving `board.js`, `tap.js` and `bridge-page.js` to `tl-board`, `tl-countdown`, `tl-tap` and `tl-bridge` is step two.
- Page-to-page view transitions and speculation rules are a separate small change.

## 2. Where the code lives

- `packages/design/elements/frame.js` and `copy.js`, one element per file.
- Each file defines its element only when `globalThis.customElements` exists and the name is free.
- Server code never imports an element file. Since `class extends HTMLElement` throws in Node, the files are browser-only.
- `@tinylap/design` `exports` gains `"./elements/*": "./elements/*"`, keeping `./design.css`. `files` gains `elements`. It is a minor version bump, because new public exports are added.
- Serving needs no changes. The dev server (`server/static.js`) and `tools/assemble.js` already serve `/pkg/design/…`, since assemble copies the package root. In production it is versioned under `/v/<build>/`.
- `layout()` gets a `modules` list of package paths, next to `scripts` (which resolve under `public/`). Setup loads `pkg/design/elements/frame.js` and `pkg/design/elements/copy.js`.
- `apps/timing/public/format.js` is unchanged. Browser files never import from a package by bare name.
- The design package gets real checks:
  - `"lint": "eslint ."`;
  - a `typecheck` script with a tsconfig extending `tsconfig.base.json` with the DOM lib;
  - `test` runs `node --test test/`, and the existing `--tl-track-mat` check of `design.css` moves into a test file.

## 3. `tl-frame`

### 3.1 Markup

```html
<tl-frame id="drivers" refreshes="transponders">
  <section class="card-static stack-md" aria-labelledby="drivers-title">…forms…</section>
</tl-frame>
```

- The frame carries the id, moved from the section. A frame without an id does nothing.
- Light DOM, with `tl-frame { display: block }` in `design.css`.
- `design.css` also gets `[hidden] { display: none !important }`. palace's `button, .btn { display: inline-block }` beats the browser's `[hidden]` rule, so without it a hidden button still shows. It is generic, so it also goes upstream to palace-ui. Once palace ships it, the TinyLap copy is removed.
- **Frames on Setup:** `track`, `drivers` (`refreshes="transponders"`), `transponders` and `watchers`. `decoders` is not a frame: its only form, Wi-Fi pairing, is left to the browser (§3.2 step 1), and Unpair is a link.
- `refreshes` names the other frames this one's writes change, separated by spaces. No other frame is ever touched. Without the rule, a later swap could wipe the one-time pairing token, or someone's typing in another card.
- On Setup, the error summary moves into a slot that is always rendered: `<div id="page-status">…</div>`, right after the `<h1>` where the summary is today, and empty when there is no error. Only `setup.js` changes. Race, tap and bridge keep their summaries as they are, since they have no frames.

### 3.2 Submitting

On `submit` from a form inside the frame:

1. **Leave the submit to the browser** (no `preventDefault`) when any of these holds:
   - the effective method (the submitter's `formMethod`, else the form's `method`) is not `post`;
   - the effective action (`event.submitter?.formAction`, else `form.action`) is not same-origin;
   - the form has a `target`, or the submitter a `formtarget`, or the form a file input;
   - the form has `data-frame="off"`;
   - the event is already `defaultPrevented`.

   Wi-Fi pairing carries `data-frame="off"`, and sits outside any frame anyway. Its 303 consumes the one-time token cookie, so a failed swap after that would lose the token for good. Pairing is rare, and the normal load lands on `#decoders`.
2. **One submit per page.** While any frame's submit is in flight, every further submit in any frame is `preventDefault()`ed and dropped, and `#frame-status` says "Still saving. Try again in a moment." It is never left to the browser, which would write a second time. A page restored from the back/forward cache (`pageshow` with `persisted`) clears the lock, `aria-busy` and the disabled buttons. Then:
   - `preventDefault()`;
   - mark the frame `aria-busy="true"`;
   - disable the submitted form's buttons.
3. **Send:**

   ```js
   fetch(action, {
     method: 'POST',
     body: new URLSearchParams(new FormData(form, event.submitter)),
     redirect: 'follow',
     headers: { Accept: 'text/html' },
     signal: AbortSignal.timeout(30_000),
   })
   ```

   The page routes accept only `application/x-www-form-urlencoded` (`server/form.js`). The timeout is 30 s because "Use this track" can take up to 25 s: the issuer call takes up to 15 s, and the planner up to 10 s.
4. **Use the response** if it is `text/html` and contains a `tl-frame` with this frame's id, whatever its status:
   - a 2xx after a followed 303 is a success;
   - a 4xx or 5xx re-renders the page with the error, so it is a failure. That covers 422, and the 404, 409, 429 and 502 the operations return.

   The page is parsed with `DOMParser`, and `getElementById(id)` must be a `TL-FRAME`. The action's fragment is dropped first, so the fallback's `location.assign` always loads instead of scrolling.
5. **Swap:**
   - replace this frame's children with those of the response's frame;
   - replace each frame named in `refreshes` the same way, unless the user has changed one of its controls without submitting, or it holds focus;
   - replace the `#page-status` element itself (a new node, so a repeated identical message is announced again);
   - set `document.title` from the response.

   A control counts as changed when:
   - for an input or textarea, `value !== defaultValue`, or `checked !== defaultChecked`;
   - for a `select`, `selectedIndex` differs from the index of its `defaultSelected` option, or from 0 when no option is `defaultSelected`.
6. **URL:** only when `response.redirected` and `response.url` differs from `location`, both without fragment: `history.replaceState(null, '', response.url + location.hash)`. A 422 does not redirect and leaves the URL alone. Replacing rather than pushing matches the no-JS flow (POST then 303), which adds no history entry either.

### 3.3 Anything else loads the page

The frame falls back to `location.assign(action)` in these cases:
- a network error;
- the timeout;
- a body that isn't HTML;
- a response without the frame;
- an exception during the swap.

It never re-sends the form. A GET on every Setup form target answers 303 to its page (`form-targets.test.js`), so the user lands on the real page with no second write, and that page shows whether the write happened. This is the tap.js rule: a write is never retried.

**Expired session:**
1. The POST answers 303 to `/auth/login?returnTo=/` (`page-access.js`).
2. fetch follows it to the BFF, which redirects cross-origin to accounts.
3. `connect-src 'self'` blocks that redirect, so fetch rejects and the fallback runs.
4. The fallback GET signs in with `returnTo=<action>` and returns to Setup.

That is better than no-JS, which returns to `/`. Do not "fix" this with `redirect: 'manual'`: it hides `Location` and would break the fallback.

### 3.4 Focus and announcements

**After a success:**
1. Focus the first field of the submitted form, with `focus({ preventScroll: true })`, like every focus call below: the first `input`, `select` or `textarea` that is not hidden, readonly or disabled. It is found by id in the new frame. An assigned transponder row moves when the table re-sorts, which is why the focus call must not scroll. Example: "Add driver" leaves focus in the empty new-driver field, ready for the next name. Matching by id also works when the click focused the button, which has no id, or nothing at all, as in Safari.
2. Otherwise focus the frame's heading. The script sets `tabindex="-1"`, and the call is `focus({ preventScroll: true })`.
3. The server-rendered, visually hidden live region `#frame-status` says "<heading> saved", e.g. "Drivers saved". Without JS, the page load itself is the feedback.

**After a failure:**
1. The new `#page-status` holds the `role="alert"` summary, which is announced.
2. Focus moves to the first `[aria-invalid="true"]` control in the frame. If there is none (404, 409), it moves to the summary, after the script gives it `tabindex="-1"`.

**Scrolling:** the frame never scrolls. Keeping the user's place is the point.

### 3.5 Never

- No link interception. Delete, Unpair and "Make a new watchers link" stay normal navigations to their confirmation pages.
- No history entries.
- No markup built in script.
- No retries.

## 4. `tl-copy`

```html
<tl-copy class="copy">
  <code class="token">…</code>
  <button type="button" class="btn btn-outline" hidden>Copy</button>
  <span class="visually-hidden" role="status"></span>
  <p class="field-hint copy-hint" hidden>Select it and copy it yourself.</p>
</tl-copy>
```

- All of this markup is rendered by the server; the script only shows and hides it.
- `.copy` lays it out in `app.css`:
  - a two-column grid keeps the button beside its value, also on a phone, where a long token wraps instead; one-line values and the button share the 3rem inline-form height;
  - the hint spans both columns.
- The pairing notice is no longer a live region of its own: it is rendered with the page, so it was never announced as a change, and nested regions would re-read the token when the hint appears. The decoder id moves onto its own line under "Decoder id:", styled like the token. That changes the no-JS look of the notice, intentionally.

- The server renders the button `hidden`. The element unhides it when `navigator.clipboard?.writeText` exists, which needs a secure context.
- It copies the value of the first input inside, otherwise the text of the first `code`.
- The element announces the outcome in a polite live region, rather than relying on a changed button label being read:
  - on success, "Copied";
  - on failure, it unhides the server-rendered hint and selects the text.
- Without the clipboard API the button stays hidden and the text stays selectable, as now.
- Used on the pairing token, the decoder id and the watchers link. For the watchers link, `textField` gains a `copy` option that renders the input inside `<tl-copy class="copy">`, with the button and hint beside it.

## 5. Testing

**`packages/design`:**
- `test/design-css.test.js` keeps the token check.
- Lint and typecheck cover `elements/`.

**Timing server tests:**
- Track, drivers, transponders and watchers are inside a `<tl-frame id>`, drivers carries `refreshes="transponders"`, and decoders keeps its id on the `<section>`.
- The existing `setup-pages.test.js:36` check (`<section … id=`) is updated for the four cards whose id moves to `<tl-frame>`.
- `#page-status` is present, and empty without an error.
- Setup lists the two module scripts.
- The Wi-Fi pairing form carries `data-frame="off"`.
- Without JS, no Copy button or copy hint is visible (`no-js.test.js` asserts it).
- No server module imports `@tinylap/design/elements/`, checked by a grep-style test.
- The CSP test still passes.

**Timing browser tests:**

New `test/browser/frames.test.js`; `page.on('request')` counts the POSTs:
1. Clicking "Add driver":
   - the scroll position is the same;
   - focus is in the empty new-driver field;
   - the live region says "Drivers saved";
   - the transponders select lists the new driver;
   - one POST was sent.
2. Renaming to `"   "` gives the 422 swap:
   - the field error, and the summary in `#page-status`;
   - focus on the invalid field;
   - the URL is unchanged;
   - the typed value is kept.

   Spaces are used because `required` blocks an empty name in the browser.
3. A planner outage (the planner stub answers 502) on "Use this track" shows the summary, with the link kept.
4. An unsubmitted change in the transponders frame survives an "Add driver" swap.
5. After pairing over Wi-Fi (normal load), adding a driver leaves the token on screen.
6. `requestSubmit()` twice, in a frame and across two frames, inside one `page.evaluate`: exactly one POST.
7. Network failure on the POST only (`route.request().method() === 'POST'` aborted): a page load of the form's page, and no second POST.
8. Expired session (`context.clearCookies()`): the page lands on accounts sign-in by a page load. The return to Setup after signing in needs a passkey, so the test doesn't cover it; the fallback GET carries `returnTo=<action>`, and that action redirects to Setup.
9. `tl-copy` copies the token and the watchers link. The test context grants `clipboard-read` and `clipboard-write`.

Other browser tests:
- `assembled.test.js`: on Setup, `/v/<sha>/pkg/design/elements/frame.js` and `copy.js` load with no page errors.
- `no-js.test.js` keeps passing, which proves the fallback, and gains a test: no visible Copy button or hint.

## 6. Risks

- The submitted frame is replaced as a whole. Text half-typed in another form of the same frame is lost, e.g. typing a new driver while renaming another. That is rare, and no worse than today's reload.
- Each submit transfers the full Setup page, a few KB at club size, the same as today.
- A frame not named in `refreshes` keeps an inline field error after the summary clears: e.g. a failed track link stays marked after a later driver add. The next load clears it. Without JS the reload clears both.
- `refreshes` has to be kept up to date when a card starts depending on another. A missing entry shows stale options until the next load, not wrong data on the server.
