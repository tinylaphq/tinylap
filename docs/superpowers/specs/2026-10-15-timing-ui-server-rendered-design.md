# Timing UI, server-rendered — Design Specification

Date: 2026-10-15
Replaces: §8 "Browser app" of `docs/superpowers/specs/2026-10-15-timing-core-design.md`
Follows: `AGENTS.md` "Web platform first"

## 1. Purpose

The timing app's pages are rebuilt as server-rendered HTML with real URLs and
plain forms. JavaScript stays only where the platform needs it or a round trip
is too slow.

The first version was a client-side app on top of the JSON API, with `#setup`
hash routes. That broke in production (the hash links resolved against
`<base href="/v/<sha>/">` and gave 404s) and went against the project's
standards: the server already holds every bit of state, and almost every
screen is a form.

Everything behind the pages stays: the store, the engine, the live hub, the
JSON and SSE API for decoders and API clients, ingest, pairing, the bridge's
serial logic and its outbox. This spec changes only what a browser is served
and how it talks back.

## 2. Decisions

| Question | Decision |
| --- | --- |
| Where are pages made? | **On the server**, from the store, with an escaping HTML template helper (§4). No client-side rendering of pages. |
| URLs | **Real paths**, one per screen, under the space they belong to: `/clubs/<id>/…` or `/personal/…` (§3). No hash routes, no client router. The address bar is always a link to what you see. |
| How do changes reach the server? | **Plain `<form method="post">`** to the page's own resource URLs; the server answers **303 See Other** to the page that shows the result (POST/redirect/GET). A failed form comes back as the same page, **status 422**, with the error next to the field and the input kept. |
| Where does JavaScript stay? | **Progressive enhancement only** (§7): live board updates over SSE, the ticking clock, instant tap entry, full-screen mode, and the USB bridge (Web Serial, which only exists in JavaScript). Every other page works fully without it. |
| Live updates | The server **renders the board's HTML** and streams it over SSE to pages; a small script swaps it in. One renderer, on the server; the browser never rebuilds the board from JSON. |
| Confirming destructive actions | A **confirmation page** with its own form (works without JavaScript); with JavaScript the same form can open in a `<dialog>`. Never `confirm()` or `prompt()`. |
| Account controls | A native **`<details>` menu** in the navbar: your name, then your clubs and personal space, Account, Sign out. No script needed. |
| Copy | The TinyLap glossary: **Sign in / Sign out**, **club** and **personal**, **track** (a "layout" is only a planner template), **Share**. "Workspace" never appears to users. |
| JSON API | **Unchanged** at `/workspaces/…`, `/decoders/…`, `/watch/{token}` (JSON) and `/…/live` (JSON SSE). Pages don't use it, except the bridge (it posts passings and pairs decoders). |
| Assets | Stylesheets, scripts and the mark are **files**, versioned under `/v/<build>/` in production and plain paths in development (§4.3). No inline scripts or styles; page CSP `script-src 'self'`. |

## 3. URLs

Every page belongs to one space, and its address says which: **`/clubs/<id>/…`**
for a club (`<id>` is the club's accounts id) and **`/personal/…`** for your own
space. Below, `<space>` stands for either prefix. A club link works for every
member of that club; `/personal/…` always means the signed-in person's own
space. Every page that needs a member answers **303 to
`/auth/login?returnTo=<path>`** when signed out, and a **404 page** when you
are not a member of that club.

The app tells clubs from personal spaces by a `kind` field (`"personal"` or
`"club"`) that accounts adds to each entry of the access token's `workspaces`
claim (today it carries `id`, `role` and `name`; the change is additive, and
`@tinylap/auth`'s `WorkspaceClaim` type gains `kind`). `/clubs/<id>` for your
personal space's id redirects to `/personal`.

### Pages (GET, `text/html`)

| Path | Page |
| --- | --- |
| `/` | Signed in: **303** to `<last>/board`, where `<last>` is the space prefix in the `tl-space` cookie (set on every space page), else `/personal`. Signed out: the start page (what TinyLap Timing is, Sign in). Everyone has a personal space, so there is always somewhere to go. |
| `<space>/board` | The live board (§6.1). `?big` renders the wall-screen layout. |
| `<space>/race` | Race control: the start form, or the running session with Abort (§6.2). |
| `<space>/tap` | Tap entry: one button per driver (§6.3). |
| `<space>/setup` | Track, drivers, transponders, decoders, watchers link (§6.4). |
| `<space>/drivers/<d>/delete` | "Delete Ana?" confirmation with its form. |
| `<space>/decoders/<id>/unpair` | "Unpair Gate?" confirmation. |
| `<space>/watch-link/new` | "Make a new watchers link? The old one stops working." confirmation. |
| `<space>/bridge` | The USB bridge (§6.5). |
| `/watch/<token>` | The watchers board for a browser; the same URL keeps answering JSON to API clients, by content negotiation as the planner's `/layouts/<key>` does (`Accept: text/html` or `Sec-Fetch-Mode: navigate` gets the page). `?big` as on the board. An unknown or replaced token gets a 404 page: "This watchers link no longer works." |

### Form targets (POST, `application/x-www-form-urlencoded`)

Every POST must come from the app's own pages (`requireSameOrigin`, as now),
checks the same permission as the JSON route it mirrors (§3 of the core spec's
permission matrix), and answers 303 on success.

| Path | Fields | 303 to |
| --- | --- | --- |
| `<space>/sessions` | `kind`, `roster` (repeated), `minutes`, `countdown` | `<space>/board` |
| `<space>/sessions/<s>/abort` | — | `<space>/race` |
| `<space>/tap` | `driver` | `<space>/tap` |
| `<space>/drivers` | `name` | `<space>/setup#drivers` |
| `<space>/drivers/<d>` | `name` | `<space>/setup#drivers` |
| `<space>/drivers/<d>/delete` | — | `<space>/setup#drivers` |
| `<space>/transponders/<code>` | `driver` (empty = unassigned) | `<space>/setup#transponders` |
| `<space>/track` | `link`, `name`, `direction` | `<space>/setup#track` |
| `<space>/decoders` | `name` | `<space>/setup?paired=<id>#decoders` (shows the token once, §6.4) |
| `<space>/decoders/<id>/unpair` | — | `<space>/setup#decoders` |
| `<space>/watch-link` | — | `<space>/setup#watchers` |

The `#…` in a redirect is a plain fragment: it scrolls to the section that
changed. It never selects a screen.

### Streams for pages (GET, `text/event-stream`)

| Path | Carries |
| --- | --- |
| `<space>/board/events` | `board` events: the rendered `<div id="board-live">` (§6.1), plus `retry` and a heartbeat. After a reconnect the stream sends a full board, with no event ids and no replay. |
| `/watch/<token>/events` | The same for watchers, closed when the token is replaced. |

These sit beside the JSON `/workspaces/<id>/live` and `/watch/<token>/live`,
which stay for API clients.

## 4. Rendering

### 4.1 Templates

- `server/views/html.js`: a tagged template `` html`…` `` that escapes every
  interpolated value (`& < > " '`), flattens arrays, and passes through values
  made by `html` itself or marked with `safe()`. Nothing else may produce HTML.
  Unit-tested for escaping, nesting, arrays, `null`/`false` (render nothing).
- One module per page under `server/views/` (`board.js`, `race.js`, `tap.js`,
  `setup.js`, `confirm.js`, `bridge.js`, `watch.js`, `start.js`, `notice.js`).
  Each exports a pure function from a view model to HTML, so pages are tested
  without a server.
- `server/views/layout.js`: the shell every page shares, modelled on accounts'
  `layout.js` (§4.2).

### 4.2 The shell

- `<head>`: charset, viewport, `referrer` no-referrer, `<title>{Page} · TinyLap Timing</title>`, palace and design stylesheets, `app.css`, the TinyLap mark as favicon, and the page's enhancement script, if any, as `<script type="module" src>`.
- The navbar: the mark and "TinyLap Timing" (linking to `/`), the screen links
  (`<a href="<space>/board">Board</a>` … with `aria-current="page"` on the
  current one), then the board controls (live status, Big screen) on board
  pages only, then the account menu: a `<details>` whose `<summary>` is your
  name, holding links to each club and your personal space (the current one
  marked), Account (accounts' `/account`), and a `<form method="post"
  action="/auth/logout">` with "Sign out".
- `<main>` holds the page; errors and notices use palace's `.status` classes.
- Pages are `Cache-Control: no-store`; the CSP is accounts' `PAGE_CSP` plus
  `connect-src 'self'` for the streams and the bridge's posts.

### 4.3 Assets

- Files live in `apps/timing/public/` (`app.css`, enhancement scripts, the
  mark) and in the served packages (`palace-ui`, `design`, `timing` for the
  bridge's ZRound code).
- Development serves them at `/public/…` and `/pkg/<name>/…`, uncached.
- Production: `tools/assemble.js` copies them under `/v/<build>/` as now, and
  the layout prefixes every asset URL with `/v/<build>/` (from `TINYLAP_BUILD`),
  so they are cached forever and a deploy changes every asset URL at once.
  `assemble` learns an app without `index.html` (it copies `public` and the
  packages and writes no page). The page `<base href>` goes away.
- Only the bridge page imports a package (`@tinylap/timing`, for the ZRound
  code). It gets an import map, the one inline `<script>` anywhere, allowed
  by its hash as the planner's is. The other scripts import nothing but
  their own files.

## 5. Forms

- Bodies are read with a form-urlencoded reader beside `readJson` (64 KiB cap;
  415 for other types on page routes).
- Validation reuses the JSON routes' rules and messages; both call the same
  functions, so a rule is written once. The page routes and the JSON routes
  are thin adapters over shared operations (`server/operations.js`: add
  driver, rename driver, assign transponder, set track, pair decoder, start
  session, …), which the existing JSON handlers move onto.
- On failure the page is rendered again with status **422**: the form keeps
  what was typed, the field gets `aria-invalid="true"` and its message
  (`aria-describedby`), and a `.status-error` summary sits at the top of the
  form.
- Rate limits are the JSON routes' (pairing per member, taps per member); a
  limit renders the page with the message and status 429.
- The planner unreachable while importing a track: the setup page with the
  error, status 502, as the JSON route's problem says.

## 6. Pages

### 6.1 Board, and the watchers board

- Server-rendered from `engine.snapshot`: the header (kind, track and
  direction, the clock with its label), the results panel of the last
  qualifying or race, the standings table, the last laps, and, for members,
  the unknown-car notice linking to `<space>/setup#transponders` and the "Get
  the track ready" steps on an empty board.
- Everything that changes lives in one `<div id="board-live">`, so the
  stream can replace it whole.
- The clock carries its times as data: `<time data-opens="…" data-closes="…"
  data-kind="…" data-state="…" data-now="…">`, rendered with the value at
  request time.
- Without JavaScript the board is a correct snapshot, and
  `<noscript><meta http-equiv="refresh" content="10"></noscript>` in the head
  reloads it every ten seconds.
- With JavaScript, `public/board.js`:
  - opens `<space>/board/events` (or `/watch/<token>/events`) and swaps in each
    `board` event's HTML;
  - ticks the clock every 200 ms from its data attributes, using the server's
    `now` for the skew (as `view.js` does today);
  - shows the live status in the navbar: connected (`--p-success`),
    reconnecting (`--p-warning`), disconnected (`--p-error`);
  - turns "Big screen" into full screen. Without JavaScript "Big screen" is a
    link to `?big`.
- The server sends at most four `board` events a second per subscriber
  (latest wins), so a busy race doesn't flood a phone.
- Watchers get the same board without member parts: no transponder codes, no
  unknown-car notice, no setup steps, no navbar links but the mark.
  Watcher streams are tagged with their token and close when it is replaced,
  as now.
- `?big` scales every part of the board (headings, tags, badges, clock,
  tables) and drops the members-only notice.

### 6.2 Race control

- No running qualifying or race: the start form, a `<fieldset>` of radios
  (Race, Qualifying), checkboxes for the drivers (all checked), Minutes,
  Countdown (seconds), and "Start". No drivers yet: a notice linking to
  Setup.
- A running one: what it is, its state, "Show the board", and a form with
  "Abort". Buttons sit in a row with one size.

### 6.3 Tap entry

- One `<form method="post" action="<space>/tap">` per driver, a big button
  each. The response page says what the tap did ("Ana: 8.412", "Ana:
  started", "Too fast, tap again").
- With JavaScript, `public/tap.js` submits the same forms with `fetch`
  (form-encoded, `Accept: application/json`) and shows the result in place,
  so taps don't wait for a page load. The page route answers JSON when asked
  for it.
- No drivers: a notice linking to Setup; no tiles, no instruction.

### 6.4 Setup

- Sections with their own `id`s (`track`, `drivers`, `transponders`,
  `decoders`, `watchers`), each a `card-static` with its forms.
- Drivers: a list, each with an inline rename form and a "Delete" link to the
  confirmation page (owners and admins only); an "Add driver" form.
- Transponders: a table, a form per row with a driver `<select>` and "Assign".
  Unknown ones first and marked.
- Decoders: the list with last-seen times and "Unpair" links (owners and
  admins); "Pair over Wi-Fi only" as a form with a name field. After it,
  `?paired=<id>` shows the token **once**: it is put in a short-lived,
  single-use sealed cookie by the POST and read by this GET, never in the URL.
  A link to the bridge for pairing over USB.
- Watchers link: the current link in a read-only field, or none; "Make a new
  watchers link" goes to the confirmation page when one exists.

### 6.5 Bridge

- The server renders the explanation and the states' markup. Without
  JavaScript, or without Web Serial: "The bridge needs Chrome or Edge on a
  laptop: it reads the decoder over USB with Web Serial."
- `public/bridge.js` loads only on this page and is today's `bridge.js`,
  `outbox.js` and `sim-port.js` with a smaller view: it toggles the server-
  rendered state sections (`hidden`) and fills in counts and the preview.
  Pairing posts to the JSON API as today (the decoder token must reach the
  board over serial, so this step is JavaScript by nature).
- Leaving the page ends the bridge. The page says so ("Keep this tab open
  while racing"), and `beforeunload` asks while it is forwarding. The board
  runs in another tab; there is no in-page navigation to preserve.

### 6.6 Start, notices and errors

- The start page and the notices (no space yet, signed out, watchers link
  gone, not a member, not found) use the brand lockup and a `card-static`, as
  accounts' pages do, and say what to do next.

## 7. Progressive enhancement, in full

| Script | Page | Without it |
| --- | --- | --- |
| `board.js` | board, watchers board | snapshot, reloaded every 10 s; "Big screen" is `?big` |
| `tap.js` | tap | each tap is a page load |
| `bridge.js` | bridge | the page explains that the bridge needs JavaScript and Web Serial |
| `confirm.js` (optional) | setup | confirmation pages instead of `<dialog>`s |

No other script exists. Each is an ES module, under 200 lines except the
bridge, and touches only the page it is loaded on.

## 8. What goes and what stays

- **Goes:** `js/main.js` (router), `js/view.js` (the client-side board model;
  its clock logic moves into `public/board.js`), `js/board.js`,
  `js/control.js`, `js/setup.js`, `js/tap.js`, `js/live.js`, `js/api.js`,
  `js/dom.js`, `index.html`, and their unit tests.
- **Moves to `public/`:** `bridge.js`, `outbox.js`, `sim-port.js`,
  `format.js` (also used by the server views, so it moves to a module both
  can import).
- **Stays:** everything under `server/` except that `workspace.js`, `setup.js`,
  `control.js` and `ingest.js`'s tap handler move their logic into
  `operations.js`; the JSON and SSE API and its tests; `openapi.json` (pages
  and form routes are not API and are not described there).
- **Accounts:** the `workspaces` claim gains `kind` (§3), with a test; `@tinylap/auth`'s types follow.
- `docs/timing.md` and the README: the page URLs, and the bridge at
  `<space>/bridge`.

## 9. Security

- Forms are protected as the JSON writes are: `requireSameOrigin`
  (`Sec-Fetch-Site: same-origin`, or a matching `Origin`), checked before the
  body is read; `SameSite=Lax` session cookie; `form-action 'self'` plus the
  issuer's origin (for Sign out's redirect).
- Every page and form route checks membership and role through the same
  `can()` calls as its JSON route. A page never shows an action the role
  can't take.
- The watchers token stays out of logs (`/watch/…` is already redacted) and
  out of `Referer` (no-referrer). The decoder token after pairing never
  appears in a URL (§6.4).
- No HTML is made outside `html`; the stream's HTML comes from the same
  views.

## 10. Testing

- **Views:** unit tests per view function: escaping of names and codes,
  member vs watcher parts, empty states, the 422 error rendering.
- **Server:** `node:test` against the real server and accounts, as now:
  each page's status, redirects for signed-out and non-members, every form's
  303 and its effect, 422 with the input kept, 429, same-origin refusal, the
  token-once cookie, content negotiation on `/watch/<token>`, the board
  stream sending HTML and closing on token rotation.
- **Browser, JavaScript off** (`javaScriptEnabled: false`): set the track, add
  and rename a driver, assign a transponder, delete via the confirmation
  page, start and abort a race, tap, sign out. Back and Forward work, every
  link is a URL.
- **Browser, JavaScript on:** the board updates live and the clock ticks;
  taps don't reload; the bridge with `?simulate=fast` pairs and forwards.
- **Production build:** the existing assembled-build test runs every page
  under `/v/<build>/` assets.

## 11. Out of scope

- The planner. It stays a client-side editor; its library and share screens
  are candidates for the same treatment in a later spec.
- The palace-ui release from the design tour (navbar menu and tabs, select,
  status text case, tags, checks). This spec uses palace as it is and writes
  a local style only where palace has none, marked for upstreaming.
- A shared server-side layout between accounts and timing (a later
  `@tinylap/design` addition).
- Heats and finals, the ladder, firmware.
