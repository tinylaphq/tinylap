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

Every URL serves JSON to programs and HTML to browsers (content negotiation
on `Accept`; `.json` or `.html` force one). The full API is described at
`/openapi.json`, readable at `/api`, and the file format is JSON Schema at
`/schemas/layout.json`.
