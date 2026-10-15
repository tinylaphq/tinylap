// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../../server/app.js';

export const appDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Starts the handler on a random port, without log-in. */
export async function startServer(options = {}) {
  const server = createServer(createHandler({ appDir, log: false, ...options }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }),
  };
}
