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

/** How long ago, for the people looking at a page: no time zone to get wrong. @param {number} ms @param {number} now */
export function formatAgo(ms, now) {
  const minutes = Math.floor((now - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** A session's length in words: seconds under a minute, else minutes and any seconds over. @param {number} ms */
export function formatLength(ms) {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const unit = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return [minutes ? unit(minutes, 'minute') : '', seconds || !minutes ? unit(seconds, 'second') : ''].filter(Boolean).join(' ');
}
