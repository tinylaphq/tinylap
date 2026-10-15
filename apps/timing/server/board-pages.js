// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board page (spec §6.1). Live updates come from Task 10's stream.
import { pageRoute } from './page-access.js';
import { page } from './respond.js';
import { spacePath } from './spaces.js';
import { boardPage } from './views/board.js';

const showBoard = (request) => page(request, 200, boardPage(request, request.engine.snapshot(request.workspaceId), { big: request.url.searchParams.has('big') }));

export const boardPageRoutes = [
  { pattern: spacePath('board'), credentials: true, methods: { GET: pageRoute('timing.run', showBoard) } },
];
