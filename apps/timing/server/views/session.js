// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A session's page (board hub and results spec §6.7): its result, kept for
// good, then every lap of each driver. Its one way out is Back to Sessions.
import { localTime } from '@tinylap/design/html/local-time.js';
import { formatLap } from '../../public/format.js';
import { html, safe } from './html.js';
import { layout } from './layout.js';
import { chip, marksHead, timeWidths } from './marks.js';
import { trackName } from './records.js';
import { resultView } from './result.js';
import { KIND, drivenMs, shortLength } from './sessions.js';

/**
 * @param {any} request
 * @param {{ session: any, crossings: any[], drivers: any[], track: any, result: import('./result.js').Result }} model
 */
export function sessionPage(request, { session, crossings, drivers, track, result }) {
  const { laps, order, fastest, markOf, rows } = result;
  const ended = session.state === 'done' || session.state === 'aborted';
  const base = request.space.base;

  // One empty state for a session nobody drove in; "not counted" only where laps were driven.
  const body = order.length === 0 ? html`<p class="empty">No laps were driven.</p>`
    : rows.length === 0 ? html`<p class="empty">No laps were counted.</p>` : resultView(result, { drivers });

  // Every card's columns line up: all are as wide as the session's longest lap needs.
  const cardWidths = timeWidths(crossings.map((c) => c.lapMs));
  const lapLists = order.map((id) => {
    const own = laps.get(id) ?? [];
    // A driver none of whose laps counted (not on the roster) says so once, not on every row.
    const noneCounted = own.length > 0 && own.every((c) => !c.counts);
    return html`<div class="card-static session-laps" id="driver-${id}">
  <h3 class="h3 cut-words">${chip(drivers, id)}</h3>
  ${noneCounted ? html`<p class="session-laps-note">None of these laps counted.</p>` : null}
  <table class="lap-table${cardWidths}">
    <colgroup><col class="col-lap"><col class="col-time"><col class="col-mark"><col></colgroup>
    <thead><tr><th scope="col" class="num">Lap</th><th scope="col" class="num">Time</th>${marksHead}<th scope="col"><span class="visually-hidden">Notes</span></th></tr></thead>
    <tbody>${own.map((c, i) => html`<tr${c.counts ? null : html` class="is-not-counted"`}>
      <td class="num">${i + 1}</td>
      <td class="num">${formatLap(c.lapMs)}</td>
      ${markOf(c)}
      <td>${c.via === 'tap' ? html`<span class="tag tag-sm">Tap</span>` : null}${c.counts || noneCounted ? null : html`<span class="tag tag-sm">Not counted</span>`}</td>
    </tr>`)}</tbody>
  </table>
  ${own.length ? null : html`<p class="empty">No laps.</p>`}
</div>`;
  });

  return layout(request, {
    title: KIND[session.kind],
    screen: 'sessions',
    modules: ['pkg/design/elements/local-time.js'],
    body: html`<div class="container sessions-screen session-page space-xl screen">
  <div class="session-head">
    <p><a href="${base}/sessions">Sessions</a></p>
    <h1>${KIND[session.kind]}${session.state === 'aborted' ? html` <span class="tag">Aborted</span>` : null}</h1>
    <dl class="session-facts">
      <div><dt>Started</dt><dd>${safe(localTime(session.opensAt ?? session.createdAt, 'datetime'))}</dd></div>
      <div><dt>Ended</dt><dd>${ended ? safe(localTime(session.endedAt, 'time')) : 'Still running'}</dd></div>
      ${ended ? html`<div><dt>Length</dt><dd>${shortLength(session.durationMs ?? drivenMs(session))}</dd></div>` : null}
      <div><dt>Track</dt><dd class="cut-words">${trackName(track, session.direction)}</dd></div>
      ${fastest && session.kind !== 'practice' ? html`<div><dt>Fastest lap</dt><dd class="lap-credit"><span class="num">${formatLap(fastest.lapMs)}</span> ${chip(drivers, fastest.driverId)}</dd></div>` : null}
    </dl>
  </div>
  <section class="result-section" aria-labelledby="result-title">
    <div class="result-head"><h2 id="result-title">Result</h2>${order.length ? html`<a href="#laps">All laps</a>` : null}</div>
    ${body}
  </section>
  ${order.length === 0 ? null : html`<section class="space-md" aria-labelledby="laps-title" id="laps">
    <h2 id="laps-title">Laps</h2>
    <div class="session-laps-grid">${lapLists}</div>
  </section>`}
  <p class="session-back"><a class="btn btn-outline" href="${base}/sessions">Back to Sessions</a></p>
</div>`,
  });
}
