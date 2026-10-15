# Timing Core — Design Specification

Date: 2026-10-15
Extends: `docs/superpowers/specs/2026-10-13-track-identity-design.md`,
`docs/superpowers/specs/2026-10-14-planner-server-design.md`,
`docs/superpowers/specs/2026-10-14-identity-design.md`

## 1. Purpose

A web app that times laps on a TinyLap track and shows them live on any
screen: a phone, a laptop, the big screen on the wall, or someone following
from elsewhere.

The first user is an office: coworkers who race now and then, maybe once a
day, on one layout that stays up for weeks. Club race nights are the later
goal. This spec is the **timing core**, the part everything else builds on:

- decoders send passings, over a USB cable and over the internet;
- passings become laps, laps become practice, qualifying and race results;
- drivers, transponders, the current track and personal bests;
- a live board for members and a read-only watchers view for anyone.

Later specs build on it (§13): heats and finals, a challenge ladder, the
decoder firmware and hardware.

## 2. Decisions

| Question | Decision |
| --- | --- |
| Where does it run? | **On the web.** One server, any screen. A track laptop is only needed for the cable path. |
| How do passings arrive? | **Both a cable and the internet, at once.** Over USB the decoder talks to a browser tab (Web Serial), which forwards to the server. Over Wi-Fi the decoder posts to the server itself. The server drops duplicates, so whichever arrives first wins and either path can fail. |
| Is the internet fast enough? | **Yes**, because the **decoder stamps every passing** on its own clock. A lap is the difference of two stamps from the same decoder, so network delay never changes a lap time. It only delays the screens (typically 0.1–0.5 s). |
| Who computes laps? | **The server**, as the authority. The same code (`packages/timing`) runs in the bridge tab for an offline preview. |
| Hardware today? | **None.** A simulator and tap entry stand in until the firmware exists. |
| Session modes | **Practice** (always on, no end), **qualifying** (a time window, best lap), **race** (a timed race, most laps). Qualifying and races are started explicitly and take the track over; practice resumes when they end. |
| Race and qualifying format | **The RC norm: time windows.** Qualifying: laps anytime within X minutes, best lap ranks. Race: X minutes, most laps wins, ties broken by total time; when time is up each driver finishes their current lap. |
| Race start | **A grid behind the line** and an on-screen countdown. Each driver's first crossing after "go" starts their race. |
| Cars and drivers | A transponder belongs to a **driver**; a driver can own several. Drivers are records, not accounts (identity spec). |
| Tracks | The workspace has a **current track and direction**, imported from a planner link. Everything inherits them until changed. |
| One app or part of the planner? | **A new `apps/timing`** with its own Node server and Fly app, the same pattern as the planner. |
| Decoder credentials | **Issued by the timing app**, one token per decoder, scoped to posting passings. Not an `accounts` device principal; see §9. |

## 3. Architecture

```
 decoder ──USB/ZRound──► bridge tab (Chromium, Web Serial) ──HTTPS──┐
    │                       │ IndexedDB buffer, local preview        │
    └──────────── Wi-Fi, HTTPS (fallback) ──────────────────────────►│
                                                                     ▼
 phone (tap entry) ──HTTPS──────────────────────────────────► apps/timing server
                                                       node:http + node:sqlite
                                                                     │ SSE
                                   live board · race control · watchers view
```

### `packages/timing` (MPL-2.0)

Pure functions, no I/O, run unchanged in Node and in browsers. Strict
`--checkJs`, like `track-format`.

- **`passing`**: the passing record and its key (§4).
- **`laps`**: passings of one transponder, in decoder-time order, become
  laps. A lap needs two passings of the same transponder from the same
  decoder boot. A gap below `minLap` (default 1.5 s) is a double read and
  dropped. A gap above `maxLap` (default 60 s) is no lap; the car was parked.
- **`sessions`**: the rules of practice, qualifying and race (§6): which laps
  count, rankings, the finish rule, results.
- **`zround`**: parses and writes ZRound Free LapCounter lines, plus the
  TinyLap extension commands (§5).

### `apps/timing` (AGPL-3.0-or-later)

One Node 24 process with `node:http` and `node:sqlite`, no framework, its
own Fly app, the planner's structure (`server/app.js`, `store.js`,
`problems.js`, `openapi.json`, …).

- **Ingest:** decoders and bridges post passings (§5).
- **Live:** one SSE stream per workspace (§7).
- **Workspace data:** drivers, transponders, decoders, the current track,
  sessions, laps, results.
- **Login:** `createBff` from `@tinylap/auth`, as in the planner; the
  deletions feed from `accounts` purges deleted workspaces.
- **Tracks:** fetched from the planner by share link (`/layouts/<key>`, JSON
  by content negotiation). The server fetches only from its configured planner
  origin (`TINYLAP_PLANNER_URL`), never from an arbitrary URL.
- **The browser app**, served by the same server (§8).

### Data

SQLite, every row scoped to a workspace; the deletions feed removes a deleted
workspace's rows.

- `decoders`: id, workspace, name, SHA-256 of its token, created, last seen.
- `drivers`: id, workspace, name, colour.
- `transponders`: workspace, code, driver (null while unassigned), first seen.
- `passings`: decoder, boot, transponder, `t`, `receivedAt`, `via`; unique on
  the key (§4).
- `tracks`: track id and shape from the planner file, workspace, name,
  planner snapshot key, the layout JSON. `workspace_settings` holds the
  current track and direction and the watchers token.
- `sessions`: kind, track, direction, duration, roster, state, start, "go",
  time-up and end times.
- `crossings`: one row per stored passing: its session, driver (null while
  the transponder is unassigned), transponder, server-mapped time, lap time
  (null for a start, a double read or a parked car) and whether it counts.
  Laps and results are derived from these and can be rebuilt from passings.

### `tools/decoder-sim`

A Node script that acts as a decoder with a few cars at configurable lap
times and jitter. It speaks ZRound to a virtual serial port (a pty) or posts
over HTTPS with a decoder token. It also answers the TinyLap extension
commands, so pairing can be tried without hardware. Used in tests and by
hand.

## 4. Passings

A passing is one car crossing the line:

```js
{ decoder, boot, transponder, t }
```

- `decoder`: the decoder's id, assigned at pairing.
- `boot`: a random 64-bit id, base64url, the decoder picks at every power-up
  and whenever its clock is reset (ZRound's `%I&` race start sets the clock
  to zero). Times from different boots are never compared.
- `transponder`: the transponder code, upper-case hex, as ZRound sends it.
- `t`: milliseconds on the decoder's clock since boot, an integer. That is
  ZRound's resolution, so the cable and the Wi-Fi copy of a passing carry the
  same value.

**Key:** `(decoder, boot, transponder, t)`. The same passing arriving over
the cable and over Wi-Fi has the same key; the server stores it once.

The server adds `receivedAt` (its own clock) and `via` (`serial`, `net` or
`tap`) for the first copy it stores.

**Tap entry** has no decoder. Each workspace has one virtual tap decoder,
`boot` = the session id, the driver's id as the transponder, and `t` = the
server's receive time in milliseconds. Tap laps are marked `via: 'tap'` and never count towards
personal bests.

## 5. Transports

### Cable: decoder → bridge tab → server

- The bridge is a page of the app, open on a Chromium browser, logged in as a
  workspace member. It opens the port with Web Serial.
- On connect it sends the TinyLap extension command `%TLHELLO&`. The decoder
  answers with its `decoder` id and current `boot`. ZRound software never
  sends that command, so it doesn't disturb existing software. Without that
  answer the bridge can't build keys; it shows "not a TinyLap decoder" and
  stops. The decoder also sends `%TLID <decoder|-> <boot>&` unprompted
  whenever its boot changes (power-up, reset, `%I&`), and the bridge sends
  `%TLHELLO&` again whenever a `%T<hex>&` clock is lower than the one before,
  so a reboot with the port open never mixes two boots.
- Passing lines are parsed by `packages/timing/zround`, shown at once in the
  local preview, appended to an IndexedDB outbox and posted in batches.
- Offline: the outbox grows, the banner says "offline, N passings waiting",
  and the preview keeps working from local data. On reconnect the outbox is
  drained oldest first.

### Internet: decoder → server

- The decoder posts the same batches itself with its bearer token, and keeps
  its own outbox until the server confirms them.

### Ingest endpoint

`POST /decoders/{id}/passings`

```json
{ "boot": "…", "passings": [{ "transponder": "4711", "t": 81234567 }] }
```

- Auth: the decoder's token, or a member session of the decoder's workspace
  (the bridge).
- Repeating a batch is safe. Duplicates by key are ignored.
- Answers `200` with `{ "stored": n, "duplicates": m, "through": t }`, where
  `through` is the highest `t` of this boot the server holds. A sender drops
  the passings it sent, up to `through`, from its outbox.
- At most 500 passings per batch.

### Pairing a decoder

1. A member opens Setup → Decoders on a Chromium laptop and plugs in a new
   board.
2. The bridge asks the server for a new decoder (`POST
   /workspaces/{id}/decoders`). The server answers with an id and a token,
   shown once and never stored in clear.
3. The bridge sends `%TLPAIR id token&` and, if entered, `%TLWIFI ssid
   password&` over serial. The board stores them and answers `%TLOK&`.
4. Unpairing deletes the decoder; its token stops working at once. Its stored
   passings stay.

The server never sees or stores the Wi-Fi credentials.

## 6. Sessions

Every lap belongs to one session. A workspace has at most one running
qualifying or race; when none runs, laps go to the current practice
session.

| | Practice | Qualifying | Race |
| --- | --- | --- | --- |
| Started | automatically | by a member | by a member |
| Roster | anyone with a known transponder | chosen drivers | chosen drivers |
| Length | none | X minutes (default 5) | X minutes (default 5) |
| Start | — | window opens at "start" | countdown (default 10 s), grid behind the line |
| A lap counts if | always | it **started** before the window closed | it is after the driver's first crossing after "go" |
| Ranking | best lap | best lap, then the time it was set | most laps, then total time |
| End | — | the window closes; laps already started finish | time up → each driver's next crossing finishes them |

- **Cars not on the roster** of a running qualifying or race are stored as
  passings but make no laps in that session or in practice.
- **Practice sessions** split automatically after 30 minutes without a
  passing, so a day's driving is one session.
- **States:** `countdown` → `running` → `finishing` → `done`, or `aborted`.
  `finishing` ends when every driver of the roster has crossed after time up,
  or after `maxLap`. Results freeze at `done`.
- **Decoder time vs server time.** "Go" and "time up" are server times; laps
  are decoder times. The server maps between them from recent passings
  (`receivedAt − t`, the smallest offset of the last minute, per boot). Only
  the cutoffs use this mapping; a driver's own lap times never do. An error
  of tens of milliseconds at a cutoff is accepted.
- **Unknown transponders** show on the board as "unknown 4711, assign to…".
  Their laps are stored; assigning the transponder later gives them to the
  driver.
- **Track and direction** are copied from the workspace onto each session
  when it starts. Changing them starts a new practice session.

### Personal bests

Not stored: a query over valid, decoder-timed laps by workspace, track,
direction and driver. The workspace is the venue prefix the track-identity
spec requires (§ "Requirements this places on the timing app").

## 7. Live updates

`GET /workspaces/{id}/live` (member session) and `GET /watch/{token}/live`
(watchers view) stream Server-Sent Events. The watchers page is
`/#watch=<token>`: in the fragment, the token never reaches a server log.

- `passing`, `lap`, `session` (state changes), `results`, `setup` (drivers,
  transponders, track; members only).
- Every event has an increasing `id`. A client reconnecting with
  `Last-Event-ID` gets what it missed, from the last 10 minutes. Older, it
  gets a `snapshot` event with the current state.
- A heartbeat comment every 15 s keeps proxies from closing the stream.

## 8. Browser app

Built on palace-ui and `@tinylap/design`, plain ES modules, import maps, no
bundler, like the planner. Screens:

- **Live board:** session clock, leaderboard, last laps, personal-best
  highlights. One layout that scales from a phone to a wall screen; a full
  screen mode for the big screen.
- **Race control:** start qualifying or a race (drivers, duration), countdown,
  abort.
- **Tap entry:** a tile per driver; a tap is a passing.
- **Setup:** drivers, transponders, decoders and pairing, the current track
  (paste a planner link) and direction, the watchers link.
- **Bridge:** serial connection status, outbox, local preview.
- **Watchers view:** the live board, read-only, without setup.

Shared UI pieces that the planner could use too (a lap-time display, a
leaderboard table) go into `@tinylap/design` when a second app needs them.

## 9. Security

- **Decoder tokens** are 256-bit random values. Only their SHA-256 is
  stored. A token can post passings for its decoder and nothing else.
- **Why not an `accounts` device principal?** The identity spec planned
  devices as principals in `accounts`, paired with RFC 8628. The only device
  here is the decoder, and it needs one narrow right in one app; the track
  laptop and the big screen are logged-in members or use the watchers view.
  Device principals (#10) stay planned for when a device needs a login.
- **Watchers token:** 128-bit random per workspace, rotatable from Setup.
  The view shows driver names, laps and results, never transponder codes,
  decoders or setup.
- **Member writes** use the BFF session cookie with the planner's CSRF check.
- **Rate limits:** ingest per decoder (generous: a race of 8 cars is a few
  passings per second), tap entry per member, pairing per member.
- **Permissions:** any workspace member may run sessions, edit drivers and
  transponders, and pair decoders; deleting drivers or decoders needs
  `admin`. New actions join the `@tinylap/auth` permission matrix
  (`timing.run`, `timing.setup`, `timing.delete`).

## 10. Errors

- RFC 9457 problem details for every error, OpenAPI 3.1 at `/openapi.json`,
  as in the planner.
- Ingest: an unknown or unpaired decoder gets `401`; the sender keeps its
  outbox. A malformed batch gets `422` and nothing of it is stored.
- A passing whose `t` lies before an already stored passing of the same
  transponder and boot is stored, makes no lap, and is flagged on the board.
- Bridge: a lost serial port shows "decoder disconnected"; the Wi-Fi path, if
  paired, carries on.

## 11. Testing

- **`packages/timing`:** `node:test` with recorded passing sequences: double
  reads, parked cars, reboots, duplicates across transports, qualifying window
  edges, the race finish rule, ties.
- **`apps/timing`:** `node:test` against the HTTP server with `:memory:`
  SQLite: ingest repeated and out of order, duplicates from both transports,
  SSE resume and snapshot, permissions, a whole race driven by
  `tools/decoder-sim`.
- **Browser:** Playwright for the live board, race control, tap entry and the
  watchers view. The bridge is tested with a fake serial port injected into
  the page; Playwright can't open real ones.

## 12. Deployment and documentation

- A Fly app `tinylap-timing` with a volume, deployed by CI like the planner,
  gated on a repo variable until the first release.
- A new client in `accounts` (`TINYLAP_CLIENTS`) and a deletions-feed token.
- A README section "Self-hosting timing" with its variables.
- `docs/timing.md`: the passing format, the ingest API and the ZRound
  extension commands, for anyone building a decoder.

## 13. Out of scope (later specs)

- Heats, finals and event structure.
- The challenge ladder (moving up and down by challenges, categories such as
  most laps or fastest lap).
- Decoder firmware and hardware (ESP32-class), against §4–§5.
- Robitronic EasyLap (WebHID) and AMB input.
- More than one decoder per track (sector timing).
- Swapping transponders for a single race.
