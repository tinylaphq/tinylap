// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge's page (spec §6.5). Everything else the bridge does goes over
// the JSON API from tl-bridge.
import { pageRoute } from './page-access.js';
import { page } from './respond.js';
import { spacePath } from './spaces.js';
import { bridgeImportMap, bridgePage } from './views/bridge.js';

function showBridge(request) {
  const map = bridgeImportMap(request);
  return page(request, 200, bridgePage(request, map, request.store.choosableDecoders(request.workspaceId)), { scriptHashes: [map.hash] });
}

export const bridgePageRoutes = [
  { pattern: spacePath('bridge'), credentials: true, methods: { GET: pageRoute('timing.run', showBridge) } },
];
