// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every page and form route (spec §3). Feature tasks add their routes to
// SCREEN_ROUTES; the catch-all stays last.
import { withSession } from './auth.js';
import { SPACE_COOKIE, pageRoute, withAccount } from './page-access.js';
import { racePageRoutes } from './race-pages.js';
import { page, seeOther } from './respond.js';
import { setupPageRoutes } from './setup-pages.js';
import { spacesOf } from './spaces.js';
import { tapPageRoutes } from './tap-pages.js';
import { notFoundPage, startPage } from './views/notice.js';

const COOKIE = new RegExp(`(?:^|;\\s*)${SPACE_COOKIE}=([^;]+)`);

/** The cookie's space, if it is still one of yours. */
function lastSpace(request) {
  const raw = COOKIE.exec(String(request.req.headers.cookie ?? ''))?.[1];
  const base = raw ? decodeURIComponent(raw) : null;
  const spaces = spacesOf(request.session.claims);
  return spaces.find((s) => s.base === base) ?? spaces.find((s) => s.kind === 'personal') ?? spaces[0] ?? null;
}

const home = withSession(async (request) => {
  if (!request.session) return page(request, 200, startPage(request));
  const space = lastSpace(request);
  if (!space) {
    await withAccount(request);
    return page(request, 404, notFoundPage(request));
  }
  return seeOther(`${space.base}/board`);
});

/** @type {any[]} Feature tasks add their page and form routes here. */
export const SCREEN_ROUTES = [...setupPageRoutes, ...racePageRoutes, ...tapPageRoutes];

export const pageRoutes = [
  { pattern: /^\/$/, credentials: true, methods: { GET: home } },
  { pattern: /^\/(?:personal|clubs\/([^/]+))\/?$/, credentials: true, methods: { GET: pageRoute('timing.run', (request) => seeOther(`${request.space.base}/board`)) } },
  ...SCREEN_ROUTES,
  // Any other space path: the not-found page, after the access checks.
  { pattern: /^\/(?:personal|clubs\/([^/]+))\/.*$/, credentials: true, methods: { GET: pageRoute('timing.run', (request) => page(request, 404, notFoundPage(request))) } },
];
