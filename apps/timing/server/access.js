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
 * Whether `claims` may do `action` in `workspaceId`: null, or the problem to
 * refuse with. Not a member is not-found, like a workspace that doesn't
 * exist. The pages, the API and MCP all ask this.
 * @param {Pick<import('@tinylap/auth').AccessClaims, 'workspaces'>} claims @param {string} workspaceId @param {import('@tinylap/auth').Action} action
 * @returns {{ name: 'not-found' | 'forbidden', detail: string } | null}
 */
export function workspaceRefusal(claims, workspaceId, action) {
  if (!(claims.workspaces ?? []).some((w) => w.id === workspaceId)) return { name: 'not-found', detail: 'There is no such club or personal space, or you are not a member.' };
  if (!can(claims, workspaceId, action)) return { name: 'forbidden', detail: 'Your role here may not do this.' };
  return null;
}

/**
 * @param {import('@tinylap/auth').Action} action an @tinylap/auth action @param {(request: any, match: RegExpExecArray) => any} handler
 * @param {{ write?: boolean }} [options]
 */
export function workspaceRoute(action, handler, { write = false } = {}) {
  const route = withSession(async (request, match) => {
    const workspaceId = match[1];
    const refuse = (name, detail) => {
      request.req.resume();
      return problem(request, name, detail);
    };
    if (!request.session) return refuse('unauthorized', 'Sign in to use timing.');
    const { claims } = request.session;
    const refusal = workspaceRefusal(claims, workspaceId, action);
    if (refusal) return refuse(refusal.name, refusal.detail);
    if (write && !request.auth.bff.requireSameOrigin(request.req)) return refuse('forbidden', "Change timing from the app's own pages.");
    if (!request.store) return refuse('unavailable', 'Timing data cannot be read or stored right now.');
    request.workspaceId = workspaceId;
    request.userId = request.session.userId;
    request.store.ensureWorkspace(workspaceId);
    return handler(request, match);
  });
  // The permission, readable by tests that hold MCP's tools to their routes.
  return Object.assign(route, { action });
}
