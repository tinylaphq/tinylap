// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Live events per workspace (spec §7): a log of the last ten minutes, so a
// reconnecting client gets what it missed, and fan-out to subscribers.
// Watchers see a redacted version of each event, or none (setup events).
// Ids are globally unique across restarts via firstId (e.g. timestamp * 1000);
// an id the log doesn't hold means "send a snapshot".

/**
 * @typedef {{ id: number, type: string, data: unknown, watcher: unknown, at: number }} LiveEvent
 * @typedef {{ id: number, type: string, data: unknown }} Sent
 * @typedef {{ watcher: boolean, tag: string | null, send: (event: Sent) => void, onClose: (() => void) | null }} Subscriber
 */

/** @param {{ now?: () => number, keepMs?: number, firstId?: number }} [options] */
export function createHub({ now = Date.now, keepMs = 600_000, firstId = Date.now() * 1000 } = {}) {
  let next = firstId;
  /** @type {Map<string, LiveEvent[]>} */
  const log = new Map();
  /** @type {Map<string, Set<Subscriber>>} */
  const subscribers = new Map();

  /** @param {string} workspaceId @param {Subscriber} sub @param {LiveEvent} event */
  const deliver = (workspaceId, sub, event) => {
    const data = sub.watcher ? event.watcher : event.data;
    if (data !== null) {
      try {
        sub.send({ id: event.id, type: event.type, data });
      } catch {
        const set = subscribers.get(workspaceId);
        if (set) set.delete(sub);
      }
    }
  };
  /** @param {string} workspaceId */
  const events = (workspaceId) => {
    const list = log.get(workspaceId) ?? [];
    const cutoff = now() - keepMs;
    while (list.length && list[0].at < cutoff) list.shift();
    log.set(workspaceId, list);
    return list;
  };

  return {
    /** @param {string} workspaceId @param {string} type @param {unknown} data @param {unknown} [watcherData] */
    publish(workspaceId, type, data, watcherData) {
      const event = { id: next++, type, data, watcher: watcherData === undefined ? data : watcherData, at: now() };
      events(workspaceId).push(event);
      for (const sub of subscribers.get(workspaceId) ?? []) deliver(workspaceId, sub, event);
    },
    /**
     * @param {string} workspaceId
     * @param {{ lastEventId: number | null, watcher: boolean, tag?: string, onClose?: () => void }} options
     * @param {(event: Sent) => void} send
     */
    subscribe(workspaceId, { lastEventId, watcher, tag, onClose }, send) {
      /** @type {Subscriber} */
      const sub = { watcher, tag: tag ?? null, send, onClose: onClose ?? null };
      /** @type {'events' | 'snapshot'} */
      let replay = 'snapshot';
      if (lastEventId !== null) {
        const list = events(workspaceId);
        const i = list.findIndex((e) => e.id === lastEventId);
        if (i !== -1) {
          replay = 'events';
          for (const event of list.slice(i + 1)) deliver(workspaceId, sub, event);
        }
      }
      const set = subscribers.get(workspaceId) ?? new Set();
      subscribers.set(workspaceId, set);
      set.add(sub);
      return {
        replay,
        unsubscribe: () => void set.delete(sub),
      };
    },
    lastId: () => next - 1,
    /** Ends every subscription tagged `tag` (a rotated watchers token). @param {string} workspaceId @param {string} tag */
    closeTagged(workspaceId, tag) {
      const set = subscribers.get(workspaceId);
      if (!set) return;
      for (const sub of [...set]) {
        if (sub.tag !== tag) continue;
        set.delete(sub);
        try {
          sub.onClose?.();
        } catch {
          // Ignore errors in onClose callbacks
        }
      }
    },
  };
}
