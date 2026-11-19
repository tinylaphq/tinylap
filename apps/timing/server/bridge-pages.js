// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge's page (spec §6.5). Everything else the bridge does goes over
// the JSON API from tl-bridge, except the fact that a decoder is on this
// tab's cable: the stream it holds (./bridge-stream.js).
import { can } from '@tinylap/auth';
import { PAGE_ID } from './bridge-stream.js';
import { pageRoute } from './page-access.js';
import { page } from './respond.js';
import { spacePath } from './spaces.js';
import { bridgeImportMap, bridgePage } from './views/bridge.js';

const LEAVING = /(?:^|;\s*)tl-bridge-leaving=([^;]*)/;

/**
 * A reload: the Bridge page that is leaving wrote its page id in tl-bridge-leaving as it went, so this render counts
 * its cable as its own (the old page's stream closes only once this answer has come), and says so as data-after.
 * The cookie is read once, so a reload that was cancelled leaves it to one render at most.
 */
function showBridge(request) {
  const map = bridgeImportMap(request);
  const ws = request.workspaceId;
  const raw = LEAVING.exec(String(request.req.headers.cookie ?? ''))?.[1];
  const after = raw && PAGE_ID.test(raw) ? raw : null;
  const cards = { connections: request.engine.connectionsOf(ws, { pages: after ? [after] : [] }), mayPair: can(request.session.claims, ws, 'timing.setup'), after };
  const headers = raw === undefined ? {} : { 'Set-Cookie': `tl-bridge-leaving=; Path=${request.space.base}/bridge; Max-Age=0; Secure; SameSite=Strict` };
  return page(request, 200, bridgePage(request, map, request.store.choosableDecoders(ws), request.store.decoders(ws).map((d) => d.id), cards), { scriptHashes: [map.hash], headers });
}

export const bridgePageRoutes = [
  { pattern: spacePath('bridge'), credentials: true, methods: { GET: pageRoute('timing.run', showBridge) } },
];
