# Timing UI, Server-Rendered — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the timing app's client-side single-page app with server-rendered pages at real URLs (`/clubs/<id>/…`, `/personal/…`, `/watch/<token>`), plain HTML forms with POST → 303, and JavaScript only for the live board, instant taps and the USB bridge.

**Architecture:** The server renders every page from the store with an escaping `html` tagged template. Page routes and the existing JSON routes become thin adapters over shared operations in `server/operations.js`. Assets are files in `apps/timing/public/`, versioned under `/v/<build>/` in production. The JSON and SSE API, the engine, the store, ingest and the bridge's serial logic stay.

**Tech Stack:** Node 24 (`node:http`, `node:sqlite`, `node:test`), plain JS checked by `tsc --checkJs`, palace-ui + `@tinylap/design`, `@tinylap/auth` (BFF, `can`, `seal`/`open`), EventSource, Web Serial, playwright-core with Chrome.

**Spec:** `docs/superpowers/specs/2026-10-15-timing-ui-server-rendered-design.md` (and, for what stays, `docs/superpowers/specs/2026-10-15-timing-core-design.md`).

## Global Constraints

- `AGENTS.md` "Web platform first": pages are rendered on the server with real URLs; forms are plain HTML forms, POST then 303; a failed form comes back as the same page, the input kept, status 422; JavaScript only as progressive enhancement; no hash routing, no client-side routers, no frameworks; native elements (`<form>`, `<a>`, `<dialog>`, `<details>`) before scripted copies.
- Every UI is palace-ui plus `@tinylap/design`; generic styles belong upstream in palace-ui (mark local ones `/* belongs upstream in palace-ui */`). **Use the `frontend-design:frontend-design` skill for every task that renders pages or styles them (Tasks 3, 5–11).**
- No HTML is produced outside `html`/`safe` from `server/views/html.js`.
- Copy follows the glossary: **Sign in / Sign out**, **club** and **personal**, **track** ("layout" only for planner templates), **Share**. The word "workspace" never reaches a page.
- Page CSP: `default-src 'self'; script-src 'self'[ 'sha256-…' for the bridge's import map]; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self' <issuer origin>; frame-ancestors 'none'`. (`'unsafe-inline'` for styles only, as the planner has, for driver colour swatches.)
- Pages and form responses are `Cache-Control: no-store`. Assets in production live under `/v/<TINYLAP_BUILD>/` and are immutable.
- Commits: conventional, `git -c user.email=1009814+jostsg@users.noreply.github.com commit -s`, **no AI attribution**. Before each commit run the touched packages' `test`, `lint`, `typecheck` (and `test:browser` where the task says).
- Test-only users need a personal space: the test helper's `signUp` creates one (Task 3).

## Review Focus

1. **A name with HTML in it** (`<b>Ana</b>`, `"`, `&`) shows literally on every page, in the account menu, the board stream and confirmation pages. Tests: Task 2 (template), Task 5 (setup), Task 9 (board), Task 10 (stream).
2. **A form posted from another site** (Sec-Fetch-Site cross-site) changes nothing and gets a 403 page. Test: Task 5.
3. **Signing out while on a page, then pressing Back and resubmitting a form** redirects to sign-in and changes nothing. Test: Task 5.
4. **A club you've been removed from** answers the 404 page on every URL under `/clubs/<id>/`, including its board stream. Test: Task 3 and Task 10.
5. **The token shown once after pairing** is gone on reload and never appears in a URL or a log line. Test: Task 6.

---

## File Structure

```
apps/accounts/server/auth.js                 workspaces claim gains `kind`
apps/accounts/test/claims.test.js            asserts it
packages/auth/types.d.ts, README.md          WorkspaceClaim.kind

apps/timing/
  package.json                               "files": ["public"]
  public/                                    served to browsers
    app.css                                  (moved from css/app.css, plus page styles)
    mark.svg                                 (copied from apps/accounts/public/mark.svg)
    format.js                                (moved from js/; server views import it too)
    bridge.js, outbox.js, sim-port.js        (moved from js/)
    board.js                                 enhancement: live board, clock, live status, full screen
    tap.js                                   enhancement: taps without a reload
    bridge-page.js                           enhancement: the bridge screen (replaces js/bridge-view.js)
  server/
    views/html.js                            html`` / safe(): the only way to make HTML
    views/layout.js                          the shell: head, navbar, account menu, assets
    views/notice.js                          start page, not found, forbidden, watchers link gone
    views/board.js                           board and watchers board (also the stream's HTML)
    views/race.js, views/tap.js, views/setup.js, views/confirm.js, views/bridge.js
    spaces.js                                spaces from claims; /clubs/<id> and /personal paths
    page-access.js                           pageRoute(): session, space, role, same-origin, cookie
    respond.js                               page(), seeOther(), pageCsp()
    form.js                                  readForm(): urlencoded bodies
    operations.js                            shared operations behind JSON and form routes
    page-routes.js                           every page and form route
    board-stream.js                          /…/board/events and /watch/<token>/events
    (existing files stay; setup.js, control.js, ingest.js call operations.js)
  test/
    format.test.js, outbox.test.js, bridge.test.js   (imports move to ../public/)
    views.test.js                            view functions
    server/pages.test.js                     shell, spaces, redirects, notices
    server/setup-pages.test.js, race-pages.test.js, tap-pages.test.js, board-pages.test.js
    browser/no-js.test.js                    every form with JavaScript off
    browser/live.test.js                     board stream, clock, taps without reload
    browser/bridge.test.js                   bridge page with ?simulate=fast
    browser/assembled.test.js                production build under /v/<build>/
  (deleted: index.html, css/, js/ except the moved files, test/view.test.js,
   test/browser/board.test.js, screens.test.js)
tools/assemble.js                            an app without index.html
tools/test/assemble.test.js                  covers it
```

---
### Task 1: accounts names each space's kind in the token

**Files:**
- Modify: `apps/accounts/server/auth.js:244-246` (`customAccessTokenClaims`)
- Modify: `packages/auth/types.d.ts` (`WorkspaceClaim`), `packages/auth/README.md` (the claim's description, if it lists fields)
- Test: `apps/accounts/test/claims.test.js`

**Interfaces:**
- Produces: every entry of the access token's `workspaces` claim is `{ id, role, name, kind }` with `kind` `'personal' | 'club'`. `WorkspaceClaim.kind?: 'personal' | 'club'` (optional, so older tokens still type-check).

- [ ] **Step 1: Change the test to expect `kind`**

In `apps/accounts/test/claims.test.js`, the first test becomes:

```js
test('the access token names every workspace with its id, role, name and kind', async () => {
  const { member, club } = await setUp();
  const tokens = await login(member);
  const expected = listMemberships(accounts.db, member).map(({ id, role, name, kind }) => ({ id, role, name, kind }));
  assert.equal(expected.length, 2);
  assert.deepEqual(claimOf(tokens), expected);
  assert.ok(claimOf(tokens).some((w) => w.id === club.id && w.role === 'member' && w.name === 'Kart Club' && w.kind === 'club'));
  assert.ok(claimOf(tokens).some((w) => w.kind === 'personal' && w.name === 'Member'));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @tinylap/accounts test`
Expected: FAIL in `claims.test.js` (the claim has no `kind`).

- [ ] **Step 3: Add `kind` to the claim and the type**

`apps/accounts/server/auth.js`, in `customAccessTokenClaims`:

```js
          workspaces: user && db ? listMemberships(db, user.id).map(({ id, role, name, kind }) => ({ id, role, name, kind })) : [],
```

`packages/auth/types.d.ts`:

```ts
export interface WorkspaceClaim {
  id: string;
  role: Role;
  /** The workspace's display name, as accounts issues it. */
  name?: string;
  /** A person's own space or a club. Tokens from before 2026-10-15 lack it. */
  kind?: 'personal' | 'club';
}
```

If `packages/auth/README.md` describes the claim's fields, add `kind` there in the same words.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @tinylap/accounts test && pnpm --filter @tinylap/auth test && pnpm --filter @tinylap/track-planner test`
Expected: PASS (the planner reads the claim too and must not mind the extra field).

- [ ] **Step 5: Lint, typecheck, commit**

```bash
pnpm --filter @tinylap/accounts lint && pnpm --filter @tinylap/accounts typecheck && pnpm --filter @tinylap/auth typecheck
git add apps/accounts packages/auth
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(accounts): name each workspace's kind in the access token"
```

---

### Task 2: The `html` template

**Files:**
- Create: `apps/timing/server/views/html.js`
- Test: `apps/timing/test/views.test.js`

**Interfaces:**
- Produces: `html` (tagged template → `Html`), `safe(text)` → `Html` (trusted markup), class `Html` with `.text` and `toString()`. Interpolations: `Html` passes through; arrays render each item; `null`, `undefined`, `false` render nothing; everything else is `String(value)` with `& < > " '` escaped.

- [ ] **Step 1: Write the failing test**

`apps/timing/test/views.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { Html, html, safe } from '../server/views/html.js';

test('interpolations are escaped', () => {
  const name = `<b>Ana</b> & "Ben" 'C'`;
  assert.equal(String(html`<li title="${name}">${name}</li>`),
    '<li title="&lt;b&gt;Ana&lt;/b&gt; &amp; &quot;Ben&quot; &#39;C&#39;">&lt;b&gt;Ana&lt;/b&gt; &amp; &quot;Ben&quot; &#39;C&#39;</li>');
});

test('templates nest, arrays join, empties vanish', () => {
  const items = ['a<', 'b'].map((x) => html`<li>${x}</li>`);
  assert.equal(String(html`<ul>${items}${null}${undefined}${false}</ul>`), '<ul><li>a&lt;</li><li>b</li></ul>');
  assert.equal(String(html`${0} ${''}`), '0 ');
  assert.ok(html`x` instanceof Html);
});

test('safe() passes trusted markup through', () => {
  assert.equal(String(html`<p>${safe('<br>')}</p>`), '<p><br></p>');
  assert.equal(safe('<i>').text, '<i>');
});
```

Add `'test/views.test.js'` coverage: the app's `test` script already runs `test/*.test.js`.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL, `views/html.js` does not exist.

- [ ] **Step 3: Implement `server/views/html.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The only way the timing app makes HTML (spec §4.1): every interpolated
// value is escaped unless it is itself made by html`` or marked safe().

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export class Html {
  /** @param {string} text */
  constructor(text) {
    this.text = text;
  }
  toString() {
    return this.text;
  }
}

/** Trusted markup, rendered as is. @param {unknown} text */
export const safe = (text) => new Html(String(text));

/** @param {unknown} value @returns {string} */
function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Html) return value.text;
  if (Array.isArray(value)) return value.map(render).join('');
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** @param {TemplateStringsArray} strings @param {...unknown} values */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1];
  });
  return new Html(out);
}
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/timing/server/views/html.js apps/timing/test/views.test.js
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing-app): add an escaping html template"
```

---
### Task 3: The cutover: page shell, spaces, access, start and notice pages

The client-side app goes; the server answers `/` and space paths with pages. Feature pages come in Tasks 5–11, so in between a space path answers the not-found page.

**Files:**
- Delete: `apps/timing/index.html`, `apps/timing/js/{main,view,board,control,setup,tap,live,api,dom,bridge-view}.js`, `apps/timing/test/view.test.js`, `apps/timing/test/browser/{board,screens,assembled,bridge}.test.js`
- Move (`git mv`): `apps/timing/css/app.css` → `apps/timing/public/app.css`; `apps/timing/js/{format,bridge,outbox,sim-port}.js` → `apps/timing/public/`
- Copy: `apps/accounts/public/mark.svg` → `apps/timing/public/mark.svg`
- Modify: `apps/timing/package.json` (`"files": ["public"]`), `apps/timing/tsconfig.json` (include `public/**/*.js`), `apps/timing/test/{format,outbox,bridge}.test.js` (import from `../public/`), `apps/timing/test/server/helpers.js` (`signUp` makes a personal space; `startTiming` accepts `build`, `keys`), `apps/timing/test/server/static.test.js`, `apps/timing/server/routes.js`, `tools/assemble.js`, `tools/test/assemble.test.js`
- Create: `apps/timing/server/spaces.js`, `server/respond.js`, `server/page-access.js`, `server/page-routes.js`, `server/views/layout.js`, `server/views/notice.js`
- Test: `apps/timing/test/server/pages.test.js`, `tools/test/assemble.test.js`

**Interfaces:**
- Consumes: `html`, `safe` (Task 2); `withSession`, `displayName` (`server/auth.js`); `can` (`@tinylap/auth`); the `kind` claim (Task 1).
- Produces:
  - `spacesOf(claims)` → `Space[]`, `Space = { id, role, kind: 'personal' | 'club', name, base }` (`base` is `/personal` or `/clubs/<id>`); `spaceFor(spaces, clubId | undefined)` → `Space | null`; `spacePath(rest)` → `RegExp` whose group 1 is the club id (undefined for `/personal`), further groups after it.
  - `page(request, status, body, { headers?, scriptHashes? })`, `seeOther(location, headers?)`, `pageCsp(request, scriptHashes?)` (respond.js). Both mark `credentials: true`.
  - `pageRoute(action, handler, { write? })` (page-access.js): sets `request.spaces`, `request.space`, `request.workspaceId`, `request.userId`, `request.displayName`; 303 to sign-in when signed out (GET keeps the path in `returnTo`, POST returns to `/`); 303 from `/clubs/<personal id>/…` to `/personal/…`; 404 page if not a member; 403 page if the role may not or a write is cross-origin; sets the `__Host-tl-space` cookie to the space's `base`.
  - `SCREENS` and `layout(request, { title, body, screen?, scripts?, importMap?, head?, watcher?, big? })` (views/layout.js); `asset(request, path)` → URL (`/v/<build>/<path>` in production, `/<path>` in development).
  - `startPage(request)`, `notFoundPage(request)`, `forbiddenPage(request, detail?)`, `unavailablePage(request)` (views/notice.js).
  - `pageRoutes` (page-routes.js): `GET /`, `GET /personal` and `/clubs/<id>` (303 to the board), and a final catch-all answering the not-found page for any other space path. Later tasks insert their routes **before** the catch-all.
  - `startTiming({ build?, keys?, … })` passes `build` and `keys` to `createHandler`; `createHandler` stores `keys` in the request context as `request.keys`.
  - `assemble(appDir, outDir, sha)` accepts an app without `index.html`: it copies `files` and packages under `v/<sha>/` and writes no page.

- [ ] **Step 1: Move and delete files**

```bash
cd apps/timing
mkdir -p public
git mv css/app.css public/app.css
git mv js/format.js js/bridge.js js/outbox.js js/sim-port.js public/
git rm -q index.html js/main.js js/view.js js/board.js js/control.js js/setup.js js/tap.js js/live.js js/api.js js/dom.js js/bridge-view.js test/view.test.js test/browser/board.test.js test/browser/screens.test.js test/browser/assembled.test.js test/browser/bridge.test.js
cp ../accounts/public/mark.svg public/mark.svg
cd ../..
```

In `test/format.test.js`, `test/outbox.test.js` and `test/bridge.test.js`, change `'../js/` to `'../public/` in the imports. In `apps/timing/package.json` set `"files": ["public"]`. In `apps/timing/tsconfig.json` set `"include": ["public/**/*.js", "server/**/*.js"]`.

Run: `pnpm --filter @tinylap/timing-app test`
Expected: the remaining unit and server tests pass except `static.test.js`'s first test (there is no `index.html` any more).

- [ ] **Step 2: `assemble` without `index.html` (test first)**

Append to `tools/test/assemble.test.js`:

```js
test('an app without index.html gets its files and packages and no page', () => {
  const { app, out } = fixture();
  writeFileSync(join(app, 'package.json'), JSON.stringify({ files: ['css'], dependencies: { '@tinylap/fmt': 'workspace:*' } }));
  rmSync(join(app, 'index.html'));
  assemble(app, out, SHA);
  assert.equal(existsSync(join(out, 'index.html')), false);
  assert.equal(readFileSync(join(out, 'v', SHA, 'css', 'a.css'), 'utf8'), 'a{}');
  assert.ok(existsSync(join(out, 'v', SHA, 'pkg', 'fmt', 'index.js')));
});
```

(add `rmSync` to the `node:fs` import). Run `pnpm --filter @tinylap/tools test`: FAIL (ENOENT on index.html). Then in `tools/assemble.js`:

```js
export function assemble(appDir, outDir, sha) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/.test(sha)) {
    throw new Error(`assemble: expected a git sha (7-40 lowercase hex), got ${JSON.stringify(sha)}`);
  }
  // Apps whose server renders every page (accounts, timing) have no index.html.
  const page = join(appDir, 'index.html');
  const html = existsSync(page) ? readFileSync(page, 'utf8') : null;
  if (html !== null) {
    const count = html.split(BASE).length - 1;
    if (count !== 1) throw new Error(`assemble: index.html must contain exactly one ${BASE}, found ${count}`);
  }

  const tree = join(outDir, 'v', sha);
  mkdirSync(tree, { recursive: true });
  const { files = [] } = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
  for (const entry of files) {
    if (entry !== 'index.html') cpSync(join(appDir, entry), join(tree, entry), { recursive: true, filter: skip });
  }
  for (const [segment, root] of packageRoots(appDir)) {
    cpSync(root, join(tree, 'pkg', segment), { recursive: true, dereference: true, filter: skip });
  }
  if (html !== null) writeFileSync(join(outDir, 'index.html'), html.replace(BASE, `<base href="/v/${sha}/">`));
  gzipTree(outDir);
}
```

(add `existsSync` to its `node:fs` import; keep the rest of the file). Run `pnpm --filter @tinylap/tools test`: PASS.

- [ ] **Step 3: Write the failing page tests**

`apps/timing/test/server/pages.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The page shell and the space addresses (spec §3, §4.2): the start page,
// / sending you to your last space, /clubs/<id> and /personal, sign-in
// redirects, the not-found and forbidden pages, and the account menu.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { removeMember } from '../../../accounts/server/workspaces.js';
import { pageRoute } from '../../server/page-access.js';
import { page } from '../../server/respond.js';
import { spacePath } from '../../server/spaces.js';
import { html } from '../../server/views/html.js';
import { layout } from '../../server/views/layout.js';
import { routes } from '../../server/routes.js';
import { startTiming } from './helpers.js';

// A test page behind pageRoute, so the access rules are tested before any real screen exists.
const probe = {
  pattern: spacePath('probe'),
  credentials: true,
  methods: {
    GET: pageRoute('timing.run', (request) => page(request, 200, layout(request, { title: 'Probe', body: html`<p id="probe">${request.space.name}</p>` }))),
    POST: pageRoute('timing.delete', (request) => page(request, 200, layout(request, { title: 'Probe', body: html`<p>posted</p>` })), { write: true }),
  },
};

let app;
let ana;
let ben;
let zed;
let office;
let anaLogin;
let benLogin;
let zedLogin;

before(async () => {
  // First, so the space catch-all doesn't answer for it.
  app = await startTiming({ routes: [probe, ...routes] });
  ana = await app.signUp('Ana <b>');
  ben = await app.signUp('Ben');
  zed = await app.signUp('Zed');
  office = app.club(ana, 'Office & Co');
  app.join(ana, office.id, ben);
  anaLogin = await app.login(ana);
  benLogin = await app.login(ben);
  zedLogin = await app.login(zed);
});
after(() => app.close());

const get = (who, path, headers = {}) => app.api(who, 'GET', path, undefined, { accept: 'text/html', ...headers });
const locationOf = (res) => res.headers.get('location');

test('signed out, / is the start page with Sign in', async () => {
  const res = await get(null, '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.text();
  assert.match(body, /<title>TinyLap Timing<\/title>/);
  assert.match(body, /href="\/auth\/login\?returnTo=%2F">Sign in</);
  assert.doesNotMatch(body, /workspace/i);
});

test('signed in, / goes to your personal board, or the space you used last', async () => {
  let res = await get(anaLogin, '/');
  assert.equal(res.status, 303);
  assert.equal(locationOf(res), '/personal/board');
  res = await get(anaLogin, `/clubs/${office.id}/probe`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('__Host-tl-space='));
  assert.match(cookie, new RegExp(`^__Host-tl-space=%2Fclubs%2F${office.id}; Path=/; Max-Age=\\d+; HttpOnly; Secure; SameSite=Lax$`));
  res = await get(anaLogin, '/', { cookie: `${anaLogin.jar.header()}; ${cookie.split(';')[0]}` });
  assert.equal(locationOf(res), `/clubs/${office.id}/board`);
  // A space you aren't in is ignored.
  res = await get(zedLogin, '/', { cookie: `${zedLogin.jar.header()}; ${cookie.split(';')[0]}` });
  assert.equal(locationOf(res), '/personal/board');
});

test('a space path names the space; its own id under /clubs goes to /personal', async () => {
  const personal = await get(anaLogin, '/personal/probe');
  assert.equal(personal.status, 200);
  assert.match(await personal.text(), /<p id="probe">Personal<\/p>/);
  const club = await (await get(anaLogin, `/clubs/${office.id}/probe`)).text();
  assert.match(club, /<p id="probe">Office &amp; Co<\/p>/);
  const me = await (await get(anaLogin, '/auth/me', { accept: 'application/json' })).json();
  const own = me.workspaces.find((w) => w.id !== office.id).id;
  const redirect = await get(anaLogin, `/clubs/${own}/probe?x=1`);
  assert.equal(redirect.status, 303);
  assert.equal(locationOf(redirect), '/personal/probe?x=1');
  assert.equal(locationOf(await get(anaLogin, `/clubs/${office.id}`)), `/clubs/${office.id}/board`);
  assert.equal(locationOf(await get(anaLogin, '/personal')), '/personal/board');
});

test('signed out, a space page sends you to sign in and back', async () => {
  const res = await get(null, `/clubs/${office.id}/probe?big`);
  assert.equal(res.status, 303);
  assert.equal(locationOf(res), `/auth/login?returnTo=${encodeURIComponent(`/clubs/${office.id}/probe?big`)}`);
  const posted = await app.api(null, 'POST', `/clubs/${office.id}/probe`, undefined, { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(locationOf(posted), '/auth/login?returnTo=%2F');
});

test('not a member, or removed from the club: the not-found page', async () => {
  const stranger = await get(zedLogin, `/clubs/${office.id}/probe`);
  assert.equal(stranger.status, 404);
  assert.match(stranger.headers.get('content-type'), /^text\/html/);
  assert.match(await stranger.text(), /<h1>Not found<\/h1>/);
  assert.equal((await get(anaLogin, `/clubs/${office.id}/nothing`)).status, 404);
  const removed = await app.signUp('Cy');
  app.join(ana, office.id, removed);
  removeMember(app.suite.accounts.db, ana.id, office.id, removed.id);
  assert.equal((await get(await app.login(removed), `/clubs/${office.id}/probe`)).status, 404);
});

test('a role that may not, or a form from elsewhere: the forbidden page', async () => {
  const member = await app.api(benLogin, 'POST', `/clubs/${office.id}/probe`, undefined, { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(member.status, 403);
  assert.match(await member.text(), /<h1>Not allowed<\/h1>/);
  const elsewhere = await app.api(anaLogin, 'POST', `/clubs/${office.id}/probe`, undefined, { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
  assert.equal(elsewhere.status, 403);
  assert.equal((await app.api(anaLogin, 'POST', `/clubs/${office.id}/probe`, undefined, { 'content-type': 'application/x-www-form-urlencoded' })).status, 200);
});

test('the navbar: brand, screens, and the account menu with your spaces and Sign out', async () => {
  const body = await (await get(anaLogin, `/clubs/${office.id}/probe`)).text();
  assert.match(body, /<a class="navbar-brand" href="\/">/);
  for (const [path, label] of [['board', 'Board'], ['race', 'Race'], ['tap', 'Tap'], ['setup', 'Setup'], ['bridge', 'Bridge']]) {
    assert.match(body, new RegExp(`href="/clubs/${office.id}/${path}"[^>]*>${label}</a>`));
  }
  assert.match(body, /<details class="nav-account">\s*<summary[^>]*>Ana &lt;b&gt;<\/summary>/);
  assert.match(body, /href="\/personal\/board"[^>]*>Personal<\/a>/);
  assert.match(body, new RegExp(`href="/clubs/${office.id}/board" aria-current="true"[^>]*>Office &amp; Co</a>`));
  assert.match(body, /<form method="post" action="\/auth\/logout">\s*<button[^>]*>Sign out<\/button>/);
  assert.match(body, /<link rel="stylesheet" href="\/pkg\/palace-ui\/palace.css">/);
  assert.match(body, /<link rel="icon" href="\/public\/mark.svg"/);
  assert.doesNotMatch(body, /<script/);
});

test('in production every asset is under /v/<build>/', async () => {
  const prod = await startTiming({ build: 'abc1234' });
  const user = await prod.signUp('Pia');
  const body = await (await prod.api(null, 'GET', '/', undefined, { accept: 'text/html' })).text();
  assert.match(body, /href="\/v\/abc1234\/pkg\/palace-ui\/palace.css"/);
  assert.match(body, /href="\/v\/abc1234\/public\/app.css"/);
  assert.ok(user);
  await prod.close();
});
```

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL, `page-access.js` and the other new modules don't exist.

- [ ] **Step 4: Test helper changes**

In `apps/timing/test/server/helpers.js`:
- import `createPersonalWorkspace` alongside `createClub` from `'../../../accounts/server/workspaces.js'`;
- `signUp` becomes

```js
  /** A new accounts user with their personal space, as a real sign-up makes. */
  const signUp = async (name) => {
    const { user } = await suite.signInUser(undefined, name);
    createPersonalWorkspace(db, user.id, name);
    return user;
  };
```

- `api(who, method, path, body, headers)` passes `redirect: 'manual'` to `fetch`, so tests see the 303s pages answer (no existing test relies on following a redirect through `api`);
- the keys made for `createAuth` are passed on: `handler = createHandler({ appDir, log: false, store, hub, engine, auth, keys, publicUrl: base, now, ...rest });` with `const keys = [{ id: 'k1', key: randomBytes(32) }];` defined once and used for both.

In `apps/timing/server/app.js` `createHandler`, add `keys` to the options typedef and `keys: options.keys ?? null,` to `context`. In `server/main.js` pass `keys` to `createHandler`.

- [ ] **Step 5: `server/spaces.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Spaces (spec §3): a person's own space at /personal, each club at
// /clubs/<id>. They come from the access token's workspaces claim; "kind"
// says which is personal. Tokens from before accounts sent "kind" list the
// personal space first, so without any "kind" the first entry is personal.

/**
 * @typedef {{ id: string, role: string, kind: 'personal' | 'club', name: string, base: string }} Space
 * @param {{ workspaces?: { id: string, role: string, name?: string, kind?: string }[] }} claims
 * @returns {Space[]}
 */
export function spacesOf(claims) {
  const list = claims.workspaces ?? [];
  const marked = list.some((w) => w.kind);
  const personalId = (marked ? list.find((w) => w.kind === 'personal') : list[0])?.id ?? null;
  return list.map((w) => {
    const personal = w.id === personalId;
    return { id: w.id, role: w.role, kind: personal ? 'personal' : 'club', name: personal ? 'Personal' : w.name ?? 'Club', base: personal ? '/personal' : `/clubs/${w.id}` };
  });
}

/** The space a path names: a club by id, or (no id) your personal space. @param {Space[]} spaces @param {string | undefined} clubId */
export const spaceFor = (spaces, clubId) => (clubId === undefined ? spaces.find((s) => s.kind === 'personal') : spaces.find((s) => s.id === clubId)) ?? null;

/** /personal/<rest> or /clubs/<id>/<rest>; group 1 is the club id, then rest's own groups. @param {string} rest */
export const spacePath = (rest) => new RegExp(`^/(?:personal|clubs/([^/]+))/${rest}$`);
```

- [ ] **Step 6: `server/respond.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Page responses (spec §4.2): HTML with the page CSP, never cached, never
// CORS (credentials: true), and 303s for POST/redirect/GET.

/** @param {any} request @param {string[]} [scriptHashes] e.g. 'sha256-…' for an import map */
export function pageCsp(request, scriptHashes = []) {
  const issuer = request.auth ? ` ${new URL(request.auth.issuer).origin}` : '';
  return [
    "default-src 'self'",
    `script-src 'self'${scriptHashes.map((h) => ` '${h}'`).join('')}`,
    // Inline styles only, for driver colour swatches (as the planner allows).
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    `form-action 'self'${issuer}`,
    "frame-ancestors 'none'",
  ].join('; ');
}

/** @param {any} request @param {number} status @param {unknown} body @param {{ headers?: Record<string, any>, scriptHashes?: string[] }} [options] */
export const page = (request, status, body, { headers = {}, scriptHashes = [] } = {}) => ({
  status,
  credentials: true,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': pageCsp(request, scriptHashes), 'Cache-Control': 'no-store', ...headers },
  body: String(body),
});

/** @param {string} location @param {Record<string, any>} [headers] */
export const seeOther = (location, headers = {}) => ({ status: 303, credentials: true, headers: { Location: location, 'Cache-Control': 'no-store', ...headers }, body: '' });
```

- [ ] **Step 7: `server/views/layout.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The shell every timing page shares (spec §4.2), modelled on accounts'
// layout.js: palace's stylesheets, the TinyLap mark, a navbar with the
// space's screens and the account menu, and only external scripts.
import { html } from './html.js';

export const SCREENS = /** @type {const} */ ([['board', 'Board'], ['race', 'Race'], ['tap', 'Tap'], ['setup', 'Setup'], ['bridge', 'Bridge']]);

/** An asset's URL: versioned under /v/<build>/ in production. @param {any} request @param {string} path without a leading slash */
export const asset = (request, path) => (request.build && request.build !== 'dev' ? `/v/${request.build}/${path}` : `/${path}`);

function accountMenu(request) {
  if (!request.session) return null;
  const current = request.space?.id;
  return html`<details class="nav-account">
  <summary class="btn btn-sm btn-outline">${request.displayName ?? 'Account'}</summary>
  <div class="nav-account-menu">
    <p class="nav-account-label">Your spaces</p>
    <ul>${(request.spaces ?? []).map((s) => html`<li><a href="${s.base}/board"${s.id === current ? html` aria-current="true"` : null}>${s.name}</a></li>`)}</ul>
    <a href="${request.auth.accountUrl}">Account</a>
    <form method="post" action="/auth/logout">
      <button type="submit" class="nav-account-signout">Sign out</button>
    </form>
  </div>
</details>`;
}

/**
 * @param {any} request
 * @param {{ title: string, body: unknown, screen?: string | null, scripts?: string[], importMap?: unknown, head?: unknown, watcher?: boolean, big?: boolean }} page
 */
export function layout(request, { title, body, screen = null, scripts = [], importMap = null, head = null, watcher = false, big = false }) {
  const space = watcher ? null : request.space;
  const signIn = !request.session && !watcher ? html`<a class="btn btn-sm btn-outline" href="/auth/login?${new URLSearchParams({ returnTo: request.url.pathname + request.url.search })}">Sign in</a>` : null;
  const bigLink = big ? request.url.pathname : `${request.url.pathname}?big`;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${title === 'TinyLap Timing' ? title : `${title} · TinyLap Timing`}</title>
<link rel="stylesheet" href="${asset(request, 'pkg/palace-ui/palace.css')}">
<link rel="stylesheet" href="${asset(request, 'pkg/design/design.css')}">
<link rel="stylesheet" href="${asset(request, 'public/app.css')}">
<link rel="icon" href="${asset(request, 'public/mark.svg')}" type="image/svg+xml">
${importMap}${scripts.map((s) => html`<script type="module" src="${asset(request, `public/${s}`)}"></script>\n`)}${head}</head>
<body${big ? html` class="big"` : null}>
<nav class="navbar">
  <a class="navbar-brand" href="/"><img src="${asset(request, 'public/mark.svg')}" alt="" width="24" height="24"> TinyLap Timing</a>
  ${space ? html`<ul class="nav-tabs">${SCREENS.map(([id, label]) => html`<li><a class="nav-tab" href="${space.base}/${id}"${id === screen ? html` aria-current="page"` : null}>${label}</a></li>`)}</ul>` : null}
  <div class="navbar-right">
    ${screen === 'board' || watcher ? html`<span class="live-status" id="live-status" data-state="off" hidden></span>
    <a class="btn btn-sm btn-outline" href="${bigLink}">${big ? 'Leave big screen' : 'Big screen'}</a>` : null}
    ${watcher ? null : accountMenu(request)}${signIn}
  </div>
</nav>
<main>
${body}
</main>
</body>
</html>
`;
}
```

- [ ] **Step 8: `server/views/notice.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The start page and the notices (spec §6.6): the brand lockup, a
// card-static, and what to do next, as accounts' pages do it.
import { html } from './html.js';
import { asset, layout } from './layout.js';

function notice(request, { title, heading = title, text, action }) {
  return layout(request, {
    title,
    body: html`<section class="container-narrow page-header notice">
  <p class="brand-lockup"><img src="${asset(request, 'public/mark.svg')}" alt="" width="32" height="32"><span class="brand">TinyLap Timing</span></p>
  <h1>${heading}</h1>
  <div class="card-static stack-md">
    <p>${text}</p>
    ${action ? html`<p><a class="btn btn-primary" href="${action.href}">${action.label}</a></p>` : null}
  </div>
</section>`,
  });
}

export const startPage = (request) => notice(request, {
  title: 'TinyLap Timing',
  heading: 'Lap times, live',
  text: 'Time your track from a decoder on USB or Wi-Fi, or tap laps by hand, and show the board on every screen.',
  action: { href: '/auth/login?returnTo=%2F', label: 'Sign in' },
});

export const notFoundPage = (request) => notice(request, {
  title: 'Not found',
  text: "There's nothing at this address, or it belongs to a club you're not in.",
  action: { href: '/', label: 'Go to your board' },
});

export const forbiddenPage = (request, detail = "Your role in this club can't do this.") => notice(request, {
  title: 'Not allowed',
  text: detail,
  action: { href: '/', label: 'Go to your board' },
});

export const unavailablePage = (request) => notice(request, {
  title: 'Not available',
  text: "Timing can't read or store anything right now. Try again in a minute.",
});
```

Note: `startPage`'s `<h1>` reads "Lap times, live" and the page `<title>` "TinyLap Timing"; the start-page test checks the title.

- [ ] **Step 9: `server/page-access.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Access to space pages (spec §3, §9): signed out goes to sign-in and comes
// back; a club you're not in is the not-found page; a role that may not, or
// a form from another site, the forbidden page. The space you open is
// remembered for /.
import { can } from '@tinylap/auth';
import { displayName, withSession } from './auth.js';
import { page, seeOther } from './respond.js';
import { spaceFor, spacesOf } from './spaces.js';
import { forbiddenPage, notFoundPage, unavailablePage } from './views/notice.js';

export const SPACE_COOKIE = '__Host-tl-space';
const YEAR = 365 * 24 * 3600;

/** The signed-in person's name for the navbar; never fails a page. */
async function nameOf(request) {
  try {
    return await displayName(request);
  } catch {
    return null;
  }
}

/** Fills request.spaces and request.displayName for any page with a session. */
export async function withAccount(request) {
  if (!request.session) return;
  request.spaces = spacesOf(request.session.claims);
  request.displayName = await nameOf(request);
}

/** @param {any} response @param {{ base: string }} space */
function rememberSpace(response, space) {
  const cookie = `${SPACE_COOKIE}=${encodeURIComponent(space.base)}; Path=/; Max-Age=${YEAR}; HttpOnly; Secure; SameSite=Lax`;
  const prior = response.headers?.['Set-Cookie'];
  return { ...response, headers: { ...response.headers, 'Set-Cookie': [...(prior ? [].concat(prior) : []), cookie] } };
}

/**
 * @param {import('@tinylap/auth').Action} action
 * @param {(request: any, match: RegExpExecArray) => any} handler
 * @param {{ write?: boolean }} [options]
 */
export function pageRoute(action, handler, { write = false } = {}) {
  return withSession(async (request, match) => {
    const { req, url } = request;
    const refuse = (response) => {
      req.resume();
      return response;
    };
    if (!request.session) {
      return refuse(seeOther(`/auth/login?${new URLSearchParams({ returnTo: req.method === 'GET' ? url.pathname + url.search : '/' })}`));
    }
    await withAccount(request);
    const space = spaceFor(request.spaces, match[1]);
    if (match[1] && space?.kind === 'personal') return refuse(seeOther(url.pathname.replace(/^\/clubs\/[^/]+/, '/personal') + url.search));
    if (!space) return refuse(page(request, 404, notFoundPage(request)));
    request.space = space;
    if (!can(request.session.claims, space.id, action)) return refuse(page(request, 403, forbiddenPage(request)));
    if (write && !request.auth.bff.requireSameOrigin(req)) return refuse(page(request, 403, forbiddenPage(request, "Change timing from its own pages.")));
    if (!request.store) return refuse(page(request, 503, unavailablePage(request)));
    request.workspaceId = space.id;
    request.userId = request.session.userId;
    request.store.ensureWorkspace(space.id);
    return rememberSpace(await handler(request, match), space);
  });
}
```

- [ ] **Step 10: `server/page-routes.js` and the routes list**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every page and form route (spec §3). Feature tasks add their routes to
// SCREEN_ROUTES; the catch-all stays last.
import { withSession } from './auth.js';
import { SPACE_COOKIE, pageRoute, withAccount } from './page-access.js';
import { page, seeOther } from './respond.js';
import { spacesOf } from './spaces.js';
import { notFoundPage, startPage } from './views/notice.js';

const COOKIE = new RegExp(`(?:^|;\\s*)${SPACE_COOKIE}=([^;]+)`);

/** The cookie's space, if it is still one of yours. */
function lastSpace(request) {
  const raw = COOKIE.exec(String(request.req.headers.cookie ?? ''))?.[1];
  const base = raw ? decodeURIComponent(raw) : null;
  const spaces = spacesOf(request.session.claims);
  return spaces.find((s) => s.base === base) ?? spaces.find((s) => s.kind === 'personal') ?? spaces[0] ?? null;
}

const home = withSession(async (request) => {
  if (!request.session) return page(request, 200, startPage(request));
  const space = lastSpace(request);
  if (!space) {
    await withAccount(request);
    return page(request, 404, notFoundPage(request));
  }
  return seeOther(`${space.base}/board`);
});

/** @type {any[]} Feature tasks add their page and form routes here. */
export const SCREEN_ROUTES = [];

export const pageRoutes = [
  { pattern: /^\/$/, credentials: true, methods: { GET: home } },
  { pattern: /^\/(?:personal|clubs\/([^/]+))\/?$/, credentials: true, methods: { GET: pageRoute('timing.run', (request) => seeOther(`${request.space.base}/board`)) } },
  ...SCREEN_ROUTES,
  // Any other space path: the not-found page, after the access checks.
  { pattern: /^\/(?:personal|clubs\/([^/]+))\/.*$/, credentials: true, methods: { GET: pageRoute('timing.run', (request) => page(request, 404, notFoundPage(request))) } },
];
```

In `server/routes.js`, import `pageRoutes` and put `...pageRoutes,` right after `...authRoutes,`. Because `SCREEN_ROUTES` is spread when `page-routes.js` loads, feature tasks add routes by editing the `SCREEN_ROUTES` array literal in this file (import their route arrays at the top and spread them in).

- [ ] **Step 11: Static test and styles**

In `apps/timing/test/server/static.test.js` replace the first test with:

```js
test('the app CSS, the mark and the timing package are served as files', async () => {
  for (const [path, type] of [['/public/app.css', /css/], ['/public/mark.svg', /svg/], ['/pkg/timing/index.js', /javascript/], ['/pkg/palace-ui/palace.css', /css/]]) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), type, path);
    await res.body?.cancel();
  }
});
```

Using the `frontend-design` skill, append to `public/app.css` the styles for what this task renders. **The navbar's right side must line up:** `.navbar-right { display: flex; align-items: center; gap: var(--p-space-sm); }`, and the live status, the Big screen link, the account menu's `<summary>` and Sign in all share one height and baseline (the `btn-sm` box: same padding, border and line height); check it in a screenshot at 1280 px and 390 px, against the user's report that "LIVE", "Big screen" and the name sat at different heights. The rest: `.navbar-brand img` (vertical alignment), `.nav-tabs` as a list (`list-style: none; margin: 0; padding: 0; display: flex`), `.nav-account` (`position: relative`), `.nav-account-menu` (a palace-styled panel: `position: absolute; right: 0; top: calc(100% + 4px); min-width: 14rem; background: var(--p-surface); color: var(--p-text); border: var(--p-border-width) solid var(--p-text); box-shadow: var(--p-shadow-md) var(--p-text); padding: var(--p-space-md); z-index: 10;` with its list and links), `.nav-account summary` (no marker: `list-style: none` and `::-webkit-details-marker { display: none }`), `.nav-account-signout` styled as a menu item, `.notice` spacing. Keep what is already in `app.css` for the board and screens; later tasks reuse and adjust it. Mark the `.nav-account` menu `/* belongs upstream in palace-ui */`.

- [ ] **Step 12: Run everything**

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck && pnpm --filter @tinylap/tools test`
Expected: PASS. (`tools/test/import-map.test.js` now skips timing: it has no `index.html`.)

- [ ] **Step 13: Commit**

```bash
git add -A apps/timing tools
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing-app): render pages on the server, under /clubs/<id> and /personal"
```

---
### Task 4: Shared operations, and reading forms

Every change the JSON API and the pages make goes through one function, so each rule and message is written once. The JSON routes move onto them first; their existing tests guard the move.

**Files:**
- Create: `apps/timing/server/operations.js`, `apps/timing/server/form.js`
- Modify: `apps/timing/server/setup.js`, `apps/timing/server/control.js`, `apps/timing/server/ingest.js` (`postTap`)
- Test: `apps/timing/test/server/form.test.js`; the existing `setup.test.js`, `control.test.js`, `ingest.test.js` stay green

**Interfaces:**
- Produces from `operations.js`, every function `(request, input)` where `request` carries `store`, `engine`, `hub`, `now`, `plannerUrl`, `fetch`, `limiters`, `workspaceId`, `userId`; each returns `{ value }` or `{ error: OpError }`, `OpError = { problem: string, status: number, message: string, field?: string, retryAfter?: number }`:
  - `addDriver(request, { name, colour? })` → `{ value: { id, name, colour } }` (field `name` / `colour`)
  - `renameDriver(request, { id, name?, colour? })` → `{ value: driver }` (`not-found` 404 when missing)
  - `deleteDriver(request, { id })` → `{ value: true }`
  - `assignTransponder(request, { code, driverId })` (`driverId` null unassigns) → `{ value: { code, driverId } }` (field `code` / `driver`)
  - `setTrack(request, { link, name?, direction })` (async) → `{ value: { id, name, direction, snapshotKey } }` (field `link` / `name` / `direction`; problems `invalid-request`, `not-a-circuit` 422, `planner-unavailable` 502)
  - `pairDecoder(request, { name? })` → `{ value: { id, name, token } }` (`rate-limited` 429 with `retryAfter`)
  - `unpairDecoder(request, { id })` → `{ value: true }`
  - `rotateWatchLink(request)` → `{ value: { token } }`
  - `startSession(request, { kind, roster, durationSeconds?, countdownSeconds? })` → `{ value: publicSession }` (field `kind` / `roster` / `duration` / `countdown`; `conflict` 409)
  - `abortSession(request, { id })` → `{ value: publicSession }`
  - `tap(request, { driverId })` → `{ value: { stored, lapMs } }` (field `driver`; `rate-limited` 429)
  - `MAX_NAME = 60`, `COLOURS` (moved here from setup.js; setup.js re-exports `COLOURS` and `tokenHash` for existing importers)
- Produces from `form.js`: `readForm(request, max = 65_536)` → `{ form: URLSearchParams } | { error: response }` (415 for other content types, 413 past `max`).

- [ ] **Step 1: Write the failing form test**

`apps/timing/test/server/form.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readForm } from '../../server/form.js';

const requestOf = (body, type = 'application/x-www-form-urlencoded') => {
  const req = Readable.from([Buffer.from(body)]);
  req.headers = { 'content-type': type, 'content-length': String(Buffer.byteLength(body)) };
  return { req, origin: 'http://timing.test' };
};

test('a form body is read as URLSearchParams, repeated fields included', async () => {
  const { form } = await readForm(requestOf('kind=race&roster=a&roster=b&name=Ana+%26+Co'));
  assert.equal(form.get('kind'), 'race');
  assert.deepEqual(form.getAll('roster'), ['a', 'b']);
  assert.equal(form.get('name'), 'Ana & Co');
});

test('other types and big bodies are refused', async () => {
  assert.equal((await readForm(requestOf('{}', 'application/json'))).error.status, 415);
  assert.equal((await readForm(requestOf('a=1'.repeat(10), undefined), 8)).error.status, 413);
});
```

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL, `form.js` does not exist.

- [ ] **Step 2: Implement `server/form.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// HTML form bodies (spec §5): application/x-www-form-urlencoded, at most
// 64 KiB, read as URLSearchParams so repeated fields (roster) keep all values.
import { readBody } from './body.js';
import { mediaType } from './negotiate.js';
import { problem } from './responses.js';

/** @param {any} request @param {number} [max] */
export async function readForm(request, max = 64 * 1024) {
  const { req } = request;
  if (mediaType(req.headers['content-type']) !== 'application/x-www-form-urlencoded') {
    req.resume();
    return { error: problem(request, 'unsupported-media-type', 'Send the form as application/x-www-form-urlencoded.') };
  }
  const tooLarge = () => ({ error: problem(request, 'too-large', 'A form may be at most 64 KiB.') });
  if (Number(req.headers['content-length'] ?? 0) > max) {
    req.resume();
    return tooLarge();
  }
  const text = await readBody(req, max);
  if (text === null) return tooLarge();
  return { form: new URLSearchParams(text) };
}
```

Run: `pnpm --filter @tinylap/timing-app test`
Expected: `form.test.js` passes.

- [ ] **Step 3: Implement `server/operations.js`**

Move the logic out of `setup.js`, `control.js` and `ingest.js`'s `postTap` into these functions; the messages are written for people (pages show them as they are).

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every change to a space's timing (spec §5), shared by the JSON API and
// the pages so each rule and message exists once. Each returns { value } or
// { error: { problem, status, message, field?, retryAfter? } }.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DIRECTIONS } from '@tinylap/track-format';
import { transponderCode } from '@tinylap/timing';
import { publicSession } from './engine.js';
import { TrackError, fetchTrack } from './planner.js';

/** Driver colours, handed out in order (palace's accents first). */
export const COLOURS = ['#ff2d9b', '#2d9bff', '#ffb82d', '#2dff9b', '#b82dff', '#ff5a2d', '#2dfff0', '#f0ff2d'];
export const MAX_NAME = 60;
const MAX_DRIVERS = 200;
const MAX_ROSTER = 20;
const COLOUR = /^#[0-9a-f]{6}$/i;
const KINDS = new Set(['qualifying', 'race']);

/** SHA-256, hex: what is stored of a decoder token. @param {string} token */
export const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

/** @param {string} problem @param {number} status @param {string} message @param {string} [field] */
const fail = (problem, status, message, field) => ({ error: { problem, status, message, ...(field ? { field } : {}) } });
const invalid = (message, field) => fail('invalid-request', 422, message, field);
const missing = (what) => fail('not-found', 404, `There is no such ${what} here.`);

/** A name: trimmed, 1 to 60 characters, or null. @param {unknown} value */
const nameOf = (value) => {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= MAX_NAME ? name : null;
};
const colourOf = (value) => (typeof value === 'string' && COLOUR.test(value) ? value.toLowerCase() : null);
/** An integer in [min, max], `fallback` when absent, or null. */
const intIn = (value, min, max, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

const publishDrivers = (request) => request.hub.publish(request.workspaceId, 'drivers', request.store.drivers(request.workspaceId));

export function addDriver(request, { name: raw, colour: rawColour }) {
  const name = nameOf(raw);
  if (!name) return invalid('Give the driver a name of 1 to 60 characters.', 'name');
  const existing = request.store.drivers(request.workspaceId);
  if (existing.length >= MAX_DRIVERS) return invalid(`A space holds at most ${MAX_DRIVERS} drivers.`, 'name');
  const colour = rawColour === undefined ? COLOURS[existing.length % COLOURS.length] : colourOf(rawColour);
  if (!colour) return invalid('A colour is #rrggbb.', 'colour');
  const driver = { id: randomUUID(), name, colour };
  request.store.addDriver(request.workspaceId, driver);
  publishDrivers(request);
  return { value: driver };
}

export function renameDriver(request, { id, name: rawName, colour: rawColour }) {
  const current = request.store.driver(request.workspaceId, id);
  if (!current) return missing('driver');
  const name = rawName === undefined ? current.name : nameOf(rawName);
  if (!name) return invalid('Give the driver a name of 1 to 60 characters.', 'name');
  const colour = rawColour === undefined ? current.colour : colourOf(rawColour);
  if (!colour) return invalid('A colour is #rrggbb.', 'colour');
  request.store.updateDriver(request.workspaceId, current.id, { name, colour });
  publishDrivers(request);
  return { value: { id: current.id, name, colour } };
}

export function deleteDriver(request, { id }) {
  if (!request.store.deleteDriver(request.workspaceId, id)) return missing('driver');
  publishDrivers(request);
  request.engine.publishUnknown(request.workspaceId);
  return { value: true };
}

export function assignTransponder(request, { code: rawCode, driverId }) {
  const code = transponderCode(rawCode);
  if (!code) return invalid('A transponder code is 1 to 16 hex digits.', 'code');
  if (driverId !== null && (typeof driverId !== 'string' || !request.store.driver(request.workspaceId, driverId))) {
    return invalid('Pick one of this space’s drivers, or none.', 'driver');
  }
  request.engine.assign(request.workspaceId, code, driverId);
  return { value: { code, driverId } };
}

const TRACK_PROBLEMS = { invalid: ['invalid-request', 422], 'not-a-circuit': ['not-a-circuit', 422], unavailable: ['planner-unavailable', 502] };

export async function setTrack(request, { link, name: rawName, direction }) {
  if (!DIRECTIONS.includes(direction)) return invalid('Pick the direction you race.', 'direction');
  const name = rawName === undefined || rawName === '' ? 'Track' : nameOf(rawName);
  if (!name) return invalid('A track name is 1 to 60 characters.', 'name');
  if (typeof link !== 'string' || link.trim() === '') return invalid('Paste a share link from the planner.', 'link');
  let track;
  try {
    track = await fetchTrack(request.plannerUrl, link.trim(), { fetch: request.fetch });
  } catch (caught) {
    if (!(caught instanceof TrackError)) throw caught;
    const [problem, status] = TRACK_PROBLEMS[caught.code];
    return fail(problem, status, caught.message, 'link');
  }
  const ws = request.workspaceId;
  request.store.setTrack(ws, { ...track, name }, direction);
  request.engine.restartPractice(ws);
  request.hub.publish(ws, 'track', { track: { id: track.id, name }, direction, bests: request.store.personalBests(ws, track.id, direction) });
  return { value: { id: track.id, name, direction, snapshotKey: track.snapshotKey } };
}

export function pairDecoder(request, { name: rawName }) {
  const wait = request.limiters.pair.take(request.userId);
  if (wait) return { error: { problem: 'rate-limited', status: 429, message: `You paired a lot of decoders just now. Try again in ${wait} seconds.`, retryAfter: wait } };
  const name = rawName === undefined || rawName === '' ? 'Decoder' : nameOf(rawName);
  if (!name) return invalid('A decoder name is 1 to 60 characters.', 'name');
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  request.store.addDecoder(request.workspaceId, { id, name, tokenHash: tokenHash(token), createdAt: request.now() });
  return { value: { id, name, token } };
}

export function unpairDecoder(request, { id }) {
  if (!request.store.deleteDecoder(request.workspaceId, id)) return missing('decoder');
  return { value: true };
}

export function rotateWatchLink(request) {
  const old = request.store.workspace(request.workspaceId).watchToken;
  const token = randomBytes(16).toString('base64url');
  request.store.setWatchToken(request.workspaceId, token);
  if (old) request.hub.closeTagged(request.workspaceId, old);
  return { value: { token } };
}

export function startSession(request, { kind, roster, durationSeconds, countdownSeconds }) {
  if (!KINDS.has(kind)) return invalid('Pick a race or a qualifying.', 'kind');
  if (!Array.isArray(roster) || roster.length < 1 || roster.length > MAX_ROSTER) return invalid(`Pick 1 to ${MAX_ROSTER} drivers.`, 'roster');
  if (new Set(roster).size !== roster.length) return invalid('A driver can be on the roster only once.', 'roster');
  if (!roster.every((id) => typeof id === 'string' && request.store.driver(request.workspaceId, id))) return invalid('Every driver must be one of this space’s.', 'roster');
  const duration = intIn(durationSeconds, 10, 3600, 300);
  if (duration === null) return invalid('A session lasts 10 seconds to an hour.', 'duration');
  const countdown = intIn(countdownSeconds, 0, 30, 10);
  if (countdown === null) return invalid('The countdown is 0 to 30 seconds.', 'countdown');
  const result = request.engine.start(request.workspaceId, { kind, roster, durationMs: duration * 1000, countdownMs: kind === 'race' ? countdown * 1000 : 0 });
  if (result.error) return fail('conflict', 409, 'A qualifying or race is already running here.');
  return { value: publicSession(result.session) };
}

export function abortSession(request, { id }) {
  const ended = request.engine.abort(request.workspaceId, id);
  return ended ? { value: publicSession(ended) } : missing('running qualifying or race');
}

export function tap(request, { driverId }) {
  if (typeof driverId !== 'string' || !request.store.driver(request.workspaceId, driverId)) return invalid('Pick one of this space’s drivers.', 'driver');
  const wait = request.limiters.tap.take(request.userId);
  if (wait) return { error: { problem: 'rate-limited', status: 429, message: `That's a lot of taps. Try again in ${wait} seconds.`, retryAfter: wait } };
  const row = request.engine.tap(request.workspaceId, driverId);
  return { value: { stored: row !== null, lapMs: row?.lapMs ?? null } };
}
```

- [ ] **Step 4: Move the JSON routes onto the operations**

Add one adapter to `server/responses.js`:

```js
/** An operation's error as Problem Details. @param {{ origin: string }} request @param {{ problem: string, message: string, retryAfter?: number }} error */
export const opProblem = (request, error) =>
  problem(request, error.problem, error.message, error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
```

Then each JSON handler reads its body as now, calls the operation, and answers `opProblem(request, r.error)` on error or its existing success response. For example, in `setup.js`:

```js
async function addDriver(request) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const r = ops.addDriver(request, { name: body.name, colour: body.colour });
  return r.error ? opProblem(request, r.error) : json(201, r.value, NO_STORE);
}
```

with `import * as ops from './operations.js';` at the top. Do the same for `updateDriver` (`ops.renameDriver(request, { id: match[2], name: body.name, colour: body.colour })` → 200), `deleteDriver` (204), `putTransponder` (`ops.assignTransponder(request, { code: match[2], driverId: body.driverId })` → 200 `{ code, driverId }`; a missing `driverId` key in the body must still be refused, so pass `body.driverId === undefined ? '' : body.driverId`), `addDecoder` (201), `deleteDecoder` (204), `putTrack` (200), `rotateWatchToken` (200); in `control.js` `startSession` (`ops.startSession(request, { kind: body.kind, roster: body.roster, durationSeconds: body.durationSeconds, countdownSeconds: body.countdownSeconds })` → 201) and `abortSession` (`ops.abortSession(request, { id: match[2] })` → 200); in `ingest.js` `postTap` (`ops.tap(request, { driverId: body.driverId })` → 200). Delete the helpers they no longer use (`nameOf`, `colourOf`, `intIn`, `TRACK_PROBLEMS`, `publishDrivers`, the `KINDS`/`MAX_*` constants) and keep `export { COLOURS, tokenHash } from './operations.js';` in `setup.js` for `ingest.js` and the tests.

In `control.js` keep the JSON body's number check strict: `durationSeconds` and `countdownSeconds` must be numbers when present (`typeof body.durationSeconds === 'string'` → 422), since `intIn` also accepts the strings forms send.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @tinylap/timing-app test`
Expected: PASS: every existing JSON test still passes on the operations.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck
git add apps/timing/server apps/timing/test/server/form.test.js
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "refactor(timing-app): share one operation per change between the API and pages"
```

---
### Task 5: The setup page, with driver and transponder forms

**Use the `frontend-design` skill** for the page's markup and styles (palace classes; `card-static` for every form container; inline errors).

**Files:**
- Create: `apps/timing/server/views/setup.js`, `apps/timing/server/views/confirm.js`, `apps/timing/server/views/form-parts.js`, `apps/timing/server/setup-pages.js`
- Modify: `apps/timing/server/page-routes.js` (spread `setupPageRoutes` into `SCREEN_ROUTES`), `apps/timing/test/server/helpers.js` (add `form()`), `apps/timing/public/app.css`
- Test: `apps/timing/test/server/setup-pages.test.js`, `apps/timing/test/views.test.js`

**Interfaces:**
- Consumes: `pageRoute`, `page`, `seeOther`, `layout`, `html` (Tasks 2–3); `readForm`, `ops.*` (Task 4).
- Produces:
  - `form-parts.js`: `textField({ label, name, value, error, type?, required?, maxlength?, placeholder?, readonly?, labelHidden?, min?, max?, id })`, `selectField({ label, name, options: [{ value, label }], value, error, id })`, `errorSummary(error)`; an `error` is `{ field, message } | null`, and the field it names gets `aria-invalid="true"` and `aria-describedby` to its message.
  - `views/confirm.js`: `confirmPage(request, { title, text, action, button, back })` → a page with `<form method="post" action>` (a danger button) and a Cancel link to `back`.
  - `views/setup.js`: `setupPage(request, model)`, `model = { drivers, transponders, decoders, track, direction, watchToken, mayDelete, paired, errors, values }`, where `errors` and `values` are keyed by form: `'add-driver'`, `'rename:<id>'`, `'transponder:<code>'`, `'track'`, `'pair'`; `paired` is `{ id, name, token } | null`. Sections have ids `track`, `drivers`, `transponders`, `decoders`, `watchers`.
  - `setup-pages.js`: `renderSetup(request, status, { errors?, values?, paired? })` and `setupPageRoutes` for `GET <space>/setup`, `POST <space>/drivers`, `POST <space>/drivers/<id>`, `GET`/`POST <space>/drivers/<id>/delete`, `POST <space>/transponders/<code>`. (Task 6 adds track, decoder and watchers-link routes to the same array.)
  - Test helper `form(who, path, fields, headers?)`: a same-origin form POST (`application/x-www-form-urlencoded`, `redirect: 'manual'`).

- [ ] **Step 1: The `form()` test helper**

In `startTiming` (`test/server/helpers.js`), next to `api`:

```js
  /** A form post as `who` from the app's own pages; redirects are not followed. */
  function form(who, path, fields, headers = {}) {
    return fetch(base + path, {
      method: 'POST',
      redirect: 'manual',
      headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded', ...(who ? { cookie: who.jar.header() } : {}), ...headers },
      body: new URLSearchParams(fields),
    });
  }
```

and return it (`… login, api, form, close …`). `fields` may be an array of pairs for repeated names.

- [ ] **Step 2: Write the failing tests**

`apps/timing/test/server/setup-pages.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Setup as pages and forms (spec §3, §5, §6.4): drivers and transponders.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

let app;
let ana;
let owner;
let member;
let office;
let base;

before(async () => {
  app = await startTiming();
  ana = await app.signUp('Ana');
  const ben = await app.signUp('Ben');
  office = app.club(ana, 'Office');
  app.join(ana, office.id, ben);
  owner = await app.login(ana);
  member = await app.login(ben);
  base = `/clubs/${office.id}`;
});
after(() => app.close());

const get = (who, path) => app.api(who, 'GET', path, undefined, { accept: 'text/html' });
const drivers = () => app.store.drivers(office.id);

test('the setup page has a section per thing to set up', async () => {
  const res = await get(owner, `${base}/setup`);
  assert.equal(res.status, 200);
  const body = await res.text();
  for (const id of ['track', 'drivers', 'transponders', 'decoders', 'watchers']) assert.match(body, new RegExp(`<section[^>]* id="${id}"`), id);
  assert.match(body, new RegExp(`<form method="post" action="${base}/drivers"`));
  assert.match(body, /<label for="add-driver-name">New driver<\/label>/);
  assert.doesNotMatch(body, /workspace/i);
});

test('adding a driver is a form and a redirect back to the drivers', async () => {
  const res = await app.form(member, `${base}/drivers`, { name: '<b>Dan</b>' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${base}/setup#drivers`);
  assert.deepEqual(drivers().map((d) => d.name), ['<b>Dan</b>']);
  const body = await (await get(member, `${base}/setup`)).text();
  assert.match(body, /&lt;b&gt;Dan&lt;\/b&gt;/);
  assert.doesNotMatch(body, /<b>Dan<\/b>/);
});

test('a bad name comes back as the page, 422, the input kept and the field marked', async () => {
  const long = 'x'.repeat(61);
  const res = await app.form(member, `${base}/drivers`, { name: long });
  assert.equal(res.status, 422);
  const body = await res.text();
  assert.match(body, /Give the driver a name of 1 to 60 characters\./);
  assert.match(body, new RegExp(`<input[^>]*id="add-driver-name"[^>]*value="${long}"[^>]*aria-invalid="true"`));
  assert.equal(drivers().length, 1);
});

test('renaming a driver', async () => {
  const [dan] = drivers();
  const res = await app.form(member, `${base}/drivers/${dan.id}`, { name: 'Dan' });
  assert.equal(res.status, 303);
  assert.equal(drivers()[0].name, 'Dan');
});

test('deleting asks first, needs an admin, and unassigns the transponder', async () => {
  const [dan] = drivers();
  app.engine.assign(office.id, '4711', dan.id);
  assert.equal((await get(member, `${base}/drivers/${dan.id}/delete`)).status, 403);
  const ask = await get(owner, `${base}/drivers/${dan.id}/delete`);
  assert.equal(ask.status, 200);
  const body = await ask.text();
  assert.match(body, /<h1>Delete Dan\?<\/h1>/);
  assert.match(body, new RegExp(`<form method="post" action="${base}/drivers/${dan.id}/delete"`));
  assert.match(body, new RegExp(`<a[^>]*href="${base}/setup#drivers"[^>]*>Cancel</a>`));
  assert.equal((await app.form(member, `${base}/drivers/${dan.id}/delete`, {})).status, 403);
  const done = await app.form(owner, `${base}/drivers/${dan.id}/delete`, {});
  assert.equal(done.status, 303);
  assert.deepEqual(drivers(), []);
  assert.equal(app.store.transponders(office.id).find((t) => t.code === '4711').driverId, null);
});

test('assigning and unassigning a transponder', async () => {
  const added = await app.form(owner, `${base}/drivers`, { name: 'Eve' });
  assert.equal(added.status, 303);
  const [eve] = drivers();
  let res = await app.form(owner, `${base}/transponders/4711`, { driver: eve.id });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${base}/setup#transponders`);
  assert.equal(app.store.transponders(office.id).find((t) => t.code === '4711').driverId, eve.id);
  res = await app.form(owner, `${base}/transponders/4711`, { driver: '' });
  assert.equal(app.store.transponders(office.id).find((t) => t.code === '4711').driverId, null);
  res = await app.form(owner, `${base}/transponders/4711`, { driver: 'nobody' });
  assert.equal(res.status, 422);
  assert.match(await res.text(), /Pick one of this space’s drivers, or none\./);
});

test('a form from another site changes nothing', async () => {
  const before = drivers().length;
  const res = await app.form(owner, `${base}/drivers`, { name: 'Mallory' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
  assert.equal(res.status, 403);
  assert.match(await res.text(), /<h1>Not allowed<\/h1>/);
  assert.equal(drivers().length, before);
});

test('after signing out, resubmitting a form sends you to sign in and changes nothing', async () => {
  const before = drivers().length;
  const gil = await app.signUp('Gil');
  app.join(ana, office.id, gil);
  const fresh = await app.login(gil);
  await app.api(fresh, 'POST', '/auth/logout');
  const res = await app.form(fresh, `${base}/drivers`, { name: 'Late' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/auth/login?returnTo=%2F');
  assert.equal(drivers().length, before);
});
```

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL: the setup routes don't exist (the catch-all answers 404).

- [ ] **Step 3: `server/views/form-parts.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Form fields with palace's label-above-input look and accessible errors
// (spec §5): the field an error names is aria-invalid and described by it.
import { html } from './html.js';

/** @param {{ field?: string, message: string } | null | undefined} error @param {string} name */
const errorFor = (error, name) => (error && error.field === name ? error.message : null);

export function textField({ label, name, value = '', error = null, type = 'text', required = false, maxlength = null, placeholder = null, readonly = false, labelHidden = false, min = null, max = null, id }) {
  const message = errorFor(error, name);
  return html`<div class="field">
  <label for="${id}"${labelHidden ? html` class="visually-hidden"` : null}>${label}</label>
  <input type="${type}" id="${id}" name="${name}" value="${value}"${required ? html` required` : null}${readonly ? html` readonly` : null}${min !== null ? html` min="${min}"` : null}${max !== null ? html` max="${max}"` : null}${maxlength ? html` maxlength="${maxlength}"` : null}${placeholder ? html` placeholder="${placeholder}"` : null}${message ? html` aria-invalid="true" aria-describedby="${id}-error"` : null}>
  ${message ? html`<p class="field-error" id="${id}-error">${message}</p>` : null}
</div>`;
}

export function selectField({ label, name, options, value = '', error = null, labelHidden = false, id }) {
  const message = errorFor(error, name);
  return html`<div class="field">
  <label for="${id}"${labelHidden ? html` class="visually-hidden"` : null}>${label}</label>
  <select id="${id}" name="${name}"${message ? html` aria-invalid="true" aria-describedby="${id}-error"` : null}>
    ${options.map((o) => html`<option value="${o.value}"${o.value === value ? html` selected` : null}>${o.label}</option>`)}
  </select>
  ${message ? html`<p class="field-error" id="${id}-error">${message}</p>` : null}
</div>`;
}

/** A form-level message for errors that aren't about one field (rate limits, conflicts). */
export const errorSummary = (error) => (error && !error.field ? html`<p class="status status-error" role="alert">${error.message}</p>` : null);
```

- [ ] **Step 4: `server/views/confirm.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// "Delete Ana?": a destructive action asks on a page of its own with its
// own form (spec §2), so it works without JavaScript and never uses confirm().
import { html } from './html.js';
import { layout } from './layout.js';

export function confirmPage(request, { title, text, action, button, back, screen = 'setup' }) {
  return layout(request, {
    title,
    screen,
    body: html`<section class="container-narrow page-header stack-md">
  <h1>${title}</h1>
  <div class="card-static stack-md">
    <p>${text}</p>
    <form method="post" action="${action}" class="button-row">
      <button type="submit" class="btn btn-danger">${button}</button>
      <a class="btn btn-outline" href="${back}">Cancel</a>
    </form>
  </div>
</section>`,
  });
}
```

- [ ] **Step 5: `server/views/setup.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The setup page (spec §6.4): the track, drivers, transponders, decoders
// and the watchers link, each its own card-static section and forms.
import { html } from './html.js';
import { errorSummary, selectField, textField } from './form-parts.js';
import { layout } from './layout.js';

const DIRECTIONS = [{ value: 'ccw', label: 'Anticlockwise' }, { value: 'cw', label: 'Clockwise' }];
const DIRECTION_NAME = { cw: 'clockwise', ccw: 'anticlockwise' };
const when = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

const driverChip = (d) => html`<span class="driver" style="--driver: ${d.colour}">${d.name}</span>`;

function trackSection(request, m) {
  const base = request.space.base;
  const error = m.errors.track ?? null;
  const values = m.values.track ?? {};
  return html`<section class="card-static stack-md" id="track" aria-labelledby="track-title">
  <h2 class="h3" id="track-title">Track</h2>
  <p>${m.track ? html`Now: <strong>${m.track.name}</strong>, ${DIRECTION_NAME[m.direction]}.` : 'No track yet. Share a closed track from the planner and paste its link here.'}</p>
  <form method="post" action="${base}/track" class="stack-sm">
    ${errorSummary(error)}
    ${textField({ id: 'track-link', label: 'Planner link', name: 'link', type: 'url', required: true, placeholder: 'https://…/layouts/…', value: values.link ?? '', error })}
    ${textField({ id: 'track-name', label: 'Track name', name: 'name', maxlength: 60, value: values.name ?? m.track?.name ?? '', error })}
    ${selectField({ id: 'track-direction', label: 'Direction', name: 'direction', options: DIRECTIONS, value: values.direction ?? m.direction, error })}
    <button type="submit" class="btn btn-primary">Use this track</button>
  </form>
</section>`;
}

function driversSection(request, m) {
  const base = request.space.base;
  const addError = m.errors['add-driver'] ?? null;
  return html`<section class="card-static stack-md" id="drivers" aria-labelledby="drivers-title">
  <h2 class="h3" id="drivers-title">Drivers</h2>
  ${m.drivers.length ? html`<ul class="setup-list">${m.drivers.map((d) => {
    const error = m.errors[`rename:${d.id}`] ?? null;
    return html`<li class="setup-row">
    ${driverChip(d)}
    <form method="post" action="${base}/drivers/${d.id}" class="inline-form">
      ${textField({ id: `rename-${d.id}`, label: `New name for ${d.name}`, labelHidden: true, name: 'name', maxlength: 60, required: true, value: m.values[`rename:${d.id}`]?.name ?? d.name, error })}
      <button type="submit" class="btn btn-sm btn-outline">Rename</button>
    </form>
    ${m.mayDelete ? html`<a class="btn btn-sm btn-danger" href="${base}/drivers/${d.id}/delete">Delete</a>` : null}
  </li>`;
  })}</ul>` : html`<p class="empty">No drivers yet.</p>`}
  <form method="post" action="${base}/drivers" class="inline-form">
    ${errorSummary(addError)}
    ${textField({ id: 'add-driver-name', label: 'New driver', name: 'name', maxlength: 60, required: true, value: m.values['add-driver']?.name ?? '', error: addError })}
    <button type="submit" class="btn btn-primary">Add driver</button>
  </form>
</section>`;
}

function transpondersSection(request, m) {
  const base = request.space.base;
  const options = [{ value: '', label: '— none' }, ...m.drivers.map((d) => ({ value: d.id, label: d.name }))];
  const rows = [...m.transponders].sort((a, b) => Number(a.driverId !== null) - Number(b.driverId !== null) || a.code.localeCompare(b.code));
  return html`<section class="card-static stack-md" id="transponders" aria-labelledby="transponders-title">
  <h2 class="h3" id="transponders-title">Transponders</h2>
  ${rows.length ? html`<table class="setup-table">
    <thead><tr><th scope="col" class="num">Code</th><th scope="col">Driver</th></tr></thead>
    <tbody>${rows.map((t) => {
      const key = `transponder:${t.code}`;
      return html`<tr${t.driverId === null ? html` class="is-unknown"` : null}>
      <td class="num">${t.code}</td>
      <td><form method="post" action="${base}/transponders/${t.code}" class="inline-form">
        ${selectField({ id: `transponder-${t.code}`, label: `Driver for ${t.code}`, labelHidden: true, name: 'driver', options, value: m.values[key]?.driver ?? t.driverId ?? '', error: m.errors[key] ?? null })}
        <button type="submit" class="btn btn-sm btn-outline">Assign</button>
      </form></td>
    </tr>`;
    })}</tbody>
  </table>` : html`<p class="empty">Transponders show up here when a car first crosses the line.</p>`}
</section>`;
}

function decodersSection(request, m) {
  const base = request.space.base;
  const error = m.errors.pair ?? null;
  return html`<section class="card-static stack-md" id="decoders" aria-labelledby="decoders-title">
  <h2 class="h3" id="decoders-title">Decoders</h2>
  ${m.paired ? html`<div class="status status-info" role="status">
    <p><strong>${m.paired.name}</strong> is paired. Its token, shown only this once:</p>
    <p><code class="token">${m.paired.token}</code></p>
    <p>Decoder id: <code>${m.paired.id}</code>. Put both on the decoder now.</p>
  </div>` : null}
  ${m.decoders.length ? html`<ul class="setup-list">${m.decoders.map((d) => html`<li class="setup-row">
    <span>${d.name}</span>
    <span class="meta">${d.lastSeenAt ? html`seen <time datetime="${new Date(d.lastSeenAt).toISOString()}">${when(d.lastSeenAt)}</time>` : 'never seen'}</span>
    ${m.mayDelete ? html`<a class="btn btn-sm btn-danger" href="${base}/decoders/${d.id}/unpair">Unpair</a>` : null}
  </li>`)}</ul>` : null}
  <p>Pair a decoder by USB on the <a href="${base}/bridge">Bridge</a> page, or here if it only uses Wi-Fi:</p>
  <form method="post" action="${base}/decoders" class="inline-form">
    ${errorSummary(error)}
    ${textField({ id: 'pair-name', label: 'Decoder name', name: 'name', maxlength: 60, value: m.values.pair?.name ?? '', placeholder: 'Start line', error })}
    <button type="submit" class="btn btn-outline">Pair over Wi-Fi only</button>
  </form>
</section>`;
}

function watchersSection(request, m) {
  const base = request.space.base;
  const link = m.watchToken ? `${request.origin}/watch/${m.watchToken}` : null;
  return html`<section class="card-static stack-md" id="watchers" aria-labelledby="watchers-title">
  <h2 class="h3" id="watchers-title">Watchers link</h2>
  <p>Anyone with this link sees the board, read-only, without signing in.</p>
  ${link ? html`${textField({ id: 'watch-link', label: 'Watchers link', name: 'link', value: link, readonly: true })}
  <p><a class="btn btn-outline" href="${base}/watch-link/new">Make a new watchers link</a></p>` : html`<form method="post" action="${base}/watch-link">
    <button type="submit" class="btn btn-primary">Make a watchers link</button>
  </form>`}
</section>`;
}

export function setupPage(request, model) {
  const m = { errors: {}, values: {}, paired: null, ...model };
  return layout(request, {
    title: 'Setup',
    screen: 'setup',
    body: html`<div class="container stack-xl screen">
  <h1>Setup</h1>
  ${trackSection(request, m)}
  ${driversSection(request, m)}
  ${transpondersSection(request, m)}
  ${decodersSection(request, m)}
  ${watchersSection(request, m)}
</div>`,
  });
}
```

- [ ] **Step 6: `server/setup-pages.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Setup's pages and forms (spec §3, §6.4). Every form posts to a resource
// URL and answers 303 to the setup section it changed; a failure renders the
// page again with the error and what was typed.
import { can } from '@tinylap/auth';
import * as ops from './operations.js';
import { readForm } from './form.js';
import { pageRoute } from './page-access.js';
import { page, seeOther } from './respond.js';
import { spacePath } from './spaces.js';
import { confirmPage } from './views/confirm.js';
import { setupPage } from './views/setup.js';

/** The setup page from the store, with any errors and kept values. */
export function renderSetup(request, status, { headers = {}, ...extras } = {}) {
  const ws = request.workspaceId;
  const workspace = request.store.workspace(ws);
  return page(request, status, setupPage(request, {
    drivers: request.store.drivers(ws),
    transponders: request.store.transponders(ws),
    decoders: request.store.decoders(ws),
    track: workspace.trackId ? request.store.track(ws, workspace.trackId) : null,
    direction: workspace.direction,
    watchToken: workspace.watchToken,
    mayDelete: can(request.session.claims, ws, 'timing.delete'),
    ...extras,
  }), { headers });
}

/**
 * Runs an operation from a form: 303 to `section` on success, the setup page
 * with the error otherwise (422, or the operation's own status).
 */
export function afterForm(request, result, { key, values, section }) {
  if (!result.error) return seeOther(`${request.space.base}/setup#${section}`);
  const headers = result.error.retryAfter ? { 'Retry-After': String(result.error.retryAfter) } : undefined;
  return renderSetup(request, result.error.status, { errors: { [key]: result.error }, values: { [key]: values }, headers });
}

/** A form handler: read the body, then `run(request, form, match)`. */
const withForm = (run) => async (request, match) => {
  const { form, error } = await readForm(request);
  return error ?? run(request, form, match);
};

const addDriver = withForm((request, form) => {
  const values = { name: form.get('name') ?? '' };
  return afterForm(request, ops.addDriver(request, { name: values.name }), { key: 'add-driver', values, section: 'drivers' });
});

const renameDriver = withForm((request, form, match) => {
  const values = { name: form.get('name') ?? '' };
  return afterForm(request, ops.renameDriver(request, { id: match[2], name: values.name }), { key: `rename:${match[2]}`, values, section: 'drivers' });
});

function askDeleteDriver(request, match) {
  const driver = request.store.driver(request.workspaceId, match[2]);
  if (!driver) return renderSetup(request, 404);
  const base = request.space.base;
  return page(request, 200, confirmPage(request, {
    title: `Delete ${driver.name}?`,
    text: 'Their laps stay on the board as "former driver", and their transponders become unassigned.',
    action: `${base}/drivers/${driver.id}/delete`,
    button: 'Delete',
    back: `${base}/setup#drivers`,
  }));
}

const deleteDriver = withForm((request, _form, match) => afterForm(request, ops.deleteDriver(request, { id: match[2] }), { key: 'add-driver', values: {}, section: 'drivers' }));

const assignTransponder = withForm((request, form, match) => {
  const driver = form.get('driver') ?? '';
  const code = match[2].toUpperCase();
  return afterForm(request, ops.assignTransponder(request, { code, driverId: driver === '' ? null : driver }), { key: `transponder:${code}`, values: { driver }, section: 'transponders' });
});

const write = { write: true };

/** @type {any[]} Task 6 adds the track, decoder and watchers-link routes here. */
export const setupPageRoutes = [
  { pattern: spacePath('setup'), credentials: true, methods: { GET: pageRoute('timing.run', (request) => renderSetup(request, 200)) } },
  { pattern: spacePath('drivers'), credentials: true, methods: { POST: pageRoute('timing.setup', addDriver, write) } },
  { pattern: spacePath('drivers/([^/]+)'), credentials: true, methods: { POST: pageRoute('timing.setup', renameDriver, write) } },
  { pattern: spacePath('drivers/([^/]+)/delete'), credentials: true, methods: { GET: pageRoute('timing.delete', askDeleteDriver), POST: pageRoute('timing.delete', deleteDriver, write) } },
  { pattern: spacePath('transponders/([0-9A-Fa-f]{1,16})'), credentials: true, methods: { POST: pageRoute('timing.setup', assignTransponder, write) } },
];
```

In `server/page-routes.js`: `import { setupPageRoutes } from './setup-pages.js';` and `export const SCREEN_ROUTES = [...setupPageRoutes];`.

- [ ] **Step 7: Styles, and a view test for escaping in forms**

Append to `test/views.test.js`:

```js
import { textField } from '../server/views/form-parts.js';

test('fields escape their values and mark their errors', () => {
  const out = String(textField({ id: 'n', label: 'Name', name: 'name', value: '"><script>', error: { field: 'name', message: 'Too <long>' } }));
  assert.match(out, /value="&quot;&gt;&lt;script&gt;"/);
  assert.match(out, /aria-invalid="true" aria-describedby="n-error"/);
  assert.match(out, /<p class="field-error" id="n-error">Too &lt;long&gt;<\/p>/);
});
```

With the `frontend-design` skill, add to `public/app.css`: `.visually-hidden` (the standard clip pattern: `position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;`), `.field` (label above input, palace's input sizes, never `font: inherit` on inputs), `.field-error` (`color: var(--p-error)`, small), `[aria-invalid="true"]` (error border), `.inline-form` (fields and button on one row, wrapping), `.button-row` (flex, gap), `.setup-list`/`.setup-row`/`.setup-table` (aligned with the card's edge; codes right-aligned with their header), `tr.is-unknown`, `.token` (wraps, monospace). Keep the existing `.driver` swatch rule.

- [ ] **Step 8: Run tests, lint, typecheck, commit**

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck`
Expected: PASS.

```bash
git add apps/timing
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing-app): set up drivers and transponders with plain forms"
```

---
### Task 6: Setup: the track, decoders and the watchers link

**Use the `frontend-design` skill** for the paired-token notice and the confirmation pages.

**Files:**
- Modify: `apps/timing/server/setup-pages.js` (routes and handlers below; the `GET <space>/setup` handler becomes `showSetup`)
- Test: `apps/timing/test/server/setup-pages-more.test.js`

**Interfaces:**
- Consumes: `renderSetup`, `afterForm`, `withForm` pattern (Task 5); `ops.setTrack`, `ops.pairDecoder`, `ops.unpairDecoder`, `ops.rotateWatchLink` (Task 4); `seal`, `open` from `@tinylap/auth` (`seal(keys, text, purpose)`, `open(keys, sealed, purpose)` throws on a bad value); `request.keys` (Task 3); `startPlannerStub`, `CLOSED`, `OPEN` (`test/server/planner-stub.js`).
- Produces routes: `POST <space>/track`; `POST <space>/decoders` (303 to `<space>/setup?paired=<id>#decoders`, sets `__Host-tl-paired`); `GET`/`POST <space>/decoders/<id>/unpair`; `POST <space>/watch-link`; `GET <space>/watch-link/new` (confirmation when a link exists, else 303 to `#watchers`). `PAIRED_COOKIE = '__Host-tl-paired'`.

- [ ] **Step 1: Write the failing tests**

`apps/timing/test/server/setup-pages-more.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Setup forms, continued (spec §6.4): the track from a planner link,
// pairing a decoder over Wi-Fi with its token shown once, unpairing, and
// the watchers link.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';
import { CLOSED, OPEN, closed, startPlannerStub } from './planner-stub.js';

let app;
let planner;
let owner;
let member;
let office;
let base;
const lines = [];

before(async () => {
  planner = await startPlannerStub();
  app = await startTiming({ plannerUrl: planner.url, log: (line) => lines.push(line) });
  const ana = await app.signUp('Ana');
  const ben = await app.signUp('Ben');
  office = app.club(ana, 'Office');
  app.join(ana, office.id, ben);
  owner = await app.login(ana);
  member = await app.login(ben);
  base = `/clubs/${office.id}`;
});
after(async () => {
  await app.close();
  await planner.close();
});

const get = (who, path, cookie = '') => app.api(who, 'GET', path, undefined, { accept: 'text/html', ...(cookie ? { cookie: `${who.jar.header()}; ${cookie}` } : {}) });

test('the track comes from a planner link; a bad one comes back with the link kept', async () => {
  const ok = await app.form(member, `${base}/track`, { link: `${planner.url}/layouts/${CLOSED}`, name: 'Office loop', direction: 'cw' });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), `${base}/setup#track`);
  assert.equal(app.store.workspace(office.id).trackId, closed.track.id);
  assert.match(await (await get(member, `${base}/setup`)).text(), /Now: <strong>Office loop<\/strong>, clockwise\./);
  const open = await app.form(member, `${base}/track`, { link: `${planner.url}/layouts/${OPEN}`, name: '', direction: 'cw' });
  assert.equal(open.status, 422);
  const body = await open.text();
  assert.match(body, /not a closed circuit/);
  assert.match(body, new RegExp(`id="track-link"[^>]*value="${planner.url}/layouts/${OPEN}"`));
  const down = await app.form(member, `${base}/track`, { link: 'http://127.0.0.1:9/layouts/x', direction: 'cw' });
  assert.equal(down.status, 422, 'a link from elsewhere is refused before anything is fetched');
});

test('pairing over Wi-Fi shows the token once, never in a URL or a log', async () => {
  const res = await app.form(member, `${base}/decoders`, { name: 'Start line' });
  assert.equal(res.status, 303);
  const [decoder] = app.store.decoders(office.id);
  assert.equal(res.headers.get('location'), `${base}/setup?paired=${decoder.id}#decoders`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('__Host-tl-paired='));
  assert.match(cookie, /Path=\/; Max-Age=300; HttpOnly; Secure; SameSite=Strict/);
  const pair = cookie.split(';')[0];
  const shown = await get(member, `${base}/setup?paired=${decoder.id}`, pair);
  const body = await shown.text();
  const token = /<code class="token">([A-Za-z0-9_-]{43})<\/code>/.exec(body)?.[1];
  assert.ok(token, 'the token is on the page');
  assert.ok(shown.headers.getSetCookie().some((c) => c.startsWith('__Host-tl-paired=;') && /Max-Age=0/.test(c)), 'and its cookie is cleared');
  assert.ok(!cookie.includes(token), 'the cookie holds it sealed');
  assert.doesNotMatch(await (await get(member, `${base}/setup?paired=${decoder.id}`)).text(), /class="token"/, 'a reload shows nothing');
  assert.ok(lines.every((line) => !line.includes(token)));
  // The token works for the decoder.
  const post = await fetch(`${app.base}/decoders/${decoder.id}/passings`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ boot: 'b00tb00t', passings: [{ transponder: '0A', t: 1 }] }) });
  assert.equal(post.status, 200);
});

test('unpairing asks first and needs an admin', async () => {
  const [decoder] = app.store.decoders(office.id);
  assert.equal((await get(member, `${base}/decoders/${decoder.id}/unpair`)).status, 403);
  const ask = await (await get(owner, `${base}/decoders/${decoder.id}/unpair`)).text();
  assert.match(ask, /<h1>Unpair Start line\?<\/h1>/);
  const done = await app.form(owner, `${base}/decoders/${decoder.id}/unpair`, {});
  assert.equal(done.status, 303);
  assert.deepEqual(app.store.decoders(office.id), []);
});

test('the watchers link: make one, then replace it after confirming', async () => {
  assert.equal((await get(member, `${base}/watch-link/new`)).headers.get('location'), `${base}/setup#watchers`, 'nothing to replace yet');
  const made = await app.form(member, `${base}/watch-link`, {});
  assert.equal(made.status, 303);
  const first = app.store.workspace(office.id).watchToken;
  assert.match(first, /^[A-Za-z0-9_-]{22}$/);
  assert.match(await (await get(member, `${base}/setup`)).text(), new RegExp(`value="${app.base}/watch/${first}"[^>]*readonly`));
  const ask = await (await get(member, `${base}/watch-link/new`)).text();
  assert.match(ask, /The old link stops working/);
  await app.form(member, `${base}/watch-link`, {});
  assert.notEqual(app.store.workspace(office.id).watchToken, first);
});
```

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL (routes missing).

- [ ] **Step 2: Implement the handlers in `server/setup-pages.js`**

Add the imports `import { open, seal } from '@tinylap/auth';` and `import { readForm } from './form.js';` (already there), then:

```js
export const PAIRED_COOKIE = '__Host-tl-paired';
const PAIRED = new RegExp(`(?:^|;\\s*)${PAIRED_COOKIE}=([^;]+)`);
const clearPaired = `${PAIRED_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

/** GET setup: the page, and once after pairing, the new decoder's token. */
function showSetup(request) {
  const id = request.url.searchParams.get('paired');
  const raw = PAIRED.exec(String(request.req.headers.cookie ?? ''))?.[1];
  if (!id || !raw || !request.keys) return renderSetup(request, 200);
  let paired = null;
  try {
    const value = JSON.parse(open(request.keys, decodeURIComponent(raw), 'paired'));
    const decoder = request.store.decoder(value.id);
    if (value.id === id && decoder?.workspaceId === request.workspaceId) paired = { id: value.id, name: decoder.name, token: value.token };
  } catch {
    // A tampered or stale cookie shows nothing.
  }
  return renderSetup(request, 200, { paired, headers: { 'Set-Cookie': [clearPaired] } });
}

const setTrack = withForm(async (request, form) => {
  const values = { link: form.get('link') ?? '', name: form.get('name') ?? '', direction: form.get('direction') ?? '' };
  // A blank name is "use the default" on a form; the operation only takes a missing one.
  return afterForm(request, await ops.setTrack(request, { ...values, name: values.name || undefined }), { key: 'track', values, section: 'track' });
});

const pairDecoder = withForm((request, form) => {
  const values = { name: form.get('name') ?? '' };
  const result = ops.pairDecoder(request, { name: values.name || undefined });
  if (result.error) return afterForm(request, result, { key: 'pair', values, section: 'decoders' });
  const { id, token } = result.value;
  const sealed = encodeURIComponent(seal(request.keys, JSON.stringify({ id, token }), 'paired'));
  return seeOther(`${request.space.base}/setup?paired=${id}#decoders`, {
    'Set-Cookie': [`${PAIRED_COOKIE}=${sealed}; Path=/; Max-Age=300; HttpOnly; Secure; SameSite=Strict`],
  });
});

function askUnpair(request, match) {
  const decoder = request.store.decoder(match[2]);
  if (!decoder || decoder.workspaceId !== request.workspaceId) return renderSetup(request, 404);
  const base = request.space.base;
  return page(request, 200, confirmPage(request, {
    title: `Unpair ${decoder.name}?`,
    text: 'Its token stops working at once. Its passings stay.',
    action: `${base}/decoders/${decoder.id}/unpair`,
    button: 'Unpair',
    back: `${base}/setup#decoders`,
  }));
}

const unpair = withForm((request, _form, match) => afterForm(request, ops.unpairDecoder(request, { id: match[2] }), { key: 'pair', values: {}, section: 'decoders' }));

const makeWatchLink = withForm((request) => afterForm(request, ops.rotateWatchLink(request), { key: 'watchers', values: {}, section: 'watchers' }));

function askNewWatchLink(request) {
  const base = request.space.base;
  if (!request.store.workspace(request.workspaceId).watchToken) return seeOther(`${base}/setup#watchers`);
  return page(request, 200, confirmPage(request, {
    title: 'Make a new watchers link?',
    text: 'The old link stops working, and anyone watching with it is cut off.',
    action: `${base}/watch-link`,
    button: 'Make a new link',
    back: `${base}/setup#watchers`,
  }));
}
```

Change the setup route's GET to `pageRoute('timing.run', showSetup)`, and add to `setupPageRoutes`:

```js
  { pattern: spacePath('track'), credentials: true, methods: { POST: pageRoute('timing.setup', setTrack, write) } },
  { pattern: spacePath('decoders'), credentials: true, methods: { POST: pageRoute('timing.setup', pairDecoder, write) } },
  { pattern: spacePath('decoders/([^/]+)/unpair'), credentials: true, methods: { GET: pageRoute('timing.delete', askUnpair), POST: pageRoute('timing.delete', unpair, write) } },
  { pattern: spacePath('watch-link'), credentials: true, methods: { POST: pageRoute('timing.setup', makeWatchLink, write) } },
  { pattern: spacePath('watch-link/new'), credentials: true, methods: { GET: pageRoute('timing.setup', askNewWatchLink) } },
```

`afterForm`'s success path ignores the key; for the watchers link a failure can't happen, so its key only needs to exist.

Note on the planner check in the test: a link from another origin is refused by `fetchTrack` before any fetch (`invalid`, 422), so "planner down" is covered by the JSON tests of `planner.test.js`, not here.

- [ ] **Step 3: Run tests, lint, typecheck, commit**

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck`
Expected: PASS.

```bash
git add apps/timing
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing-app): set the track, pair decoders and share the watchers link with forms"
```

---
### Task 7: Race control

**Use the `frontend-design` skill** (radio and checkbox groups as palace-styled fieldsets; one button size in a row).

**Files:**
- Create: `apps/timing/server/views/race.js`, `apps/timing/server/race-pages.js`
- Modify: `apps/timing/server/page-routes.js` (`SCREEN_ROUTES = [...setupPageRoutes, ...racePageRoutes]`), `apps/timing/public/app.css`
- Test: `apps/timing/test/server/race-pages.test.js`

**Interfaces:**
- Consumes: `ops.startSession`, `ops.abortSession` (Task 4); `textField`, `errorSummary` (Task 5); `store.activeSession(ws)`, `store.drivers(ws)`.
- Produces: `racePage(request, { session, drivers, error, values })` (views/race.js); `racePageRoutes`: `GET <space>/race`, `POST <space>/sessions` (fields `kind`, `roster` repeated, `duration` in minutes, `countdown` in seconds; 303 to `<space>/board`), `POST <space>/sessions/<id>/abort` (303 to `<space>/race`).

- [ ] **Step 1: Write the failing tests**

`apps/timing/test/server/race-pages.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

let app;
let member;
let office;
let base;

before(async () => {
  app = await startTiming();
  const ana = await app.signUp('Ana');
  office = app.club(ana, 'Office');
  member = await app.login(ana);
  base = `/clubs/${office.id}`;
});
after(() => app.close());

const get = (path) => app.api(member, 'GET', path, undefined, { accept: 'text/html' });

test('without drivers, race control points to Setup', async () => {
  const body = await (await get(`${base}/race`)).text();
  assert.match(body, /<h1>Race control<\/h1>/);
  assert.match(body, new RegExp(`<a[^>]*href="${base}/setup#drivers"`));
  assert.doesNotMatch(body, /<form/);
});

test('start a race from the form, then abort it', async () => {
  for (const name of ['Ana', 'Ben']) await app.form(member, `${base}/drivers`, { name });
  const [a, b] = app.store.drivers(office.id);
  const form = await (await get(`${base}/race`)).text();
  assert.match(form, /<input type="radio" name="kind" value="race"[^>]* checked/);
  assert.match(form, new RegExp(`<input type="checkbox" name="roster" value="${a.id}"[^>]* checked`));
  const started = await app.form(member, `${base}/sessions`, [['kind', 'race'], ['roster', a.id], ['roster', b.id], ['duration', '2'], ['countdown', '0']]);
  assert.equal(started.status, 303);
  assert.equal(started.headers.get('location'), `${base}/board`);
  const session = app.store.activeSession(office.id);
  assert.deepEqual([session.kind, session.durationMs, session.roster], ['race', 120_000, [a.id, b.id]]);

  const running = await (await get(`${base}/race`)).text();
  assert.match(running, /<h2[^>]*>Race<\/h2>/);
  assert.match(running, new RegExp(`<form method="post" action="${base}/sessions/${session.id}/abort"`));

  const again = await app.form(member, `${base}/sessions`, [['kind', 'race'], ['roster', a.id], ['duration', '2'], ['countdown', '0']]);
  assert.equal(again.status, 409);
  assert.match(await again.text(), /A qualifying or race is already running here\./);

  const aborted = await app.form(member, `${base}/sessions/${session.id}/abort`, {});
  assert.equal(aborted.status, 303);
  assert.equal(aborted.headers.get('location'), `${base}/race`);
  assert.equal(app.store.session(session.id).state, 'aborted');
});

test('a bad form comes back with what was chosen', async () => {
  const [a] = app.store.drivers(office.id);
  const none = await app.form(member, `${base}/sessions`, [['kind', 'qualifying'], ['duration', '5'], ['countdown', '10']]);
  assert.equal(none.status, 422);
  const body = await none.text();
  assert.match(body, /Pick 1 to 20 drivers\./);
  assert.match(body, /<input type="radio" name="kind" value="qualifying"[^>]* checked/);
  assert.doesNotMatch(body, new RegExp(`value="${a.id}"[^>]* checked`), 'unticked stays unticked');
  const long = await app.form(member, `${base}/sessions`, [['kind', 'race'], ['roster', a.id], ['duration', '120'], ['countdown', '10']]);
  assert.equal(long.status, 422);
  assert.match(await long.text(), /id="race-duration"[^>]*value="120"[^>]*aria-invalid="true"/);
});
```

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL (routes missing).

- [ ] **Step 2: `server/views/race.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Race control (spec §6.2): the start form, or the running session with Abort.
import { html } from './html.js';
import { errorSummary, textField } from './form-parts.js';
import { layout } from './layout.js';

const KIND = { qualifying: 'Qualifying', race: 'Race' };
const STATE = { countdown: 'Counting down', running: 'Running', finishing: 'Finishing the last lap' };

function startForm(request, { drivers, error, values }) {
  const base = request.space.base;
  if (drivers.length === 0) {
    return html`<div class="card-static stack-md"><p>Add drivers before you start a race.</p><p><a class="btn btn-primary" href="${base}/setup#drivers">Add drivers</a></p></div>`;
  }
  const kind = values?.kind ?? 'race';
  const roster = values ? new Set(values.roster) : new Set(drivers.map((d) => d.id));
  const rosterError = error?.field === 'roster' ? error.message : null;
  return html`<form method="post" action="${base}/sessions" class="card-static stack-md">
  ${errorSummary(error)}
  <fieldset class="stack-sm">
    <legend>Session</legend>
    ${['race', 'qualifying'].map((k) => html`<label class="choice"><input type="radio" name="kind" value="${k}"${k === kind ? html` checked` : null}> ${KIND[k]}</label>`)}
  </fieldset>
  <fieldset class="stack-sm"${rosterError ? html` aria-describedby="roster-error"` : null}>
    <legend>Drivers</legend>
    ${drivers.map((d) => html`<label class="choice"><input type="checkbox" name="roster" value="${d.id}"${roster.has(d.id) ? html` checked` : null}> ${d.name}</label>`)}
    ${rosterError ? html`<p class="field-error" id="roster-error">${rosterError}</p>` : null}
  </fieldset>
  ${textField({ id: 'race-duration', label: 'Minutes', name: 'duration', type: 'number', required: true, min: 1, max: 60, value: values?.duration ?? '5', error })}
  ${textField({ id: 'race-countdown', label: 'Countdown (seconds, races only)', name: 'countdown', type: 'number', required: true, min: 0, max: 30, value: values?.countdown ?? '10', error })}
  <button type="submit" class="btn btn-primary btn-lg">Start</button>
</form>`;
}

function runningPanel(request, session) {
  const base = request.space.base;
  return html`<div class="card-static stack-md">
  <h2 class="h3">${KIND[session.kind]}</h2>
  <p class="subtitle">${STATE[session.state] ?? session.state}</p>
  <form method="post" action="${base}/sessions/${session.id}/abort" class="button-row">
    <a class="btn btn-outline" href="${base}/board">Show the board</a>
    <button type="submit" class="btn btn-danger">Abort</button>
  </form>
</div>`;
}

export function racePage(request, { session, drivers, error = null, values = null }) {
  return layout(request, {
    title: 'Race control',
    screen: 'race',
    body: html`<div class="container stack-lg screen">
  <h1>Race control</h1>
  ${session ? html`${errorSummary(error)}${runningPanel(request, session)}` : startForm(request, { drivers, error, values })}
</div>`,
  });
}
```

The `min`/`max` attributes only help the browser; the server still validates.

- [ ] **Step 3: `server/race-pages.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Race control's page and forms (spec §3, §6.2).
import * as ops from './operations.js';
import { readForm } from './form.js';
import { pageRoute } from './page-access.js';
import { page, seeOther } from './respond.js';
import { spacePath } from './spaces.js';
import { racePage } from './views/race.js';

function renderRace(request, status, { error = null, values = null } = {}) {
  const ws = request.workspaceId;
  const session = request.store.activeSession(ws);
  return page(request, status, racePage(request, { session, drivers: request.store.drivers(ws), error, values }));
}

async function start(request) {
  const { form, error } = await readForm(request);
  if (error) return error;
  const values = { kind: form.get('kind') ?? '', roster: form.getAll('roster'), duration: form.get('duration') ?? '', countdown: form.get('countdown') ?? '' };
  const minutes = values.duration === '' ? undefined : Number(values.duration);
  const result = ops.startSession(request, {
    kind: values.kind,
    roster: values.roster,
    durationSeconds: minutes === undefined ? undefined : minutes * 60,
    countdownSeconds: values.countdown === '' ? undefined : values.countdown,
  });
  if (!result.error) return seeOther(`${request.space.base}/board`);
  return renderRace(request, result.error.status, { error: result.error, values });
}

async function abort(request, match) {
  request.req.resume();
  const result = ops.abortSession(request, { id: match[2] });
  return result.error ? renderRace(request, 404, { error: result.error }) : seeOther(`${request.space.base}/race`);
}

const write = { write: true };

export const racePageRoutes = [
  { pattern: spacePath('race'), credentials: true, methods: { GET: pageRoute('timing.run', (request) => renderRace(request, 200)) } },
  { pattern: spacePath('sessions'), credentials: true, methods: { POST: pageRoute('timing.run', start, write) } },
  { pattern: spacePath('sessions/([^/]+)/abort'), credentials: true, methods: { POST: pageRoute('timing.run', abort, write) } },
];
```

- [ ] **Step 4: Styles, run tests, lint, typecheck, commit**

With the `frontend-design` skill, in `public/app.css`: `fieldset` inside `.screen` (no default border; `legend` styled as palace's label), `.choice` as body text with a larger hit area (`text-transform: none; font-size: 1rem; color: var(--p-text)`), mark `/* belongs upstream in palace-ui */`.

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck`
Expected: PASS.

```bash
git add apps/timing
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing-app): start and abort races with a plain form"
```

---

### Task 8: Tap entry, with taps that don't wait for a page load

**Use the `frontend-design` skill** (big, high-contrast tiles for thumbs).

**Files:**
- Create: `apps/timing/server/views/tap.js`, `apps/timing/server/tap-pages.js`, `apps/timing/public/tap.js`
- Modify: `apps/timing/server/page-routes.js` (add `...tapPageRoutes`), `apps/timing/public/app.css`
- Test: `apps/timing/test/server/tap-pages.test.js`, `apps/timing/test/browser/tap.test.js`

**Interfaces:**
- Consumes: `ops.tap` (Task 4); `prefersHtml` / `mediaType` (`server/negotiate.js`); `formatLap` (`public/format.js`); browser fixture `openBrowser`, `pageAs` (`test/browser/browser.js`).
- Produces: `tapPage(request, { drivers, result })`, `tapResultText(result, driver)` (views/tap.js); `tapPageRoutes`: `GET <space>/tap` (reads `?driver=&result=&ms=`), `POST <space>/tap` (field `driver`; HTML: 303 to `<space>/tap?driver=<id>&result=started|lap|again[&ms=<n>]`; with `Accept: application/json`: 200 `{ stored, lapMs, text }`).

- [ ] **Step 1: Write the failing server test**

`apps/timing/test/server/tap-pages.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

const clock = { now: 1_000_000_000_000 };
let app;
let member;
let office;
let base;
let ana;

before(async () => {
  app = await startTiming({ clock });
  const user = await app.signUp('Ana');
  office = app.club(user, 'Office');
  member = await app.login(user);
  base = `/clubs/${office.id}`;
  await app.form(member, `${base}/drivers`, { name: 'Ana' });
  [ana] = app.store.drivers(office.id);
});
after(() => app.close());

const get = (path) => app.api(member, 'GET', path, undefined, { accept: 'text/html' });

test('a tile per driver, each its own form', async () => {
  const body = await (await get(`${base}/tap`)).text();
  assert.match(body, new RegExp(`<form method="post" action="${base}/tap" class="tap-form">\\s*<input type="hidden" name="driver" value="${ana.id}">\\s*<button type="submit" class="tap-tile"[^>]*>Ana</button>`));
  assert.match(body, /<script type="module" src="\/public\/tap.js"><\/script>/);
});

test('a tap is a post and a redirect that says what it did', async () => {
  let res = await app.form(member, `${base}/tap`, { driver: ana.id });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${base}/tap?driver=${ana.id}&result=started`);
  assert.match(await (await get(res.headers.get('location'))).text(), /role="status"[^>]*>Ana: started</);
  clock.now += 8412;
  res = await app.form(member, `${base}/tap`, { driver: ana.id });
  assert.equal(res.headers.get('location'), `${base}/tap?driver=${ana.id}&result=lap&ms=8412`);
  assert.match(await (await get(res.headers.get('location'))).text(), />Ana: 8\.412</);
  res = await app.form(member, `${base}/tap`, { driver: ana.id });
  assert.equal(res.headers.get('location'), `${base}/tap?driver=${ana.id}&result=again`, 'the same millisecond');
});

test('asked for JSON, the same post answers in place', async () => {
  clock.now += 9000;
  const res = await app.form(member, `${base}/tap`, { driver: ana.id }, { accept: 'application/json' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { stored: true, lapMs: 9000, text: 'Ana: 9.000' });
  const bad = await app.form(member, `${base}/tap`, { driver: 'nobody' });
  assert.equal(bad.status, 422);
});

test('without drivers: a link to Setup and no tiles', async () => {
  const solo = await app.signUp('Solo');
  const login = await app.login(solo);
  const body = await (await app.api(login, 'GET', '/personal/tap', undefined, { accept: 'text/html' })).text();
  assert.match(body, /href="\/personal\/setup#drivers"/);
  assert.doesNotMatch(body, /tap-tile/);
});
```

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL.

- [ ] **Step 2: `server/views/tap.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Tap entry (spec §6.3): one form per driver, a big button each. tap.js
// submits them in place; without it each tap is a page load.
import { formatLap } from '../../public/format.js';
import { html } from './html.js';
import { layout } from './layout.js';

/** What a tap did, in words. @param {{ result: string, ms?: number | null }} result @param {{ name: string }} driver */
export function tapResultText(result, driver) {
  if (result.result === 'again') return 'Too fast, tap again.';
  if (result.result === 'started') return `${driver.name}: started`;
  return `${driver.name}: ${formatLap(result.ms ?? null)}`;
}

export function tapPage(request, { drivers, result = null, error = null }) {
  const base = request.space.base;
  const said = error ? error.message : result ? tapResultText(result, result.driver) : 'Tap a driver as their car crosses the line.';
  return layout(request, {
    title: 'Tap',
    screen: 'tap',
    scripts: drivers.length ? ['tap.js'] : [],
    body: drivers.length
      ? html`<div class="tap-screen">
  <h1 class="visually-hidden">Tap</h1>
  <div class="tap-grid">${drivers.map((d) => html`<form method="post" action="${base}/tap" class="tap-form">
    <input type="hidden" name="driver" value="${d.id}">
    <button type="submit" class="tap-tile" style="--driver: ${d.colour}">${d.name}</button>
  </form>`)}</div>
  <p class="tap-result" id="tap-result" role="status" aria-live="polite">${said}</p>
</div>`
      : html`<div class="container stack-lg screen">
  <h1>Tap</h1>
  <div class="card-static stack-md"><p>Add drivers to tap their laps.</p><p><a class="btn btn-primary" href="${base}/setup#drivers">Add drivers</a></p></div>
</div>`,
  });
}
```

- [ ] **Step 3: `server/tap-pages.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Tap entry's page and form (spec §6.3). The form answers 303 with what the
// tap did in the query; asked for JSON (tap.js), the same post answers in
// place, so taps don't wait for a page load.
import * as ops from './operations.js';
import { readForm } from './form.js';
import { pageRoute } from './page-access.js';
import { page, seeOther } from './respond.js';
import { json } from './responses.js';
import { spacePath } from './spaces.js';
import { tapPage, tapResultText } from './views/tap.js';

const RESULTS = new Set(['started', 'lap', 'again']);
const wantsJson = (req) => /application\/json/.test(String(req.headers.accept ?? ''));

function showTap(request) {
  const drivers = request.store.drivers(request.workspaceId);
  const q = request.url.searchParams;
  const driver = drivers.find((d) => d.id === q.get('driver'));
  const kind = q.get('result');
  const result = driver && RESULTS.has(kind) ? { result: kind, ms: q.has('ms') ? Number(q.get('ms')) : null, driver } : null;
  return page(request, 200, tapPage(request, { drivers, result }));
}

/** @param {{ stored: boolean, lapMs: number | null }} value */
const outcomeOf = (value) => (!value.stored ? 'again' : value.lapMs === null ? 'started' : 'lap');

async function postTap(request) {
  const { form, error } = await readForm(request);
  if (error) return error;
  const driverId = form.get('driver') ?? '';
  const result = ops.tap(request, { driverId });
  const drivers = request.store.drivers(request.workspaceId);
  if (result.error) {
    const headers = result.error.retryAfter ? { 'Retry-After': String(result.error.retryAfter) } : {};
    if (wantsJson(request.req)) return { ...json(result.error.status, { error: result.error.message }, { 'Cache-Control': 'no-store', ...headers }), credentials: true };
    return page(request, result.error.status, tapPage(request, { drivers, error: result.error }), { headers });
  }
  const outcome = outcomeOf(result.value);
  const driver = drivers.find((d) => d.id === driverId);
  if (wantsJson(request.req)) {
    return { ...json(200, { ...result.value, text: tapResultText({ result: outcome, ms: result.value.lapMs }, driver) }, { 'Cache-Control': 'no-store' }), credentials: true };
  }
  const query = new URLSearchParams({ driver: driverId, result: outcome, ...(outcome === 'lap' ? { ms: String(result.value.lapMs) } : {}) });
  return seeOther(`${request.space.base}/tap?${query}`);
}

export const tapPageRoutes = [
  { pattern: spacePath('tap'), credentials: true, methods: { GET: pageRoute('timing.run', showTap), POST: pageRoute('timing.run', postTap, { write: true }) } },
];
```

- [ ] **Step 4: `public/tap.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Taps without a page load (spec §6.3): the tap forms are submitted with
// fetch and the result is shown in place. Without this script, or if a
// request fails, each form submits normally.
const status = document.querySelector('#tap-result');

for (const form of document.querySelectorAll('form.tap-form')) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const tile = form.querySelector('.tap-tile');
    tile?.classList.add('is-tapped');
    setTimeout(() => tile?.classList.remove('is-tapped'), 150);
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { accept: 'application/json' },
        body: new URLSearchParams(new FormData(form)),
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (status) status.textContent = res.ok ? data.text : data.error;
    } catch {
      form.submit();
    }
  });
}
```

In `server/page-routes.js`: `import { tapPageRoutes } from './tap-pages.js';` and add `...tapPageRoutes` to `SCREEN_ROUTES`.

- [ ] **Step 5: Browser test for the enhancement**

`apps/timing/test/browser/tap.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

const clock = { now: Date.now() };
let app;
let browser;
let member;

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  const user = await app.signUp('Ana');
  member = await app.login(user);
  await app.form(member, '/personal/drivers', { name: 'Ana' });
});
after(async () => {
  await browser?.close();
  await app?.close();
});

test('with JavaScript, taps answer in place without a page load', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  await page.goto('/personal/tap');
  let loads = 0;
  page.on('load', () => { loads += 1; });
  await page.getByRole('button', { name: 'Ana' }).click();
  await page.getByRole('status').filter({ hasText: 'Ana: started' }).waitFor();
  clock.now += 8000;
  await page.getByRole('button', { name: 'Ana' }).click();
  await page.getByRole('status').filter({ hasText: 'Ana: 8.000' }).waitFor();
  assert.equal(loads, 0);
  assert.equal(new URL(page.url()).pathname, '/personal/tap');
  assert.deepEqual(errors, []);
});
```

- [ ] **Step 6: Styles, run tests, lint, typecheck, commit**

With the `frontend-design` skill: the tile styles already in `public/app.css` (`.tap-grid`, `.tap-tile`, `.is-tapped`, `.tap-result`) apply; make `.tap-form` a plain grid cell (`display: contents` or no margin) and keep tiles at least 7rem tall.

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck && pnpm --filter @tinylap/timing-app test:browser`
Expected: PASS.

```bash
git add apps/timing
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing-app): tap laps with forms, answered in place when JavaScript is on"
```

---
### Task 9: The board and the watchers board, rendered on the server

**Use the `frontend-design` skill** (reuse the board styles in `public/app.css`; `?big` scales every part).

**Files:**
- Create: `apps/timing/server/views/board.js`, `apps/timing/server/board-pages.js`
- Modify: `apps/timing/server/page-routes.js` (add `...boardPageRoutes`), `apps/timing/server/stream.js` (`GET /watch/<token>` negotiates), `apps/timing/server/views/notice.js` (add `watchGonePage`), `apps/timing/public/app.css`
- Test: `apps/timing/test/server/board-pages.test.js`, `apps/timing/test/views.test.js`

**Interfaces:**
- Consumes: `engine.snapshot(ws, { watcher })` → `{ now, track, direction, session, standings, crossings, drivers, bests, lastResults, unknown? }`; `formatLap`, `formatClock` (`public/format.js`); `prefersHtml(accept)` (`server/negotiate.js`).
- Produces:
  - `clockOf(session, now)` → `{ label, ms } | null` (moved from the old client `view.js`, unchanged rules).
  - `boardLive(request, snapshot, { watcher, big })` → the `<div id="board-live" …>` element: header with clock, unknown-car notice (members), results of the last qualifying or race, standings or (members, no laps) the setup steps, last laps. Its `data-events` attribute is the stream URL (`<space>/board/events` or `/watch/<token>/events`). The clock is `<time class="board-clock-time" data-clock data-kind data-state data-opens data-closes data-now>`.
  - `boardPage(request, snapshot, { watcher, big, token? })` → the whole page, with `<noscript><meta http-equiv="refresh" content="10"></noscript>` and `board.js` as its script.
  - `watchGonePage(request)` (notice.js).
  - `boardPageRoutes`: `GET <space>/board` (`?big`). `GET /watch/<token>` answers the watchers page to browsers (`Accept` prefers HTML, or `Sec-Fetch-Mode: navigate`) and JSON to everything else, as before.

- [ ] **Step 1: Write the failing tests**

`apps/timing/test/server/board-pages.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

const clock = { now: 1_000_000_000_000 };
let app;
let member;
let office;
let base;

before(async () => {
  app = await startTiming({ clock });
  const user = await app.signUp('Ana');
  office = app.club(user, 'Office');
  member = await app.login(user);
  base = `/clubs/${office.id}`;
});
after(() => app.close());

const get = (who, path, headers = {}) => app.api(who, 'GET', path, undefined, { accept: 'text/html', ...headers });
const pass = (t, transponder = '10') => {
  clock.now = 1_000_000_000_000 + t;
  app.engine.ingest({ workspaceId: office.id, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder, t }] } });
};

test('an empty board shows a member how to get the track ready', async () => {
  const res = await get(member, `${base}/board`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<h1 class="board-title">Waiting for the first car<\/h1>/);
  assert.match(body, /aria-labelledby="board-steps-title"/);
  assert.match(body, new RegExp(`<a href="${base}/setup#track">Set the track</a>`));
  assert.match(body, /<noscript><meta http-equiv="refresh" content="10"><\/noscript>/);
  assert.match(body, new RegExp(`<div id="board-live"[^>]* data-events="${base}/board/events"`));
  assert.match(body, /<script type="module" src="\/public\/board.js"><\/script>/);
});

test('laps, a personal best and an unknown car', async () => {
  // Personal bests are per track: set one, and start practice on it.
  app.store.setTrack(office.id, { id: 't1', shape: 'c30:1:x', name: 'Office loop', snapshotKey: 'k'.repeat(22), layout: '{}' }, 'ccw');
  app.engine.restartPractice(office.id);
  await app.form(member, `${base}/drivers`, { name: '<i>Ana</i>' });
  const [ana] = app.store.drivers(office.id);
  app.engine.assign(office.id, '10', ana.id);
  pass(1000);
  pass(9000);
  pass(9500, '4711');
  const body = await (await get(member, `${base}/board`)).text();
  assert.match(body, /<h1 class="board-title">Practice<\/h1>/);
  assert.match(body, /&lt;i&gt;Ana&lt;\/i&gt;/);
  assert.doesNotMatch(body, /<i>Ana<\/i>/);
  assert.match(body, /<td class="num">8\.000<span class="badge pb">PB<\/span><\/td>/);
  assert.match(body, new RegExp(`Unknown car: 4711\\. <a href="${base}/setup#transponders">Assign in Setup</a>`));
  assert.match(body, /<time class="board-clock-time" data-clock data-kind="practice" data-state="running" data-opens="\d+" data-closes="" data-now="\d+">0:09<\/time>/);
});

test('?big is the wall layout, without the members-only notice', async () => {
  const body = await (await get(member, `${base}/board?big`)).text();
  assert.match(body, /<body class="big">/);
  assert.doesNotMatch(body, /Unknown car/);
  assert.match(body, new RegExp(`href="${base}/board">Leave big screen</a>`));
});

test('the watchers board: a page for browsers, JSON for programs, no codes', async () => {
  await app.form(member, `${base}/watch-link`, {});
  const token = app.store.workspace(office.id).watchToken;
  const page = await get(null, `/watch/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  const body = await page.text();
  assert.match(body, /&lt;i&gt;Ana&lt;\/i&gt;/);
  assert.doesNotMatch(body, /4711|Unknown car|board-steps|nav-tabs|nav-account/);
  assert.match(body, new RegExp(`data-events="/watch/${token}/events"`));
  const data = await app.api(null, 'GET', `/watch/${token}`, undefined, { accept: 'application/json' });
  assert.match(data.headers.get('content-type'), /^application\/json/);
  assert.equal((await data.json()).session.kind, 'practice');
  const gone = await get(null, '/watch/AAAAAAAAAAAAAAAAAAAAAA');
  assert.equal(gone.status, 404);
  assert.match(await gone.text(), /This watchers link no longer works/);
});
```

Append to `test/views.test.js`:

```js
import { clockOf } from '../server/views/board.js';

test('the clock for each state, on the server', () => {
  const race = { kind: 'race', opensAt: 10_000, closesAt: 310_000 };
  assert.equal(clockOf(null, 0), null);
  assert.deepEqual(clockOf({ kind: 'practice', state: 'running', opensAt: 1000 }, 61_000), { label: 'Practice', ms: 60_000 });
  assert.deepEqual(clockOf({ kind: 'practice', state: 'done', opensAt: 1000 }, 61_000), { label: 'Practice ended', ms: 0 });
  assert.deepEqual(clockOf({ ...race, state: 'countdown' }, 5000), { label: 'Starts in', ms: 5000 });
  assert.deepEqual(clockOf({ ...race, state: 'running' }, 70_000), { label: 'Remaining', ms: 240_000 });
  assert.deepEqual(clockOf({ ...race, state: 'finishing' }, 400_000), { label: 'Last lap', ms: 0 });
  assert.deepEqual(clockOf({ ...race, state: 'aborted' }, 400_000), { label: 'Aborted', ms: 0 });
  assert.deepEqual(clockOf({ ...race, state: 'done' }, 400_000), { label: 'Finished', ms: 0 });
});
```

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL.

- [ ] **Step 2: `server/views/board.js`**

Port the old client renderer (`js/board.js` in git history, commit `332fddc`) to `html`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board (spec §6.1), rendered on the server from engine.snapshot. All
// that changes lives in #board-live, which the stream replaces whole; the
// watchers board is the same without member parts.
import { formatClock, formatLap } from '../../public/format.js';
import { html } from './html.js';
import { layout } from './layout.js';

const KIND = { practice: 'Practice', qualifying: 'Qualifying', race: 'Race' };
const DIRECTION = { cw: 'clockwise', ccw: 'anticlockwise' };

/** What the session clock shows at server time `now`. */
export function clockOf(session, now) {
  if (!session) return null;
  if (session.state === 'countdown') return { label: 'Starts in', ms: session.opensAt - now };
  if (session.kind === 'practice' && (session.state === 'done' || session.state === 'aborted')) return { label: 'Practice ended', ms: 0 };
  if (session.kind === 'practice') return { label: 'Practice', ms: now - session.opensAt };
  if (session.state === 'running') return { label: 'Remaining', ms: Math.max(0, session.closesAt - now) };
  if (session.state === 'finishing') return { label: 'Last lap', ms: 0 };
  return { label: session.state === 'aborted' ? 'Aborted' : 'Finished', ms: 0 };
}

function chip(snap, id) {
  const d = snap.drivers.find((x) => x.id === id);
  if (!d) return html`<span class="driver">${id ? 'former driver' : 'unknown car'}</span>`;
  return html`<span class="driver" style="--driver: ${d.colour}">${d.name}</span>`;
}

function header(snap) {
  const s = snap.session;
  const clock = clockOf(s, snap.now);
  const where = snap.track ? `${snap.track.name} · ${DIRECTION[snap.direction]}` : 'No track set';
  return html`<header class="board-head">
  <div><p class="eyebrow">${where}</p><h1 class="board-title">${s ? KIND[s.kind] : 'Waiting for the first car'}</h1></div>
  ${clock ? html`<div class="board-clock"><span class="stat-label board-clock-label">${clock.label}</span><time class="board-clock-time" data-clock data-kind="${s.kind}" data-state="${s.state}" data-opens="${s.opensAt ?? ''}" data-closes="${s.closesAt ?? ''}" data-now="${snap.now}">${formatClock(clock.ms)}</time></div>` : null}
</header>`;
}

function standingsTable(snap) {
  const race = snap.session?.kind === 'race';
  const last = new Map();
  for (const c of snap.crossings) if (c.lapMs !== null && c.driverId && !last.has(c.driverId)) last.set(c.driverId, c.lapMs);
  const best = new Map(snap.bests.map((b) => [b.driverId, b.bestMs]));
  if (snap.standings.length === 0) return html`<p class="empty board-empty">No laps yet.</p>`;
  return html`<div class="board-scroll"><table class="board-table">
  <thead><tr><th scope="col">Pos</th><th scope="col">Driver</th><th scope="col" class="num">Laps</th><th scope="col" class="num">Best</th><th scope="col" class="num">Last</th>${race ? html`<th scope="col" class="num">Time</th>` : null}</tr></thead>
  <tbody>${snap.standings.map((row) => html`<tr${row.finished ? html` class="is-finished"` : null}>
    <td class="pos">${row.position}</td>
    <td>${chip(snap, row.driverId)}</td>
    <td class="num">${row.laps}</td>
    <td class="num">${formatLap(row.bestMs)}${row.bestMs !== null && best.get(row.driverId) === row.bestMs ? html`<span class="badge pb">PB</span>` : null}</td>
    <td class="num">${formatLap(last.get(row.driverId))}</td>
    ${race ? html`<td class="num">${formatLap(row.elapsedMs)}</td>` : null}
  </tr>`)}</tbody>
</table></div>`;
}

function results(snap) {
  const r = snap.lastResults;
  if (!r || snap.session?.id === r.session.id) return null;
  const race = r.session.kind === 'race';
  return html`<section class="board-results" aria-label="Results">
  <h2 class="h3 board-results-title">${KIND[r.session.kind]} results <span class="tag">${r.session.state === 'aborted' ? 'Aborted' : 'Finished'}</span></h2>
  ${r.standings.length === 0 ? html`<p class="empty">No laps were counted.</p>` : html`<div class="board-scroll"><table class="board-table">
    <thead><tr><th scope="col">Pos</th><th scope="col">Driver</th><th scope="col" class="num">Laps</th><th scope="col" class="num">Best</th>${race ? html`<th scope="col" class="num">Time</th>` : null}</tr></thead>
    <tbody>${r.standings.map((row) => html`<tr><td class="pos">${row.position}</td><td>${chip(snap, row.driverId)}</td><td class="num">${row.laps}</td><td class="num">${formatLap(row.bestMs)}</td>${race ? html`<td class="num">${formatLap(row.elapsedMs)}</td>` : null}</tr>`)}</tbody>
  </table></div>`}
</section>`;
}

function feed(snap) {
  const laps = snap.crossings.filter((c) => c.lapMs !== null).slice(0, 12);
  return html`<aside class="board-feed" aria-label="Last laps">
  <h2 class="h3">Last laps</h2>
  ${laps.length === 0 ? html`<p class="empty">Laps show up here as cars cross the line.</p>` : html`<ol class="board-laps">${laps.map((c) => html`<li>${chip(snap, c.driverId)}<span class="num">${formatLap(c.lapMs)}</span>${c.via === 'tap' ? html`<span class="tag">tap</span>` : null}${!c.counts && c.driverId ? html`<span class="tag">not counted</span>` : null}</li>`)}</ol>`}
</aside>`;
}

function steps(request, snap) {
  const base = request.space.base;
  const where = snap.track && `${snap.track.name}, ${DIRECTION[snap.direction]}`;
  const n = snap.drivers.length;
  const step = (title, done, text, links) => html`<li class="board-step${done ? ' is-done' : ''}"><h3>${title}</h3><p>${done ?? text}</p>${links ? html`<p class="board-step-links">${links}</p>` : null}</li>`;
  return html`<section class="board-steps" aria-labelledby="board-steps-title">
  <h2 class="h3" id="board-steps-title">Get the track ready</h2>
  <ol>
    ${step('Choose the track', where, 'Paste a share link from the planner, and pick the direction you race.', where ? null : html`<a href="${base}/setup#track">Set the track</a>`)}
    ${step('Add drivers', n ? `${n} ${n === 1 ? 'driver' : 'drivers'}` : null, 'Give everyone a name, then their car’s transponder once it has crossed the line.', n ? null : html`<a href="${base}/setup#drivers">Add drivers</a>`)}
    ${step('Start timing', null, 'Connect the decoder by USB, or tap each crossing by hand.', html`<a href="${base}/bridge">Connect the decoder</a> <a href="${base}/tap">Tap laps by hand</a>`)}
  </ol>
</section>`;
}

/** Everything on the board that changes, in one element the stream replaces. */
export function boardLive(request, snap, { watcher = false, big = false, token = null } = {}) {
  const events = watcher ? `/watch/${token}/events` : `${request.space.base}/board/events`;
  const unknown = !watcher && !big && snap.unknown?.length
    ? html`<p class="status status-warning board-unknown" role="status">Unknown ${snap.unknown.length === 1 ? 'car' : 'cars'}: ${snap.unknown.join(', ')}. <a href="${request.space.base}/setup#transponders">Assign in Setup</a></p>`
    : null;
  const main = !watcher && snap.standings.length === 0 ? steps(request, snap) : standingsTable(snap);
  return html`<div id="board-live" class="board" data-events="${events}">
${header(snap)}
${unknown}
<div class="board-main">${results(snap)}${main}</div>
${feed(snap)}
</div>`;
}

export function boardPage(request, snap, { watcher = false, big = false, token = null } = {}) {
  return layout(request, {
    title: watcher ? 'Live board' : 'Board',
    screen: watcher ? null : 'board',
    watcher,
    big,
    scripts: ['board.js'],
    head: html`<noscript><meta http-equiv="refresh" content="10"></noscript>\n`,
    body: boardLive(request, snap, { watcher, big, token }),
  });
}
```

- [ ] **Step 3: Routes**

`server/board-pages.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board page (spec §6.1). Live updates come from board-stream.js.
import { pageRoute } from './page-access.js';
import { page } from './respond.js';
import { spacePath } from './spaces.js';
import { boardPage } from './views/board.js';

const showBoard = (request) => page(request, 200, boardPage(request, request.engine.snapshot(request.workspaceId), { big: request.url.searchParams.has('big') }));

export const boardPageRoutes = [
  { pattern: spacePath('board'), credentials: true, methods: { GET: pageRoute('timing.run', showBoard) } },
];
```

In `server/stream.js`, the `GET /watch/([^/]+)` handler negotiates:

```js
import { withSession } from './auth.js';
import { prefersHtml } from './negotiate.js';
import { page } from './respond.js';
import { withAccount } from './page-access.js';
import { boardPage } from './views/board.js';
import { watchGonePage } from './views/notice.js';

const wantsPage = (req) => req.headers['sec-fetch-mode'] === 'navigate' || prefersHtml(req.headers.accept);

const watchBoard = withSession(async (request, [, token]) => {
  const workspaceId = watched(request, token);
  if (!wantsPage(request.req)) {
    return workspaceId ? json(200, request.engine.snapshot(workspaceId, { watcher: true }), NO_STORE) : noWatch(request);
  }
  await withAccount(request);
  if (!workspaceId) return page(request, 404, watchGonePage(request));
  return page(request, 200, boardPage(request, request.engine.snapshot(workspaceId, { watcher: true }), { watcher: true, big: request.url.searchParams.has('big'), token }));
});
```

and use `GET: watchBoard` for that route. In `views/notice.js`:

```js
export const watchGonePage = (request) => notice(request, {
  title: 'Link no longer works',
  text: 'This watchers link no longer works. Ask someone at the track for the new one.',
});
```

In `server/page-routes.js` add `...boardPageRoutes` to `SCREEN_ROUTES`.

`/watch/<token>` stays out of the request log (already redacted), and `layout` shows watchers no account menu.

- [ ] **Step 4: Run tests, lint, typecheck, commit**

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck`
Expected: PASS (the `board.js` script 404s until Task 10; no test fetches it yet).

```bash
git add apps/timing
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing-app): render the board and the watchers board on the server"
```

---
### Task 10: The live board: a stream of server-rendered HTML, and `board.js`

**Use the `frontend-design` skill** for the live-status indicator (connected, reconnecting, disconnected).

**Files:**
- Create: `apps/timing/server/board-stream.js`, `apps/timing/public/board.js`
- Modify: `apps/timing/server/page-routes.js` (add `...boardStreamRoutes` before the catch-all), `apps/timing/server/routes.js` (the watchers stream route sits with the page routes), `apps/timing/public/app.css`
- Test: `apps/timing/test/server/board-stream.test.js`, `apps/timing/test/browser/live.test.js`

**Interfaces:**
- Consumes: `boardLive` (Task 9); `hub.subscribe(ws, { lastEventId: null, watcher, tag?, onClose }, send)`; `HEARTBEAT_MS` (`server/stream.js`); `events`, `next` (`test/server/sse.js`).
- Produces:
  - `GET <space>/board/events` and `GET /watch/<token>/events`: `text/event-stream` with `retry: 2000`, a `board` event right away and after every change (at most one per `THROTTLE_MS = 250`), each event's `data` the HTML of `#board-live`, one `data:` line per HTML line; heartbeats; the watcher stream ends when its token is replaced.
  - `public/board.js`: opens `#board-live`'s `data-events`, replaces `#board-live` with each event's HTML, ticks `time[data-clock]` every 200 ms, sets `#live-status`'s `data-state` (`live`, `reconnecting`, `off`) and shows it, and turns the `?big` link into a full-screen button when the browser can.

- [ ] **Step 1: Write the failing server test**

`apps/timing/test/server/board-stream.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { removeMember } from '../../../accounts/server/workspaces.js';
import { startTiming } from './helpers.js';
import { events, next } from './sse.js';

let app;
let owner;
let office;
let base;
let ana;

before(async () => {
  app = await startTiming();
  ana = await app.signUp('Ana');
  office = app.club(ana, 'Office');
  owner = await app.login(ana);
  base = `/clubs/${office.id}`;
  await app.form(owner, `${base}/drivers`, { name: '<b>Ben</b>' });
  app.engine.assign(office.id, '10', app.store.drivers(office.id)[0].id);
});
after(() => app.close());

const pass = (t) => app.engine.ingest({ workspaceId: office.id, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder: '10', t }] } });

test('the board stream sends the rendered board now and after every change', async () => {
  const res = await app.api(owner, 'GET', `${base}/board/events`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/event-stream/);
  const it = events(res, { raw: true });
  const first = await next(it, 'board');
  assert.match(first.data, /^<div id="board-live"/);
  pass(1000);
  pass(9000);
  const later = await next(it, 'board');
  assert.match(later.data, /&lt;b&gt;Ben&lt;\/b&gt;/);
  assert.match(later.data, /8\.000/);
  await it.return();
});

test('a removed member gets the not-found page, not the stream', async () => {
  const cy = await app.signUp('Cy');
  app.join(ana, office.id, cy);
  removeMember(app.suite.accounts.db, ana.id, office.id, cy.id);
  const res = await app.api(await app.login(cy), 'GET', `${base}/board/events`);
  assert.equal(res.status, 404);
});

test('the watchers stream has no codes and ends when the link is replaced', async () => {
  await app.form(owner, `${base}/watch-link`, {});
  const token = app.store.workspace(office.id).watchToken;
  const res = await fetch(`${app.base}/watch/${token}/events`);
  const it = events(res, { raw: true });
  const first = await next(it, 'board');
  assert.doesNotMatch(first.data, /Unknown car|board-steps/);
  await app.form(owner, `${base}/watch-link`, {});
  assert.equal(await next(it, 'ended'), null);
});
```

In `test/server/sse.js`, `events` learns multi-line data and a `raw` option (the board's HTML spans many `data:` lines; the existing tests keep JSON). Replace the function with:

```js
/**
 * Reads a text/event-stream response as { id, type, data } events. Data
 * lines are joined with "\n"; `raw` keeps them as text instead of JSON.
 * @param {Response} res @param {{ raw?: boolean }} [options]
 */
export async function* events(res, { raw = false } = {}) {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let id = null;
        let type = null;
        const data = [];
        for (const line of block.split('\n')) {
          if (!line || line.startsWith(':')) continue;
          const colon = line.indexOf(':');
          const key = line.slice(0, colon);
          const val = line.slice(colon + 1).replace(/^ /, '');
          if (key === 'id') id = Number(val);
          else if (key === 'event') type = val;
          else if (key === 'data') data.push(val);
        }
        if (type) yield { id, type, data: raw ? data.join('\n') : JSON.parse(data.join('\n')) };
      }
    }
  } finally {
    // `it.return()` ends the stream from the client side.
    await reader.cancel().catch(() => {});
  }
}
```

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL (no stream routes).

- [ ] **Step 2: `server/board-stream.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board's live stream for pages (spec §3, §6.1): the server renders
// #board-live and sends it whole, so the board is only ever built in one
// place. At most one render per THROTTLE_MS; the latest state wins.
import { withSession } from './auth.js';
import { pageRoute } from './page-access.js';
import { page } from './respond.js';
import { spacePath } from './spaces.js';
import { HEARTBEAT_MS } from './stream.js';
import { boardLive } from './views/board.js';
import { watchGonePage } from './views/notice.js';

export const THROTTLE_MS = 250;
const SSE = { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' };
const WATCH_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** @param {string} text */
const sse = (text) => `event: board\n${text.split('\n').map((line) => `data: ${line}`).join('\n')}\n\n`;

function boardStream(request, workspaceId, { watcher, token = null }) {
  return {
    status: 200,
    credentials: true,
    headers: SSE,
    stream(req, res) {
      let timer = null;
      let last = 0;
      const render = () => {
        timer = null;
        last = Date.now();
        res.write(sse(String(boardLive(request, request.engine.snapshot(workspaceId, { watcher }), { watcher, token }))));
      };
      const changed = () => {
        if (timer) return;
        timer = setTimeout(render, Math.max(0, THROTTLE_MS - (Date.now() - last)));
      };
      res.write('retry: 2000\n\n');
      const sub = request.hub.subscribe(workspaceId, { lastEventId: null, watcher, tag: token ?? undefined, onClose: () => res.end() }, changed);
      render();
      const beat = setInterval(() => res.write(': beat\n\n'), HEARTBEAT_MS);
      beat.unref();
      res.on('close', () => {
        clearInterval(beat);
        if (timer) clearTimeout(timer);
        sub.unsubscribe();
      });
    },
  };
}

const watchEvents = withSession(async (request, [, token]) => {
  const workspaceId = WATCH_TOKEN.test(token) && request.store ? request.store.workspaceByWatchToken(token) : null;
  return workspaceId ? boardStream(request, workspaceId, { watcher: true, token }) : page(request, 404, watchGonePage(request));
});

export const boardStreamRoutes = [
  { pattern: spacePath('board/events'), credentials: true, methods: { GET: pageRoute('timing.run', (request) => boardStream(request, request.workspaceId, { watcher: false })) } },
  { pattern: /^\/watch\/([^/]+)\/events$/, credentials: true, methods: { GET: watchEvents } },
];
```

`boardStream`'s response passes through `pageRoute`, which adds the space cookie; that's harmless on a stream. In `server/page-routes.js`, `import { boardStreamRoutes } from './board-stream.js';` and spread it into `SCREEN_ROUTES`. In `server/routes.js` make sure `...pageRoutes` comes **before** `...streamRoutes`, so `/watch/<token>/events` is matched by its own route (the JSON stream is `/watch/<token>/live`, which doesn't collide).

- [ ] **Step 3: `public/board.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The live board (spec §6.1, §7): the server renders #board-live and
// streams it; this swaps each one in, ticks the clock on the server's time,
// shows whether the stream is live, and offers full screen on ?big.
// Without it the page reloads every ten seconds (<noscript> refresh).

const STATES = { live: 'Live', reconnecting: 'Reconnecting…', off: 'Disconnected' };
let skew = 0;

function format(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function remaining(el, now) {
  const { kind, state } = el.dataset;
  const opens = Number(el.dataset.opens);
  const closes = Number(el.dataset.closes);
  if (state === 'countdown') return opens - now;
  if (kind === 'practice') return state === 'running' ? now - opens : 0;
  return state === 'running' ? Math.max(0, closes - now) : 0;
}

function adopt(root) {
  const clock = root.querySelector('time[data-clock]');
  if (clock) skew = Number(clock.dataset.now) - Date.now();
}

function tick() {
  const clock = document.querySelector('#board-live time[data-clock]');
  if (clock) clock.textContent = format(remaining(clock, Date.now() + skew));
}

function setStatus(state) {
  const status = document.querySelector('#live-status');
  if (!status) return;
  status.hidden = false;
  status.dataset.state = state;
  status.textContent = STATES[state];
}

const live = document.querySelector('#board-live');
if (live && 'EventSource' in window) {
  // The stream keeps the board current; the reload is only for no-JS.
  document.querySelector('meta[http-equiv="refresh"]')?.remove();
  adopt(live);
  setInterval(tick, 200);
  const source = new EventSource(live.dataset.events);
  source.addEventListener('open', () => setStatus('live'));
  source.addEventListener('error', () => setStatus(source.readyState === EventSource.CLOSED ? 'off' : 'reconnecting'));
  source.addEventListener('board', (event) => {
    const template = document.createElement('template');
    template.innerHTML = /** @type {MessageEvent} */ (event).data; // rendered and escaped by the server
    const next = template.content.firstElementChild;
    const current = document.querySelector('#board-live');
    if (next && current) {
      current.replaceWith(next);
      adopt(next);
    }
  });
}

if (document.body.classList.contains('big') && document.documentElement.requestFullscreen) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-sm btn-outline';
  button.textContent = 'Full screen';
  button.addEventListener('click', () => document.documentElement.requestFullscreen().catch(() => {}));
  document.querySelector('.navbar-right')?.prepend(button);
}
```

The `<noscript>` refresh lives in `<head>` and never runs with JavaScript on; the `remove()` line is harmless and documents the intent.

- [ ] **Step 4: Browser test**

`apps/timing/test/browser/live.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs, postPassings } from './browser.js';

let app;
let browser;
let member;
let decoder;

before(async () => {
  app = await startTiming();
  browser = await openBrowser();
  const user = await app.signUp('Ana');
  member = await app.login(user);
  await app.form(member, '/personal/drivers', { name: 'Ana' });
  const me = await (await app.api(member, 'GET', '/auth/me')).json();
  const personal = me.workspaces[0].id;
  app.engine.assign(personal, '10', app.store.drivers(personal)[0].id);
  decoder = await (await app.api(member, 'POST', `/workspaces/${personal}/decoders`, { name: 'Gate' })).json();
});
after(async () => {
  await browser?.close();
  await app?.close();
});

test('the board updates live and its clock ticks', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/personal/board');
  await page.getByRole('heading', { name: 'Waiting for the first car' }).waitFor();
  await postPassings(app, decoder, [{ transponder: '10', t: 1000 }, { transponder: '10', t: 9000 }]);
  await page.getByRole('heading', { name: 'Practice' }).waitFor();
  await page.locator('.board-table').getByText('Ana').waitFor();
  await page.locator('#live-status[data-state="live"]').waitFor();
  const before = await page.locator('time[data-clock]').innerText();
  await page.waitForFunction((was) => document.querySelector('time[data-clock]')?.textContent !== was, before, { timeout: 3000 });
  assert.deepEqual(errors, []);
});
```

`me.workspaces[0]` is the personal space here (the only one).

- [ ] **Step 5: Styles, run tests, lint, typecheck, commit**

With the `frontend-design` skill, in `public/app.css`: `.live-status[data-state="live"]::before { background: var(--p-success); }`, `[data-state="reconnecting"]` → `--p-warning`, `[data-state="off"]` → `--p-error`; `body.big` scales the board's headings, tags, badges, clock and tables in `em` and hides `.board-unknown`.

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck && pnpm --filter @tinylap/timing-app test:browser`
Expected: PASS.

```bash
git add apps/timing
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing-app): stream the server-rendered board to open pages"
```

---
### Task 11: The bridge page

The one page that needs JavaScript by nature (Web Serial). The server renders every state's markup; the script only shows the right section and fills in counts.

**Use the `frontend-design` skill** for the bridge states.

**Files:**
- Create: `apps/timing/server/views/bridge.js`, `apps/timing/server/bridge-pages.js`, `apps/timing/public/bridge-page.js`
- Modify: `apps/timing/server/page-routes.js` (add `...bridgePageRoutes`), `apps/timing/public/app.css`
- Test: `apps/timing/test/server/bridge-pages.test.js`, `apps/timing/test/browser/bridge.test.js`

**Interfaces:**
- Consumes: `Bridge`, `sendOutbox(outbox, post, onSent)` (`public/bridge.js`); `openOutbox()` (`public/outbox.js`); `simulatedPort({ lapMs })` (`public/sim-port.js`); `formatLap` (`public/format.js`); the JSON API `POST /decoders/<id>/passings` and `POST /workspaces/<id>/decoders` (member session, same origin).
- Produces:
  - `bridgePage(request)` (views/bridge.js): `<div id="bridge" data-workspace="<id>">` holding sections `[data-bridge-state="unsupported" | "connect" | "connecting" | "not-tinylap" | "unpaired" | "ready" | "disconnected"]`, only `unsupported` visible in the HTML; buttons `[data-bridge-connect]`; the pair `<form data-bridge-pair>` with `name`, `ssid`, `password`; in `ready`: `[data-bridge-status]`, `[data-bridge-outbox]`, `[data-bridge-refused]`, `[data-bridge-preview]`; `[data-bridge-earlier]`; `[data-bridge-error]`. An import map maps `@tinylap/timing` to its asset URL.
  - `bridgePageRoutes`: `GET <space>/bridge` (CSP allows the import map by its hash).

- [ ] **Step 1: Write the failing server test**

`apps/timing/test/server/bridge-pages.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startTiming } from './helpers.js';

let app;
let member;

before(async () => {
  app = await startTiming();
  member = await app.login(await app.signUp('Ana'));
});
after(() => app.close());

test('the bridge page: every state rendered, the explanation shown, the import map allowed by hash', async () => {
  const res = await app.api(member, 'GET', '/personal/bridge', undefined, { accept: 'text/html' });
  assert.equal(res.status, 200);
  const body = await res.text();
  const me = await (await app.api(member, 'GET', '/auth/me')).json();
  assert.match(body, new RegExp(`<div id="bridge" data-workspace="${me.workspaces[0].id}">`));
  for (const state of ['unsupported', 'connect', 'connecting', 'not-tinylap', 'unpaired', 'ready', 'disconnected']) assert.match(body, new RegExp(`data-bridge-state="${state}"`));
  assert.match(body, /<section data-bridge-state="unsupported"[^>]*>[\s\S]*Chrome or Edge/);
  assert.match(body, /<section data-bridge-state="connect" hidden/);
  const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(body)[1];
  assert.deepEqual(JSON.parse(map), { imports: { '@tinylap/timing': '/pkg/timing/index.js' } });
  const hash = createHash('sha256').update(map).digest('base64');
  assert.match(res.headers.get('content-security-policy'), new RegExp(`script-src 'self' 'sha256-${hash.replace(/[+/=]/g, (c) => `\\${c}`)}'`));
  assert.match(body, /<script type="module" src="\/public\/bridge-page.js"><\/script>/);
});
```

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL.

- [ ] **Step 2: `server/views/bridge.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge (spec §6.5): the server renders every state; bridge-page.js
// shows the one that applies. Without JavaScript or Web Serial, the page
// says what the bridge needs.
import { createHash } from 'node:crypto';
import { html, safe } from './html.js';
import { asset, layout } from './layout.js';

/** The import map the bridge's modules need, and its CSP hash. @param {any} request */
export function bridgeImportMap(request) {
  const text = JSON.stringify({ imports: { '@tinylap/timing': asset(request, 'pkg/timing/index.js') } });
  return { tag: html`<script type="importmap">${safe(text)}</script>\n`, hash: `sha256-${createHash('sha256').update(text).digest('base64')}` };
}

const connect = (label) => html`<button type="button" class="btn btn-primary btn-lg" data-bridge-connect>${label}</button>`;

export function bridgePage(request, importMap) {
  return layout(request, {
    title: 'Bridge',
    screen: 'bridge',
    importMap: importMap.tag,
    scripts: ['bridge-page.js'],
    body: html`<div class="container stack-lg screen">
  <h1>Bridge</h1>
  <div id="bridge" data-workspace="${request.workspaceId}">
    <p class="status status-warning" data-bridge-earlier role="status" hidden></p>
    <section data-bridge-state="unsupported" class="card-static stack-md">
      <p>The bridge reads the decoder over USB with Web Serial, which needs Chrome or Edge on a laptop, with JavaScript on.</p>
      <p>Timing still works without it: the decoder can send its passings over Wi-Fi, and you can <a href="${request.space.base}/tap">tap laps by hand</a>.</p>
    </section>
    <section data-bridge-state="connect" hidden class="card-static stack-md">
      <p>Plug the decoder in by USB, then connect. Keep this tab open while racing; the board runs in any other tab or screen.</p>
      ${connect('Connect decoder')}
    </section>
    <section data-bridge-state="connecting" hidden class="card-static"><p role="status">Talking to the decoder…</p></section>
    <section data-bridge-state="not-tinylap" hidden class="card-static stack-md">
      <p class="status status-error">This device doesn't answer like a TinyLap decoder.</p>
      ${connect('Try another port')}
    </section>
    <section data-bridge-state="unpaired" hidden class="card-static stack-md">
      <h2 class="h3">Pair this decoder</h2>
      <p>It gets its own token for this space. Wi-Fi is optional: with it, the decoder also sends passings over the internet when the cable is out.</p>
      <form data-bridge-pair class="stack-sm">
        <div class="field"><label for="bridge-name">Decoder name</label><input type="text" id="bridge-name" name="name" value="Decoder" maxlength="60" required></div>
        <div class="field"><label for="bridge-ssid">Wi-Fi name (optional)</label><input type="text" id="bridge-ssid" name="ssid" autocomplete="off"></div>
        <div class="field"><label for="bridge-password">Wi-Fi password</label><input type="password" id="bridge-password" name="password" autocomplete="off"></div>
        <button type="submit" class="btn btn-primary">Pair</button>
      </form>
    </section>
    <section data-bridge-state="ready" hidden class="stack-md">
      <div class="bridge-state" data-bridge-status-box>
        <p role="status" data-bridge-status></p>
        <p>Waiting to send: <span class="bridge-outbox num" data-bridge-outbox>…</span></p>
      </div>
      <p class="status status-error" role="alert" data-bridge-refused hidden></p>
      <h2 class="h3">Straight from the cable</h2>
      <ol class="board-laps bridge-preview" data-bridge-preview></ol>
      <p class="empty" data-bridge-preview-empty>Passings show up here the moment the decoder reports them.</p>
    </section>
    <section data-bridge-state="disconnected" hidden class="card-static stack-md">
      <p class="status status-warning">Decoder disconnected.</p>
      ${connect('Connect again')}
    </section>
    <p class="status status-error" role="alert" data-bridge-error hidden></p>
  </div>
</div>`,
  });
}
```

- [ ] **Step 3: `server/bridge-pages.js` and routes**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { pageRoute } from './page-access.js';
import { page } from './respond.js';
import { spacePath } from './spaces.js';
import { bridgeImportMap, bridgePage } from './views/bridge.js';

function showBridge(request) {
  const map = bridgeImportMap(request);
  return page(request, 200, bridgePage(request, map), { scriptHashes: [map.hash] });
}

export const bridgePageRoutes = [
  { pattern: spacePath('bridge'), credentials: true, methods: { GET: pageRoute('timing.run', showBridge) } },
];
```

Add `...bridgePageRoutes` to `SCREEN_ROUTES` in `server/page-routes.js`.

- [ ] **Step 4: `public/bridge-page.js`**

This replaces the deleted `js/bridge-view.js` (in git history at `332fddc`); its behaviour stays: the outbox an earlier tab left is sent at once, one Bridge at a time, the not-TinyLap state lets go of the port, `beforeunload` asks while forwarding, a 4xx refusal shows while online.

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge page (spec §6.5): Web Serial ↔ the server, on the markup the
// server rendered. Shows one [data-bridge-state] section at a time and fills
// in the ready panel; pairing posts to the JSON API, because the decoder's
// token must reach the board over serial.
import { Bridge, sendOutbox } from './bridge.js';
import { formatLap } from './format.js';
import { openOutbox } from './outbox.js';
import { simulatedPort } from './sim-port.js';

const root = document.querySelector('#bridge');
const workspaceId = root?.dataset.workspace ?? '';
const $ = (selector) => root?.querySelector(selector);
const simulate = new URLSearchParams(location.search).get('simulate');
const supported = 'serial' in navigator || simulate !== null;

/** A same-origin JSON call; errors carry the server's status and detail. */
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.detail ?? `The server answered ${res.status}.`), { status: res.status });
  return data;
}

const post = (decoderId, batch) => api('POST', `/decoders/${encodeURIComponent(decoderId)}/passings`, batch);

/** @type {Bridge | null} */
let bridge = null;
const preview = [];
const error = $('[data-bridge-error]');
const fail = (caught) => {
  error.textContent = caught.message;
  error.hidden = false;
};
const ok = () => { error.hidden = true; };

function show(state) {
  for (const section of root.querySelectorAll('[data-bridge-state]')) section.hidden = section.dataset.bridgeState !== state;
  if (state === 'ready') update();
}

function update() {
  if (!bridge) return;
  $('[data-bridge-status-box]').classList.toggle('is-offline', !bridge.online);
  $('[data-bridge-status]').textContent = bridge.online ? `Forwarding from decoder ${bridge.decoder}` : `Offline: passings wait here. ${bridge.lastError?.message ?? ''}`;
  const refused = $('[data-bridge-refused]');
  refused.hidden = !(bridge.online && bridge.lastError);
  refused.textContent = bridge.online && bridge.lastError ? `Some passings were refused: ${bridge.lastError.message}` : '';
  void bridge.outbox.count().then((n) => { $('[data-bridge-outbox]').textContent = String(n); });
  const list = $('[data-bridge-preview]');
  list.replaceChildren(...preview.map((p) => {
    const li = document.createElement('li');
    const code = Object.assign(document.createElement('span'), { className: 'num', textContent: p.transponder });
    const lap = Object.assign(document.createElement('span'), { className: 'num', textContent: formatLap(p.lapMs) });
    li.append(code, lap);
    return li;
  }));
  $('[data-bridge-preview-empty]').hidden = preview.length > 0;
}

async function connect() {
  const port = simulate !== null ? simulatedPort({ lapMs: simulate === 'fast' ? 2000 : 8000 }) : await navigator.serial.requestPort();
  await bridge?.close();
  const next = new Bridge({ port, outbox: await openOutbox(), post });
  next.addEventListener('state', () => {
    if (next.state === 'not-tinylap') void next.close();
    if (bridge === next) show(next.state === 'idle' ? 'connecting' : next.state);
  });
  for (const type of ['outbox', 'online']) next.addEventListener(type, () => { if (bridge === next) update(); });
  next.addEventListener('passing', (event) => {
    preview.unshift(/** @type {CustomEvent} */ (event).detail);
    preview.length = Math.min(preview.length, 20);
    if (bridge === next) update();
  });
  bridge = next;
  show('connecting');
  try {
    await next.start();
  } catch (caught) {
    await next.close();
    if (bridge === next) bridge = null;
    show('connect');
    throw caught;
  }
}

/** Passings an earlier tab left behind (a reload, a crash) go now, without waiting for the cable. */
async function sendEarlier() {
  const note = $('[data-bridge-earlier]');
  const outbox = await openOutbox();
  const say = (count, why = '') => {
    note.hidden = count === 0;
    note.textContent = `${count} ${count === 1 ? 'passing' : 'passings'} from earlier ${count === 1 ? 'is' : 'are'} waiting. ${why}`.trim();
  };
  let count = await outbox.count();
  if (count === 0) return;
  say(count, 'Sending them now…');
  const { refusal } = await sendOutbox(outbox, post, async () => say(await outbox.count(), 'Sending them now…')).catch((caught) => ({ refusal: caught }));
  count = await outbox.count();
  say(count, refusal && count ? `They couldn't be sent: ${refusal.message}` : '');
}

if (root && supported) {
  show('connect');
  for (const button of root.querySelectorAll('[data-bridge-connect]')) button.addEventListener('click', () => connect().then(ok, fail));
  $('[data-bridge-pair]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(/** @type {HTMLFormElement} */ (event.target));
    try {
      const decoder = await api('POST', `/workspaces/${encodeURIComponent(workspaceId)}/decoders`, { name: String(form.get('name') ?? '') });
      const ssid = String(form.get('ssid') ?? '');
      await bridge.pair(decoder.id, decoder.token, ssid ? { ssid, password: String(form.get('password') ?? '') } : null);
      ok();
    } catch (caught) {
      fail(caught);
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (bridge && bridge.state === 'ready') event.preventDefault();
  });
  void sendEarlier().catch(() => {});
}
```

- [ ] **Step 5: Browser test**

`apps/timing/test/browser/bridge.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

let app;
let browser;
let member;
let personal;

before(async () => {
  app = await startTiming();
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  personal = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
});
after(async () => {
  await browser?.close();
  await app?.close();
});

test('connect, pair and forward with the simulated decoder', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/personal/bridge?simulate=fast');
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByRole('heading', { name: 'Pair this decoder' }).waitFor();
  await page.getByLabel('Decoder name').fill('Gate');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByText(/^Forwarding from decoder /).waitFor();
  await page.locator('[data-bridge-preview] li').first().waitFor({ timeout: 20_000 });
  assert.equal(app.store.decoders(personal)[0].name, 'Gate');
  assert.ok(app.engine.snapshot(personal).crossings.length > 0);
  assert.deepEqual(errors, []);
});

test('without JavaScript, the page says what the bridge needs', async (t) => {
  const { context, page } = await pageAs(browser, app, member, { javaScriptEnabled: false });
  t.after(() => context.close());
  await page.goto('/personal/bridge');
  await page.getByText(/needs Chrome or Edge/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Connect decoder' }).isVisible(), false);
});
```

`pageAs` in `test/browser/browser.js` gains a `javaScriptEnabled` option (default `true`), passed to `browser.newContext({ baseURL: app.base, viewport, javaScriptEnabled })`; Task 12's no-JavaScript tests use it too.

- [ ] **Step 6: Styles, run tests, lint, typecheck, commit**

With the `frontend-design` skill: the bridge styles in `public/app.css` (`.bridge-state`, `.is-offline`, `.bridge-preview`) apply; make the preview full width and line it up with the status strip.

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck && pnpm --filter @tinylap/timing-app test:browser`
Expected: PASS.

```bash
git add apps/timing
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing-app): serve the bridge as a page, enhanced by Web Serial"
```

---
### Task 12: JavaScript off, the production build, and the docs

**Files:**
- Create: `apps/timing/test/browser/no-js.test.js`, `apps/timing/test/browser/assembled.test.js`
- Modify: `apps/timing/README.md`, `docs/timing.md` (if it names screens), `README.md` (timing line, if it names URLs), `docs/superpowers/specs/2026-10-15-timing-core-design.md` (§8 points to the new spec)
- Test: the two new browser tests

**Interfaces:**
- Consumes: `pageAs(browser, app, who, { viewport?, javaScriptEnabled? })`, `openBrowser` (browser fixture); `startTiming({ root, build })`; `assemble` (`tools/assemble.js`); `startPlannerStub`, `CLOSED` (planner stub).

- [ ] **Step 1: Every form with JavaScript off**

`apps/timing/test/browser/no-js.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// AGENTS.md "Web platform first": with JavaScript switched off, every
// screen works through links and forms, and Back and Forward behave.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { CLOSED, startPlannerStub } from '../server/planner-stub.js';
import { openBrowser, pageAs } from './browser.js';

let app;
let planner;
let browser;
let member;

before(async () => {
  planner = await startPlannerStub();
  app = await startTiming({ plannerUrl: planner.url });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
});
after(async () => {
  await browser?.close();
  await app?.close();
  await planner?.close();
});

test('set up, race, tap and sign out with JavaScript off', async (t) => {
  const { context, page } = await pageAs(browser, app, member, { javaScriptEnabled: false });
  t.after(() => context.close());
  await page.goto('/');
  assert.equal(new URL(page.url()).pathname, '/personal/board');
  await page.getByRole('link', { name: 'Setup', exact: true }).click();
  assert.equal(new URL(page.url()).pathname, '/personal/setup');

  await page.getByLabel('Planner link').fill(`${planner.url}/layouts/${CLOSED}`);
  await page.getByLabel('Track name').fill('Office loop');
  await page.getByLabel('Direction').selectOption('cw');
  await page.getByRole('button', { name: 'Use this track' }).click();
  await page.getByText('Now: Office loop, clockwise.').waitFor();

  for (const name of ['Ana', 'Ben']) {
    await page.getByLabel('New driver').fill(name);
    await page.getByRole('button', { name: 'Add driver' }).click();
  }
  await page.getByLabel('New name for Ben').fill('Benji');
  await page.locator('form', { has: page.getByLabel('New name for Ben') }).getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('New name for Benji').waitFor();

  await page.locator('#drivers li', { has: page.getByLabel('New name for Benji') }).getByRole('link', { name: 'Delete' }).click();
  await page.getByRole('heading', { name: 'Delete Benji?' }).waitFor();
  await page.goBack();
  assert.equal(new URL(page.url()).pathname, '/personal/setup');
  await page.goForward();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByText('Benji').waitFor({ state: 'detached' });

  await page.getByRole('link', { name: 'Race', exact: true }).click();
  await page.getByLabel('Minutes').fill('2');
  await page.getByLabel(/Countdown/).fill('0');
  await page.getByRole('button', { name: 'Start' }).click();
  assert.equal(new URL(page.url()).pathname, '/personal/board');
  await page.getByRole('heading', { name: 'Race' }).waitFor();
  await page.getByRole('link', { name: 'Race', exact: true }).click();
  await page.getByRole('button', { name: 'Abort' }).click();
  await page.getByRole('button', { name: 'Start' }).waitFor();

  await page.getByRole('link', { name: 'Tap', exact: true }).click();
  await page.getByRole('button', { name: 'Ana' }).click();
  await page.getByRole('status').filter({ hasText: 'Ana: started' }).waitFor();

  await page.locator('summary', { hasText: 'Ana' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL((url) => url.origin !== app.base || url.pathname === '/');
});
```

Sign out ends at accounts' end-session page (another origin) or back at the start page; either proves the form worked. With JavaScript off, `<details>` still opens on click: it's native.

Run: `pnpm --filter @tinylap/timing-app test:browser`
Expected: PASS once Tasks 3–11 are in. If a step fails, the failure names the page and form; fix the page, not the test.

- [ ] **Step 2: The production build**

`apps/timing/test/browser/assembled.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The app as production serves it: assets under /v/<build>/, every page
// loading them without a 404 or a CSP violation.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../../../../tools/assemble.js';
import { appDir, startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

const SHA = 'abc1234';
let app;
let browser;
let member;

before(async () => {
  const root = mkdtempSync(join(tmpdir(), 'timing-assembled-'));
  assemble(appDir, root, SHA);
  app = await startTiming({ root, build: SHA });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  await app.form(member, '/personal/drivers', { name: 'Ana' });
});
after(async () => {
  await browser?.close();
  await app?.close();
});

test('every screen loads its assets from /v/<build>/', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  const failed = [];
  page.on('response', (res) => { if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`); });
  for (const screen of ['board', 'race', 'tap', 'setup', 'bridge']) {
    await page.goto(`/personal/${screen}`);
    await page.locator('main h1, main .board-title').first().waitFor();
    const css = await page.evaluate(() => [...document.styleSheets].map((s) => s.href).filter(Boolean));
    assert.ok(css.every((href) => new URL(href).pathname.startsWith(`/v/${SHA}/`)), `${screen}: ${css.join(', ')}`);
  }
  assert.deepEqual(failed, []);
  assert.deepEqual(errors, []);
});
```

Run: `pnpm --filter @tinylap/timing-app test:browser`
Expected: PASS.

- [ ] **Step 3: Docs**

- `apps/timing/README.md`: the first line says "a club's track" (glossary), and the development paragraph becomes: "Open http://localhost:8100 and sign in. Without hardware: Setup → "Pair over Wi-Fi only", then `node tools/decoder-sim.js net --url http://localhost:8100 --decoder <id> --token <token>`, or the bridge with a simulated decoder at http://localhost:8100/personal/bridge?simulate=fast."
- `docs/superpowers/specs/2026-10-15-timing-core-design.md` §8: one line at the top, "Replaced by `docs/superpowers/specs/2026-10-15-timing-ui-server-rendered-design.md`."
- `docs/timing.md` and `README.md`: replace any `#bridge`, `#watch=` or `/?…#…` address with the new ones (`/personal/bridge`, `/clubs/<id>/bridge`, `/watch/<token>`).

- [ ] **Step 4: Run everything and commit**

Run: `pnpm check && pnpm --filter @tinylap/timing-app test:browser && pnpm --filter @tinylap/track-planner test:browser`
Expected: PASS.

```bash
git add -A apps/timing docs README.md
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "test(timing-app): run every screen with JavaScript off and from the production build"
```
