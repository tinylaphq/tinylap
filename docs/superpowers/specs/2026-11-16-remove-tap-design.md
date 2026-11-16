# No hand-timed laps: design

Every lap is timed by a decoder. The app has no page, element or route for timing laps by hand, and the board is the one place a session starts. Laps tapped by hand earlier stay in the store, and the readers that set them apart stay with them. Paths are relative to `apps/timing/`.

## 1. How laps arrive

- A lap comes only from a decoder's passing, over the cable (`via: 'serial'`, through the bridge) or over Wi-Fi (`via: 'net'`) (`server/ingest.js`).
- There is no `<space>/tap` page, no Tap tab in the navbar, no `tl-tap` element and no `POST /workspaces/{workspace}/tap`. With them go `ops.tap`, `engine.tap`, the `tap` rate limiter and the `no-session` problem type, which only a tap without a session answered.
- The bridge page links to Wi-Fi pairing only. The MCP server has no left-out entry for tap, because there is no such route.

## 2. Where a session starts

- The board's Start flow (`<space>/board`) starts every session, practice included. No other page carries a Start practice form, and the board's start and confirm steps take no `from` field.

## 3. Stored tap laps

A tap lap is a `crossing` with `via = 'tap'`, its driver set when it was tapped. Each reader that looks at `via` stays, for its own reason:

| Reader | Where | Why it stays |
| --- | --- | --- |
| Records and personal bests | `server/store.js`, the record and PB queries (`c.via != 'tap'`) | A lap timed by hand must never set a track record or a personal best, also when the projection is rebuilt from the laps after a recount. |
| A session's PB marks | `server/views/result.js` (`c.via !== 'tap'`) | The same rule on a session's page: a tap lap is never marked PB. |
| The "Tap" tag | `server/views/session.js`, `server/views/board.js` (Last laps) | An old tap lap stays distinguishable from a decoder lap wherever it shows. |
| Transponder assignment | `server/store.js`, `unassignedSessions` and `assignCrossings` (`via != 'tap'`) | A harmless guard: a tap row already carries its driver, so assigning a transponder never touches it. |

A stored tap lap still counts in its session's standings, so it can hold that session's FL.

## 4. The engine

The live check in `cross` that kept a tap lap out of records and PBs as it arrived is gone. Every new crossing comes from a decoder, so there is nothing for it to catch; the stored readers above cover the old laps.

## 5. Data

No schema change. `via` stays a `TEXT` column, and the rows with `via = 'tap'` stay as they are.
