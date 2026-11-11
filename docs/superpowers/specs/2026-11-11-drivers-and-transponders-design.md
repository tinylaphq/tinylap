# Drivers and transponders: design

Assigning a transponder to a driver takes one form wherever you come from: the board's warning, Setup, or a page that collects all new transponders at once. A driver can have several transponders, and an optional short label tells them apart. Drivers get an avatar: their initials on their colour. There are no pictures: a big club's members or a public race day's drivers would not upload any. The top of the live board and Setup's current track stop using a left bar, which in palace means a selected list item. Paths are relative to the repository root.

Mark: **(call)** a choice made here that a builder may revisit if it fights the code.

## 1. Why, and what it is not

The usual way a transponder gets into TinyLap: its car crosses the line, the transponder registers by itself, and someone says whose it is. Today that means finding it in Setup's table (code, a driver select, Assign) with no link from the warning that says a car has no driver.

Goals:
- **One form, three ways in.** From the board's warning straight to that transponder; on a driver in Setup ("Add another transponder"); and a page that assigns every new transponder in one go, with each row lighting up while its transponder crosses the line.
- **One transponder per driver is the normal case** and looks like it; more are possible.
- **An overview of all transponders**, new ones first, where a transponder can be assigned, moved or forgotten.
- **Buttons say what they do** (Assign, Move, Remove, Forget); questions are only headings.

Non-goals:
- Cars. A club has one shared account; at big clubs and public races creating a car per driver costs too much at the desk, and car bests or retiring cars are personal. They belong to personal driver accounts later. Every lap already stores its transponder, so a car history can be built from it then.
- Driver accounts, or drivers editing themselves.
- Entering transponders by number as the main way (it stays possible, behind a disclosure).

## 2. Data

No migration: there are no production users; the schema changes in place (call: reset the production database at deploy, after asking the owner).
- `transponder` gains `label TEXT` (optional, at most 24 characters). `driver_id` stays: a driver has any number of transponders.
- `driver` keeps `colour`; nothing else changes on it.
- Forgetting a transponder deletes its row; its passings stay (they keep the code).

## 3. Pages

The approved mockup is `drivers-transponders.html` from the brainstorming session (not committed); the rules here bind, the mockup illustrates.

### 3.1 Setup: drivers

- Each driver is a row: avatar, name, their transponder inline ("Simon 17"), Edit. With two or more transponders, each shows its label ("17 Buggy", "52 Touring car").
- **Add another transponder** is a quiet link on the driver. It opens a short list of the known transponders: unassigned first, newest first, each with when it crossed ("Crossing now", "crossed 2 min ago"); then, under "Someone else's", the assigned ones with their driver ("17 Simon's, Buggy"); last, a row "Not in the list? Enter its number". With no known transponder: "Run its car over the line, and it shows up here."
- **Each row opens onto its own action**, so what you chose and what the button does sit together. A row is a `<details name>` (one open at a time, no script) holding its own small form: the label field (only when the driver already has a transponder, hint "Tells it apart from his 17.") and **Add 41 to Simon**. Someone else's row says "Transponder 8 is Haris's. Giving it to Simon takes it off Haris." and its button is **Give it to Simon** (the move question of §3.4, inline). The number row holds the number field, the label field and **Add to Simon**. A free transponder is added; a driver who already has one simply gets another.
- Each transponder on a driver has a quiet **Remove**: it goes back to "Not assigned yet" (reversible).
- A label can be added or changed on the driver's page (§3.5) for any of their transponders; Setup shows labels only for drivers with two or more. A moved transponder loses its label, since it now goes in someone else's car (call).
- **Edit** opens the driver's page (§3.5).

### 3.2 Setup: transponders

- **Not assigned yet** first, newest first, with **Assign all N** leading to the collect page (§3.6). Each row: the number, when it first crossed, **Assign**, and a quiet text link **Forget**.
- **Assigned** below: number, driver, label, **Move**, **Forget**.
- **Forget** opens a confirm page ("Forget transponder 41? Its laps stay; if it crosses again it shows up as new."), POST, 303 back. Like every other delete, it needs `timing.delete` (owner and admin); members without it don't see the link.

### 3.3 The form: "Whose transponder is 41?"

`<space>/transponders/<code>`, a page of its own (and a dialog when script runs, call).
- Heading "Whose transponder is 41?"; if it is crossing now, a live line "It's on the track now."
- **Each driver is a submit button** (`<button name="driver" value="…">`, avatar, name, what they have: "has 23, 31", and a quiet "Assign" at the end): one click assigns, with or without script, so there is no radio and no separate Assign button. Hover and focus show palace's selected-item bar (an inset left bar) and darken "Assign". The last row is **A new driver**: a name field with its own button, **Assign to a new driver**. No label field: a driver who already has a transponder simply gets another, and the label goes on later on their page (§3.5). "Not now" goes back.
- One POST, then 303 back to where the form was opened from (`returnTo`, same-origin paths only); a failure returns the page with the error, the input kept, status 422.

### 3.4 Moving a transponder

Assigning a transponder that belongs to another driver asks first. On the form (§3.3) and on collect: "Transponder 17 is Simon's." with **Give it to Mia** (primary) and **Keep it with Simon**. In Setup's add list (§3.1) the question is the row itself. On the form the move question follows a click on a driver. Giving it moves it; Simon then has one fewer.

### 3.5 The driver's page

`<space>/drivers/<id>`, for members only: avatar, name, colour, their transponders each with a label field and Remove, and **Best laps here**: for a driver with two or more labelled transponders, one line per transponder with its best lap, label and date, the best first ("7.701 Red Losi 9 Oct"); otherwise one line, without a label. This is the only place that says which transponder a lap was set with. Under the name the page keeps its normal spacing (the card's stack), with no inline margin overriding it. Every member has Setup rights (`timing.setup` for owner, admin and member), so there is no read-only variant; watchers never see it (§4).

### 3.6 Collect: all new transponders in one go

`<space>/transponders/new`: one small form per unassigned transponder: one **Driver** field and **Assign**. Type a name: a driver of that name (trimmed, case ignored) gets the transponder; a new name adds the driver. The browser suggests the existing drivers from a `datalist`. No label here. A row shows "Crossing now" while its transponder crosses the line, so you can tell which car is which: the server renders the line hidden per row; the page shows it when the live stream reports a crossing or an idle passing of that code (call: the existing live events, `crossing` and `idle`). The whole list is one `tl-frame`. Assigning a row posts, the 303 comes back to the collect page with `?assigned=<code>`, and the page then shows the list without that row and, above it, one line "Transponder 41 is Lena's now. Change", or "Transponder 41 is Lena's now, a new driver. Change" when the name added one, so a typo shows at once (Change opens §3.3 for it) (call).

## 4. The board

- **Idle (no session), one unassigned transponder on the track:** the record card's right side shows the live "Transponder 41 is on the track", and quietly under it "Transponder 41 isn't assigned yet. **Assign it**" (to §3.3 with `returnTo` the board).
- **Idle, several:** "Transponder 52 is on the track" (the latest crossing), and "3 transponders aren't assigned yet. **Assign them**" (to §3.6). No yellow box when idle: nothing is lost without a session.
- **During a session:** the yellow box "Transponder 41 isn't assigned yet, so its laps aren't counted. **Assign it**" (or "Transponders 41 and 52 … **Assign them**").
- **Rows:** the driver's colour marker and name, as today; the big board shows name and colour.
- **No transponder on the board.** Which transponder a lap was set with is shown only on the driver's page (§3.5). Watchers see no transponder numbers and nothing of unassigned transponders, as today (`watcherCrossing`).
- **The crown belongs to the person, the mark column to the lap.** In standings (the leaderboard, the big board, a session's final table) the record holder's name is followed by the crown, from the moment they set the record; a long name is cut with "…" before it, so the crown always shows. It sits as far after the name as a mark sits after its time (`--mark-gap`, which scales on the big board), and lines up with the marks. It is a flat SVG crown, not the emoji: `--p-warning` fill, outlined like a mark's border, exactly as tall as a mark. In a flex row it needs a nudge onto the marks' line, since `vertical-align` does nothing there. Lap lists show no crown (one row per lap would repeat it), and the record card none (it says whose record it is).
- **The mark column holds one mark at most: TR, SB or PB, the widest that is true** (track, then session, then personal). A record lap shows TR; the session's fastest lap shows SB, also when it is a PB. The column stays one mark wide. Marks sit `--p-space-sm` after their time (on the big board, a share of the board's font).
- **SB marks the session's fastest lap** (cyan, `--p-accent-3`, ink `--p-text`), in lap lists and in race standings; it replaces today's row tint (`--tl-session-best`, `tr.is-best`) and its key under the table, and the visually hidden "Session best" note becomes the mark's title. In a table sorted by best lap (practice and qualifying standings) it would always be row 1, so it is left out there. In lap lists (the session page's laps, in the order they were driven) and race standings (finishing order) it picks out one row among many. Marks in lap lists stand after the time, in a mark column like the standings'; the tags before the time ("Tap", "Not counted") stay where they are.
- **When the record falls, the crown jumps** from the old holder's row to the new one's: once, on boards open at that moment, when the swap brings a new holder; with reduced motion it just moves. Who lost it is on the record card ("beat Haris's 7.412"); the old holder keeps no pale crown.
- **The record card celebrates it, and the time is the finale.** Behind the new time a big crown pops up: the flat crown in solid `--p-warning`, no outline (black lines would run into the digits), a little wider than the digits, its base on their baseline, its peaks inside the card; it grows slowly while it is there, so it never stands still. A short burst of solid bars in palace's accent colours shoots out with it and is gone within the first second. Then the time, in front, bounces (up to 1.2×, settling in two smaller bounces) while the crown fades out behind it. About 2.4 s in all, clipped to the card, `aria-hidden`, nothing stays; the card's words ("New track record … beat Haris's 7.412") carry the news for everyone else. Reduced motion skips it. It plays only on a swap that brings a new record, never on a page load.
- **The leader's bar goes.** The 4 px accent bar on first place's position says what "1" already says, and a left bar means "selected" in palace.
- **Pos is as wide as its digits and sits by its name.** One digit wide; a table of ten drivers or more is two (`has-two-digit-pos`), and one that shows finish flags (races) keeps room for one (`has-flags`); the server sets both, like `has-minute-laps`. Right-aligned, with one cell padding to the name instead of two, so the table's left and right edges have the same padding. Its header is for screen readers only ("Position"), like the mark column's: "POS" is wider than a digit.
- **Which unassigned transponders count:** during a session, those that crossed in this session; when idle, those that crossed in the last hour (call). Older ones are only in Setup's overview, where Forget clears them. Today's `snap.unknown` (every unassigned transponder ever seen) changes accordingly, with the `setup` live event.
- **Box language:** the track strip loses its left bar. Idle, it becomes the top band of the record card (one box, one shadow); during a session it stands alone, raised with the same shadow. Setup's current track (`.track-now`) loses its left bar the same way.

## 5. Scope

Page routes only. The JSON API (`PUT /transponders/{code}`), `openapi.json` and the MCP tools keep their current behaviour; the shared operation `ops.assignTransponder` keeps its signature, and new operations (label, remove, forget, move, assign to a new driver) are added beside it for the pages (call: API and MCP follow later).

## 6. Words

Assign, Move, Remove, Forget, Assign it, Assign them, Add 41 to Simon, Assign to a new driver, Not now, SB (Session best), Give it to Mia, Keep it with Simon, Best laps here, Add another transponder, Not in the list? Enter its number, Not assigned yet, Someone else's, Crossing now, crossed 2 min ago, Run its car over the line, and it shows up here. No "code" on screen: "transponder 41", "number".

## 7. Tests

- Store/operations: assign, add a second, label only stored when given, move between drivers, remove (back to unassigned), forget (row gone, passings kept).
- Pages: each Setup state (one transponder inline; two with labels; none known), the add list's order and groups, each row's own form and button ("Add 41 to Simon", "Give it to Simon"), the form's driver buttons and new driver, collect's one field (existing name, new name, case and spaces), the move question, the form's 303/422 and `returnTo` checks, the confirm pages, collect, the driver page's best laps (labelled and not).
- Board: the idle single and several lines with their links, the session warning, the box language (no left bar), the crown after the holder's name in standings only, one mark per row (TR, else SB, else PB), SB in lap lists and race standings but not in tables sorted by best lap, the crown moving to a new holder at once, no crown on the record card, no leader bar, Pos width with and without flags.
- Browser: from the board's warning to the form and back; collect with a simulated crossing lighting up its row and assigning it; at 390 px.

## 8. Open guesses

- The existing live events are enough to light "Crossing now" on collect without a new stream.
