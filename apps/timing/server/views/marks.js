// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// What the board and the Sessions tab share (records spec §4.2, §5.3): the
// marks after a lap time, the crown beside the record holder, a driver's
// name, and the notice of a car crossing the line with no session running.
import { html } from './html.js';

/** A mark: its letters for the eye, its full name for a screen reader, which mostly skips an abbr's title. */
const mark = (kind, letters, name) => html`<abbr class="mark mark-${kind}" title="${name}" aria-hidden="true">${letters}</abbr><span class="visually-hidden">${name}</span>`;

/**
 * The marks after a lap time, in a slot of its own width whether it holds one
 * or not, so times stay aligned in their column. A record lap is its driver's
 * best too: it shows TR alone.
 * @param {{ lapMs: number | null | undefined, isRecord: boolean, isPb: boolean }} lap
 */
export function marks({ lapMs, isRecord, isPb }) {
  const has = lapMs !== null && lapMs !== undefined;
  const shown = !has ? null
    : isRecord ? mark('tr', 'TR', 'Track record')
      : isPb ? mark('pb', 'PB', 'Personal best') : null;
  return html`<span class="marks">${shown}</span>`;
}

/** The crown after the record holder's name, on every leaderboard of the record's track and direction. @param {boolean} isHolder */
export const crown = (isHolder) => (isHolder
  ? html`<span class="crown" role="img" aria-label="Track record holder" title="Track record holder">👑</span>`
  : null);

/** A driver's name with their colour, or what is left of one. @param {{ id: string, name: string, colour?: string }[]} drivers @param {string | null} id */
export function chip(drivers, id) {
  const d = drivers.find((x) => x.id === id);
  if (!d) return html`<span class="driver">${id ? 'former driver' : 'unknown car'}</span>`;
  return html`<span class="driver" style="--driver: ${d.colour}">${d.name}</span>`;
}

/** Starts a practice: one button, no settings; from the Tap page, it leads back there. @param {any} request @param {{ from?: 'tap' }} [options] */
export function startPracticeForm(request, { from } = {}) {
  return html`<form method="post" action="${request.space.base}/sessions" class="start-practice">
  <input type="hidden" name="kind" value="practice">
  ${from === 'tap' ? html`<input type="hidden" name="from" value="tap">
  ` : null}<button type="submit" class="btn btn-primary">Start practice</button>
</form>`;
}

/**
 * "A car crossed the line (21, Haris). No session is running.", with Start
 * practice; for members only, from the snapshot's `idle`.
 * @param {any} request @param {{ transponder: string, driverId: string | null } | null} idle @param {{ id: string, name: string }[]} drivers
 */
export function idleNotice(request, idle, drivers) {
  if (!idle) return null;
  const name = idle.driverId ? drivers.find((d) => d.id === idle.driverId)?.name : null;
  return html`<div class="status status-warning flag idle-notice" role="status">
  <p>A car crossed the line (${idle.transponder}${name ? `, ${name}` : ''}). No session is running.</p>
  ${startPracticeForm(request)}
</div>`;
}
