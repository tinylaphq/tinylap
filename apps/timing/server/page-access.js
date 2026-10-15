// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Access to space pages (spec §3, §9): signed out goes to sign-in and comes
// back; a club you're not in is the not-found page; a role that may not, or
// a form from another site, the forbidden page. The space you open is
// remembered for /.
import { can } from '@tinylap/auth';
import { displayName, withSession } from './auth.js';
import { page, seeOther } from './respond.js';
import { spaceFor, spacesOf } from './spaces.js';
import { forbiddenPage, notFoundPage, unavailablePage } from './views/notice.js';

export const SPACE_COOKIE = '__Host-tl-space';
const YEAR = 365 * 24 * 3600;

/** The signed-in person's name for the navbar; never fails a page. */
async function nameOf(request) {
  try {
    return await displayName(request);
  } catch {
    return null;
  }
}

/** Fills request.spaces and request.displayName for any page with a session. */
export async function withAccount(request) {
  if (!request.session) return;
  request.spaces = spacesOf(request.session.claims);
  request.displayName = await nameOf(request);
}

/** @param {any} response @param {{ base: string }} space */
function rememberSpace(response, space) {
  const cookie = `${SPACE_COOKIE}=${encodeURIComponent(space.base)}; Path=/; Max-Age=${YEAR}; HttpOnly; Secure; SameSite=Lax`;
  const prior = response.headers?.['Set-Cookie'];
  return { ...response, headers: { ...response.headers, 'Set-Cookie': [...(prior ? [].concat(prior) : []), cookie] } };
}

/**
 * @param {import('@tinylap/auth').Action} action
 * @param {(request: any, match: RegExpExecArray) => any} handler
 * @param {{ write?: boolean }} [options]
 */
export function pageRoute(action, handler, { write = false } = {}) {
  return withSession(async (request, match) => {
    const { req, url } = request;
    const refuse = (response) => {
      req.resume();
      return response;
    };
    if (!request.session) {
      return refuse(seeOther(`/auth/login?${new URLSearchParams({ returnTo: req.method === 'GET' ? url.pathname + url.search : '/' })}`));
    }
    await withAccount(request);
    const space = spaceFor(request.spaces, match[1]);
    if (match[1] && space?.kind === 'personal') return refuse(seeOther(url.pathname.replace(/^\/clubs\/[^/]+/, '/personal') + url.search));
    if (!space) return refuse(page(request, 404, notFoundPage(request)));
    request.space = space;
    if (!can(request.session.claims, space.id, action)) return refuse(page(request, 403, forbiddenPage(request)));
    if (write && !request.auth.bff.requireSameOrigin(req)) return refuse(page(request, 403, forbiddenPage(request, "Change timing from its own pages.")));
    if (!request.store) return refuse(page(request, 503, unavailablePage(request)));
    request.workspaceId = space.id;
    request.userId = request.session.userId;
    request.store.ensureWorkspace(space.id);
    return rememberSpace(await handler(request, match), space);
  });
}

/** A GET on a form's POST target (after a failed form the address bar shows it): on to the page the form is on. @param {string} path under the space */
export const toPage = (path) => pageRoute('timing.run', (request) => seeOther(`${request.space.base}/${path}`));
