// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The live stream. EventSource reconnects by itself and sends Last-Event-ID,
// so the server replays what was missed (spec §7).
const TYPES = ['snapshot', 'session', 'crossing', 'standings', 'results', 'drivers', 'track', 'setup'];

/** @param {string} url @param {(type: string, data: any) => void} onEvent @param {(status: 'live' | 'reconnecting' | 'closed') => void} onStatus */
export function connect(url, onEvent, onStatus) {
  const source = new EventSource(url);
  for (const type of TYPES) source.addEventListener(type, (event) => onEvent(type, JSON.parse(/** @type {MessageEvent} */ (event).data)));
  source.addEventListener('open', () => onStatus('live'));
  source.addEventListener('error', () => onStatus(source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting'));
  return () => source.close();
}
