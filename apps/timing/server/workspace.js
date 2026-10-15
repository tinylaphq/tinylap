// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// GET /workspaces/{id}: everything a screen needs to draw the board now.
import { NO_STORE, workspaceRoute } from './access.js';
import { json } from './responses.js';

export const workspaceRoutes = [
  {
    pattern: /^\/workspaces\/([^/]+)$/,
    credentials: true,
    methods: { GET: workspaceRoute('timing.run', (request) => json(200, request.engine.snapshot(request.workspaceId), NO_STORE)) },
  },
];
