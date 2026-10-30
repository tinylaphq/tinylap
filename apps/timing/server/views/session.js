// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A session's page (records spec §5.2): its final table, as the board showed
// it when it ended, with marks and the crown, then every lap of each driver.
import { localTime } from '@tinylap/design/html/local-time.js';
import { formatLap } from '../../public/format.js';
import { html, safe } from './html.js';
import { layout } from './layout.js';
import { chip, crown, marks } from './marks.js';
import { trackName } from './records.js';
import { KIND } from './sessions.js';

/**
 * @param {any} request
 * @param {{ session: any, standings: any[], crossings: any[], drivers: any[], track: any,
 *   record: { driverId: string, seq: number } | null, bests: { driverId: string, seq: number }[] }} model
 */
export function sessionPage(request, { session, standings, crossings, drivers, track, record, bests }) {
  const race = session.kind === 'race';
  const pbSeq = new Set(bests.map((b) => b.seq));
  const markOf = (c) => marks({ lapMs: c?.lapMs, isRecord: c?.seq === record?.seq, isPb: pbSeq.has(c?.seq) });
  const laps = new Map();
  for (const c of crossings) {
    if (c.lapMs === null || c.driverId === null) continue;
    if (!laps.has(c.driverId)) laps.set(c.driverId, []);
    laps.get(c.driverId).push(c);
  }
  /** The crossing a row's best lap came from: its first counted lap of that time. */
  const bestOf = (row) => laps.get(row.driverId)?.find((c) => c.counts && c.lapMs === row.bestMs) ?? null;
  // The session's best lap: one row only, the earlier lap on a tie.
  let best = null;
  for (const row of standings) {
    const c = bestOf(row);
    if (c && (!best || c.lapMs < best.lapMs || (c.lapMs === best.lapMs && c.seq < best.seq))) best = c;
  }
  const order = [...standings.map((r) => r.driverId), ...[...laps.keys()].filter((id) => !standings.some((r) => r.driverId === id))];
  const ended = session.state === 'done' || session.state === 'aborted';

  const table = standings.length === 0 ? html`<p class="empty">No laps were counted.</p>` : html`<div class="board-scroll"><table class="board-table">
  <thead><tr><th scope="col">Pos</th><th scope="col">Driver</th><th scope="col" class="num">Laps</th><th scope="col" class="num">Best</th>${race ? html`<th scope="col" class="num">Time</th>` : null}</tr></thead>
  <tbody>${standings.map((row) => { const isBest = best?.driverId === row.driverId; return html`<tr${isBest ? html` class="is-best"` : null}>
    <td class="pos">${row.position}</td>
    <td class="board-driver">${chip(drivers, row.driverId)}${crown(record?.driverId === row.driverId)}</td>
    <td class="num">${row.laps}</td>
    <td class="num">${formatLap(row.bestMs)}${markOf(bestOf(row))}${isBest ? html`<span class="visually-hidden">Session best</span>` : null}</td>
    ${race ? html`<td class="num">${formatLap(row.elapsedMs)}</td>` : null}
  </tr>`; })}</tbody>
</table></div>`;

  const lapLists = order.map((id) => html`<div class="card-static session-laps">
  <h3 class="h3">${chip(drivers, id)}</h3>
  <table class="lap-table">
    <thead><tr><th scope="col" class="num">Lap</th><th scope="col" class="num">Time</th><th scope="col"><span class="visually-hidden">Notes</span></th></tr></thead>
    <tbody>${laps.get(id).map((c, i) => html`<tr${c.counts ? null : html` class="is-not-counted"`}>
      <td class="num">${i + 1}</td>
      <td class="num">${formatLap(c.lapMs)}${markOf(c)}</td>
      <td>${c.via === 'tap' ? html`<span class="tag">tap</span>` : null}${c.counts ? null : html`<span class="tag">not counted</span>`}</td>
    </tr>`)}</tbody>
  </table>
</div>`);

  return layout(request, {
    title: KIND[session.kind],
    screen: 'sessions',
    modules: ['pkg/design/elements/local-time.js'],
    body: html`<div class="container sessions-screen stack-xl screen">
  <div class="stack-sm">
    <p><a href="${request.space.base}/sessions">Sessions</a></p>
    <h1>${KIND[session.kind]}${session.state === 'aborted' ? html` <span class="tag">Aborted</span>` : null}</h1>
    <dl class="session-facts">
      <div><dt>Started</dt><dd>${safe(localTime(session.opensAt ?? session.createdAt, 'datetime'))}</dd></div>
      <div><dt>Ended</dt><dd>${ended ? safe(localTime(session.endedAt, 'time')) : 'Still running'}</dd></div>
      <div><dt>Track</dt><dd>${trackName(track, session.direction)}</dd></div>
    </dl>
  </div>
  <section class="stack-md" aria-labelledby="standings-title">
    <h2 id="standings-title">${ended ? 'Final table' : 'Table so far'}</h2>
    ${table}
  </section>
  <section class="stack-md" aria-labelledby="laps-title">
    <h2 id="laps-title">Laps</h2>
    ${order.length === 0 ? html`<p class="empty">No laps.</p>` : html`<div class="session-laps-grid">${lapLists}</div>`}
  </section>
</div>`,
  });
}
