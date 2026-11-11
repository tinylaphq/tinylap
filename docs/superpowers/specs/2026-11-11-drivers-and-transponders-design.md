# Drivers and transponders: design

Assigning a transponder to a driver takes one form wherever you come from: the board's warning, Setup, or a page that collects all new transponders at once. A driver can have several transponders, and an optional short label tells them apart. Drivers get an avatar (initials on their colour, or a picture). The top of the live board and Setup's current track stop using a left bar, which in palace means a selected list item. Paths are relative to the repository root.

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
- `driver` keeps `colour`. A new table `driver_picture (workspace_id, driver_id, type, bytes, updated_at)` holds an optional picture: JPEG, PNG or WebP, at most 2 MB, stored as uploaded (call: no resizing on the server; the page shows it at a fixed size with `object-fit: cover`). Served at `<space>/drivers/<id>/picture` with an ETag; members of the club only.
- Forgetting a transponder deletes its row; its passings stay (they keep the code).

## 3. Pages

The approved mockup is `drivers-transponders.html` from the brainstorming session (not committed); the rules here bind, the mockup illustrates.

### 3.1 Setup: drivers

- Each driver is a row: avatar, name, their transponder inline ("Simon 17"), Edit. With two or more transponders, each shows its label ("17 Buggy", "52 Touring car").
- **Add another transponder** is a quiet link on the driver. It opens a short radio list of the known transponders: unassigned first, newest first, each with when it crossed ("Crossing now", "crossed 2 min ago"); then, under "Someone else's", the assigned ones with their driver ("17 Simon's, Buggy"). Under the list: "Not in the list? Enter its number" (a disclosure with a number field). The label field appears only when the driver already has a transponder. With no known transponder: "Run its car over the line, and it shows up here."
- Choosing someone else's transponder leads to the move question (§3.4). Choosing a free one adds it; a driver who already has one simply gets another.
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
- A list of drivers (avatar and name), and **A new driver** with a name field. An optional label field when the chosen driver already has a transponder (shown by script; without script always shown, call).
- **Assign**. One POST, then 303 back to where the form was opened from (`returnTo`, same-origin paths only); a failure returns the page with the error, the input kept, status 422.

### 3.4 Moving a transponder

Assigning or adding a transponder that belongs to another driver asks first: "Transponder 17 is Simon's." with **Give it to Mia** (primary) and **Keep it with Simon**. Giving it moves it; Simon then has one fewer.

### 3.5 The driver's page

`<space>/drivers/<id>`, for members only: avatar or picture (upload or remove), name, colour, their transponders each with a label field and Remove, their best laps. The name and the line under it (best lap, transponders) are separated by the page's normal spacing, not run together. Every member has Setup rights (`timing.setup` for owner, admin and member), so there is no read-only variant; watchers never see it (§4).

### 3.6 Collect: all new transponders in one go

`<space>/transponders/new`: one small form per unassigned transponder (a driver select, or a new driver's name, and Assign). A row shows "Crossing now" while its transponder crosses the line, so you can tell which car is which: the server renders the line hidden per row; the page shows it when the live stream reports a crossing or an idle passing of that code (call: the existing live events, `crossing` and `idle`). The whole list is one `tl-frame`. Assigning a row posts, the 303 comes back to the collect page with `?assigned=<code>`, and the page then shows the list without that row and, above it, one line "Transponder 41 is Lena's now. Change" (Change opens §3.3 for it) (call).

## 4. The board

- **Idle (no session), one unassigned transponder on the track:** the record card's right side shows the live "Transponder 41 is on the track", and quietly under it "Transponder 41 isn't assigned yet. **Assign it**" (to §3.3 with `returnTo` the board).
- **Idle, several:** "Transponder 52 is on the track" (the latest crossing), and "3 transponders aren't assigned yet. **Assign them**" (to §3.6). No yellow box when idle: nothing is lost without a session.
- **During a session:** the yellow box "Transponder 41 isn't assigned yet, so its laps aren't counted. **Assign it**" (or "Transponders 41 and 52 … **Assign them**").
- **Rows:** the driver's colour marker and name, as today; no pictures on the board; the big board shows name and colour.
- **Records:** under a record, on demand and for members only, "Which transponder?" shows the transponder and its label ("Transponder 8, Touring car"). Watchers see no transponder numbers and nothing of unassigned transponders, as today (`watcherCrossing`).
- **Which unassigned transponders count:** during a session, those that crossed in this session; when idle, those that crossed in the last hour (call). Older ones are only in Setup's overview, where Forget clears them. Today's `snap.unknown` (every unassigned transponder ever seen) changes accordingly, with the `setup` live event.
- **Box language:** the track strip loses its left bar. Idle, it becomes the top band of the record card (one box, one shadow); during a session it stands alone, raised with the same shadow. Setup's current track (`.track-now`) loses its left bar the same way.

## 5. Scope

Page routes only. The JSON API (`PUT /transponders/{code}`), `openapi.json` and the MCP tools keep their current behaviour; the shared operation `ops.assignTransponder` keeps its signature, and new operations (label, remove, forget, move, assign to a new driver, pictures) are added beside it for the pages (call: API and MCP follow later).

## 6. Words

Assign, Move, Remove, Forget, Assign it, Assign them, Give it to Mia, Keep it with Simon, Add another transponder, Not in the list? Enter its number, Not assigned yet, Someone else's, Crossing now, crossed 2 min ago, Run its car over the line, and it shows up here. No "code" on screen: "transponder 41", "number".

## 7. Tests

- Store/operations: assign, add a second, label only stored when given, move between drivers, remove (back to unassigned), forget (row gone, passings kept); picture upload limits and types; members-only picture route.
- Pages: each Setup state (one transponder inline; two with labels; none known), the add list's order and groups, the move question, the form's 303/422 and `returnTo` checks, the confirm pages, collect.
- Board: the idle single and several lines with their links, the session warning, records' "Which transponder?", the box language (no left bar).
- Browser: from the board's warning to the form and back; collect with a simulated crossing lighting up its row and assigning it; at 390 px.

## 8. Open guesses

- 2 MB pictures stored as uploaded are fine for a club's handful of drivers.
- The existing live events are enough to light "Crossing now" on collect without a new stream.
