// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Membership notices. After a membership changes, each client that registered
// a `noticeUri` is told which users it touched, so it can recheck what they
// may still do. The notice carries no claims and ends nothing by itself.
// Best effort: it is never awaited, never retried, and a failure only logs.

/**
 * @param {{ clients: { noticeUri?: string, noticeToken?: string }[], fetch?: typeof globalThis.fetch,
 *   timeoutMs?: number, logger?: { warn: (message: string) => void } }} options
 * @returns {(users: string[]) => void}
 */
export function createNotifier({ clients, fetch = globalThis.fetch, timeoutMs = 5000, logger = console }) {
  const targets = clients.filter((c) => c.noticeUri);
  return (users) => {
    if (users.length === 0) return;
    for (const { noticeUri, noticeToken } of targets) {
      const uri = /** @type {string} */ (noticeUri);
      // No user ids in the log, only where the notice went and why it failed.
      const failed = (why) => logger.warn(`accounts: a membership notice to ${new URL(uri).origin} failed (${why})`);
      fetch(uri, {
        method: 'POST',
        headers: { authorization: `Bearer ${noticeToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ users }),
        signal: AbortSignal.timeout(timeoutMs),
      }).then(
        (res) => {
          res.body?.cancel().catch(() => {});
          if (!res.ok) failed(res.status);
        },
        (error) => failed(error?.name === 'TimeoutError' ? 'timeout' : error?.cause?.code ?? error?.message ?? 'error'),
      );
    }
  };
}
