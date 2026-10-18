# TinyLap copy survey (main @ 5f53fc4)

Survey only: no edits. Rules:

- **R1** "Sign in" / "Sign out", never log in/out, login, log-in
- **R2** "workspace" never shown to users; "club" / "personal"; the list is "Your clubs", Personal first
- **R3** "Track" for a saved or shared thing; "layout" only for the planner's templates (the Layouts picker)
- **R4** "Share", never "Publish"
- **R5** A signed-out "Save" that downloads a file says "Download"
- **R6** Sentence case for prose and labels written in source
- **R7** Errors say what happened and how to fix it; no "Please", no filler, no vague "Something went wrong"
- **Other**: grammar, inconsistencies

Out of scope: code identifiers, API paths, JSON fields, `name="workspace"` / `value="publish"` attributes, comments, and operator logs (`main.js` refuse messages, `admin.js`). Operator READMEs are listed in an appendix but not counted.

## Counts

| Rule | timing | accounts | planner | packages | README | Total |
|---|---|---|---|---|---|---|
| R1 Sign in/out | 9 | 0 | 19 | 6 | – | **34** |
| R2 workspace | 10 | 9 | 17 | 0 | – | **36** |
| R3 track/layout | 6 | 0 | 14 | 0 | 2 | **22** |
| R4 Share/Publish | 0 | 0 | 6 | 0 | – | **6** |
| R5 Download | 0 | 0 | 1 | 0 | – | **1** |
| R6 sentence case | 0 | 0 | 4 | 0 | – | **4** |
| R7 errors/filler | 4 | 6 | 1 | 0 | – | **11** |
| Other | 0 | 1 | 0 | 0 | – | **1** |
| **Total** | **29** | **16** | **62** | **6** | **2** | **115** |

---

## apps/timing

Timing's UI (views, auth pages, access errors) is already clean, and `test/server/glossary.test.js` guards it. What's left is the OpenAPI document (also rendered at `/api`), the planner-import errors, and one fallback that leaks text from the BFF (see packages/auth).

### R1 Sign in/out

| file:line | current | proposed |
|---|---|---|
| server/openapi.json:7 | "…through a logged-in browser tab… A read-only watchers view needs no log-in." | "…through a signed-in browser tab… A read-only watchers view needs no sign-in." |
| server/openapi.json:11 | summary "Log in through TinyLap accounts" | "Sign in through TinyLap accounts" |
| server/openapi.json:12 | summary "Finish logging in" | "Finish signing in" |
| server/openapi.json:13 | summary "Log out" | "Sign out" |
| server/openapi.json:14 | "Who is logged in, and their workspaces" / "The log-in state." | "Who is signed in, with their personal space and clubs" / "The sign-in state." |
| server/openapi.json:57 | session scheme: "The log-in session. …" | "The sign-in session. …" |
| server/openapi.json:64 | unavailable: "…or log-in is unavailable." | "…or sign-in is unavailable." |
| server/openapi.json:65 | unauthorized title "Not logged in" / "Log in, or send a valid decoder token." | "Not signed in" / "Sign in, or send a valid decoder token." |
| server/openapi.json:74 | login-failed: "The log-in could not be completed" / "The log-in expired or was tampered with; log in again." | "The sign-in could not be completed" / "The sign-in expired or was tampered with. Sign in again." |

### R2 workspace / club / personal

| file:line | current | proposed |
|---|---|---|
| server/openapi.json:7 | "Lap timing for a workspace's track." | "Lap timing for a club's track, or your own." |
| server/openapi.json:14 | "…and their workspaces" | (see R1) "…with their personal space and clubs" |
| server/openapi.json:15 | "The workspace's live state: …" | "The live state of a club or personal space: …" |
| server/openapi.json:62 | not-found: "No such route, workspace, driver, …" | "No such route, club, personal space, driver, …" |
| server/openapi.json:71 | conflict: "…already running in this workspace; …" | "…already running here; abort it or wait for it to end." |
| server/views/bridge.js:23 | `'your personal timing'` → "It gets its own token for your personal timing." | "your personal space" (a test asserts this string, see Tests) |
| server/operations.js:55 | "A space holds at most N drivers." | Owner decision: "space" is not in the glossary. Suggest "You can have at most N drivers here." |
| server/operations.js:88 | "Pick one of this space's drivers, or none." | "Pick one of the drivers here, or none." |
| server/operations.js:145 | "Every driver must be one of this space's." | "Pick only drivers from this list." |
| server/operations.js:161 | "Pick one of this space's drivers." | "Pick one of the drivers here." |

### R3 track vs layout (errors from importing a planner link, shown on Setup)

| file:line | current | proposed |
|---|---|---|
| server/planner.js:35 | "The link must be a shared layout (/layouts/…)." | "Paste the link of a track shared from the planner." |
| server/planner.js:42 | "The planner has no shared layout under this link." | "The planner has no shared track at this link. Share it again and paste the new link." |
| server/planner.js:45 | "The layout is too large." | "This track is too large to time." |
| server/planner.js:50 | "The planner sent something that is not a layout." | "The planner sent something that is not a track. Share the track again and paste the new link." |
| server/planner.js:52 | "This layout is not a closed circuit, so it has no track to time." | "This track is not a closed circuit, so there is nothing to time. Close the loop in the planner and share it again." |
| server/openapi.json:72 | not-a-circuit title "The layout is not a closed circuit" | "The track is not a closed circuit" |

### R7 errors / filler

| file:line | current | proposed |
|---|---|---|
| server/auth.js:153 | fallback detail "Please sign in again." (`res.body` from the BFF wins when present, and it says "log in"; see packages) | "Sign in again." |
| server/views/notice.js:51 | title "Something went wrong" (the text does explain) | Low priority. "Timing hit a problem". A test asserts the old title. |
| public/bridge-page.js:29 | "The server answered ${status}." | "Timing answered ${status}. Try again in a minute." |
| server/race-pages.js:31 vs server/operations.js:147 | "A session lasts 1 to 60 minutes." vs "A session lasts 10 seconds to an hour." | Make them the same: "A session lasts 1 to 60 minutes." |

---

## apps/accounts

Sign in/out is already right everywhere. The issue is "workspace" on the account, clubs and privacy pages.

### R2 workspace / club / personal

| file:line | current | proposed |
|---|---|---|
| server/pages/account.js:98 | "Every track and version in your workspaces, from the planner, as JSON." | "Every track and version in your personal space and your clubs, from the planner, as JSON." |
| server/pages/account.js:109 | "Deletes your name, passkeys, recovery codes and personal workspace with its tracks, …" | "…recovery codes and your personal space with its tracks, …" |
| server/pages/club.js:137 | "Copy any you want to your personal workspace first." | "Copy any you want to your personal space first." |
| server/pages/clubs.js:36 | lede "…Tracks you save go to one of these workspaces." | "…Tracks you save go to your personal space or one of your clubs." |
| server/pages/clubs.js:42 | h2 "Workspaces" (page h1 is already "Your clubs"; Personal is listed first) | Drop the h2 (make the list `aria-labelledby` the h1), or rename it "Personal and clubs". It must not say "Workspaces". |
| server/pages/privacy.js:24 | "Your personal workspace, the clubs you are in, …" | "Your personal space, the clubs you are in, …" |
| server/pages/privacy.js:26 | "The tracks and versions you save to your workspaces. …" | "…you save to your personal space and your clubs. …" |
| server/pages/privacy.js:37 | "…sessions and personal workspace at once …" | "…sessions and personal space at once …" |
| server/workspaces.js:106 | API error "A personal workspace has no other members, invites or settings." | "Your personal space has no other members, invites or settings." |

Not counted (operator CLI `admin.js` only): server/workspaces.js:314 "There is no workspace ${id}.", :317 "A personal workspace cannot change hands." If they change, a test asserts them (see Tests).

### R7 errors / filler

| file:line | current | proposed |
|---|---|---|
| public/club.js:41 | "Something went wrong. Try again." (any error that isn't a PageError, usually the network) | "Could not reach TinyLap. Check your connection and try again." |
| public/account.js:63 | same | same |
| public/webauthn.js:163 | same | same |
| public/webauthn.js:47 | "The server answered ${status}. Try again." | "TinyLap answered ${status}. Try again in a minute." |
| server/app.js:129 | errorPage title "Something went wrong" (the lede explains) | "The app's request failed", or keep it. Low priority. |
| server/api.js:18-19 | problem titles "Cannot do that" (invalid), "Not yet" (conflict) | "The request is not valid", "Something must change first". These are API-only, so low priority. |

### Other

| file:line | current | proposed |
|---|---|---|
| server/pages/account.js:137 | "TinyLap asks again when you sign in more than 10 minutes ago" | "…when you signed in more than 10 minutes ago" (tense) |

---

## apps/track-planner

### R1 Sign in/out

| file:line | current | proposed |
|---|---|---|
| server/auth.js:25 | `UNAVAILABLE = 'Log-in is unavailable right now.'` | "Sign-in is unavailable right now." (as timing auth.js:27) |
| server/auth.js:117 | link "Log in again" | "Sign in again" |
| server/auth.js:122 | "Log-in is not set up on this server." | "Sign-in is not set up on this server." |
| server/auth.js:129 | title "Can't log in right now" | "Can't sign in right now" |
| server/auth.js:146 | title "The log-in didn't finish"; fallback "Please log in again." | "The sign-in didn't finish"; "Sign in again." |
| server/auth.js:152 | "Log out from the planner's own page." | "Sign out from the planner's own page." |
| server/library.js:47 | "Log in to use the library." | "Sign in to use the library." |
| server/openapi.json:143 | summary "Log in to TinyLap" | "Sign in to TinyLap" |
| server/openapi.json:148 | "…with the pending log-in in a short-lived, sealed cookie." | "…pending sign-in…" |
| server/openapi.json:169 | summary "Log out" | "Sign out" |
| server/openapi.json:170 | "…and logs out at accounts too." | "…and signs out at accounts too." |
| server/openapi.json:181 | summary "Who is logged in" | "Who is signed in" |
| server/openapi.json:184 | "The log-in state. Never cached." | "The sign-in state. Never cached." |
| server/openapi.json:416 | "false when this server has log-in turned off." | "…has sign-in turned off." |
| server/openapi.json:544 | "…with a link to log in again…" | "…with a link to sign in again…" |
| server/openapi.json:563 | "…or log-in is unavailable because accounts can't be reached." | "…or sign-in is unavailable…" |
| server/openapi.json:565 | title "Not logged in" / "The library needs you to log in." | "Not signed in" / "Sign in to use the library." |
| server/openapi.json:568 | "The log-in could not be completed" / "…replaced by a log-in started in another tab… Log in again." | "The sign-in could not be completed" / "…by a sign-in started in another tab… Sign in again." |

### R2 workspace / club / personal

| file:line | current | proposed |
|---|---|---|
| index.html:185 | Save dialog label "Workspace" | "Save to" |
| js/library.js:107-108 | option label `'Unnamed workspace'`; personal shown as "Ayrton (personal)" | "Unnamed club"; personal shown as "Personal", first (as timing's spaces.js:21 and the account menu do) |
| js/library.js:353, 359 | library section heading and aria-label fallback `'Unnamed workspace'` | "Unnamed club" |
| js/library.js:546 | "…deleted for everyone in the workspace. Links you shared keep working. …" | "…deleted for everyone in the club. …" (for a personal track: "…deleted. …") |
| js/library.js:564 | "The version saved … is deleted for everyone in the workspace. …" | same split: "…for everyone in the club. …" / "…is deleted. …" |
| js/library.js:592 | fallback "Copied X to the other workspace." | "Copied X to the other club." |
| server/openapi.json:43 | "…served only to a member of its workspace…" | "…only to a member of its club (or its owner, for a personal track)…" |
| server/openapi.json:191 | summary "Your workspaces and their tracks" | "Your personal space and clubs, with their tracks" |
| server/openapi.json:192 | "Every workspace in your token you may read…" | "Your personal space and every club in your token you may read…" |
| server/openapi.json:203 | "Every track and version in your workspaces, with layouts" | "Every track and version in your personal space and clubs" |
| server/openapi.json:215 | "…private snapshot of the workspace… At most 200 tracks per workspace…" | "…of the club or personal space… At most 200 tracks in each…" |
| server/openapi.json:327 | summary "Copy a track to another of your workspaces" | "Copy a track to your personal space or another of your clubs" |
| server/openapi.json:328 | "A workspace you do not belong to is a 404." | "A club you are not in is a 404." |
| server/openapi.json:454 | "…a private snapshot of the workspace, …" | "…of its club or personal space, …" |
| server/openapi.json:561 | "…or a library track or workspace that does not exist…" | "…or a library track or club…" |
| server/openapi.json:564 | "…or your role in the workspace cannot do it…" | "…your role in the club…" |
| server/openapi.json:566 | "At most 200 tracks per workspace, …" | "At most 200 tracks in a club or personal space, …" |

The planner's account menu in index.html:35-46 (static copy of `accountMenu`) has no "Your clubs" list, so it differs from timing. That may be on purpose; the owner should check.

### R3 track vs layout

| file:line | current | proposed |
|---|---|---|
| index.html:72 | canvas `aria-label="Track layout"` | "Track" |
| js/app.js:166 | status "N overlapping mats — layout invalid" | "N overlapping mats. Move them apart to make the track valid." (also R7: says how to fix) |
| js/app.js:1228 | download filename `circuit30-layout.html` | `circuit30-track.html` |
| js/library.js:124 | button title "Save this layout to your library" | "Save this track to your library" |
| js/library.js:289 | "…Save again to keep this layout as a new track." | "…Save again to keep it as a new track." |
| js/library.js:362 | "…press Save to keep the layout on the canvas here." | "…press Save to keep the track on the canvas here." |
| js/share.js:40 | "This link does not point to a layout." | "This link does not point to a shared track." |
| js/storage.js:52, 81 | shared or downloaded page `<title>` and h1 "Circuit 30 layout" (also what `/layouts/<key>` serves to browsers) | "Circuit 30 track" (or the track's name when it has one) |
| server/layouts.js:39 | "Layouts cannot be stored or read right now." | "Tracks cannot be shared or opened right now. Try again in a minute." |
| server/openapi.json:7 | "Shared Circuit 30 layouts. A layout is stored as…" | "Shared Circuit 30 tracks. …" The data format is named "layout" (schema, `/layouts` paths), which may be kept as a format term. Owner decision. |
| server/openapi.json:556 | title "The layout is not valid". It reaches the UI: share.js:21 shows `problem.title` | "The track is not valid" |
| server/openapi.json:557 | title "The track block does not match the layout" (UI via share.js:21) | "The track does not match its pieces" |
| server/openapi.json:558 | title "The layout is too large" (UI via share.js:21) | "The track is too large" |
| server/openapi.json:559 | title "Too many layouts posted" (UI via share.js:21) | "Too many tracks shared. Wait a minute." |

API-only details in server/layouts.js:45, 80-81, 86, 132, 143 name the JSON format ("Send a layout as application/json", "This is not a layout key"). Keep them, since "layout" is the format term, unless the owner decides otherwise. Not counted.

### R4 Share vs Publish

| file:line | current | proposed |
|---|---|---|
| index.html:197 | dialog title "Publish this layout?" | "Share this track?" |
| index.html:198 | "Publishing makes this layout public at a permanent link. It cannot be undone." | "Sharing makes this track public at a permanent link. It cannot be undone." |
| index.html:202 | button "Publish and copy link" | "Share and copy link" |
| server/openapi.json:215 | "…Nothing is published." | "…Nothing is shared." |
| server/openapi.json:349 | summary "Publish the current version" | "Share the current version" |
| server/openapi.json:356 | 201 description "Published." | "Shared." |

### R5 Download

| file:line | current | proposed |
|---|---|---|
| index.html:26 + js/app.js:1219 | signed out, the navbar button reads "Save" but calls `download()` | Make the static label "Download". Library init (library.js:240, which already sets `data-library` and unhides `#btn-download`) relabels it "Save". |

### R6 sentence case

| file:line | current | proposed |
|---|---|---|
| index.html:62-66 | Controls list: "place next, keep going", "turn the selected piece", "swap for another that fits", "remove the selection", "cancel and deselect" | Capitalise the first letter of each: "Place next, keep going", … |
| index.html:143 | checkbox label "include chicanes" | "Include chicanes" |
| js/app.js:1124-1125 | "showing 1-5 of N (filtered from M)" / "nothing matches those filters" | "Showing 1–5 of N (filtered from M)" / "Nothing matches those filters" |
| js/app.js:1180-1181 | `<dd>` "a loop of these alone cannot close — …" | "A loop of these alone cannot close — …" |

### R7 errors

| file:line | current | proposed |
|---|---|---|
| js/share.js:21 | fallback "The planner server answered ${status}." | "The planner answered ${status}. Try again in a minute." |

---

## packages

### @tinylap/auth (BFF, used by both apps)

The callback body is shown verbatim on both apps' "sign-in didn't finish" pages, so timing currently shows "log in" text too. Timing's glossary test misses this because it stubs `body: undefined`.

| file:line | current | proposed |
|---|---|---|
| auth/bff.js:54 | AuthError message "Log-in is unavailable right now." | "Sign-in is unavailable right now." |
| auth/bff.js:366 | appended "Please log in again." (R1 + R7 filler) | "Sign in again." |
| auth/bff.js:369 | "This log-in has expired or was started in another browser." | "This sign-in has expired or was started in another browser." |
| auth/bff.js:375 | "This log-in could not be read." | "This sign-in could not be read." |
| auth/bff.js:377 | "This log-in has expired." | "This sign-in has expired." |
| auth/bff.js:392, 400, 403 | "The log-in did not complete." | "The sign-in did not complete." |

### @tinylap/design

No findings. accountMenu ("Your clubs", "Account", "Sign out"), signInLink ("Sign in"), frame.js and copy.js strings all follow the glossary.

---

## README (end-user facing parts)

| file:line | rule | current | proposed |
|---|---|---|---|
| README.md:6 | R3 | "design Kyosho Mini-Z Grand Prix Circuit 30 layouts and cost them…" | "…Circuit 30 tracks and cost them…" |
| README.md:17 | R3 | "Exported layout files are standalone…" | "Downloaded track files are standalone…" |

### Appendix: operator docs (not counted, owner decision)

These are for self-hosters and maintainers, not end users, but they say "log-in", "login" or "log in" where the product says "sign-in":

- README.md:37, 44, 48 ("the login service"), 73 ("log-in half configured", "logging out ends only…")
- apps/accounts/README.md:3 ("login service"), 37, 39, 93, 101, 103, 148, 149, 166, 175 ("Log in to the planner once"), 203
- apps/timing/README.md:7, 24, 27 ("Log in at …")
- packages/auth/README.md:3, 62, 101 (its sample code literally sends `'Log-in is unavailable right now.'`), 109, 117, 139, 146
- apps/track-planner/server/main.js:55, 63, 68 and apps/timing/server/main.js:66 (startup refusals, "log-in: …"). Asserted by apps/track-planner/test/server/main.test.js:56-60.

---

## Tests asserting strings that would change

| test file:line | asserts | changes with |
|---|---|---|
| apps/track-planner/test/browser/library.test.js:217 | `'Publishing makes this layout public at a permanent link. It cannot be undone.'` | R4 index.html:198 |
| apps/track-planner/test/browser/library.test.js:223 | button name `'Publish and copy link'` | R4 index.html:202 |
| tools/e2e/identity.test.js:226 | button name `'Publish and copy link'` | R4 index.html:202 |
| apps/track-planner/test/library-ui.test.js:142 | `workspaceLabel(...)` → `'Ayrton (personal)'` | R2 library.js:108 |
| apps/track-planner/test/library-ui.test.js:144 | `'Unnamed workspace'` | R2 library.js:107 |
| apps/track-planner/test/server/auth.test.js:127 | `/log in again/i` | R1 planner auth.js:146 / bff.js:366 |
| apps/track-planner/test/server/auth.test.js:162 | `'Log-in is unavailable right now.'` | R1 planner auth.js:25 |
| packages/auth/test/bff.test.js:253 | `/log in again/i` | R1 bff.js:366 |
| apps/timing/test/server/bridge-pages.test.js:29 | `/token for your personal timing/` | R2 timing views/bridge.js:23 |
| apps/timing/test/server/setup-pages-more.test.js:54 | `/not a closed circuit/` | Still passes with the proposed planner.js:52 text. Check it if reworded. |
| apps/timing/test/server/page-failures.test.js:46, 70 | `/Something went wrong/` | Only if R7 notice.js:51 changes |
| apps/accounts/test/admin.test.js:61 | `/no workspace no-such-club/i` | Only if the operator text in workspaces.js:314 changes |
| apps/track-planner/test/server/discovery.test.js:20 | schema title `'TinyLap Circuit 30 layout'` | Only if the format name changes (not proposed) |
| apps/track-planner/test/server/main.test.js:56-60 | `/log-in also needs …/`, `/log-in: /` | Only if the operator messages change |

Existing guards to extend: apps/timing/test/server/glossary.test.js; apps/timing/test/server/pages.test.js:70 and setup-pages.test.js:40 (`doesNotMatch(/workspace/i)`). Neither accounts nor the planner has an equivalent, and the timing callback test should use a real BFF 400 body.

---

## Brand and product names (for the owner; no rename proposed)

| Name | Where |
|---|---|
| **TinyLap** | accounts brand lockup and `<title>` suffix "· TinyLap" (server/pages/layout.js:37, 46); accounts prose (account.js:40, 85, 102, 137; invite.js:37, 58 "the TinyLap club"; privacy.js:14; sign-in.js:15, 26; sign-up.js:58; signed-out.js:16, 33, 36, 40; app.js:130; api.js:134); passkey rpName/appName (auth.js:55, 179); recovery file header "TinyLap recovery codes" (public/account.js:101, sign-up.js:68); timing "TinyLap decoder" (views/bridge.js:44, public/bridge-page.js:61); README.md:1 |
| **TinyLap Timing** | timing navbar brand (views/layout.js:53), `<title>` suffix "· TinyLap Timing" (layout.js:44), start page and notice lockup (notice.js:16, 27); apps/timing/README.md:1 |
| **"TinyLap timing API"** (lower-case t) | timing openapi.json:4, which is also the `/api` page h1 and title |
| **TinyLap accounts** (lower-case a) | timing openapi.json:11 "Log in through TinyLap accounts"; apps/accounts/README.md:1. Elsewhere it is just "accounts". |
| **Circuit 30 Planner** | planner `<title>` and navbar brand (index.html:7, 19); downloaded file note "Open this file in the Circuit 30 Planner…" (js/storage.js:88) |
| **"the planner" / "planner"** | planner error pages "Back to the planner" (server/auth.js:117), "The planner still works" (129); download note "Open in planner" (storage.js:88); timing Setup "Planner link", "from the planner"; accounts "from the planner" |
| **"TinyLap planner API"** | planner openapi.json:4 (the `/api` page) |
| **"Circuit 30 layout"** | downloaded/shared page title and h1 (storage.js:52, 81); schema title "TinyLap Circuit 30 layout" (packages/track-format/layout.schema.json:3) |
| **"Timing" / "timing"** | timing prose "Sign in to use timing.", "Back to timing", "Change timing from its own pages.", "Timing keeps recording" |

Inconsistencies to decide:

1. The planner is the only app whose navbar brand and `<title>` lack "TinyLap". It shows "Circuit 30 Planner" where timing shows "TinyLap Timing" and accounts shows "TinyLap".
2. Title suffix pattern: accounts uses "X · TinyLap", timing uses "X · TinyLap Timing", the planner is the bare static "Circuit 30 Planner", and the planner and timing server pages (`pages.js` `page()`) have no suffix.
3. Casing: "TinyLap Timing" (brand) vs "TinyLap timing API" vs "TinyLap accounts" vs "TinyLap planner API".
4. Accounts has no visible product name beyond "TinyLap". Timing's openapi calls it "TinyLap accounts".

---

## Planner keyboard shortcuts fire on focused navbar buttons and links

Confirmed. In apps/track-planner/js/app.js, the document keydown listener is at :1350. Its only focus guard is at :1353:

```js
if (e.target.matches('input, textarea, select')) return;
```

When a `<button>`, `<a href>` or `<summary>` has focus, the event goes on to the shortcuts:

- :1386 `r`: rotates the selection or armed tool. Typing "r" while tabbed onto Share or the brand link turns a piece.
- :1430 `c`: swaps the selected piece.
- :1472 `Delete` / `Backspace`: deletes the selected pieces while focus is on a navbar button, the "Clear" button (`#btn-clear`) or the account `<summary>`.
- :1486 `Space` / `Enter`: commits the pending piece and calls `preventDefault()`. On a focused button, Enter's click is cancelled, or Space both activates the button and places a piece, depending on the browser. On a focused link, Enter no longer follows the link.

The `dialog[open]` guard at :1359 covers modals only, not the navbar or the canvas bar. The palette entries are non-focusable `<li draggable>` and the canvas is `<svg tabindex="0">`, so neither needs these keys to reach a control.

Minimal guard: widen the existing check at :1353 to interactive elements, keeping it after the `defaultPrevented` check:

```js
if (e.target.closest('input, textarea, select, button, a[href], summary, [contenteditable]')) return;
```

To keep Ctrl/Cmd+Z and Escape working while a navbar control has focus, put this guard after the undo block (:1361) and the Escape block (:1367) instead, so it gates only `r`, `c`, Delete/Backspace and Space/Enter. Add a test: focus `#btn-share`, press `r` and Delete with a selected piece, and assert the layout did not change.
