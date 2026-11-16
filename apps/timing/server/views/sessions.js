// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Sessions tab (board hub spec §7): the history, every past session by
// club night. Sessions start, end and abort on the board (§5); while one
// runs, a line here says so and leads there.
import { localTime } from '@tinylap/design/html/local-time.js';
import { formatLap } from '../../public/format.js';
import { html, safe } from './html.js';
import { errorsSummary } from './form-parts.js';
import { layout } from './layout.js';
import { chip, marks, marksHead, timeWidths } from './marks.js';
import { trackName } from './records.js';

export const KIND = { practice: 'Practice', qualifying: 'Qualifying', race: 'Race' };
/** The running line's words, by the kind that runs. */
const RUNNING = { practice: 'A practice is running.', qualifying: 'Qualifying is running.', race: 'A race is running.' };

/** A length short enough for a table cell: "18 s", "12 min"; 59.6 s is "1 min", never "60 s". @param {number} ms */
export const shortLength = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
};

/** How long an ended session was driven: from its start (after any countdown) to its end. */
export const drivenMs = (session) => Math.max(0, (session.endedAt ?? session.opensAt ?? 0) - (session.opensAt ?? session.createdAt));

/**
 * Past sessions, newest first, 20 a page, a tbody per club night with its date
 * and track in a head row. The time is the row's link, and its box the whole
 * row's (app.css). The columns have fixed widths; the fastest driver has what
 * is left. On a phone Length and Drivers go, so who was fastest and how fast
 * stay in view.
 * @param {any} request @param {{ rows: any[], nights: any[], older: string | null, newer: string | null }} history @param {any[]} drivers
 */
function historySection(request, { rows, nights, older, newer }, drivers) {
  const base = request.space.base;
  const row = ({ session, drivers: count, best }) => html`<tr class="history-row">
    <td class="history-started"><a href="${base}/sessions/${session.id}">${safe(localTime(session.opensAt ?? session.createdAt, 'time'))}<span class="visually-hidden">, ${KIND[session.kind]}</span></a></td>
    <td class="history-session"><span class="history-kind">${KIND[session.kind]}</span>${session.state === 'aborted' ? html` <span class="tag tag-sm">Aborted</span>` : null}</td>
    <td class="num history-wide">${shortLength(drivenMs(session))}</td>
    <td class="num history-wide">${count}</td>
    <td class="board-driver">${best ? chip(drivers, best.driverId) : null}</td>
    <td class="num">${formatLap(best?.lapMs)}</td>
    ${marks({ lapMs: best?.lapMs, isRecord: Boolean(best?.isRecord), isPb: Boolean(best?.isPb) })}
  </tr>`;
  const table = rows.length === 0 ? html`<p class="empty">No sessions yet.</p>` : html`<div class="board-scroll"><table class="board-table history-table${timeWidths(rows.map(({ best }) => best?.lapMs))}">
  <colgroup><col class="col-started"><col class="col-kind"><col class="col-count history-wide"><col class="col-count history-wide"><col><col class="col-time"><col class="col-mark"></colgroup>
  <thead><tr><th scope="col">Started</th><th scope="col">Session</th><th scope="col" class="num history-wide">Length</th><th scope="col" class="num history-wide">Drivers</th><th scope="col">Fastest</th><th scope="col" class="num">Best</th>${marksHead}</tr></thead>
  ${nights.map((night) => html`<tbody class="history-night">
    <tr class="history-night-head"><th scope="rowgroup" colspan="7">${safe(localTime(night.at, 'day'))}<span class="history-night-track">${trackName(night.track, night.direction)}</span></th></tr>
    ${night.rows.map(row)}
  </tbody>`)}
</table></div>`;
  // A step at a time either way, and back to the newest from deep in the history.
  const links = [
    newer ? html`<a class="btn btn-outline btn-sm" href="${base}/sessions#history">Newest sessions</a>` : null,
    newer !== null ? html`<a class="btn btn-outline btn-sm" href="${base}/sessions${newer ? `?before=${newer}` : ''}#history">Newer sessions</a>` : null,
    older !== null ? html`<a class="btn btn-outline btn-sm" href="${base}/sessions?before=${older}#history">Older sessions</a>` : null,
  ].filter(Boolean);
  return html`<section id="history" class="space-md" aria-label="Past sessions, newest first">
  ${table}
  ${links.length ? html`<div class="button-row">${links}</div>` : null}
</section>`;
}

/**
 * @param {any} request
 * @param {{ running: any, drivers: any[], history: any, errors?: any[] }} model
 */
export function sessionsPage(request, { running, drivers, history, errors = [] }) {
  return layout(request, {
    title: 'Sessions',
    screen: 'sessions',
    modules: ['pkg/design/elements/local-time.js'],
    body: html`<div class="container sessions-screen space-xl screen">
  <div class="space-xs">
    <h1>Sessions</h1>
    ${running ? html`<p class="sessions-running" role="status"><span>${RUNNING[running.kind]}</span> <a href="${request.space.base}/board">Go to the board</a></p>` : null}
  </div>
  ${errorsSummary(errors, () => null)}
  ${historySection(request, history, drivers)}
</div>`,
  });
}
