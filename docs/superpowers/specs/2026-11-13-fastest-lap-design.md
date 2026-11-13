# Fastest lap: design

The session's fastest lap gets a plain name and a moment of its own. "Session best" and its mark SB become **Fastest lap** and **FL**. The live board names the fastest lap under the track record. A lap that sets a mark lights its driver's row with one animation, coloured by the mark: TR, FL or PB. The board's boxes take one shadow size, and palace-ui names its shadow sizes like its spacing. Paths are relative to the repository root.

Mark: **(call)** a choice made here that a builder may revisit if it fights the code.

## 1. Why, and what it is not

A session's fastest lap is simply the fastest lap in that session. In practice and qualifying it belongs to P1, because those tables are sorted by best lap. In a race the order is by laps, so the last driver can hold it. It falls far more often than a track record, and it is what drivers chase lap after lap, so it deserves to be seen as well as the record.

Goals:
- **One word for it everywhere:** "Fastest lap", never "Session best".
- **Always visible while a session runs:** who holds it and with what time.
- **A moment when it falls**, in the same language as a track record and a personal best, so all three read as one family, each in its own mark's colour.
- **One shadow size on the board**, and shadow sizes that palace-ui names.

Non-goals:
- History of who held the fastest lap during a session (a chart's job, not a mark's).
- Changing the record moment in the strip (the burst, the bounce and the crown jump stay as they are).
- New sounds for FL or PB.

## 2. Words and marks

- The mark is **FL**, in SB's cyan box. Its class is `mark-fl`, its colour is a new token `--tl-fastest` (`var(--p-accent-3)`) with ink `--tl-fastest-ink` (`var(--p-text)`), in `packages/design/design.css` beside `--tl-record` and `--tl-pb`. Its title is "Fastest lap of the session"; its visually hidden text is "Fastest lap".
- One mark per lap time stays, the widest that is true: **TR**, then **FL**, then **PB**.
- **A mark always follows its time**, the way a unit follows a number: in the standings, the lap lists, Last laps and the strip. The mark carries its name for the eye as a `title` and for a screen reader as visually hidden text.
- "Session best", `mark-sb`, `isSessionBest`, `--tl-session-best` and SB leave the code, the docs (`docs/timing.md`) and the tests. The API and MCP never exposed it and do not change.
- A tie keeps the lap set first. FL is the fastest of the laps the standings count (a tapped lap included, a lap marked "Not counted" not), so it is always somebody's Best (call).

Every mark's box is trimmed to its capitals (`text-box: trim-both cap alphabetic`), so its padding is the same above and below its letters (call: where `text-box` is unsupported the box keeps today's padding, and the letters sit a little high).

## 3. The live board

### 3.1 The strip

The strip (`.board-track`) holds the track and its decoders on the left and the two times to beat on the right, one under the other, each as time, mark, driver, with no words:

```
Kitchen Ring ⊂⊃                       6.950 TR   ■ Ana
■ Start line: reporting               7.106 FL   ■ Ben Okafor
```

- Each line is read through its mark: TR for the track record (also told by the strip's purple shadow and the crown on its holder in the standings), FL for the fastest lap. The words "Track record" and "Fastest lap" are visually hidden, for screen readers.
- The mark sits `--p-space-xs` after the time; the driver follows `--p-space-md` after the mark (§7). Times, marks and names share columns. The name column has a fixed width (between 9em and 12em) and cuts a long name with an ellipsis, so a new holder never moves either line.
- The record's date leaves the board (it stays on the session pages).
- Before any lap counts, the second line is a muted dash in the time's place, then FL, and no driver; the line's `title` and its hidden text say "No laps yet". The line is there while a session runs; the idle board does not have it.
- While the strip shows a fallen record (`.board-track.is-record`), the Fastest lap line is hidden: the record lap is the fastest lap, and the card already names it. It comes back when the strip does (call).
- On a phone (at most 720px) the strip stacks: name, decoders, then the two lines, left-aligned.
- On the big screen the two lines close up (smaller gap), so the board does not grow taller.

### 3.2 Standings

- FL shows on every session kind, P1 included: in practice and qualifying it no longer hides because the table is sorted by best lap.
- The header cells' bottom line is the header's own colour, not the body's light row line (it showed as a white line over a lit row).
- The standings table is `border-collapse: separate; border-spacing: 0`, so its 2px border and 4px shadow measure what they say; the row lines stay on the cells.

### 3.3 Last laps

- The feed marks **TR and FL only** (PB on every early lap would be noise), after the time, in a mark column every row keeps (about 28px: a mark's width plus `--p-space-xs`), so the times stay aligned. Tags such as "Not counted" stay before the time.
- FL marks only the current fastest lap; when it is beaten, the old lap loses its mark.
- The feed plays no moment: the standings row carries it.

## 4. The moment

When a lap sets a mark, its driver's row in the standings lights up. One animation for all three marks, in the mark's colour:

1. A **rainbow head**, 40% of the row wide, sweeps in from off the left edge to off the right edge. It is made of palace's colours and starts and ends in the mark's colour, peaking in pink at its middle:
   - FL: cyan, purple 25%, pink 50%, purple 75%, cyan.
   - PB: green, cyan 20%, purple 38%, pink 50%, purple 62%, cyan 80%, green.
   - TR: purple, pink 25%, cyan 50%, pink 75%, purple.
2. Behind it the row fills with the mark's colour: the fill follows the head's back edge, so there is no seam.
3. The fill **holds**, then **slides out to the right** with a plain edge; the rainbow does not come back on the way out.

| Mark | Fill | Length | Head crosses | Slides out from |
|---|---|---|---|---|
| FL | `--tl-fastest` | 1600 ms | 0–520 ms | 1150 ms |
| PB | `--tl-pb` | 1600 ms | 0–520 ms | 1150 ms |
| TR | `--tl-record` | 2400 ms | 0–700 ms | 1900 ms |

The head and the fill share one easing (`cubic-bezier(.45,.05,.55,.95)`) for the crossing; the slide out eases in (`cubic-bezier(.6,0,.8,.4)`).

While a row is lit:
- Its mark turns ink with the mark's colour as text, so it does not vanish into the fill.
- Driver squares in it get a 2px ink outline (a blue square vanishes on cyan, a green one on green).
- A TR row's text turns white while the purple is under it (black on purple is about 3.6:1), and back when the fill leaves.

How it is drawn:
- The moment is one element (`.row-fx`, `aria-hidden`) inside the row's first cell, positioned against the row (`position: relative; isolation: isolate` on the lit row) and behind the row's text (`z-index: -1`), clipped to the row. Only transforms and `clip-path` move. Nothing stays: the element goes when the moment ends.
- `tl-board` plays it on a swap that brings a row whose `data-moment` (§4.1) it has not seen. The first render never plays it, a page load never does, and a new moment on the same row ends the old one.
- A moment survives the swaps that come during it, as the record moment does (`carryMoment` in `apps/timing/public/elements/board.js`): rows carry their driver (`data-driver`), and a playing moment moves to the same driver's row in the new render at its elapsed time, with its mark colour flip and a TR row's white text. A driver who leaves the table ends it.

When it plays:
- **FL:** every time the session's fastest lap improves, except the session's first counted lap (nothing was beaten).
- **PB:** when the lap improves the driver's best on this track and direction and the driver already had a best there from an earlier session (any session kind, aborted ones included, as personal bests count today). Every improvement after that plays too. A driver's first laps on a track show PB with no moment, so the start of a session does not light every row. The best as it stood when the session started is kept with the session (call: recorded at session start).
- **TR:** exactly when the strip's record moment plays (a record existed and the lap is fresh, as `noteLap` in `apps/timing/server/engine.js` decides), so the row, the strip and the bell always agree.
- **Late laps play nothing:** a lap older than the record's freshness window (`RECORD_FRESH_MS`) when it arrives, such as a quiet Wi-Fi decoder catching up, plays no moment of any kind.
- One lap plays one moment: the widest of its marks that plays. A lap that is FL but the session's first counted lap, and also beats an earlier session's best, plays PB; a track's very first lap plays nothing (call).

Overlaps:
- Rows that light at once each play their own.
- A newer fastest lap cuts the older one short: the old row slides out at once (300 ms) as its FL leaves.
- With more than three rows lit, further PB moments are dropped; TR and FL always play.
- A row that changes place lights at its new place; rows do not animate their moves (call: no FLIP, since no swap animates rows today and moving every row on every swap is a change of its own).

Reduced motion: no head, no sweep. The row takes the mark's colour at once, holds for the moment's length, and fades over 200 ms. The strip's record moment keeps its own reduced-motion rules.

Screen readers: the strip's line is a polite live region; a new fastest lap reads "Fastest lap 7.041, Ben Okafor". A TR lap reads the record as today, not the fastest lap too.

Sound: none for FL or PB; TR rings as today (call).

### 4.1 What the server says

The server decides which moment a lap earns, as it already decides the record (`recordNew`). The board's snapshot gives each standings row the moment of its driver's latest counted lap, when that lap set a mark that plays: `data-moment="<seq> fl|pb|tr"`, `seq` being the lap's crossing. The PB rule (an earlier session's best on this track and direction) and the first-counted-lap rule are the server's. The client only plays what it is given, once per `seq`.

## 5. The session page

- The facts (`dl.session-facts`) end with **Fastest lap** "7.106 ■ Ben Okafor", the time and the name on one baseline.
- FL marks the session's fastest lap in the final table (P1 included) and in that driver's lap list. Laps that were the fastest at the time keep no mark.
- No moment: the page is not live.

## 6. Shadows

palace-ui names its shadow offsets like its spacing, in t-shirt sizes, and TinyLap uses only those:
- palace already has `--p-shadow-sm` (2px), `--p-shadow-md` (3px), `--p-shadow-lg` (4px). It gains `--p-shadow-xs` (1px), which its own `kbd` uses instead of a raw `1px 1px 0`. palace's SPEC says which size is for what: `xs` keys, `sm` small chips, `md` controls (hover and focus), `lg` boxes and cards. palace's own CSS uses no raw offsets (a test checks it). This is palace-ui work and a release before TinyLap's part.
- TinyLap's board uses `--p-shadow-lg` for every box: the strip (`apps/timing/public/app.css:66`), the idle board's hero (`:480`) and the first-run card (`:524`) come down from a raw 8px; the Last laps card (`.board-feed`) gets `var(--p-shadow-lg) var(--p-text)`, like the standings table. Colours keep their meaning: purple for the record's strip and hero, pink for the clock, ink for the lists.
- No raw shadow offsets anywhere in TinyLap's CSS (apps and `packages/design`): a check in CI fails on a `box-shadow` whose offset is not a `--p-shadow-*` token (inset indicator lines, such as the nav tab's underline, are not shadows and are allowed).

## 7. A time and who set it

Wherever a lap time is followed by the driver who set it (the strip's two lines, the idle board's record card and its ranked lists, the session page's Fastest lap fact), the two read as a value and its credit, not as one run of text:
- The time stays JetBrains Mono 700 in `--p-text`.
- The driver starts `--p-space-md` after the time.
- The name is Space Grotesk 400 (palace ships 400, 600 and 700) in `--p-text-secondary`; the square keeps its colour and stays with the name, `--p-space-xs` before it, and the two never wrap apart (`white-space: nowrap`).
- No word between them ("by"): the gap and the weight say it.

Lists that lead with the driver and end with the time (Last laps, the standings) are not this pattern and do not change.

## 8. Everywhere it shows

The same rules hold wherever live standings show: the board at a laptop's width, the big screen (`?big`), a phone, and the watchers' board. The marks and the session page facts follow everywhere the session page renders. The moment plays the same on all live boards; the watchers' board plays it too (it already plays the record moment).

## 9. Tests

- Marks: FL replaces SB in every view; the widest mark wins; FL on P1 in practice and qualifying; a tie keeps the earlier lap; a not-counted lap never holds FL, a tapped one can.
- Marks follow their times everywhere, the feed included, and the feed's times stay aligned with or without a mark.
- Strip: each line is time, mark, driver, with no visible words; the fastest lap's dash and "No laps yet" title before a counted lap; absent on the idle board; hidden while the strip shows a fallen record; names cut, lines not moving when the holder changes (layout measured before and after a swap).
- Feed: TR and FL only; only the current fastest lap keeps FL.
- Server: `data-moment` for FL on an improvement but not on the first counted lap; PB only once an earlier session's best exists, then on every improvement; TR exactly when `recordNew` is set; late laps none; one moment per lap, the widest that plays.
- Browser: a moment carries over a swap that comes during it, to the same driver's row, at its elapsed time.
- Browser: a swap with a new `data-moment` adds `.row-fx` to that row, behind its text, and nothing is left afterwards; the first render and a page load add none; reduced motion adds no transforms; a lit row's mark is inverted; a TR row's text turns white and back.
- Shadows: palace's test that its CSS uses only `--p-shadow-*` offsets; TinyLap's CI check for the same; the board's four boxes measure a 4px shadow.
- Session page: the Fastest lap fact; FL on the final fastest lap only.
- A time and who set it: the gap, weight and colour in every place §7 names.

## 10. Words

FL (title "Fastest lap of the session"), TR ("Track record"), PB ("Personal best"); on the strip, for screen readers only, "Track record", "Fastest lap" and "Fastest lap: no laps yet"; the session page's fact "Fastest lap". Screen reader: "Fastest lap 7.041, Ben Okafor".
