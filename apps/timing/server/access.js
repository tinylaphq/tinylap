// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Access to a workspace's timing (spec §9): the token's `workspaces` claim
// through can(). Not a member is 404, like a workspace that doesn't exist;
// a role that may not is 403; every write must come from the app's pages.
import { can } from '@tinylap/auth';
import { withSession } from './auth.js';
import { problem } from './responses.js';

export const NO_STORE = { 'Cache-Control': 'no-store' };

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
    if (!request.session) return refuse('unauthorized', 'Log in to use timing.');
    const { claims } = request.session;
    if (!(claims.workspaces ?? []).some((w) => w.id === workspaceId)) return refuse('not-found', 'There is no such workspace, or you are not a member.');
    if (!can(claims, workspaceId, action)) return refuse('forbidden', 'Your role in this workspace may not do this.');
    if (write && !request.auth.bff.requireSameOrigin(request.req)) return refuse('forbidden', "Change timing from the app's own pages.");
    if (!request.store) return refuse('unavailable', 'Timing data cannot be read or stored right now.');
    request.workspaceId = workspaceId;
    request.userId = request.session.userId;
    request.store.ensureWorkspace(workspaceId);
    return handler(request, match);
  });
}
