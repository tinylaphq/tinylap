# Track Identity — Design Specification

Date: 2026-10-13
Extends: `docs/superpowers/specs/2026-10-13-tinylap-monorepo-design.md` (sub-project 2)

## 1. Purpose

The timing app will keep leaderboards per track. For that, a layout file has to
say *which* track it is. This sub-project adds track identity to
`@tinylap/track-format`. It doesn't build the timing app.

## 2. Decisions

| Question | Decision |
| --- | --- |
| When are two layouts the same track? | Two separate notions. An **id** identifies one concrete track. A **shape** fingerprint says "built the same", so different venues can be compared. |
| What does an edit do? | **Changed geometry is a new track, with a new id.** The old track stays as it was, with its own leaderboards. |
| Mirrored layout? | A different track: left turns become right turns. The shape does not treat mirror images as equal. |
| Driving direction? | **Not part of the track.** A physical build is driven either way. Direction is a per-session choice in the timing app, remembered there until someone changes it. The format defines the vocabulary and how direction splits leaderboards. |
| Timing line (gate position)? | Left out. Lap times don't depend on it. An optional field can be added later without breaking anything. |
| Open layouts? | No track, no leaderboard. Only closed circuits get an identity. |

## 3. Data model: format version 2

```json
{
  "version": 2,
  "unit": "mat",
  "room": null,
  "pieces": [ ... ],
  "track": { "id": "0f8c2a4e-5b1d-4c3a-9e7f-2d6b8a1c3e5f", "shape": "c30:1:..." }
}
```

- `track` is optional. It is present only for closed circuits.
- `id` is a lowercase RFC 4122 UUID from `crypto.randomUUID()`, the platform standard, so no dependency is needed.
- `shape` is the fingerprint (§4). The `c30:1:` prefix names the piece system (Circuit 30) and the algorithm version, so either can change later without colliding.

Types (`types.d.ts`):

```ts
export interface Track { id: string; shape: string }
export type Direction = 'cw' | 'ccw';
// Layout gains: track?: Track; version is always 2 in memory (created or read).
```

## 4. The shape fingerprint

`shapeOf(layout): string | null` returns `null` for a layout that isn't a closed
circuit, or that has overlapping pieces (it can't physically be built).

**Source.** The fingerprint is computed from **what is physically built**, not
from the piece list:
- the occupied cells
- the straight barrier edges, with how many barriers each edge carries. An unjoined contact carries two.
- the curved barriers, as cell, corner, radius and kind
- the corner-cap vertices

The reason is that the piece list is ambiguous. A straight at rotation 0 and
one at 180 occupy the same cells and get the same barriers, but they're
different entries in the list. Fingerprinting the built result means identical
builds always match, whatever pieces described them.

**Normalisation.**
1. Each of the four rotations (0, 90, 180, 270) is applied to all of those elements.
2. Each rotated set is translated so that its minimum cell sits at the origin.
3. Each element is serialised to a fixed text form; the list is sorted and joined.
4. The lexicographically smallest of the four results is the shape.
5. Mirroring is deliberately **not** applied. A layout that is itself mirror
   symmetric (the rectangular ring, for example) naturally has the same shape as
   its mirror image. That is correct: it is the same build.

The result is prefixed with `c30:1:`. It is plain, readable text, with no hash,
so it is deterministic, synchronous, and inspectable when a comparison looks
wrong.

Rotation must use the existing helpers in `geometry.js` (`rotateCell`,
`rotateCorner`, `rotateVertex`). Edge ids (`H:x:y` / `V:x:y`) are rotated
through their two end vertices, so there is one source of rotation maths.

## 5. Identity rules

`assignTrack(layout): Layout` returns a copy of the layout with a correct
`track`:

| Situation | Result |
| --- | --- |
| Not a closed circuit, or overlapping | no `track`; any existing block is removed |
| Closed, no `track` | new id, current shape |
| Closed, `track.shape` equals current shape | unchanged |
| Closed, `track.shape` differs | new id, current shape |

`assignTrack` runs where a layout **leaves or enters** as a file:
- **Planner export.** The planner keeps the result. Its current layout
  carries the `track` block in state and in the session store, so the next
  export compares against it. Edits never touch `track`, and session saves
  store it as it is. Opening a file adopts the file's `track`.
- **The future timing-app import.**

That implements "changed geometry is a new track" without the editor tracking
edits. Moving a piece away and back before the next export keeps the id, because
the shape matches again. Moving the whole layout, rotating it, or changing `room` keeps the id,
because none of those changes the shape.

`crypto.randomUUID()` exists only in secure contexts: HTTPS, or `localhost`.
The hosted planner is HTTPS and the dev server is `localhost`, so both are
covered.

## 6. Direction and leaderboards

- `DIRECTIONS = ['cw', 'ccw']`: clockwise and anticlockwise **as seen from
  above, in the planner's coordinates** (x right, y down). Every closed
  Circuit 30 layout is one loop on a flat floor with no crossings, so the
  direction is always well defined. Rotating a layout doesn't change it.
  Mirroring would, but a mirrored layout is a different track anyway.
- `leaderboardKey(track, direction): string` returns `` `${track.id}:${direction}` ``,
  and throws on an unknown direction. Times from different directions never
  share a key.

**Requirements this places on the timing app (sub-project 3):**
- It keeps the chosen direction per track, until changed.
- It prefixes leaderboard keys with its own venue or installation. A shared,
  unmodified layout file carries the same id to every venue that builds it.
  That's correct, because it is the same build, but each venue's leaderboard
  must stay its own.

## 7. Reading and compatibility

`layoutFromData` reads versions 1 and 2:
- A version 1 file has no `track`; it gets one on its next `assignTrack`.
- Every layout read is returned as version 2 in memory. Reading upgrades it;
  the next save writes version 2.
- A version 2 `track` block is kept if `id` is a lowercase UUID and `shape`
  starts with `c30:`. Otherwise it's **dropped**, not rejected, so a damaged
  block costs only a re-issued id, never a file that won't open.
- Any other `version` is refused with the existing "saved by a newer planner"
  message.

`createLayout` creates version 2. Older planners refuse version 2 files with
their existing message, which is correct.

`extractLayoutJson` moves from the planner's `storage.js` into the package,
together with a new `layoutFromHtml(html)` (extract plus `layoutFromData`).
That way the timing app can open files the planner exported. The planner's
`exportHtml` stays in the planner, because it embeds the bill of materials.

## 8. Public API additions

| Name | Kind |
| --- | --- |
| `shapeOf(layout)` | `string \| null` |
| `assignTrack(layout)` | `Layout` |
| `DIRECTIONS` | `readonly Direction[]` |
| `leaderboardKey(track, direction)` | `string` |
| `extractLayoutJson(html)` | `unknown` (moved) |
| `layoutFromHtml(html)` | `Layout` |
| `Track`, `Direction` | types |

`SUPPORTED_VERSION` becomes `2`. A `SUPPORTED_VERSIONS = [1, 2]` export
documents what `layoutFromData` reads.

## 9. Testing

- **Shape invariance.** Every reference layout (`rectangularRing`, `stockL`,
  and a ring with a `cornerR60`) has the same shape after translation and after
  each of the four rotations.
- **Shape sensitivity.**
  - the mirrored stock L gets a different shape
  - swapping one straight pair for a corner gets a different shape
  - an open layout, and an overlapping one, give `null`
- **Piece symmetry.** A ring whose straights are placed at 0° and the same
  ring with them at 180° get the same shape.
- **Identity rules.** Each row of the §5 table, plus:
  - a moved layout keeps its id
  - a room change keeps its id
  - two fresh assignments of the same closed layout get different ids
- **Reading.**
  - the v1 golden file (`apps/track-planner/test/fixtures/live-export.html`) still imports, without a track
  - a v2 file round-trips with its track intact
  - a malformed track block is dropped
  - version 3 is refused
- **Direction.** `leaderboardKey` gives `<id>:cw` and `<id>:ccw`, and throws on `'clockwise'`.
- **Planner.**
  - an export of a closed layout contains a `track` block
  - exporting twice without changes keeps the id
  - exporting after a change issues a new one
  - a change reverted before the next export keeps the id
  - the session store keeps the `track` block across a reload
  - opening a file adopts its `track`
- All existing tests pass unchanged, except where they assert `version: 1`.
  Those change to 2, because created and read layouts are both version 2. This
  includes the golden-file test: its file stays a v1 file byte for byte, and
  only the expected in-memory version changes.

## 10. Out of scope

- The timing app, and with it remembering direction and venue scoping.
- A timing line, sector gates, or a track name field.
- Comparing across venues beyond equal shapes. For example, a mirrored track
  driven the other way has the same turn sequence, but it is not treated as the
  same.
- Showing the id or shape in the planner's interface.
