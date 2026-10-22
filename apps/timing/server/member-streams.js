// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The open member streams (#39, spec §3): each checks its viewer's access
// again when the session's token refreshes, so a check sees memberships as
// accounts has them now. Sign-out ends a session's streams at once, and a
// membership notice asks a user's streams to check now.
import { can } from '@tinylap/auth';
import { isOutage } from './auth.js';

/** @typedef {{ sessionId: string | null, userId: string, check: () => Promise<void>, end: () => void }} MemberStream */
/**
 * @typedef {{
 *   watch(request: any, workspaceId: string, action: import('@tinylap/auth').Action, watcher: boolean, end: () => void): () => void,
 *   endSession(sessionId: string | null): void,
 *   recheck(userIds: string[]): void,
 * }} MemberStreams
 */

/**
 * @param {{ retryMs?: number }} [options] `retryMs`: the next check after an
 *   outage or error, and the shortest wait between checks.
 * @returns {MemberStreams}
 */
export function createMemberStreams({ retryMs = 15_000 } = {}) {
  /** @type {Set<MemberStream>} */
  const streams = new Set();
  /** After the token refreshes (refreshAt + 1 s), but never sooner than retryMs. @param {{ refreshAt: number }} session */
  const untilRefresh = (session) => Math.max(session.refreshAt + 1000 - Date.now(), retryMs);

  return {
    /**
     * Registers a member stream; it calls `end` once its viewer loses
     * `action` in the workspace. `end` must stop everything that writes
     * before it ends the response. A watcher has no session: replacing the
     * link ends its stream. Returns the stop for the stream's close.
     */
    watch(request, workspaceId, action, watcher, end) {
      if (watcher) return () => {};
      const { bff } = request.auth;
      let timer = null;
      let checking = false;
      let again = false;
      let stopped = false;
      const schedule = (ms) => {
        clearTimeout(timer);
        timer = setTimeout(check, ms);
        timer.unref();
      };
      const check = async () => {
        if (stopped) return;
        // One check at a time; a recheck during one runs right after it, with the claims as they are then.
        if (checking) {
          again = true;
          return;
        }
        checking = true;
        clearTimeout(timer);
        let wait = retryMs;
        try {
          const session = await bff.session(request.req);
          if (stopped) return;
          if (!session || !can(session.claims, workspaceId, action)) return end();
          wait = untilRefresh(session);
        } catch (error) {
          // An outage at the issuer keeps access, as the BFF keeps the session.
          if (!isOutage(error)) {
            console.error('stream: access check failed', error);
            if (!stopped) end();
          }
        } finally {
          checking = false;
        }
        if (stopped) return;
        if (again) {
          again = false;
          return check();
        }
        schedule(wait);
      };
      /** @type {MemberStream} */
      const stream = { sessionId: bff.sessionId(request.req), userId: request.userId, check, end };
      streams.add(stream);
      schedule(untilRefresh(request.session));
      return () => {
        stopped = true;
        clearTimeout(timer);
        streams.delete(stream);
      };
    },
    /** Ends every stream of the session, as sign-out does. */
    endSession(sessionId) {
      if (!sessionId) return;
      for (const stream of [...streams]) if (stream.sessionId === sessionId) stream.end();
    },
    /** Checks every stream of these users now. */
    recheck(userIds) {
      const users = new Set(userIds);
      for (const stream of [...streams]) if (users.has(stream.userId)) stream.check();
    },
  };
}
