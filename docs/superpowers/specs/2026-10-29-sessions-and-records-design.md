# Sessions and track records: design

TinyLap Timing in an office or club room: people walk up for 15 to 20 minutes, alone or four at a time, and want their laps, the best lap of the session, and the track's all-time best, with a moment when that falls. It follows the timing-core spec (`2026-10-15-timing-core-design.md`, §6 Sessions) and changes it where this says so. Paths are relative to `apps/timing/` unless they start with `packages/` or `docs/`.

## 1. Why

Today practice is always on: every passing outside a qualifying or race lands in an automatic practice, which splits after 30 minutes without a passing. On the board its clock counts up for as long as anyone drives, which tells nobody anything. There is no way to start "a session now", no history of sessions, and no track record: personal bests exist (a query, shown as `PB` on the board), the track's best does not.

## 2. Goals, non-goals, anti-goals

Goals:

1. **Every session is started by someone.** Practice, qualifying and race are the three kinds; nothing runs on its own.
2. **One session at a time.** Starting one ends the running one, after a confirmation.
3. **A practice is "just start the timer"**: no settings, open as long as wanted, ended by hand or by an hour without a passing.
4. **The track record**, per track and direction, shown on every board, celebrated when it falls: a notice on every screen, a bell where sound is on, a crown for the holder.
5. **A history of sessions**, each with its final table and every lap, and the history of the track record.

Non-goals:

- Changing how qualifying and races run (rosters, countdown, length, finishing). They only gain the confirmation when they end a running session, and the record marks.
- Records across workspaces (a "world record" for Circuit 30 layouts). A record belongs to one workspace's track.
- Driver colours that members can change: a separate piece of work.

Anti-goals (a failure even if it works):

- A session that starts or keeps running without anyone deciding it, apart from the hour-without-passings end.
- A record that can be set by a hand-tapped lap.
- A notice or a start button on a read-only (watch link) screen.
- The bell as the only sign of a record: a screen without sound must show it just as clearly.

## 3. Sessions

### 3.1 The kinds and their life

| | Practice | Qualifying | Race |
| --- | --- | --- | --- |
| Started | by a member, no settings | by a member, as today | by a member, as today |
| Roster | anyone whose transponder has a driver | chosen drivers | chosen drivers |
| Ends | by a member, or after 60 min without a passing | as today | as today |
| Ranking | best lap | best lap, then when it was set | most laps, then total time |

- **Practice starts clean.** Its laps begin with the first crossing after the start; a crossing before it is no lap of it. The lap rules (`nextLap`, min and max lap) are unchanged.
- **The idle end.** A practice whose last passing is 60 minutes old ends, and its `endedAt` is **that last passing's time**, so the history shows the driving, not the wait. With no passing at all, it ends 60 minutes after its start, at its start. The engine's `tick` does this; it no longer waits for the next passing to notice.
- **One at a time.** Starting any session while one runs ends the running one first: a practice at its last passing (or now, without one), a qualifying or race as an abort does today (`state` `aborted`, now). The member confirms this first (§5.2).
- **Changing the track or the direction** ends a running practice, as today. A running qualifying or race keeps the track it started with, as today.
- `PRACTICE_GAP_MS` (30 min, the automatic split) goes; the idle end replaces it.

### 3.2 A passing with no session running

- The server stores it (`passing`) and notes the transponder (`transponder.first_seen_at`), as today: the first keeps the decoder's outbox and the USB/Wi-Fi de-duplication working, the second is how a code reaches Setup. It makes **no crossing and no lap**.
- Members' screens show a notice (§5.3) with a **Start practice** button. Read-only screens show nothing of it.
- **Loose passings are deleted after a day.** A passing that made no crossing and is older than 24 hours is removed (a periodic job, or on `tick`). The transponder row stays. *My call: 24 hours, long enough for every decoder resend and the cable and Wi-Fi copies to settle.*
- **Tap with no session.** The Tap page records nothing without a running session and offers Start practice instead. *My call: a tap is a passing by hand, so it follows the same rule.*

### 3.3 What changes in the engine

- `practiceFor` (the automatic practice) goes. `cross` runs only with a session; `ingest` and `tap` skip it otherwise.
- `start` takes `practice` too, and ends any running session (§3.1) rather than answering `conflict`.
- A practice's `end` by a member is new (today only qualifying and races can be aborted). It ends with `state` `done`, at its last passing or now.
- `snapshot` keeps answering the running session, or else the last ended one (`lastResults`).

### 3.4 The JSON API

`POST /workspaces/{workspace}/sessions` (`server/control.js`, `ops.startSession`) takes `kind: "practice"` too, with no other fields. While a session runs it still answers `409 conflict`, unless the body carries `"replace": true`: then it ends the running session as §3.1 says and starts the new one. That keeps the confirmation on the caller's side, as the page does it with its confirmation step. Ending a practice gets its own route beside abort, `POST …/sessions/{id}/end`, which ends a running practice as `done`; abort keeps refusing practices. `openapi.json` says all three. *My call.*

## 4. Track records

### 4.1 What counts

- **The record** of a workspace's track and direction is the fastest lap that: counts in its session, was timed by a decoder (`via` is not `tap`), has a driver, and was driven on that track (`session.track_id`) in that direction. Any session kind counts. This is the personal-best query without the driver grouping; personal bests keep their definition.
- **A record falls** when a lap is strictly faster than the record. A tie doesn't take it.
- **The first lap on a track** sets the first record without a celebration: there was nothing to beat. *My call.*
- **Stored as a projection of the laps.** The laps stay the truth; the record history (the running minimum of those laps in time order) and each driver's personal best are kept in their own tables (§6), written with the lap that changes them, so reading them never costs more as a club's history grows. A later change to the laps (assigning a transponder, which recounts) rebuilds them for that track and direction; the change shows, but rings no bell. A deleted driver's record stays, held by "former driver".

### 4.2 Marks

After a lap time, in the Best column of every leaderboard (the board, results, a session's page):

- **TR**: this lap is the current track record.
- **PB**: the driver's best on this track and direction (as the board's `PB` badge today).
- **The session's best lap**: its whole row is highlighted. Only one row can be.
- **👑**: next to the record holder's name, on every leaderboard of that track and direction (board, results, history). It moves when the record falls.

Marks sit in a fixed slot beside the time, so times stay aligned in their column.

### 4.3 When a record falls

- **Every screen showing the board**, the read-only ones included, shows it at once: the track header turns to the record colour and reads "New track record", with the new time, the holder, and the record it beat (time, holder, date).
- **The bell** rings on every screen with sound on. Browsers play sound only after a click on the page, so the board has a "Sound on" switch, remembered in this browser (`localStorage`, a per-viewer convenience). *My call: the bell is made with the Web Audio API, no sound file.*
- The header stays in its record state for 30 seconds or until that driver's next lap, whichever is later, then shows the new record normally. *My call.*
- **Late laps.** A lap is checked against the record as it stood when the lap was driven (its `at`), not as it stands when it arrives. It is celebrated only if it was driven less than a minute before it arrives; an older one (an outbox resend, a Wi-Fi backlog) takes the record silently, and the history places it at its own time. *My call.*

## 5. Screens

### 5.1 The track header (every board)

Above the session, on the board, the big board and the watch link: the track's name and direction, and its record with holder and date ("Track record 7.412 · Haris · 12 Oct"), or "No record yet". This replaces the board's eyebrow line (`views/board.js`, `header`).

### 5.2 Sessions tab (replaces Race)

`…/sessions`, the tab "Sessions" in place of "Race" (`SCREENS` in `views/layout.js`). `…/race` redirects to it.

- **Start**: practice with one button and no settings; qualifying and race with today's form (`views/race.js`). Starting while a session runs leads to a confirmation page (`views/confirm.js`), naming what runs: "A practice is running (12 min, 3 drivers). Starting this race ends it."
- **Running**: the running session with its clock and **End** (practice) or **Abort** (qualifying, race), as today's panel.
- **History**: past sessions, newest first, each a row with date and time, kind, length, drivers, the best lap with its marks, and a link to its page. *My call: 20 per page, with a link to older ones.*
- **Record history** of the current track and direction: who held it, with what lap, from when to when. *My call: a section on this page, the five latest, and `…/records` for the whole list.*

**Times of day** (Started 14:32, Ended 17:42, the history's dates, the record's dates) are rendered as `<time datetime>` with the UTC time as text, and a small `tl-local-time` element rewrites them in the viewer's time zone (`Intl.DateTimeFormat`), as `tl-relative-time` does for "3 min ago". The server knows no zone, and a workspace gets no time-zone setting. *My call.*

A session's page, `…/sessions/<id>`: its final table (as the board showed it when it ended, with marks and crown) and every lap of each driver. A real URL, readable by members. *My call: members only, like the rest of the space; the watch link shows only the board.*

### 5.3 No session running

- **The board** shows the last session's final table with "Ended 17:42" above it, under the track header. Members get a **Start practice** button there. Read-only screens show the same table, without the button. With no session ever, the board shows today's "Get the track ready" steps.
- **The big board** (`…/board?big`) is a display, even when a member opened it: no notice and no Start button, as it already shows no unknown-car notice. It does show the record state and rings the bell. *My call.*
- **A passing with no session** shows members a notice on the board and the Sessions tab: "A car crossed the line (21, Haris). No session is running." with **Start practice**. One notice, updated with the latest car, not one per passing; it goes once a session starts. It comes over the board's live stream, members only.
- **Practice's clock** counts up from its start, as today, but under the label "Started 14:32". *My call: the start time makes the count meaningful.*

## 6. Data

- `session`: no new columns. `kind` gains nothing; a practice's `opens_at` is its start, `ended_at` its end (§3.1).
- `passing`: unchanged; loose ones are deleted (§3.2). A passing is loose when no `crossing` has its decoder, boot, transponder and `t`.
- **One server serves many clubs, each with any number of drivers, in one database**, and the database calls are synchronous: a slow query in one club holds up every club. So nothing a board reads on each update may grow with a club's history or its number of drivers, and every index starts with `workspace_id`.
- `track_record`: one row per lap that set a record, per workspace, track and direction (driver, lap time, `at`, session, crossing). The current record is the latest row; the record history is the table.
- `personal_best`: one row per workspace, track, direction and driver (lap time, `at`, crossing). A tie keeps the earlier lap. The board reads only the drivers it shows.
- Both are written in the transaction that adds the lap. A late lap that changes the history before its latest row rebuilds the history for that track and direction. Anything that recounts laps (assigning a transponder) rebuilds both for the tracks and directions it touched. A rebuild reads only that track and direction's laps, through an index on `session (workspace_id, track_id, direction)`.
- The tables always equal what a rebuild from the laps produces; a test holds them to it. They are filled from the existing laps when they are first created, and removed with the workspace.
- Existing data: a running automatic practice at deploy becomes an ordinary practice and ends by the idle rule. Past sessions are history as they are.

## 7. Left to the builder

- The look of the header, the record state, the notice and the marks, within palace-ui and `@tinylap/design` (AGENTS.md), and the `frontend-design` skill for every screen.
- The bell's sound.
- How the idle end and the loose-passing cleanup are scheduled.
- The live-stream event names and payloads, within `live.js`'s member and watcher split.

## 8. Decisions

1. **No automatic practice.** Every session is started by a member; a practice ends by hand or after an hour without a passing, at its last passing.
2. **Starting a session ends the running one**, after a confirmation page.
3. **Practice starts clean**: laps from the first crossing after the start.
4. **Passings without a session** make no laps, prompt members to start a practice, and are deleted after a day; transponder codes stay.
5. **The track record** belongs to the workspace's track and direction; decoder laps of any session count, tapped laps never; it and personal bests are stored as a projection of the laps, rebuilt from them when laps are recounted, so no board read grows with a club's history.
6. **Marks**: TR and PB after the time, the session's best as a highlighted row, a crown for the holder.
7. **A new record** shows on every screen and rings the bell where sound is on; the notice matters more than the sound.
8. **The Sessions tab** replaces Race: start, end, history, record history. Each session has its own page.
9. **Read-only screens** never show a notice or a button; they show the running session, or the last one.
