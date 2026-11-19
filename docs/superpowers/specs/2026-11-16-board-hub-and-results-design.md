# The board as the hub, and session results: design

A club night is run from the board: every kind of session starts there, runs there live, and ends there; between sessions the board shows the latest result. Sessions becomes the history. A session's page becomes its result, kept for good, with a podium. The board's strip becomes one component on every board, with the track record as its headline. A race or qualifying no longer needs a driver list: everyone on the track races unless drivers are chosen. Paths are relative to the repository root.

Mark: **(call)** a choice made here that a builder may revisit if it fights the code.

The approved mockups were built on the real server's pages (`.superpowers/brainstorm/results-v6/`, with `results-v5/` for the shared result system, from the design session, not committed); the rules here bind, the mockups illustrate.

## 1. Why, and what it is not

At a club night people want to race, not navigate. Today a race is started on the Sessions page, which then sends you to the board; the board can start only a practice; a finished race simply disappears from the board; and a session's page is a plain table. The board is where everyone already looks, so it should be where everything about the current night happens, and a finished session should have a page worth looking at, now and a month later.

Goals:
- **The board runs the night:** start, watch, end, read the result, start the next.
- **A result with a winner:** the winner most prominent, then the runners-up, then the rest; straight to all laps or one driver's laps.
- **Each place one job:** the board does, the session page tells, Sessions finds.

Non-goals:
- A tile dashboard of drivers, transponders or schedules (it would repeat Setup and Sessions, and on a TV a grid of tiles reads as a settings page).
- Changing the row moments, the record moment or the marks.
- The Tap page: it is removed from the product separately (#122); nothing here starts a session from it.

## 2. The places

| Place | Job | Controls |
|---|---|---|
| Board (`/<club>/board`) | Run a club night: start every kind of session, watch it live, read its result | Start (nothing running); End or Abort (running) |
| TV (`?big`) and the watchers' link | The board, to look at | None, and no links |
| Sessions (`/<club>/sessions`) | The history: every past session | None |
| A session (`/<club>/sessions/<id>`) | Its result, kept for good | Back to Sessions only |

An old result never offers to start anything.

## 3. The strip: one component on every board

The same strip heads the idle board, the never-driven board, the live board and the TV, replacing today's two (the live white box with right-aligned times, and the idle band over a rule).

- One palace box (`--p-surface`, 2px `--p-text` border, `--p-shadow-lg --p-text`); inside, cells share its borders. Nothing inside it is a box.
- **Where you are**, left on white: the track's name at `--p-text-xl`, its direction icon, the decoders under it.
- **The track record**, a cell filled `--tl-record` with `--tl-record-ink`: the label "Track record" (`--p-text-2xs` 700 caps), the time in mono 700 at `--p-text-3xl`, who and when, and the crown at the cell's end. No TR mark: the fill says it. No record yet: the cell keeps its place unfilled, "None yet", "The first lap sets it."
- **The fastest lap**, while a session runs: a second cell in `--tl-fastest`/`--tl-fastest-ink`; both cells' figures step down to `--p-text-2xl` and the driver takes its own line. It keeps `role="status"` and the `.board-fastest-line` hooks the strip's live region and the row moment use. When a record falls during a session, the record cell takes the label "New track record" and a line "Beat …".
- The strip is a subgrid of the board's columns: the record cell's left edge falls on the right column's left edge (the Start panel when idle, Last laps while running).
- TV: sizes follow `--board-font`; no links. Phone: the cells stack, the record under the track at full width.

## 4. The board

While nothing runs, two columns, `minmax(0, 1.75fr) minmax(16rem, 1fr)`, with `--p-space-2xl` (48px) between them. One level of box: the result's cards, the table, the Start panel and Fastest on this track are the only boxes; nothing wraps them.

### 4.1 Nothing running

- **Which result:** the latest *finished* (done, not aborted) session on the club's *current* track and direction. An aborted session stays in Sessions with its Aborted tag but never takes the board; after a switch to a track with no finished session there, the board is in its never-driven state.
- **Left:** that session's result (§6), under the head "Race result" / "Qualifying result" / "Practice result", "Ended at 20:26" beneath it, and **Full results** (to the session's page) at the far end. Inside the result nothing is a link. It stays until the next session starts (call: no expiry).
- **Right:** the **Start** panel (§5), its top level with the result's first block, its title level with the result's head; **Fastest on this track** below it.
- **What else the idle board says** (today's lines, kept): the warnings (a transponder not assigned yet, a decoder not reporting) stay above the result as today's notices; "Ana is on the track" goes in the Start panel above the button, as the reason to press it.
- **Never driven:** the head "No sessions yet"; in the result's place one box with the record's shadow and one sentence ("Start a session and drive. Every lap shows up here as it is timed, and the first one sets the track record on Kitchen Ring."); the Start panel with Practice checked. A club with no drivers sees today's first steps (**Add drivers**, **Connect the decoder**) in the Start panel's place, since a session with no drivers times nothing.
- Today's idle record card and its "Last session" list go: the strip holds the record, the result is the last session.

### 4.2 A session running

Today's live board with the new strip: its columns (`2fr / 1fr`, and the TV's fit tuned in #118), title, clock, standings, Last laps and the row moments unchanged; the strip's cells fit the live columns (call). Under the title, one line: "4 drivers, 10 min" (race, qualifying), "Every car with a driver" (practice), "Everyone on the track, 10 min" (no roster), and **End** (practice) or **Abort** (race, qualifying) as `.btn-outline .btn-sm` links to today's confirm pages (`GET /sessions/<id>/end|abort`, then POST, then 303 to the board).

### 4.3 TV and watchers

The idle TV is the strip and the result only: no Start, no Fastest on this track, no links, no table header, three reads (§6.4). The live TV as today with the new strip. Neither shows End, Abort or Start. Decoders show on both TVs (call: v5 hid them on the idle TV; one strip everywhere).

## 5. Start: one flow, one button

One form on the board, outside the live region the board's stream replaces (`#board-live`), so a half-filled form survives passings and decoder changes; the server replaces the panel only when a session starts or ends (call: its own region in the stream's update). The board's `<noscript>` refresh applies only while a session runs, so it never reloads the form away. `POST /<club>/sessions`, 303 to the board; a failure comes back as the same board, 422, with the error at its field and the input kept. The Sessions page no longer has a start form; the board is the only place to start a session.

1. **The kind:** a segmented choice of three radios (`name="kind"`) in night order: Practice, Qualifying, Race. One bar with a 2px ink border; cells `--p-control-height`, `--p-text-sm` 700 caps; the checked one filled `--p-text` with `--p-text-on-fill`; the radio stays focusable, focus draws a 2px `--p-accent-2` outline. The server checks the last session's kind (call).
2. **Only the settings that kind needs:**
   - Practice: none.
   - Qualifying: Drivers, Length.
   - Race: Drivers, Length, Countdown.
   - **Drivers:** two radios with their meaning under the name: **Everyone on the track** (default; "Whoever's car crosses the line.") and **Chosen drivers** ("Only their laps count."; a race adds "The race waits for each of them."). Chosen opens the drivers' checkboxes in two columns.
   - **Length** (minutes) and **Countdown** (seconds) are number inputs with their unit after them.
   - Each kind has its own field names (`race-minutes`, `qualifying-drivers`, …) and its own defaults, taken from the last session of that kind; the server reads and validates only the fields of the kind sent.
3. **One Start button**, `.btn-primary`, full width, `--p-control-height-lg`, labelled by the kind ("Start race"). One hint under it: "Runs until you end it, timing every car with a driver." / "Same drivers and length as the last qualifying." / "Same drivers, length and countdown as the last race."; with no earlier session of that kind, what the kind does ("Ranked by each driver's best lap." / "Counts down, then runs for its length.").

Showing and hiding works without script: the parts of each kind carry `data-for="<kind>"`; the server marks the unchosen kinds' parts `data-off`; inside `@supports selector(:has(a))` CSS follows the checked radios instead (the settings, the hint, the button's word, the roster under Chosen drivers). Without `:has()` the server's choice stays on screen and still submits correctly. Script may only repeat the toggling. palace's `[hidden]` is `!important`, so it isn't used for this.

A new session while one runs keeps today's confirm ("Starting this race ends it.").

## 6. Results

One system for the session page, the board and the TV.

### 6.1 The ranked list

A result is one ranked list whose top three are set larger. A **rank gutter** (`--rank`: 64px on a page, 40px on a phone, `2.4 × --board-font` on the TV) runs through it: every position numeral ends one gap left of it, every colour square starts on it, in the cards and in the table. Every block of a result shares one width (the table's scroll wrapper hangs its 4px shadow room outside its width); blocks are `--p-space-md` apart; no label rows above blocks.

### 6.2 The placed card (P1, P2, P3)

- **Position:** mono 700, the name's size, on its baseline, no box. P1's numeral is `--p-accent-1`, the only pink figure.
- **Name:** Space Grotesk 700, sentence case; colour square; crown after it. Long names wrap between words; a single word too long ends in "…".
- **Main figure:** mono 700 one step under the name, at the right.
- **Facts:** under a thin rule starting at the name's edge; label over value in fixed columns (labels in the session facts' style: `--p-text-2xs` 700 caps, `--p-text-muted`). The facts sit at the card's foot, so P2 and P3 keep their rules level.
- Sizes: P1 name/position `--p-text-4xl`, figure `--p-text-3xl`, facts `--p-text-lg`, shadow `--p-shadow-lg --p-accent-1`; P2/P3 `--p-text-2xl` / `--p-text-xl` / `--p-text-md`, shadow `--p-shadow-lg --p-text`, side by side.
- On the session page "Lap times" closes P1–P3's facts row, linking to that driver's laps.

| | Main figure | Facts |
|---|---|---|
| Race P1 | total time | Laps, Best lap (+ mark) |
| Race P2/P3 | gap ("+0.613", "+1 lap") | Time (only on the lead lap), Best lap |
| Qualifying P1 | best lap (+ mark) | Laps, Set on lap |
| Qualifying P2/P3 | gap to P1 | Best lap, Laps |
| Practice P1 | best lap (+ mark) | Laps, Set on lap, and when the record fell: New track record "Beat 7.104 ■ Ana" |

### 6.3 The rest

The standings table continues the list from 4 (practice from 2). Race: Pos, Driver, Laps, Gap, Best lap + mark, Time (only for cars on the lead lap; the cell is empty otherwise). Qualifying and practice: Pos, Driver, Gap, Best lap + mark, Laps. On the session page the driver's name links to their lap card (`#driver-<id>`), which takes a `--p-accent-2` shadow when targeted. Phone: Time and Laps go.

### 6.4 The TV

Three reads, every size a multiple of `--board-font`: who won (P1 at 2.3em; its figure 1.15em in `--p-text-secondary`; one fact, Best lap), who followed (P2/P3 at 1.15em, name and gap only), everyone else (the table at 0.8em, no header, no Laps or Time). It fits 1920×1080 with six drivers; with more, the table stops after P6 with "N more on the results page" (call).

### 6.5 Practice

One list, like a race: P1 (the fastest lap) as the card, then the table from 2. On the session page the personal bests set in the session follow the table, as cards three to a row: name, new time with PB, then Before (the old best) and Faster by. A driver here for the first time set no personal best and gets no card. The board leaves the personal-best cards out (the table's PB marks say who).

### 6.6 A record that fell

The crown says who holds the record (maybe for months); TR says this lap is the record. When the record fell in the session, the practice P1 card says it from inside (its New track record fact) and takes the record's shadow (`--p-shadow-lg --tl-record`). A race or qualifying adds nothing: a line above P1 broke the layout; TR, the crown and the strip tell it.

### 6.7 The session page

- Head: the breadcrumb "Sessions", the h1 (the kind), the facts as metadata (Started, Ended, Length, Track, Fastest lap); nothing else on that line.
- "Result" section head with **All laps** at its far end; the result; then the Laps cards; then **Back to Sessions** (`.btn-outline`) at the foot. No other actions.

## 7. Sessions: the history

- One table, newest first, grouped by club night: a night is a run of sessions with no gap longer than 6 hours between one's end and the next's start (call; the server knows no time zone, so it doesn't group by calendar day); its header row gives the first session's date (`tl-local-time`, the viewer's zone) and the track; a new group also when the track or direction changes.
- Columns: Started (the time, the row's link; the whole row opens the session), Session (the kind, with the Aborted tag), Length, Drivers, Fastest, Best and its mark. Older sessions page on as today.
- While a session runs, one line under the title: the on-track lamp, "A race is running." and **Go to the board**.
- The start form, the running panel and the Track record section are gone (Fastest on this track and the records page cover the records).

## 8. Everyone on the track

A race or qualifying started with **Everyone on the track** has no roster. This is one rule everywhere: the roster becomes optional for qualifying and race in `ops.startErrors` (`apps/timing/server/operations.js`), so the form, the JSON API (`openapi.json` documents it) and the MCP tools agree. As today, only cars with a driver count ("Whoever's car crosses the line" means a car assigned to a driver). The engine (`packages/timing/sessions.js`) treats no roster as everyone whose car crossed the line in the session: their laps count (as practice), they are classified, and a race is over when each of them has finished (crossed after the close); qualifying when each of them has crossed after the close. Today `isOver` reads `rules.roster ?? []`, so without a roster a race would end at once: that changes. A driver who stops for good must not hold a race open forever: the race ends a fixed time after the close at the latest (call: the slowest car's best lap × 2, or 60 s, whichever is longer; the builder checks what the code has today). Chosen drivers behave as today's roster.

## 9. Related issues

- #120 (Sessions stays on "finishing the last lap") goes away: Sessions has no running panel.
- #121 (the idle board's Last session leaves out the winner) goes away: the list is replaced by the result.
- #122 removes the Tap page.

## 10. Tests

- Start: a half-filled form survives the stream's updates; the noscript refresh only while running; each kind's settings appear and submit without script (no `:has()` too); the server reads only the sent kind's fields; defaults come from the last session of that kind; a 422 keeps the input; Start while a session runs asks first.
- Everyone on the track: the API and MCP accept a race or qualifying without a roster; a race with no roster classifies whoever crossed and ends when each has finished, or at the fixed limit; a car that never crosses isn't in it.
- Board states: nothing running (result, Start, Fastest; the latest finished session on the current track, never an aborted one), the warnings and "on the track" line, no drivers (first steps), never driven, running (End/Abort line), TV and watchers (no controls or links); the strip in each, and its record cell edge on the right column's edge.
- Results: the rank gutter (numerals end on one line, squares start on one line, cards and table); one width for every block; facts per kind (§6.2 table); no Time for a lapped car; P1 in pink, its shadow; practice from 2 in the table; the new-record fact and shadow; lap-card anchors; the TV's three reads fit 1920×1080.
- Sessions: grouped by night (a 6-hour gap) and track; the row opens the session; the running line.
- Session page: no actions but Back to Sessions; All laps in the section head.

## 11. Words

Track record; None yet; The first lap sets it.; New track record; Beat 7.104; Fastest lap; Race result, Qualifying result, Practice result; Ended at 20:26; Full results; Start; Practice, Qualifying, Race; Drivers; Everyone on the track, Whoever's car crosses the line.; Chosen drivers, Only their laps count., The race waits for each of them.; Length, min; Countdown, s; Start practice, Start qualifying, Start race; the hints in §5; Fastest on this track; No sessions yet; End, Abort; 4 drivers, 10 min; Every car with a driver; Everyone on the track, 10 min; Laps, Best lap, Time, Gap, Set on lap, Before, Faster by; Lap times; All laps; Back to Sessions; Sessions; A race is running.; Go to the board; N more on the results page.
