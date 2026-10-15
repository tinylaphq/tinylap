// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every route, in matching order. The first pattern that matches wins.
import { authRoutes } from './auth.js';
import { controlRoutes } from './control.js';
import { discoveryRoutes } from './discovery.js';
import { ingestRoutes } from './ingest.js';
import { pageRoutes } from './page-routes.js';
import { setupRoutes } from './setup.js';
import { streamRoutes } from './stream.js';
import { workspaceRoutes } from './workspace.js';

export const routes = [
  ...authRoutes,
  ...pageRoutes,
  ...workspaceRoutes,
  ...setupRoutes,
  ...controlRoutes,
  ...ingestRoutes,
  ...streamRoutes,
  ...discoveryRoutes,
  // Anything else under the API answers a problem, not the static 404.
  { pattern: /^\/(?:workspaces|decoders|watch)(?:\/.*)?$/, credentials: true, unknown: true, methods: {} },
];
