// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// What the board and the Sessions tab share (records spec §4.2, §5.3): the
// marks after a lap time, a driver's name with the record holder's crown,
// and the line that says a car is on the track with no session running.
import { html } from './html.js';

/** A mark: its letters for the eye, its full name for a screen reader, which mostly skips an abbr's title. */
const mark = (kind, letters, name) => html`<abbr class="mark mark-${kind}" title="${name}" aria-hidden="true">${letters}</abbr><span class="visually-hidden">${name}</span>`;

/**
 * The mark of a lap time, in a narrow column of its own after the time's, so
 * the time keeps its column's edge whether a mark follows it or not. One mark
 * at most, the widest that is true: TR (the track's), then SB (the session's
 * fastest lap), then PB (the driver's own). `note` is read after it. In a
 * list, the cell is a span.
 * @param {{ lapMs: number | null | undefined, isRecord: boolean, isSessionBest?: boolean, isPb: boolean }} lap
 * @param {{ note?: any, list?: boolean }} [options]
 */
export function marks({ lapMs, isRecord, isSessionBest = false, isPb }, { note = null, list = false } = {}) {
  const has = lapMs !== null && lapMs !== undefined;
  const shown = !has ? null
    : isRecord ? mark('tr', 'TR', 'Track record')
      : isSessionBest ? mark('sb', 'SB', 'Session best')
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

/** The position column's header: "Pos" is wider than a digit, so only a screen reader gets its name. */
export const posHead = html`<th scope="col"><span class="visually-hidden">Position</span></th>`;

/**
 * Classes that size a standings table's position column (app.css), as
 * timeWidths does its times: two digits from ten rows on, and room for the
 * finish flag where a table shows flags (a race on the board). Leading space included.
 * @param {{ positions: number, flags?: boolean }} table
 */
export function tableClasses({ positions, flags = false }) {
  return `${positions >= 10 ? ' has-two-digit-pos' : ''}${flags ? ' has-flags' : ''}`;
}

/**
 * The crown: the record holder's, after their name in standings. Flat, in the
 * warning colour with a mark's outline, as tall as a mark (app.css).
 */
const crownMark = html`<svg class="crown" viewBox="0 0 26 18" role="img" aria-label="Track record holder"><title>Track record holder</title><path d="M1.125 16.875V4.5l6.5 5.5L13 1.6l5.375 8.4 6.5-5.5v12.475Z"/></svg>`;

/**
 * A driver's name with their colour, or what is left of one. In standings
 * the record holder's crown follows the name, as far after it as a mark sits
 * after its time. In a table or list the name keeps one line and ends in an
 * ellipsis when the column is too narrow (app.css), before the crown, so the
 * crown always shows; its full text stays in the page, for screen readers,
 * and in its title, for hover.
 * @param {{ id: string, name: string, colour?: string }[]} drivers @param {string | null} id
 * @param {{ holder?: boolean }} [options]
 */
export function chip(drivers, id, { holder = false } = {}) {
  const d = drivers.find((x) => x.id === id);
  const name = d ? d.name : id ? 'Former driver' : 'Unknown car';
  return html`<span class="driver"${d ? html` style="--driver: ${d.colour}"` : null}><span class="driver-name" title="${name}">${name}</span>${holder ? crownMark : null}</span>`;
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
 * "Transponder 23 is on the track": a live line, not a warning, while a car crosses
 * with no session running (named tracks spec §4); for members only, from the
 * snapshot's `idle`. A car with a driver says who: "Ana is on the track".
 * @param {{ transponder: string, driverId: string | null } | null} idle
 * @param {{ id: string, name: string, colour?: string }[]} drivers
 */
export function idleNotice(idle, drivers) {
  if (!idle) return null;
  const who = idle.driverId && drivers.some((d) => d.id === idle.driverId) ? chip(drivers, idle.driverId) : html`Transponder ${idle.transponder}`;
  return html`<p class="board-on-track" role="status"><span>${who} is on the track</span></p>`;
}
