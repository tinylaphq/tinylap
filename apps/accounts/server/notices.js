// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Membership notices. After a membership changes, each client that registered
// a `noticeUri` is told which users it touched, so it can recheck what they
// may still do. The notice carries no claims and ends nothing by itself.
// It can carry each member's new token version (token-version.js), so the
// app can refuse tokens issued before the change without comparing clocks.
// Best effort: it is never awaited, never retried, and a failure only logs.
// A notice names at most `BATCH` users (timing's cap), so a long list is split.

const BATCH = 1000;

/**
 * @param {{ clients: { noticeUri?: string, noticeToken?: string }[], fetch?: typeof globalThis.fetch,
 *   timeoutMs?: number, logger?: { warn: (message: string) => void } }} options
 * @returns {(users: string[], versions?: Record<string, number>) => void}
 */
export function createNotifier({ clients, fetch = globalThis.fetch, timeoutMs = 5000, logger = console }) {
  const targets = clients.filter((c) => c.noticeUri);
  return (users, versions = {}) => {
    for (let from = 0; from < users.length; from += BATCH) {
      const batch = users.slice(from, from + BATCH);
      const known = Object.fromEntries(batch.filter((u) => Object.hasOwn(versions, u)).map((u) => [u, versions[u]]));
      send(batch, known);
    }
  };
  function send(users, versions) {
    for (const { noticeUri, noticeToken } of targets) {
      const uri = /** @type {string} */ (noticeUri);
      // No user ids in the log, only where the notice went and why it failed.
      const failed = (why) => logger.warn(`accounts: a membership notice to ${new URL(uri).origin} failed (${why})`);
      fetch(uri, {
        method: 'POST',
        headers: { authorization: `Bearer ${noticeToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(Object.keys(versions).length ? { users, versions } : { users }),
        signal: AbortSignal.timeout(timeoutMs),
      }).then(
        (res) => {
          res.body?.cancel().catch(() => {});
          if (!res.ok) failed(res.status);
        },
        (error) => failed(error?.name === 'TimeoutError' ? 'timeout' : error?.cause?.code ?? error?.message ?? 'error'),
      );
    }
  }
}
