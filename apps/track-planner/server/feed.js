// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The deletions feed (identity spec §7). accounts lists every deleted user
// and workspace in order; the planner removes what it holds for them (a
// user's sessions, and their name on what they saved in the library; a
// workspace's library) and
// keeps the highest seq it processed, so each row is handled once. Read on
// start and hourly. Processing is idempotent, so a crash between a row and
// the cursor only repeats work.

/**
 * @typedef {{
 *   sessions: Pick<import('@tinylap/auth').SessionStore, 'deleteUser'>,
 *   deleteWorkspaceData(workspaceId: string): void | Promise<void>,
 *   forgetUser(userId: string): void | Promise<void>,
 *   feedCursor(): number,
 *   setFeedCursor(seq: number): void,
 * }} FeedStore
 */

/**
 * @param {{ issuer: string, token: string, store: FeedStore, intervalMs?: number, poll?: boolean,
 *   timeoutMs?: number, fetch?: typeof fetch, logger?: { warn(message: string): void, info?(message: string): void } }} options
 *   `poll: false` skips the read on start (tests call `poll()` themselves).
 */
export function startFeed({ issuer, token, store, intervalMs = 3_600_000, poll: pollOnStart = true, timeoutMs = 15_000, fetch: fetchImpl = fetch, logger = console }) {
  const base = issuer.replace(/\/$/, '');
  let failing = false;
  /** @type {Promise<{ processed: number, error?: Error }> | null} */
  let running = null;

  async function readAll() {
    let processed = 0;
    for (;;) {
      const after = store.feedCursor();
      const res = await fetchImpl(`${base}/deletions?after=${after}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`accounts answered ${res.status}`);
      /** @type {{ deletions: { seq: number, kind: string, id: string }[], next: number }} */
      const page = await res.json();
      if (!Array.isArray(page?.deletions)) throw new Error('accounts answered something that is not a deletions page');
      if (page.deletions.length === 0) return processed;
      for (const { seq, kind, id } of page.deletions) {
        if (kind === 'user') {
          await store.sessions.deleteUser(id);
          await store.forgetUser(id);
        } else if (kind === 'workspace') await store.deleteWorkspaceData(id);
        store.setFeedCursor(seq);
        processed += 1;
      }
    }
  }

  /** Reads everything new. Never throws: a failure is logged once per streak, and the next interval retries. */
  function poll() {
    // One read at a time; a caller during a read shares it.
    running ??= readAll().then(
      (processed) => {
        if (failing) logger.info?.('deletions feed: reading again');
        failing = false;
        return { processed };
      },
      (/** @type {Error} */ error) => {
        if (!failing) logger.warn(`deletions feed: can't read it, retrying in ${Math.round(intervalMs / 60_000)} min: ${error.message}`);
        failing = true;
        return { processed: 0, error };
      },
    ).finally(() => {
      running = null;
    });
    return running;
  }

  const timer = setInterval(poll, intervalMs);
  timer.unref();
  if (pollOnStart) void poll();

  return {
    poll,
    stop() {
      clearInterval(timer);
    },
  };
}
