// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Sessions tab (records spec §5.2): the running session with End or
// Abort, the history of sessions, and the latest track records. Sessions
// start on the board (board hub spec §5).
import { localTime } from '@tinylap/design/html/local-time.js';
import { clockAt, formatClock, formatLap, formatLength } from '../../public/format.js';
import { html, safe } from './html.js';
import { errorsSummary } from './form-parts.js';
import { layout } from './layout.js';
import { chip, marks, marksHead, timeWidths } from './marks.js';
import { recordsTable, trackName } from './records.js';

export const KIND = { practice: 'Practice', qualifying: 'Qualifying', race: 'Race' };
const STATE = { countdown: 'counting down', running: 'running', finishing: 'finishing the last lap' };

/** A length short enough for a table cell: "18 s", "12 min"; 59.6 s is "1 min", never "60 s". @param {number} ms */
export const shortLength = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
};

/** How long an ended session was driven: from its start (after any countdown) to its end. */
export const drivenMs = (session) => Math.max(0, (session.endedAt ?? session.opensAt ?? 0) - (session.opensAt ?? session.createdAt));

/** The panel of a running session. `reload` (only on the 200 GET) lets its clock reload the page once at a phase change. */
function runningPanel(request, session, drivers, { reload }) {
  const base = request.space.base;
  const now = request.now();
  const clock = clockAt({ ...session, opensAt: session.opensAt ?? null, closesAt: session.closesAt ?? null }, now);
  const time = html`<time class="race-clock-time" data-clock data-kind="${session.kind}" data-state="${session.state}" data-opens="${session.opensAt ?? ''}" data-closes="${session.closesAt ?? ''}" data-now="${now}">${formatClock(clock.ms)}</time>`;
  if (session.kind === 'practice') {
    // The clock counts up from the start; the label says when that was (records spec §5.3).
    return html`<div class="card-static space-md running-panel">
  <h2>Practice, running</h2>
  <tl-countdown class="race-clock"${reload ? html` reload-on-phase` : null}><span class="stat-label">Started ${safe(localTime(session.opensAt, 'time'))}</span> ${time}</tl-countdown>
  <div class="button-row">
    <a class="btn btn-outline" href="${base}/board">Show the board</a>
    <a class="btn btn-danger" href="${base}/sessions/${session.id}/end">End</a>
  </div>
</div>`;
  }
  const names = session.roster ? session.roster.map((id) => drivers.find((d) => d.id === id)?.name ?? 'Former driver').join(', ') : 'Everyone on the track';
  return html`<div class="card-static space-md running-panel">
  <h2>${KIND[session.kind]}, ${STATE[session.state] ?? session.state}</h2>
  <p>${names}. ${formatLength(session.durationMs ?? 0)}.</p>
  <tl-countdown class="race-clock"${reload ? html` reload-on-phase` : null}><span class="stat-label" data-clock-label>${clock.label}</span> ${time}</tl-countdown>
  <div class="button-row">
    <a class="btn btn-outline" href="${base}/board">Show the board</a>
    <a class="btn btn-danger" href="${base}/sessions/${session.id}/abort">Abort</a>
  </div>
</div>`;
}

/**
 * Past sessions, newest first, 20 a page. The columns have fixed widths
 * (app.css); the track and the fastest driver share what is left. On a phone
 * Track, Length and Drivers go, and the track is a second line under the
 * session, so who was fastest and how fast stay in view.
 * @param {any} request @param {{ rows: any[], older: string | null, newer: string | null }} history @param {any[]} drivers
 */
function historySection(request, { rows, older, newer }, drivers) {
  const base = request.space.base;
  const table = rows.length === 0 ? html`<p class="empty">No sessions yet.</p>` : html`<div class="board-scroll"><table class="board-table history-table${timeWidths(rows.map(({ best }) => best?.lapMs))}">
  <colgroup><col class="col-started"><col class="col-kind"><col class="history-wide"><col class="col-count history-wide"><col class="col-count history-wide"><col><col class="col-time"><col class="col-mark"></colgroup>
  <thead><tr><th scope="col">Started</th><th scope="col">Session</th><th scope="col" class="history-wide">Track</th><th scope="col" class="num history-wide">Length</th><th scope="col" class="num history-wide">Drivers</th><th scope="col">Fastest</th><th scope="col" class="num">Best</th>${marksHead}</tr></thead>
  <tbody>${rows.map(({ session, track, drivers: count, best }) => html`<tr class="history-row">
    <td class="history-started"><a href="${base}/sessions/${session.id}">${safe(localTime(session.opensAt ?? session.createdAt, 'datetime'))}</a></td>
    <td class="history-session"><span class="history-kind">${KIND[session.kind]}</span>${session.state === 'aborted' ? html` <span class="tag tag-sm">Aborted</span>` : null}<span class="history-track">${trackName(track, session.direction)}</span></td>
    <td class="history-wide cut-words">${trackName(track, session.direction)}</td>
    <td class="num history-wide">${shortLength(drivenMs(session))}</td>
    <td class="num history-wide">${count}</td>
    <td class="board-driver">${best ? chip(drivers, best.driverId) : null}</td>
    <td class="num">${formatLap(best?.lapMs)}</td>
    ${marks({ lapMs: best?.lapMs, isRecord: Boolean(best?.isRecord), isPb: Boolean(best?.isPb) })}
  </tr>`)}</tbody>
</table></div>`;
  // A step at a time either way, and back to the newest from deep in the history.
  const links = [
    newer ? html`<a class="btn btn-outline btn-sm" href="${base}/sessions#history">Newest sessions</a>` : null,
    newer !== null ? html`<a class="btn btn-outline btn-sm" href="${base}/sessions${newer ? `?before=${newer}` : ''}#history">Newer sessions</a>` : null,
    older !== null ? html`<a class="btn btn-outline btn-sm" href="${base}/sessions?before=${older}#history">Older sessions</a>` : null,
  ].filter(Boolean);
  return html`<section id="history" class="space-md" aria-labelledby="history-title">
  <h2 id="history-title">History</h2>
  ${table}
  ${links.length ? html`<div class="button-row">${links}</div>` : null}
</section>`;
}

function recordsSection(request, { track, direction, rows }, drivers) {
  return html`<section class="space-md" aria-labelledby="records-title">
  <div class="space-xs">
    <h2 id="records-title">Track record</h2>
    ${track ? html`<p class="subtitle cut-words">${trackName(track, direction)}</p>` : null}
  </div>
  ${recordsTable(request, { track, rows, drivers })}
  ${rows.length ? html`<p><a href="${request.space.base}/records">All track records</a></p>` : null}
</section>`;
}

/**
 * @param {any} request
 * @param {{ session: any, drivers: any[], history: any, records: any, errors?: any[], reload?: boolean }} model
 */
export function sessionsPage(request, { session, drivers, history, records, errors = [], reload = false }) {
  return layout(request, {
    title: 'Sessions',
    screen: 'sessions',
    scripts: session ? ['elements/countdown.js'] : [],
    modules: ['pkg/design/elements/local-time.js'],
    body: html`<div class="container sessions-screen space-xl screen">
  <h1>Sessions</h1>
  ${errorsSummary(errors, () => null)}
  ${session ? runningPanel(request, session, drivers, { reload }) : null}
  ${historySection(request, history, drivers)}
  ${recordsSection(request, records, drivers)}
</div>`,
  });
}
