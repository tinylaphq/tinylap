// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer } from 'node:http';
import { assignTrack, canonicalJson, createLayout, stockL } from '@tinylap/track-format';

export const CLOSED = 'A'.repeat(22);
export const OPEN = 'B'.repeat(22);
/** The closed layout shared again: the same planner track, a new snapshot. */
export const AGAIN = 'E'.repeat(22);
/** Another closed circuit: a different planner track. */
export const OTHER = 'F'.repeat(22);
export const closed = assignTrack(createLayout({ pieces: stockL() }));
export const other = assignTrack(createLayout({ pieces: stockL() }));

/** A pretend planner serving closed layouts (one shared twice) and one open layout. */
export async function startPlannerStub() {
  const layouts = { [CLOSED]: canonicalJson(closed), [AGAIN]: canonicalJson(closed), [OTHER]: canonicalJson(other), [OPEN]: canonicalJson(createLayout({ pieces: [{ type: 'straight', x: 0, y: 0, rot: 0 }] })) };
  const server = createServer((req, res) => {
    const key = /^\/layouts\/([^/]+)$/.exec(req.url ?? '')?.[1];
    if (req.headers.accept !== 'application/json' || !key || !layouts[key]) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end(layouts[key]);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done) => server.close(done)) };
}
