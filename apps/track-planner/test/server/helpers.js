// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLayout, assignTrack, stockL } from '@tinylap/track-format';
import { createHandler } from '../../server/app.js';
import { openStore } from '../../server/store.js';

export const appDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Starts the real server on a random port. Pass `store: null` for an unavailable database. */
export async function startServer(options = {}) {
  const store = 'store' in options ? options.store : openStore(':memory:');
  const server = createServer(createHandler({ appDir, log: false, ...options, store }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    store,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}

export const closedLayout = () => assignTrack(createLayout({ pieces: stockL() }));
export const openLayout = () => createLayout({ pieces: [{ type: 'straight', x: 0, y: 0, rot: 0 }] });
