# @tinylap/track-format

Read, validate and draw track layouts for the Kyosho Mini-Z Grand Prix Circuit 30: the layout data model, piece geometry, barrier and lap metrics, and SVG rendering.
It is plain ES modules with TypeScript declarations, and runs in browsers and Node.

## Install

```sh
npm install @tinylap/track-format
```

## Usage

```js
import { layoutFromData, isClosedCircuit, computeMetrics, layoutToSvgString } from '@tinylap/track-format';

const layout = layoutFromData(JSON.parse(saved)); // throws on an unknown version or piece
console.log(isClosedCircuit(layout), computeMetrics(layout).lapMm);
const svg = layoutToSvgString(layout, { theme: 'light' });
```

The data model types are exported too: `import type { Layout } from '@tinylap/track-format'`.

## Track identity

Format version 2 adds an optional `track: { id, shape }` block. `shape` fingerprints the built geometry of a closed, single-loop layout (the same for any position or quarter turn, not for a mirror image); `id` is a UUID that stays while the shape does.

- `assignTrack(layout)` settles the block. Run it when a layout leaves or enters as a file, not on every edit: unchanged shape keeps the id, changed shape gets a new one, an open or overlapping layout gets none.
- `shapeOf(layout)` returns the fingerprint, or `null` if the layout is not one closed loop.
- `DIRECTIONS` (`'cw'`, `'ccw'`) and `leaderboardKey(track, direction)` key a leaderboard per direction. A timing app must prefix the key with its own venue, because a shared unchanged file carries the same id everywhere.
- `layoutFromHtml(html)` reads a layout from a planner export.

```js
import { layoutFromHtml, assignTrack, leaderboardKey } from '@tinylap/track-format';

const { track } = assignTrack(layoutFromHtml(html));
const key = track && `${venue}:${leaderboardKey(track, 'cw')}`;
```

## Keys

Shared layouts are addressed by content. See [docs/identity.md](https://github.com/tinylaphq/tinylap/blob/main/docs/identity.md) for how snapshots, track ids and shapes relate.

- `@tinylap/track-format/layout.schema.json` is the format as JSON Schema 2020-12, for validating layouts without this package.
- `snapshotKey(layout)` names one exact layout: SHA-256 of `canonicalJson(layout)`, first 16 bytes, base64url (22 characters). Piece order does not matter; anything else does.
- `shapeKey(shapeOf(layout))` names one physical build, wherever and however it was laid out.
- `parseLayout(text)` reads a layout from JSON or from an exported page.
- `KEY_PATTERN` matches a valid key.

```js
import { parseLayout, snapshotKey, shapeKey, shapeOf } from '@tinylap/track-format';

const layout = parseLayout(text);
const link = `/layouts/${await snapshotKey(layout)}`;
const shape = shapeOf(layout);
const sameBuild = shape && `/shapes/${await shapeKey(shape)}`;
```

## License

MPL-2.0. See `LICENSE`.
