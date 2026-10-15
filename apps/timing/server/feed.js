// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The deletions feed (identity spec §7). accounts lists every deleted user
// and workspace in order; the timing app removes what it holds for them (a
// user's sessions; everything of a workspace) and keeps the highest seq it
// processed, so each row is handled once. Read on start and hourly.
// Processing is idempotent, so a crash between a row and the cursor only
// repeats work.
//
// A row is processed only once it is older than one access token lifetime
// plus clock skew: until then a member's token may still name a deleted
// club, and a save with it would leave rows that are never removed. The read
// stops at the first younger row; a later poll picks it up.

/**
 * @typedef {{
 *   sessions: Pick<import('@tinylap/auth').SessionStore, 'deleteUser'>,
 *   deleteWorkspaceData(workspaceId: string): void | Promise<void>,
 *   forgetUser(userId: string): void | Promise<void>,
 *   feedCursor(): number,
 *   setFeedCursor(seq: number): void,
 * }} FeedStore
 */

const KINDS = new Set(['user', 'workspace']);

/**
 * @param {{ issuer: string, token: string, store: FeedStore, intervalMs?: number, poll?: boolean,
 *   accessTtlSeconds?: number, skewSeconds?: number, now?: () => number,
 *   timeoutMs?: number, fetch?: typeof fetch, logger?: { warn(message: string): void, info?(message: string): void } }} options
 *   `poll: false` skips the read on start (tests call `poll()` themselves).
 *   `accessTtlSeconds` is accounts' access token lifetime (600 there).
 */
export function startFeed({
  issuer, token, store, intervalMs = 3_600_000, poll: pollOnStart = true, accessTtlSeconds = 600, skewSeconds = 60,
  now = Date.now, timeoutMs = 15_000, fetch: fetchImpl = fetch, logger = console,
}) {
  const base = issuer.replace(/\/$/, '');
  const holdMs = (accessTtlSeconds + skewSeconds) * 1000;
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
      /** @type {{ deletions: { seq: number, kind: string, id: string, deletedAt: string }[], next: number }} */
      const page = await res.json();
      if (!Array.isArray(page?.deletions)) throw new Error('accounts answered something that is not a deletions page');
      if (page.deletions.length === 0) return processed;
      // The whole page is checked first: every row must move past the one
      // before it, or the read would never end.
      let last = after;
      for (const row of page.deletions) {
        const seq = row?.seq;
        if (!Number.isSafeInteger(seq) || seq <= last) throw new Error(`accounts sent seq ${JSON.stringify(seq)} after ${last}`);
        if (!KINDS.has(row.kind) || typeof row.id !== 'string' || Number.isNaN(Date.parse(row.deletedAt))) throw new Error(`accounts sent a deletion it cannot read (seq ${seq})`);
        last = seq;
      }
      for (const { seq, kind, id, deletedAt } of page.deletions) {
        if (Date.parse(deletedAt) > now() - holdMs) return processed;
        if (kind === 'user') {
          await store.sessions.deleteUser(id);
          await store.forgetUser(id);
        } else await store.deleteWorkspaceData(id);
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
