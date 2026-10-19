// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/** A lap time: seconds with milliseconds, minutes past a minute. @param {number | null | undefined} ms */
export function formatLap(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 60_000) return (ms / 1000).toFixed(3);
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}:${((ms % 60_000) / 1000).toFixed(3).padStart(6, '0')}`;
}

/** A session clock: m:ss, whole seconds rounded up, never negative. @param {number} ms */
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * What a session clock shows at server time `now`, and the phase time alone decides:
 * a countdown past opensAt is running; a race or qualifying past closesAt is finishing.
 * done and aborted are never derived. opensAt/closesAt may be null.
 * @param {{ kind: string, state: string, opensAt: number | null, closesAt: number | null }} session @param {number} now
 * @returns {{ phase: string, label: string, ms: number }}
 */
export function clockAt({ kind, state, opensAt, closesAt }, now) {
  let phase = state;
  if (phase === 'countdown' && opensAt !== null && now >= opensAt) phase = 'running';
  if (phase === 'running' && kind !== 'practice' && closesAt !== null && now >= closesAt) phase = 'finishing';
  if (phase === 'countdown') return { phase, label: 'Starts in', ms: opensAt - now };
  if (kind === 'practice') return phase === 'done' || phase === 'aborted' ? { phase, label: 'Practice ended', ms: 0 } : { phase, label: 'Practice', ms: now - opensAt };
  if (phase === 'running') return { phase, label: 'Remaining', ms: Math.max(0, closesAt - now) };
  if (phase === 'finishing') return { phase, label: 'Last lap', ms: 0 };
  return { phase, label: phase === 'aborted' ? 'Aborted' : 'Finished', ms: 0 };
}

/** A session's length in words: seconds under a minute, else minutes and any seconds over. @param {number} ms */
export function formatLength(ms) {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const unit = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return [minutes ? unit(minutes, 'minute') : '', seconds || !minutes ? unit(seconds, 'second') : ''].filter(Boolean).join(' ');
}
