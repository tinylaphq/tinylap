// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every route, in matching order. The first pattern that matches wins.
import { authRoutes } from './auth.js';
import { discoveryRoutes } from './discovery.js';
import { setupRoutes } from './setup.js';
import { workspaceRoutes } from './workspace.js';

export const routes = [
  ...authRoutes,
  ...workspaceRoutes,
  ...setupRoutes,
  ...discoveryRoutes,
];
