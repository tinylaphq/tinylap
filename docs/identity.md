# Snapshots, tracks and shapes

A TinyLap layout can be named three ways. Each answers a different question,
and mixing them up is the most common mistake when building against the
planner's API.

| Identifier | Answers | Changes when | Used for |
| --- | --- | --- | --- |
| **Snapshot key** | "this exact file" | anything in the layout changes | sharing links: `/layouts/<key>` |
| **Track id** | "this track, as its owner keeps it" | the built geometry changes | leaderboards at one venue |
| **Shape key** | "this build, wherever and however it was made" | the built geometry changes | finding the same build anywhere: `/shapes/<key>` |

## Snapshot key

A snapshot is one layout, frozen. Its key is computed from its content:

1. Read the layout with `layoutFromData` and sort its pieces by `y`, `x`, `type`, `rot`.
2. `JSON.stringify` it. That is the canonical JSON (`canonicalJson`).
3. SHA-256 the UTF-8 bytes, keep the first 16 bytes, and write them as base64url without padding: 22 characters (`snapshotKey`).

The same layout always gets the same key, however its pieces were listed, so
sharing twice gives the same link. Move a piece, change the room, add a
track block, and it is a different snapshot with a different link. Snapshots
are never edited or deleted, so a link always shows what was shared.

## Track id

`track.id` is a random UUID that the planner settles whenever a layout leaves
as a file or a link (`assignTrack`). It stays as long as the shape does. Moving
the whole layout, turning it, changing the room or describing the same build
with other pieces keeps it. Changing what is built issues a new one: a new
track, with its own leaderboards. Only a single closed loop has a track.

Many snapshots can share one track id. A track id proves no ownership, though:
anyone can post a snapshot carrying any id, as long as the shape matches.

## Shape key

`shapeOf(layout)` fingerprints what is physically built: covered cells,
barriers and corner caps, normalised for position and quarter turns, not for
mirroring (a mirrored track turns the other way, so it is a different track).
`shapeKey(shape)` hashes that string the same way as a snapshot key.

Many track ids can share one shape: two people who built the same thing
independently, or one who lost the file and built it again. A shape key says
"built the same". It does not say "the same venue".

## Examples

**Sharing a link.** Press Share in the planner. It settles the track, posts
the layout and copies `…/layouts/<key>`. Whoever opens it sees the drawing
and the bill of materials, and can open it in their own planner.

**Two friends who lost the link.** Both still have the layout in their app.
Each computes `shapeKey(shapeOf(layout))` locally, with no server and no link,
and gets the same key. `/shapes/<key>` lists every stored snapshot of that
build, so they find each other's, even if one of them rebuilt it by hand and
has a different track id.

**An online race** (planned). A race is defined by shape key, direction and
number of laps. Every venue whose layout has that shape can take part, and
the results merge. Each venue's own leaderboard stays keyed by venue and
track id (`leaderboardKey`).

## Getting a layout

`/layouts/<key>` and `/shapes/<key>` serve JSON to programs and HTML to
browsers (content negotiation on `Accept`). Only `/layouts/<key>` also takes a
`.json` or `.html` suffix to force one; `/shapes/<key>` negotiates by `Accept`
alone. The discovery routes (`/openapi.json`, `/schemas/layout.json`, `/api`)
serve one representation each. The full API is described at
`/openapi.json`, readable at `/api`, and the file format is JSON Schema at
`/schemas/layout.json`.

# Accounts and workspaces

Logging in is optional: the planner works fully without an account. An
account gives you a durable library of tracks, and gives clubs a shared one.
The sign-in service is TinyLap Accounts (`apps/accounts`); the planner is its first client. The
design is in `docs/superpowers/specs/2026-10-14-identity-design.md`.

**Status: proof of concept.** Everything runs on `*.fly.dev`, with Fly's daily
volume snapshots as the only backup. It is not meant for data you cannot
lose. What is needed before a production release (a domain, off-site backups,
the OpenID conformance run, a legal check, email) is tracked in the GitHub
issues [#5](https://github.com/tinylaphq/tinylap/issues/5) to
[#9](https://github.com/tinylaphq/tinylap/issues/9).

## Who owns what

People have accounts, and sign in with a passkey (no passwords). Recovery
codes, shown once at sign-up, are the way back if every passkey is lost. Lose
every passkey and every code and the account is gone.

Data belongs to **workspaces**, not to people. Everyone has a personal
workspace, created at sign-up, which never has other members. A **club** is a
shared workspace with members. Each club has exactly one owner at all times.
A person can create up to five clubs.

## Roles

| Action | owner | admin | member |
| --- | --- | --- | --- |
| See the workspace's tracks and history | ✓ | ✓ | ✓ |
| Save, save a new version, rename a track | ✓ | ✓ | ✓ |
| Share a track (publish) | ✓ | ✓ | ✓ |
| Copy a track to another workspace you belong to | ✓ | ✓ | ✓ |
| Delete a track or a version | ✓ | ✓ | |
| Create, list and revoke invites | ✓ | ✓ | |
| Remove a member | ✓ | ✓ | |
| Promote a member to admin, demote or remove an admin | ✓ | | |
| Transfer ownership | ✓ | | |
| Rename or delete the club | ✓ | | |
| Leave the club | (transfer first) | ✓ | ✓ |

People join a club through an invite link (valid 7 days, single use by
default, shown once). When someone leaves or is removed, the club keeps their
tracks, and their saves keep the name they had. Only a deleted account's
saves show as "former member". Copy tracks to your personal
workspace before leaving if you want them.

## Private and public snapshots

Saving a track to the library writes a **private** snapshot: same
content-addressed key as a public one, readable only by members of that
workspace (anyone else gets a 404). Saving is not publishing. **Share**
publishes the current version as an ordinary public snapshot and cannot be
undone, which is why it asks first. Two workspaces with identical content each
have their own private copy, and deleting one never touches the other or any
public snapshot.

A library track keeps its **50 newest versions**; older ones drop off, and the
history view says so. Other limits: 200 tracks per workspace, 64 KiB per
snapshot, 60 saves per user per hour, 20 active invites per workspace.

## Deleting, and the deletions feed

Deleting an account removes the person, their passkeys, recovery codes and
sessions, and their personal workspace. It is refused while they own a club:
transfer ownership or delete the club first. Deleting a club removes its
members and invites. Public snapshots stay: they contain no personal data.

`accounts` appends each deletion to a feed, `GET /deletions?after=<seq>`, behind
a bearer token per consumer. The planner reads it when it starts and hourly,
and deletes the private snapshots, library tracks and versions of deleted
workspaces and the sessions of deleted users. It takes a deletion only once
it is older than one access token lifetime plus a minute, so a save made with
a token that still names a deleted club is removed too. Until then, deleted
data still sits in the planner but cannot be reached.

If a club's owner can no longer act, the maintainer can transfer ownership
after verifying the request out of band
(`node apps/accounts/admin.js transfer-ownership <workspace> <user>`, see
`apps/accounts/README.md`).

## Data protection

`accounts` stores a display name, passkeys (public keys), recovery code hashes,
memberships and sessions. The email field holds a placeholder
(`<id>@users.invalid`) that is never shown or used. The planner stores the
library and, per sign-in session, the tokens, encrypted. The account page offers
an export of the account data with a link to the planner's export of every
track and version, and deletion. The privacy page of `accounts` says the same
in plain words. Nothing is third-party: no analytics, fonts or sign-in providers.
