// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board's live stream for pages (spec §3, §6.1): the server renders
// #board-live and sends it whole, so the board is only ever built in one
// place. At most one render per THROTTLE_MS; the latest state wins.
import { pageRoute } from './page-access.js';
import { page } from './respond.js';
import { spacePath } from './spaces.js';
import { HEARTBEAT_MS } from './stream.js';
import { boardLive } from './views/board.js';
import { watchGonePage } from './views/notice.js';

export const THROTTLE_MS = 250;
const SSE = { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' };
const WATCH_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** Every line ending SSE knows (CR, LF, CRLF) starts a new data line, so none can start a field. @param {string} text */
const sse = (text) => `event: board\n${text.split(/\r\n|\r|\n/).map((line) => `data: ${line}`).join('\n')}\n\n`;

/** @param {any} request @param {string} workspaceId @param {{ watcher: boolean, token?: string | null }} options */
function boardStream(request, workspaceId, { watcher, token = null }) {
  // ?big (the wall screen) renders a different #board-live, so it carries into the stream.
  const big = request.url.searchParams.has('big');
  return {
    status: 200,
    credentials: true,
    headers: SSE,
    stream(req, res) {
      let timer = null;
      let last = 0;
      const render = () => {
        timer = null;
        if (res.writableEnded) return;
        last = Date.now();
        try {
          res.write(sse(String(boardLive(request, request.engine.snapshot(workspaceId, { watcher }), { watcher, big, token }))));
        } catch (error) {
          // The page reconnects and gets whatever the server answers now (the board, or a not-found page).
          console.error('board stream: render failed', error);
          res.end();
        }
      };
      const changed = () => {
        if (timer) return;
        timer = setTimeout(render, Math.max(0, THROTTLE_MS - (Date.now() - last)));
      };
      res.write('retry: 2000\n\n');
      const sub = request.hub.subscribe(workspaceId, { lastEventId: null, watcher, tag: token ?? undefined, onClose: () => res.end() }, changed);
      render();
      const beat = setInterval(() => res.write(': beat\n\n'), HEARTBEAT_MS);
      beat.unref();
      const close = () => {
        clearInterval(beat);
        stopChecks();
        if (timer) clearTimeout(timer);
        sub.unsubscribe();
      };
      const stopChecks = request.streams.watch(request, workspaceId, 'timing.run', watcher, () => {
        close();
        res.end();
      });
      res.on('close', close);
    },
  };
}

// Like the JSON /watch/<token>/live: no session, no account, only the token.
const watchEvents = (request, [, token]) => {
  const workspaceId = WATCH_TOKEN.test(token) && request.store ? request.store.workspaceByWatchToken(token) : null;
  return workspaceId ? boardStream(request, workspaceId, { watcher: true, token }) : page(request, 404, watchGonePage(request));
};

export const boardStreamRoutes = [
  { pattern: spacePath('board/events'), credentials: true, methods: { GET: pageRoute('timing.run', (request) => boardStream(request, request.workspaceId, { watcher: false })) } },
  { pattern: /^\/watch\/([^/]+)\/events$/, credentials: true, methods: { GET: watchEvents } },
];
