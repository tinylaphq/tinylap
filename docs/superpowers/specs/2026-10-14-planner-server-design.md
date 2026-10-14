# Planner Server — Design Specification

Date: 2026-10-14
Extends: `docs/superpowers/specs/2026-10-13-track-identity-design.md`

## 1. Purpose

Layouts get a home on the web. Two uses, in this order:

1. **Sharing links.** Someone shares a layout as a link; whoever opens it sees
   it, and can open a copy in the planner.
2. **A source of tracks for the timing app.** The timing app fetches a layout
   by its link, or finds every stored layout of a build by its shape.

A public catalogue of tracks is a later use. The storage chosen here supports it
without changes, but nothing in this spec lists or searches tracks.

## 2. Decisions

| Question | Decision |
| --- | --- |
| Static server plus an API server? | **One Node server** (`node:http`, `node:sqlite`, no framework). It replaces Caddy and `tools/dev-server.js`, so dev and production run the same code. |
| What does a link point to? | A **snapshot**: the exact layout at the moment of sharing, addressed by a hash of its content. Snapshots never change. A changed layout is a new snapshot with a new link. No versions, no owners. |
| HTML or JSON? | Both, from the same URL, by **content negotiation**. A browser gets the export page, an API client gets JSON. |
| Who may post? | **Anyone, anonymously.** Only valid layouts are accepted, with a size cap and a rate limit. The format carries no personal data, so nothing needs an owner or a delete. |
| API description | **OpenAPI 3.1**, with the layout format as **JSON Schema 2020-12**, errors as **RFC 9457 Problem Details**, discovery through **RFC 8631** `service-desc` and **RFC 9727** `/.well-known/api-catalog`. |
| Does the server assign track ids? | **No.** Clients assign them (`assignTrack`) before posting. A server-side random id would make the same post produce different snapshots. |

## 3. Three identifiers

This is the core mechanism, and `docs/identity.md` (§9) explains it for
everyone building against the API.

| Identifier | Answers | Changes when | Used for |
| --- | --- | --- | --- |
| **Snapshot key** `/layouts/<key>` | "this exact file" | anything in the layout changes, including room, position or which pieces describe the build | sharing links |
| **Track id** `track.id` | "this track, as built and kept by its owner" | the geometry changes (track-identity spec §5) | leaderboards at a venue |
| **Shape key** `/shapes/<key>` | "this build, wherever and however it was made" | the physical build changes; moving, rotating, room size and piece choice never change it; mirroring does | finding the same build elsewhere; online races (later) |

Consequences:
- Many snapshots can share a track id (the same track, moved or re-described).
- Many track ids can share a shape (two people who built the same thing
  independently, or one who lost the file and built it again).
- Someone who lost a link but still has the layout recomputes its shape key
  locally and finds every stored snapshot of that build. No account, no link.
- An online race (a later sub-project) is defined as **shape key + direction +
  laps**. Every venue whose layout has that shape can take part.

### Keys

- `snapshotKey(layout)`: SHA-256 of the UTF-8 bytes of the layout's canonical
  JSON, truncated to the first 16 bytes, base64url without padding
  (22 characters).
- Canonical JSON: `layoutFromData(data)`, with `pieces` sorted by `y`, `x`,
  `type`, `rot`, then `JSON.stringify`. `layoutFromData` builds a fresh object
  with a fixed key order, and piece order carries no meaning, so the same
  layout always serialises to the same bytes, however its pieces were listed. A golden test pins one known key, so any
  accidental change to the canonical form fails a test.
- `shapeKey(shape)`: the same hash over the full shape string, prefix included.
- Both are async (`crypto.subtle.digest`) and run unchanged in browsers and in
  Node, so the planner, the timing app and the server compute identical keys.

## 4. Architecture

```
apps/track-planner/
  server/
    main.js        entry: reads env, opens the store, starts listening
    app.js         request handler: routing, negotiation, headers
    static.js      file serving for the assembled app (/, /v/<sha>/)
    store.js       SQLite access: put, get, list by shape
    problems.js    RFC 9457 helpers
    negotiate.js   Accept and Content-Type parsing
    rate-limit.js  in-memory fixed window per client IP
    pages.js       the server-rendered HTML pages (/api, /shapes/<key>)
    openapi.json   the API description, hand written
  test/server/     server tests
```

- The server imports `exportHtml` from the planner's `js/storage.js` to render
  the HTML representation. `exportHtml` already runs in Node.
- `tools/dev-server.js` is removed; `pnpm dev` runs the server against the app
  source using `tools/serve-map.js`, with `Cache-Control: no-store` as today.
- Configuration by environment:
  - `PORT` (default 8080)
  - `TINYLAP_DB` (default `/data/tinylap.sqlite`; `:memory:` in tests)
  - `TINYLAP_RATE_LIMIT` (posts per hour per client, default 30)
  - `TINYLAP_PUBLIC_URL` (the origin used in absolute links such as `url`;
    without it, the request's `Host`)
  - `TINYLAP_CLIENT_IP_HEADER` (the header carrying the client IP, set to
    `Fly-Client-IP` on Fly; without it, the socket address. A header is only
    trusted when configured, so a self-hoster without a proxy can't be fooled
    by a forged one.)
- The rate limiter lives in memory, so a restart resets it. That is accepted.
- `node:sqlite` is built into Node 24. If it still prints an experimental
  warning, that is accepted.

### Storage

One table:

```sql
CREATE TABLE layouts (
  key        TEXT PRIMARY KEY,   -- snapshot key
  json       TEXT NOT NULL,      -- canonical JSON
  shape_key  TEXT,               -- NULL for layouts without a track
  track_id   TEXT,
  created_at TEXT NOT NULL       -- ISO 8601, UTC
);
CREATE INDEX layouts_shape ON layouts (shape_key);
```

Inserts use `INSERT ... ON CONFLICT DO NOTHING`; a repeated post is a no-op.

### Package additions (`@tinylap/track-format`)

| Name | Kind |
| --- | --- |
| `parseLayout(text)` | `Layout`. Reads JSON, or HTML through `layoutFromHtml`. Text whose first non-blank character is `{` is JSON. |
| `snapshotKey(layout)` | `Promise<string>` |
| `shapeKey(shape)` | `Promise<string>` |
| `canonicalJson(layout)` | `string` |
| `layout.schema.json` | JSON Schema 2020-12 for the file format, exported as `@tinylap/track-format/layout.schema.json` |

`layoutToHtml` does not move into the package: the export page needs the
planner's bill of materials and nothing else needs it.

## 5. API

All API responses carry `Link: </openapi.json>; rel="service-desc"` and
`Access-Control-Allow-Origin: *`. No route uses cookies or credentials.
`OPTIONS` preflights are answered for `POST /layouts` (`Content-Type` allowed).

### `POST /layouts`

- Body: `application/json` (a layout) or `text/html` (an exported page), read
  with `parseLayout`. Other types: `415`.
- Validation, in order:
  1. Larger than 512 KiB: `413`. (An exported page carries the drawing and is
     several times larger than its JSON.)
  2. Over the rate limit: `429` with `Retry-After`.
  3. Unparseable, or rejected by `layoutFromData`: `422`.
  4. **Track consistency.** If `shapeOf(layout)` is a shape, the layout must
     carry a `track` whose `shape` equals it. If `shapeOf(layout)` is `null`,
     it must carry no `track`. Otherwise `422`, with a `detail` that says to run
     `assignTrack` first. Open and unfinished layouts are welcome; they simply
     have no track and no shape key.
- Stores the canonical JSON under its snapshot key.
- `201 Created` with `Location: /layouts/<key>` when new, `200` when it already
  existed. Body: `{ "key", "url", "shapeKey" }` (`shapeKey` is `null` without a
  track). `url` is absolute, built from `TINYLAP_PUBLIC_URL`.

### `GET /layouts/<key>`

| Request | Representation |
| --- | --- |
| `Accept` prefers `text/html` over `application/json` (q-values respected) | the export page |
| anything else, including `*/*` and no `Accept` | the canonical JSON |
| `/layouts/<key>.json` or `/layouts/<key>.html` | that one, whatever `Accept` says |

- Both carry `Vary: Accept`; `If-None-Match` gives `304`.
- **JSON** is the snapshot itself and never changes: `ETag: "<key>"`,
  `Cache-Control: public, max-age=31536000, immutable`.
- **HTML** is a rendering of it, and the rendering changes when the export page
  does: `ETag: "<key>-<build sha>"`, `Cache-Control: no-cache`. The two
  representations never share an ETag.
- The export page gains an "Open in planner" link to `/?layout=<key>`.
  `exportHtml(layout, { openUrl })` takes it as an option; downloaded files
  are unchanged.
- Unknown or malformed key: `404`, `Cache-Control: no-store`.

### `GET /shapes/<key>`

- JSON: `{ "shapeKey", "shape", "layouts": [{ "key", "trackId", "createdAt" }] }`,
  newest first, at most 100.
- HTML (same negotiation rules): a plain page listing the snapshots as links.
- `Cache-Control: public, max-age=60`, `Vary: Accept`. A shape with no stored
  snapshots: `404`, `no-store`.

### Discovery and docs

- `GET /openapi.json`: the description (`application/vnd.oai.openapi+json`).
- `GET /schemas/layout.json`: the layout JSON Schema, referenced by the
  description.
- `GET /.well-known/api-catalog`: an RFC 9727 linkset pointing at
  `/openapi.json` and `/api`.
- `GET /api`: the docs page, rendered **on the server** from `openapi.json`
  into plain HTML (routes, parameters, representations, responses, problem
  types), with no scripts. Off-the-shelf renderers were ruled out: Scalar
  alone is 48 MB of Vue components, the opposite of this project's
  platform-first approach. Tools that want an interactive explorer point at
  `/openapi.json`.
- Problem types are defined once, as an `x-tinylap-problems` extension in
  `openapi.json` (name, status, title, description). The server takes its error
  titles from there, and `/api` lists them with an anchor each.

### Errors

Every error is `application/problem+json`:
`{ "type", "title", "status", "detail" }`. `type` is a URL under
`/problems/<name>` (`invalid-layout`, `track-mismatch`, `too-large`,
`rate-limited`, `unsupported-media-type`, `not-found`, `method-not-allowed`,
`unavailable`), each described in the OpenAPI document. Requesting a type URL
redirects (`302`) to its description on `/api`.

- Database unavailable: `503` on API routes; static files keep working.
- Unknown route: `404`. Wrong method on a known route: `405` with `Allow`.

## 6. Static files

- `/` and `/v/<sha>/` exactly as today: `no-cache` for pages, `immutable` for
  `/v/*`, `no-store` on errors.
- gzip happens once in the assemble step (`.gz` beside each file); the server
  sends it when `Accept-Encoding` allows, with `Vary: Accept-Encoding`.
- `ETag` from the file's content; `304` on match.
- Paths are resolved inside the served root only; anything that escapes it
  (`..`, encoded or not) is `404`.

## 7. Security headers

- Existing: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  no `Server` header.
- New `Content-Security-Policy`:
  - planner pages: `default-src 'self'`, with the inline import map allowed by
    its SHA-256 hash, computed in the assemble step;
  - `/layouts/<key>` HTML: `default-src 'none'; style-src 'unsafe-inline';
    img-src data:` (the page has no scripts at all);
  - `/api` and the `/shapes/<key>` HTML: the same policy as the `/layouts`
    HTML, since none of them has a script.
- Logs: one line per request (method, path, status, duration). No IP addresses
  are logged; the rate limiter holds them in memory only, for at most one hour.

## 8. The planner

- **Share button.** Runs `prepareExport` (the track is settled exactly as on
  export, and the planner keeps the result), posts the JSON to `/layouts`,
  copies the returned `url` to the clipboard and confirms it. On failure it
  shows the problem's `title`; the layout is untouched.
- **Opening a link.** `/?layout=<key>` fetches `/layouts/<key>.json` and opens
  it exactly like opening a file: the planner adopts its `track`, and the
  replacement is one undo step, so it needs no confirmation (as with Open and
  Clear today). The parameter is removed from the address bar afterwards. A
  failed fetch shows the problem's `title` and leaves the layout untouched.
- **Open** accepts `.json` as well as `.html`, through `parseLayout`.

## 9. Documentation

- `docs/identity.md` (CC-BY-SA-4.0): the three identifiers, how each is
  computed and when it changes, the keys' exact algorithms, and worked
  examples (sharing a link; two friends who lost the link; an online race).
  It is written for people building against the API, not for this repo's
  developers. It also says what the identifiers are not: a track id proves no
  ownership (anyone can post a snapshot carrying any id, as long as the shape
  matches), and a shape key says "built the same", not "the same venue". The package README and the OpenAPI description link to it.
- The OpenAPI description documents every route, representation and problem
  type, and is checked against the server by the contract tests.
- README: a self-hosting section (Docker image, volume, environment variables).

## 10. Deployment

- The image runs `node:24-alpine` instead of Caddy. It holds the assembled
  `/srv`, plus the server, the planner modules it imports and their production
  `node_modules`.
- A Fly volume mounted at `/data` holds the database. Creating it is a one-off
  `fly volumes create` the maintainer runs. Fly's daily volume snapshots are
  the backup.
- Still one smallest machine that stops when idle. SQLite and a single volume
  mean exactly one machine; that is accepted.

## 11. Testing

- **Package:** `parseLayout` reads JSON and HTML and rejects other text;
  `canonicalJson` is stable and independent of piece order; `snapshotKey` matches a golden value and changes
  with any change; `shapeKey` is equal after a rotation; the JSON Schema
  accepts every reference layout and the v1 golden file's data, and rejects a
  missing `pieces`.
- **Server** (real server on a random port, `TINYLAP_DB=:memory:`):
  - post: `201`, repeated `200`, `413`, `415`, `422` invalid, `422` track
    mismatch (missing, wrong shape, track on an open layout), `429`;
  - an HTML body stores the same snapshot as its JSON;
  - negotiation: browser `Accept`, `*/*`, none, q-values, suffixes, `Vary`,
    `304`; JSON and HTML have different ETags;
  - `/shapes`: lists snapshots of two different track ids with one shape;
    `404` for an unknown shape;
  - CORS headers and preflight; `Link` header; Problem Details bodies;
  - static: gzip, `304`, `..` and `%2e%2e` give `404`, cache headers.
- **Contract:** every response the server tests produce is validated against
  `openapi.json` (Ajv, a dev dependency only).
- **Smoke:** the Docker image starts, a layout is posted, and is fetched as
  JSON and as HTML.
- **Planner:** share posts and copies (fetch and clipboard stubbed); `?layout=`
  opens the layout and adopts its track; `.json` files open.

## 12. Out of scope

- A catalogue, search, or listing of all tracks.
- Accounts, ownership, deleting snapshots, editing in place, `parent` links
  between snapshots.
- Online races and anything about timing protocols (the timing app's spec).
- Running more than one machine.
