# Named tracks: design

A club races on one layout for years and should never have to draw it before the first lap. A track is a name first; a layout from the planner is an optional extra for those who like documentation. It follows the sessions and records spec (`2026-10-29-sessions-and-records-design.md`, §4 Track records) and the timing-core spec (`2026-10-15-timing-core-design.md`, the track and Setup), and changes them where this says so. Paths are relative to `apps/timing/` unless they start with `packages/` or `docs/`.

## 1. Why

Today a track only exists once someone pastes a planner share link on Setup. Until then the board says "No track set", "Choose the track" is the first setup step, and no lap can set a track record. Most clubs and offices never change their layout and have no reason to draw it; the planner should enrich a track, not gate it.

## 2. Goals, non-goals, anti-goals

Goals:

1. **A club can race straight away.** A new club has a track called "Track"; the first practice already counts towards its record.
2. **A track is a name.** A planner layout can be attached when it's added or later, and changed, with a clear warning.
3. **A track's layouts are kept**, each with when and by whom it was attached, so a club can look back years later and see what changed.
4. **Several tracks per club**, one of them current; old ones can be archived, and archived ones deleted.

Non-goals:

- Comparing records across tracks or clubs.
- Editing a layout inside timing: layouts come from the planner, as now.
- A history of renames or other edits: they don't change what was driven.

Anti-goals (a failure even if it works):

- A club that can't time a lap until it has set up a track.
- A layout change that silently changes what a record means: the member is told before it happens.
- Losing records or sessions through a click that can't be undone, without a confirmation.

## 3. Tracks

### 3.1 What a track is

- A track has an id of its own (not the planner's), a name (1–60 characters, unique within the club among tracks that aren't archived), and optionally a current layout.
- Records stay per track and direction (sessions and records spec §4.1). Direction stays per club, set with the current track, as today.
- **The current track** is the one new sessions use (`workspace.track_id`, as today). There is always one: the current track can't be archived or deleted; a member switches first. A running qualifying or race keeps the track it started with, and switching ends a running practice, as today.

### 3.2 The default track

- A new club gets one track named "Track", with no layout, as its current track, direction counter-clockwise (today's default). It is an ordinary track: it can be renamed, given a layout, archived once another track is current.

### 3.3 Adding a track

On Setup, **Add track** with a name, and optionally a planner link (the link's layout becomes the track's first layout). The name is always required: a planner layout carries no name, and a fixed default would clash with "Track". *My call.* A new track isn't current until a member makes it so; adding the first planner track to a club that only has the untouched default does not replace it either. *My call: adding never switches, so a running session is never ended by adding.*

### 3.4 Layouts

- **Attach a layout** to a track without one: a planner link, no warning (nothing was compared against a layout yet).
- **The same layout again**: a link whose planner track id equals the current layout's is the same circuit (the track-identity spec keeps the id while the geometry is unchanged). It adds a layout entry only if the snapshot differs, with no warning. *My call.*
- **Change the layout** of a track that has one, to a layout with a different planner track id: the member pastes the link, then confirms on a page that says what it means: "Records on Office stay and are compared with laps on the new layout. If the track itself changed, add it as a new track instead." The confirmation offers both: change it, or add a new track with this layout.
- **Every layout stays.** Each attach or change adds an entry: the layout (the planner's track id, shape, snapshot key and layout data, as stored today), when it was attached, and who attached it (the member's user id and display name at that moment). This is the first personal data timing keeps: when a member's account is deleted (the deletions feed, `forgetUser`), their entries keep the date and show "former member", as a deleted driver's record shows "former driver". *My call.* The newest entry is the current layout. Fixing a wrong attachment is just another change; the history shows it happened.
- A record shows the layout that was current when it was driven (the newest entry attached before the lap's `at`), or none.

### 3.5 Archive and delete

- **Archive** hides a track from the track list and the current-track choice; no confirmation, because **Restore** undoes it. Its records, sessions and layouts stay.
- **Delete** is only offered for an archived track, after a confirmation naming what goes: "Delete Office? Its records and layouts are removed. Its 42 sessions stay in the history, without a track." It removes the track, its layout entries and its rows in `track_record` and `personal_best`. Sessions and their laps stay; a session whose track is gone shows "a deleted track".

### 3.6 Existing data

No migration. The deployed timing database holds no real club yet, so it starts empty with this change: the new schema is created as it stands, and the old `track` columns aren't carried over. *Replacing the deployed database is a deploy step the owner approves.*

## 4. Screens

- **Setup, Track section** becomes the track list:
  - the current track with its direction, and the form to switch track and direction;
  - each other track with Make current, Rename, Attach layout or Change layout, Archive;
  - Add track (a name, or a planner link);
  - Archived tracks, collapsed (`<details>`), each with Restore and Delete.
- **A track's page**, `…/tracks/<id>`, members only: its name, the current layout drawn with `layoutToSvgString` from `@tinylap/track-format` (or "No layout"), earlier layouts by date with who attached them, and its records per direction (the record history, as `…/records` shows it). `…/records` keeps showing the current track's and links here.
- **The board's track header** always has a track: its name, the direction as an icon, and its record or "No record yet". "No track set" goes.
- **The direction icon:** an open loop, like a track seen from above, with one pink arrowhead where it carries on; it points the way the club races. It stands alone, without a visible word. Its meaning is in the SVG's own `<title>` ("Anticlockwise" or "Clockwise", the words the app already uses), which gives screen readers its name (`role="img"`) and a tooltip on hover. Where a member chooses the direction (Setup), the words stay visible.
- **The board when nobody is racing** shows what's worth seeing, not warnings:
  - The track record is the big thing: the time, the holder with the crown, when it was set and what it beat (or "No record yet").
  - Beside it, **Start practice** (members, not on the big board or the watch link). While a car crosses with no session, a live line says so ("Car 23 is on the track") instead of a yellow notice.
  - Cars without a driver are one quiet line under the button ("2 cars have no driver yet. Assign them"), not a notice.
  - Below: **Fastest on this track** (each driver's best on the current track and direction) and **Last session** (its top finishers, when it ended, a link to its page).
  - A club that has never driven a lap gets one card instead: "Ready when your cars are", with Add drivers, Connect the decoder and Tap laps by hand.
  - Gone: the "No session yet" headline, the empty "Last laps" card, the setup steps for clubs that have driven, and both yellow notices. Yellow notices stay for things that are wrong, such as a decoder offline.
- The words follow the glossary: a *track* is what a club races on; a *layout* is the planner's drawing of it.

## 5. Data

- `track`: gains `archived_at` (null while active); keeps `name`; the layout columns move to `track_layout`. Its `id` is the track's own id, a random UUID.
- `track_layout`: `(workspace_id, track_id, attached_at, planner_id, shape, snapshot_key, layout, attached_by_user, attached_by_name)`, primary key `(workspace_id, track_id, attached_at)`; the newest row per track is current. Every index starts with `workspace_id` (one server serves many clubs; sessions and records spec §6).
- `workspace.track_id` is never null: a club gets "Track" when it is created.
- Deleting a track deletes its `track_layout`, `track_record` and `personal_best` rows in one transaction; `session.track_id` stays as it is and finds no track.

## 6. The JSON API

`openapi.json` gains `GET/POST …/tracks` (list with archived ones flagged; add by name or link), `PATCH …/tracks/{id}` (rename, archive, restore), `POST …/tracks/{id}/layouts` (attach or change; a layout with a different planner track id than the current one needs `"confirm": true`, else 409 naming the current layout), `DELETE …/tracks/{id}` (archived only, else 409), and the current-track route takes a track id instead of a link. *My call.*

## 7. Left to the builder

- The look of the track list, the track page and the confirmation, within palace-ui and `@tinylap/design`, with the `frontend-design` skill.
- How large the track page draws earlier layouts.

## 8. Decisions

1. **A track is a name**; a planner layout is optional and can be attached later.
2. **A new club starts with "Track"**, so it can race at once.
3. **A layout can be changed**, after a confirmation that says records continue; every layout stays, with when and who.
4. **One current track, always**; archive hides without confirmation, delete only from the archive with confirmation, removing records and layouts but not sessions.
5. **No migration**: the deployed database holds no real data yet and starts empty.
