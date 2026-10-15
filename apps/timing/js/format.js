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
