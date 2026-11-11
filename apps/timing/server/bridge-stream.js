// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Bridge page's stream (cable presence spec §2). While a Bridge tab has a
// decoder on its cable it holds GET <space>/decoders/<id>/cable, and for as
// long as that stream is open the decoder is on a cable: the engine counts
// it, and the count drops when the connection closes, by any path. Without a
// decoder on its cable the page holds GET <space>/bridge/events, which holds
// nothing. Both send #bridge-decoders, rendered by the server, whenever it
// changes, plus a keep-alive. Each Bridge render has its own page id
// (#bridge's data-page), sent as ?page= on both: the server counts holders by
// page, and renders a page's cards without its own.
import { randomBytes } from 'node:crypto';
import { can } from '@tinylap/auth';
import { pageRoute } from './page-access.js';
import { page, seeOther } from './respond.js';
import { spacePath } from './spaces.js';
import { HEARTBEAT_MS } from './stream.js';
import { THROTTLE_MS } from './board-stream.js';
import { decoderCards } from './views/bridge.js';
import { forbiddenPage, notFoundPage } from './views/notice.js';

const PAGE_ID = /^[A-Za-z0-9_-]{16,64}$/;
/** The asking page's id, or a fresh one for a client that sent none: then the stream is its own page. @param {any} request */
const pageOf = (request) => {
  const page = request.url.searchParams.get('page');
  return page && PAGE_ID.test(page) ? page : randomBytes(12).toString('base64url');
};

const SSE = { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' };

/** Every line ending SSE knows starts a new data line, so none can start a field. @param {string} text */
const sse = (text) => `event: bridge\n${text.split(/\r\n|\r|\n/).map((line) => `data: ${line}`).join('\n')}\n\n`;

/**
 * @param {any} request @param {string | null} decoder the decoder on this tab's cable, whose stream holds it; null holds nothing
 */
function bridgeStream(request, decoder) {
  const workspaceId = request.workspaceId;
  const page = pageOf(request);
  // Fixed for the stream: losing timing.setup ends it (below), and the page reconnects to cards without Change Wi-Fi.
  const mayPair = can(request.session.claims, workspaceId, 'timing.setup');
  return {
    status: 200,
    credentials: true,
    headers: SSE,
    stream(req, res) {
      let timer = null;
      let last = 0;
      let sent = '';
      const render = () => {
        timer = null;
        if (res.writableEnded) return;
        last = Date.now();
        try {
          const cards = String(decoderCards(request, request.engine.connectionsOf(workspaceId, { page }), { mayPair }));
          // Only a change goes: most of the club's events (a lap, say) leave the cards as they are.
          if (cards === sent) return;
          sent = cards;
          res.write(sse(cards));
        } catch (error) {
          // The page reconnects and gets whatever the server answers now.
          console.error('bridge stream: render failed', error);
          res.end();
        }
      };
      const changed = () => {
        if (timer) return;
        timer = setTimeout(render, Math.max(0, THROTTLE_MS - (Date.now() - last)));
      };
      let open = true;
      let release = null;
      let sub = null;
      let beat = null;
      let stopChecks = null;
      let stopSetup = null;
      const close = () => {
        if (!open) return;
        open = false;
        clearInterval(beat);
        stopChecks?.();
        stopSetup?.();
        if (timer) clearTimeout(timer);
        sub?.unsubscribe();
        release?.();
      };
      // First, so a setup that throws, or a tab already gone, never leaves the decoder on a cable.
      res.on('close', close);
      try {
        res.write('retry: 2000\n\n');
        sub = request.hub.subscribe(workspaceId, { lastEventId: null, watcher: false }, changed);
        stopChecks = request.streams.watch(request, workspaceId, 'timing.run', false, () => {
          close();
          res.end();
        });
        // The cards show Change Wi-Fi only to members who may pair: one who no longer may gets cards without it.
        if (mayPair && open) {
          stopSetup = request.streams.watch(request, workspaceId, 'timing.setup', false, () => {
            close();
            res.end();
          });
        }
        // It ended the stream before its stops existed.
        if (!open) {
          stopChecks();
          stopSetup?.();
        }
        if (open && !res.destroyed && decoder) release = request.engine.holdCable(workspaceId, decoder, page);
        if (open) render();
        beat = setInterval(() => { if (!res.writableEnded) res.write(': beat\n\n'); }, HEARTBEAT_MS);
        beat.unref();
        if (!open) clearInterval(beat);
      } catch (error) {
        // The page reconnects and gets whatever the server answers now.
        console.error('bridge stream: setup failed', error);
        close();
        res.end();
      }
      // Gone before it started: its close came before the listener.
      if (res.destroyed) close();
    },
  };
}

/** Whether the client asks for the stream (an EventSource does); a page load on the address goes to the Bridge page. */
const wantsStream = (request) => /\btext\/event-stream\b/i.test(String(request.req.headers.accept ?? ''));

/** The stream of the decoder on this tab's cable: another club's decoder, or none, is not found. */
function cableStream(request, match) {
  if (!wantsStream(request)) return seeOther(`${request.space.base}/bridge`);
  // Holding it says this decoder is on a cable, a fact only the club's own Bridge page may state.
  if (!request.auth.bff.requireSameOrigin(request.req)) return page(request, 403, forbiddenPage(request, 'Connect decoders from the Bridge page.'));
  const decoder = request.store.decoder(match[2]);
  if (!decoder || decoder.workspaceId !== request.workspaceId) return page(request, 404, notFoundPage(request));
  return bridgeStream(request, decoder.id);
}

export const bridgeStreamRoutes = [
  { pattern: spacePath('bridge/events'), credentials: true, methods: { GET: pageRoute('timing.run', (request) => bridgeStream(request, null)) } },
  { pattern: spacePath('decoders/([^/]+)/cable'), credentials: true, methods: { GET: pageRoute('timing.run', cableStream) } },
];
