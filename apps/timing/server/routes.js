// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every route, in matching order. The first pattern that matches wins.
import { discoveryRoutes } from './discovery.js';

export const routes = [
  ...discoveryRoutes,
];
