// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge's page (spec §6.5). Everything else the bridge does goes over
// the JSON API from tl-bridge, except the fact that this tab's cable to a
// decoder closed: a form post, answered with the Bridge page.
import { can } from '@tinylap/auth';
import { readForm } from './form.js';
import { pageRoute, toPage } from './page-access.js';
import { page, seeOther } from './respond.js';
import { problem } from './responses.js';
import { spacePath } from './spaces.js';
import { bridgeImportMap, bridgePage } from './views/bridge.js';
import { notFoundPage } from './views/notice.js';

function showBridge(request) {
  const map = bridgeImportMap(request);
  const ws = request.workspaceId;
  const cards = { connections: request.engine.connectionsOf(ws), mayPair: can(request.session.claims, ws, 'timing.setup') };
  return page(request, 200, bridgePage(request, map, request.store.choosableDecoders(ws), request.store.decoders(ws).map((d) => d.id), cards), { scriptHashes: [map.hash] });
}

/** The bridge's cable to a decoder closed (connections spec §3): the server stops saying it is on a cable now. */
async function closeCable(request, match) {
  const { form, error } = await readForm(request);
  if (error) return error;
  const decoder = request.store.decoder(match[2]);
  if (!decoder || decoder.workspaceId !== request.workspaceId) return page(request, 404, notFoundPage(request));
  if (form.get('state') !== 'closed') return problem(request, 'invalid-request', 'Send state=closed: the only thing a bridge says of its cable.');
  request.engine.cableClosed(request.workspaceId, decoder.id);
  return seeOther(`${request.space.base}/bridge`);
}

export const bridgePageRoutes = [
  { pattern: spacePath('bridge'), credentials: true, methods: { GET: pageRoute('timing.run', showBridge) } },
  { pattern: spacePath('decoders/([^/]+)/cable'), credentials: true, methods: { GET: toPage('bridge'), POST: pageRoute('timing.run', closeCable, { write: true }) } },
];
