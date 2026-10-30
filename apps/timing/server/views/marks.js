// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// What the board and the Sessions tab share (records spec §4.2, §5.3): the
// marks after a lap time, the crown beside the record holder, a driver's
// name, and the line that says a car is on the track with no session running.
import { html } from './html.js';

/** A mark: its letters for the eye, its full name for a screen reader, which mostly skips an abbr's title. */
const mark = (kind, letters, name) => html`<abbr class="mark mark-${kind}" title="${name}" aria-hidden="true">${letters}</abbr><span class="visually-hidden">${name}</span>`;

/**
 * The mark of a lap time, in a narrow column of its own after the time's, so
 * the time keeps its column's edge whether a mark follows it or not. A record
 * lap is its driver's best too: it shows TR alone. `note` is read after it,
 * such as "Session best". In a list, the cell is a span.
 * @param {{ lapMs: number | null | undefined, isRecord: boolean, isPb: boolean }} lap
 * @param {{ note?: any, list?: boolean }} [options]
 */
export function marks({ lapMs, isRecord, isPb }, { note = null, list = false } = {}) {
  const has = lapMs !== null && lapMs !== undefined;
  const shown = !has ? null
    : isRecord ? mark('tr', 'TR', 'Track record')
      : isPb ? mark('pb', 'PB', 'Personal best') : null;
  return list ? html`<span class="mark-cell">${shown}${note}</span>` : html`<td class="mark-cell">${shown}${note}</td>`;
}

/**
 * Classes that widen a table's or list's time columns to the longest time it
 * holds (app.css): a lap of a minute ("1:00.000", as long as a lap can be), a
 * race's total of ten minutes or more ("14:05.123"). Most times are shorter,
 * and the columns stay narrow for them. Leading space included.
 * @param {(number | null | undefined)[]} laps @param {(number | null | undefined)[]} [totals]
 */
export function timeWidths(laps, totals = []) {
  const long = (limit) => (/** @type {number | null | undefined} */ ms) => ms !== null && ms !== undefined && ms >= limit;
  return `${laps.some(long(60_000)) ? ' has-minute-laps' : ''}${totals.some(long(600_000)) ? ' has-long-totals' : ''}`;
}

/** The marks column's header: no word on screen, its name for a screen reader. */
export const marksHead = html`<th scope="col" class="mark-cell"><span class="visually-hidden">Mark</span></th>`;

/**
 * The crown after the record holder's name, on every leaderboard of the
 * record's track and direction. A word joiner glues it to the name, so a long
 * name wraps with it rather than leaving it alone on a line.
 * @param {boolean} isHolder
 */
export const crown = (isHolder) => (isHolder
  ? html`&#8288;<span class="crown" role="img" aria-label="Track record holder" title="Track record holder">👑</span>`
  : null);

/** A driver's name with their colour, or what is left of one. @param {{ id: string, name: string, colour?: string }[]} drivers @param {string | null} id */
export function chip(drivers, id) {
  const d = drivers.find((x) => x.id === id);
  if (!d) return html`<span class="driver">${id ? 'Former driver' : 'Unknown car'}</span>`;
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
 * "Car 23 is on the track": a live line, not a warning, while a car crosses
 * with no session running (named tracks spec §4); for members only, from the
 * snapshot's `idle`. A car with a driver says who: "Ana is on the track".
 * @param {{ transponder: string, driverId: string | null } | null} idle
 * @param {{ id: string, name: string, colour?: string }[]} drivers
 */
export function idleNotice(idle, drivers) {
  if (!idle) return null;
  const who = idle.driverId && drivers.some((d) => d.id === idle.driverId) ? chip(drivers, idle.driverId) : html`Car ${idle.transponder}`;
  return html`<p class="board-on-track" role="status"><span>${who} is on the track</span></p>`;
}
