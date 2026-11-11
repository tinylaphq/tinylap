// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge's page (spec §6.5). Everything else the bridge does goes over
// the JSON API from tl-bridge, except the fact that a decoder is on this
// tab's cable: the stream it holds (./bridge-stream.js).
import { can } from '@tinylap/auth';
import { pageRoute } from './page-access.js';
import { page } from './respond.js';
import { spacePath } from './spaces.js';
import { bridgeImportMap, bridgePage } from './views/bridge.js';

function showBridge(request) {
  const map = bridgeImportMap(request);
  const ws = request.workspaceId;
  const cards = { connections: request.engine.connectionsOf(ws), mayPair: can(request.session.claims, ws, 'timing.setup') };
  return page(request, 200, bridgePage(request, map, request.store.choosableDecoders(ws), request.store.decoders(ws).map((d) => d.id), cards), { scriptHashes: [map.hash] });
}

export const bridgePageRoutes = [
  { pattern: spacePath('bridge'), credentials: true, methods: { GET: pageRoute('timing.run', showBridge) } },
];
