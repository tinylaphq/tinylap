// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Server-Sent Events (spec §7) for members and for the watchers view. A
// stream starts with what the client missed (Last-Event-ID) or a snapshot.
// Watcher streams are tagged with their token, so rotating it ends them.
import { NO_STORE, workspaceRoute } from './access.js';
import { json, problem } from './responses.js';

export const HEARTBEAT_MS = 15_000;
const SSE_HEADERS = { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' };
const WATCH_TOKEN = /^[A-Za-z0-9_-]{22}$/;

const lastEventIdOf = (req) => {
  const value = req.headers['last-event-id'];
  return typeof value === 'string' && /^\d{1,16}$/.test(value) ? Number(value) : null;
};

/** @param {any} request @param {string} workspaceId @param {{ watcher: boolean, tag?: string }} options */
function eventStream(request, workspaceId, { watcher, tag }) {
  return {
    status: 200,
    headers: SSE_HEADERS,
    stream(req, res) {
      const write = ({ id, type, data }) => res.write(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      res.write('retry: 2000\n\n');
      const sub = request.hub.subscribe(workspaceId, { lastEventId: lastEventIdOf(req), watcher, tag, onClose: () => res.end() }, write);
      if (sub.replay === 'snapshot') write({ id: request.hub.lastId(), type: 'snapshot', data: request.engine.snapshot(workspaceId, { watcher }) });
      const beat = setInterval(() => res.write(': beat\n\n'), HEARTBEAT_MS);
      beat.unref();
      res.on('close', () => {
        clearInterval(beat);
        sub.unsubscribe();
      });
    },
  };
}

const watched = (request, token) => (WATCH_TOKEN.test(token) && request.store ? request.store.workspaceByWatchToken(token) : null);
const noWatch = (request) => problem(request, 'not-found', 'There is no such watchers link; ask for a new one.');

export const streamRoutes = [
  {
    pattern: /^\/workspaces\/([^/]+)\/live$/,
    credentials: true,
    methods: { GET: workspaceRoute('timing.run', (request) => eventStream(request, request.workspaceId, { watcher: false })) },
  },
  {
    pattern: /^\/watch\/([^/]+)$/,
    methods: {
      GET: (request, [, token]) => {
        const workspaceId = watched(request, token);
        return workspaceId ? json(200, request.engine.snapshot(workspaceId, { watcher: true }), NO_STORE) : noWatch(request);
      },
    },
  },
  {
    pattern: /^\/watch\/([^/]+)\/live$/,
    methods: {
      GET: (request, [, token]) => {
        const workspaceId = watched(request, token);
        return workspaceId ? eventStream(request, workspaceId, { watcher: true, tag: token }) : noWatch(request);
      },
    },
  },
];
