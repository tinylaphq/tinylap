// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Access to a workspace's timing (spec §9): the token's `workspaces` claim
// through can(). Not a member is 404, like a workspace that doesn't exist;
// a role that may not is 403; every write must come from the app's pages.
import { can } from '@tinylap/auth';
import { isOutage, withSession } from './auth.js';
import { problem } from './responses.js';

export const NO_STORE = { 'Cache-Control': 'no-store' };

/** Whether the viewer behind an open request may still do `action`, by the session as it is now. */
async function stillAllowed(request, workspaceId, action) {
  try {
    const session = await request.auth.bff.session(request.req);
    return Boolean(session) && can(session.claims, workspaceId, action);
  } catch (error) {
    // An outage at the issuer keeps access, as the BFF keeps the session.
    if (isOutage(error)) return true;
    throw error;
  }
}

/**
 * Calls `end` once a member stream's viewer loses `action` in the workspace
 * (#39), checking every `request.accessCheckMs`. `end` must stop everything
 * that writes before it ends the response. A watcher has no session:
 * replacing the link ends its stream. Returns the stop for the stream's close.
 * @param {any} request @param {string} workspaceId @param {import('@tinylap/auth').Action} action
 * @param {boolean} watcher @param {() => void} end
 */
export function endWhenDenied(request, workspaceId, action, watcher, end) {
  if (watcher) return () => {};
  let checking = false;
  let stopped = false;
  const check = async () => {
    if (checking || stopped) return;
    checking = true;
    try {
      if (!(await stillAllowed(request, workspaceId, action)) && !stopped) end();
    } catch (error) {
      console.error('stream: access check failed', error);
      if (!stopped) end();
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(check, request.accessCheckMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
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
