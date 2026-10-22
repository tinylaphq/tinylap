// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Access to a workspace's timing (spec §9): the token's `workspaces` claim
// through can(). Not a member is 404, like a workspace that doesn't exist;
// a role that may not is 403; every write must come from the app's pages.
import { AuthError, can } from '@tinylap/auth';
import { withSession } from './auth.js';
import { problem } from './responses.js';

export const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Whether the viewer behind an open request may still do `action` in the
 * workspace, by the session as it is now (#39). An outage at the issuer
 * keeps access, as the BFF keeps the session.
 * @param {any} request @param {string} workspaceId @param {import('@tinylap/auth').Action} action
 */
export async function stillAllowed(request, workspaceId, action) {
  try {
    const session = await request.auth.bff.session(request.req);
    return Boolean(session) && can(session.claims, workspaceId, action);
  } catch (error) {
    if (error instanceof AuthError && error.code === 'unavailable') return true;
    throw error;
  }
}

/**
 * Ends `res` once its viewer loses `action` in the workspace, checking every
 * `request.accessCheckMs`. Returns the stop for the stream's close.
 * @param {any} request @param {any} res @param {string} workspaceId @param {import('@tinylap/auth').Action} action
 */
export function endWhenDenied(request, res, workspaceId, action) {
  let checking = false;
  const check = async () => {
    if (checking || res.writableEnded) return;
    checking = true;
    try {
      if (!(await stillAllowed(request, workspaceId, action))) res.end();
    } catch (error) {
      console.error('stream: access check failed', error);
      res.end();
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(check, request.accessCheckMs);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * @param {import('@tinylap/auth').Action} action an @tinylap/auth action @param {(request: any, match: RegExpExecArray) => any} handler
 * @param {{ write?: boolean }} [options]
 */
export function workspaceRoute(action, handler, { write = false } = {}) {
  return withSession(async (request, match) => {
    const workspaceId = match[1];
    const refuse = (name, detail) => {
      request.req.resume();
      return problem(request, name, detail);
    };
    if (!request.session) return refuse('unauthorized', 'Sign in to use timing.');
    const { claims } = request.session;
    if (!(claims.workspaces ?? []).some((w) => w.id === workspaceId)) return refuse('not-found', 'There is no such club or personal space, or you are not a member.');
    if (!can(claims, workspaceId, action)) return refuse('forbidden', 'Your role here may not do this.');
    if (write && !request.auth.bff.requireSameOrigin(request.req)) return refuse('forbidden', "Change timing from the app's own pages.");
    if (!request.store) return refuse('unavailable', 'Timing data cannot be read or stored right now.');
    request.workspaceId = workspaceId;
    request.userId = request.session.userId;
    request.store.ensureWorkspace(workspaceId);
    return handler(request, match);
  });
}
