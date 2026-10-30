// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The record history of the track and direction (records spec §5.2): who
// held it, with what lap, from when to when. The Sessions tab shows the five
// latest; …/records all of them.
import { localTime } from '@tinylap/design/html/local-time.js';
import { formatLap } from '../../public/format.js';
import { html, safe } from './html.js';
import { layout } from './layout.js';
import { chip, crown, timeWidths } from './marks.js';

export const DIRECTION = { cw: 'clockwise', ccw: 'anticlockwise' };

/** "Office loop, clockwise", or "Deleted track" once it is gone (named tracks spec §3.5). @param {{ name: string } | null} track @param {string} direction */
export const trackName = (track, direction) => (track ? `${track.name}, ${DIRECTION[direction]}` : 'Deleted track');

/** A layout by when it was attached, to the minute and with the year, linking to it on its track's page; nothing without one. */
const layoutLink = (entry, href) => entry ? html`<a href="${href}#layout-${entry.attachedAt}">${safe(localTime(entry.attachedAt, 'datetime-year'))}</a>` : null;

/**
 * Newest first. The columns have fixed widths (app.css), so the tables of a
 * track's two directions line up. A row held the record until the row before it took it; the
 * first is the record now, its holder crowned. With `layoutOf`, a column names
 * the layout each was driven on, linking to it under `layouts`. `dates` is the
 * format of the Set and Held until times. On a phone Held until and Layout
 * go: Held until is the Set of the row above, and the dates stay one line.
 * @param {any} request
 * @param {{ track: any, rows: { driverId: string, lapMs: number, at: number, sessionId: string }[], drivers: any[],
 *   layoutOf?: ((at: number) => { attachedAt: number } | null) | null, layouts?: string,
 *   dates?: 'datetime' | 'datetime-year' }} model
 */
export function recordsTable(request, { track, rows, drivers, layoutOf = null, layouts = '', dates = 'datetime' }) {
  const base = request.space.base;
  if (!track) return html`<p class="empty">Set the track in <a href="${base}/setup#track">Setup</a> to keep its record.</p>`;
  if (rows.length === 0) return html`<p class="empty">No record yet.</p>`;
  return html`<div class="board-scroll"><table class="board-table records-table${dates === 'datetime-year' || layoutOf ? ' is-wide' : ''}${timeWidths(rows.map((r) => r.lapMs))}">
  <colgroup><col class="col-time"><col>${dates === 'datetime-year' ? html`<col class="col-date is-year"><col class="col-date is-year records-wide">` : html`<col class="col-date"><col class="col-date records-wide">`}${layoutOf ? html`<col class="col-date is-year records-wide">` : null}</colgroup>
  <thead><tr><th scope="col" class="num">Lap</th><th scope="col">Driver</th><th scope="col">Set</th><th scope="col" class="records-wide">Held until</th>${layoutOf ? html`<th scope="col" class="records-wide">Layout</th>` : null}</tr></thead>
  <tbody>${rows.map((r, i) => html`<tr${i === 0 ? html` class="is-current"` : null}>
    <td class="num">${formatLap(r.lapMs)}</td>
    <td class="board-driver">${chip(drivers, r.driverId)}${crown(i === 0)}</td>
    <td><a href="${base}/sessions/${r.sessionId}">${safe(localTime(r.at, dates))}</a></td>
    <td class="records-wide">${i === 0 ? 'Now' : safe(localTime(rows[i - 1].at, dates))}</td>
    ${layoutOf ? html`<td class="records-wide">${layoutLink(layoutOf(r.at), layouts)}</td>` : null}
  </tr>`)}</tbody>
</table></div>`;
}

/** @param {any} request @param {{ track: any, direction: string, rows: any[], drivers: any[], layoutOf: ((at: number) => any) | null }} model */
export function recordsPage(request, { track, direction, rows, drivers, layoutOf }) {
  const href = track ? `${request.space.base}/tracks/${track.id}` : '';
  return layout(request, {
    title: 'Track records',
    screen: 'sessions',
    modules: ['pkg/design/elements/local-time.js'],
    body: html`<div class="container sessions-screen stack-lg screen">
  <div class="stack-xs">
    <h1>Track records</h1>
    ${track ? html`<p class="subtitle"><a href="${href}">${track.name}</a>, ${DIRECTION[direction]}</p>` : null}
  </div>
  ${recordsTable(request, { track, rows, drivers, layoutOf, layouts: href })}
  <p><a href="${request.space.base}/sessions">Back to sessions</a></p>
</div>`,
  });
}
