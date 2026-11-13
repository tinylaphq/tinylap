// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A session's page (records spec §5.2): its final table, as the board showed
// it when it ended, with marks and the crown, then every lap of each driver.
import { localTime } from '@tinylap/design/html/local-time.js';
import { formatLap } from '../../public/format.js';
import { html, safe } from './html.js';
import { layout } from './layout.js';
import { chip, marks, marksHead, posHead, tableClasses, timeWidths } from './marks.js';
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
  const laps = new Map();
  for (const c of crossings) {
    if (c.lapMs === null || c.driverId === null) continue;
    if (!laps.has(c.driverId)) laps.set(c.driverId, []);
    laps.get(c.driverId).push(c);
  }
  /** The crossing a row's best lap came from: its first counted lap of that time. */
  const bestOf = (row) => laps.get(row.driverId)?.find((c) => c.counts && c.lapMs === row.bestMs) ?? null;
  // The session's fastest lap: one lap only, the earlier on a tie. It is FL
  // in the table, P1 included, and in its driver's laps (fastest lap spec §5).
  let best = null;
  for (const row of standings) {
    const c = bestOf(row);
    if (c && (!best || c.lapMs < best.lapMs || (c.lapMs === best.lapMs && c.seq < best.seq))) best = c;
  }
  /** A lap's mark: TR, FL (the session's fastest lap) or PB. */
  const markOf = (c) => marks({ lapMs: c?.lapMs, isRecord: c?.seq === record?.seq, isFastest: best !== null && c?.seq === best.seq, isPb: pbSeq.has(c?.seq) });
  const order = [...standings.map((r) => r.driverId), ...[...laps.keys()].filter((id) => !standings.some((r) => r.driverId === id))];
  const ended = session.state === 'done' || session.state === 'aborted';

  // One empty state for a session nobody drove in; "not counted" only where laps were driven.
  const table = order.length === 0 ? html`<p class="empty">No laps were driven.</p>`
    : standings.length === 0 ? html`<p class="empty">No laps were counted.</p>` : html`<div class="board-scroll"><table class="board-table standings-table${race ? ' is-race' : ''}${tableClasses({ positions: standings.length })}${timeWidths(standings.map((row) => row.bestMs), standings.map((row) => row.elapsedMs))}">
  <colgroup><col class="col-pos"><col><col class="col-laps"><col class="col-time"><col class="col-mark">${race ? html`<col class="col-total">` : null}</colgroup>
  <thead><tr>${posHead}<th scope="col">Driver</th><th scope="col" class="num">Laps</th><th scope="col" class="num">Best</th>${marksHead}${race ? html`<th scope="col" class="num">Time</th>` : null}</tr></thead>
  <tbody>${standings.map((row) => html`<tr>
    <td class="pos">${row.position}</td>
    <td class="board-driver">${chip(drivers, row.driverId, { holder: record?.driverId === row.driverId })}</td>
    <td class="num">${row.laps}</td>
    <td class="num">${formatLap(row.bestMs)}</td>
    ${markOf(bestOf(row))}
    ${race ? html`<td class="num">${formatLap(row.elapsedMs)}</td>` : null}
  </tr>`)}</tbody>
</table></div>`;

  // Every card's columns line up: all are as wide as the session's longest lap needs.
  const cardWidths = timeWidths(crossings.map((c) => c.lapMs));
  const lapLists = order.map((id) => {
    const own = laps.get(id) ?? [];
    // A driver none of whose laps counted (not on the roster) says so once, not on every row.
    const noneCounted = own.length > 0 && own.every((c) => !c.counts);
    return html`<div class="card-static session-laps">
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
    body: html`<div class="container sessions-screen space-xl screen">
  <div class="space-sm">
    <p><a href="${request.space.base}/sessions">Sessions</a></p>
    <h1>${KIND[session.kind]}${session.state === 'aborted' ? html` <span class="tag">Aborted</span>` : null}</h1>
    <dl class="session-facts">
      <div><dt>Started</dt><dd>${safe(localTime(session.opensAt ?? session.createdAt, 'datetime'))}</dd></div>
      <div><dt>Ended</dt><dd>${ended ? safe(localTime(session.endedAt, 'time')) : 'Still running'}</dd></div>
      <div><dt>Track</dt><dd class="cut-words">${trackName(track, session.direction)}</dd></div>
      ${best ? html`<div><dt>Fastest lap</dt><dd class="lap-credit"><span class="num">${formatLap(best.lapMs)}</span> ${chip(drivers, best.driverId)}</dd></div>` : null}
    </dl>
  </div>
  <section class="space-md" aria-labelledby="standings-title">
    <h2 id="standings-title">${ended ? 'Final table' : 'Table so far'}</h2>
    ${table}
  </section>
  ${order.length === 0 ? null : html`<section class="space-md" aria-labelledby="laps-title">
    <h2 id="laps-title">Laps</h2>
    <div class="session-laps-grid">${lapLists}</div>
  </section>`}
</div>`,
  });
}
