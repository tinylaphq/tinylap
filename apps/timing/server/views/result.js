// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A session's result (board hub and results spec §6): one ranked list whose
// top three are set larger. The placed cards P1, P2 and P3 (a practice: P1
// only), then the rest in a table, then a practice's personal bests. A rank
// gutter (app.css, --rank) runs through all of it: every position ends one
// gap left of it, every colour square starts on it. The session page renders
// it with links to each driver's laps; the board and the TV without links.
import { formatLap } from '../../public/format.js';
import { html } from './html.js';
import { chip, marks, marksHead, posHead, tableClasses, timeWidths } from './marks.js';

/**
 * @typedef {{ seq: number, driverId: string | null, lapMs: number | null, counts: boolean, via: string, at: number }} Lap
 * @typedef {{ driverId: string, lapMs: number, seq: number }} RecordLap
 * @typedef {{ driverId: string, position: number, laps: number, bestMs: number | null, elapsedMs: number | null,
 *   best: Lap | null, setOnLap: number | null, gap: string | null, onLeadLap: boolean }} Row
 * @typedef {{ driverId: string, lap: Lap, beforeMs: number | null }} PersonalBest
 * @typedef {{ kind: string, rows: Row[], laps: Map<string, Lap[]>, order: string[], fastest: Lap | null,
 *   holderId: string | null, recordSeq: number | null, fell: { lap: RecordLap, beat: RecordLap | null } | null, personalBests: PersonalBest[],
 *   markOf: (lap: Lap | null | undefined, options?: { list?: boolean }) => import('./html.js').Html }} Result
 */

/** "+0.613", "+1 lap", "+2 laps". @param {number} ms */
const plus = (ms) => `+${formatLap(ms)}`;
const lapsBehind = (n) => `+${n} lap${n === 1 ? '' : 's'}`;

/**
 * A session's result from its standings and laps: the gaps, who is on the
 * lead lap, which lap each best was set on, the session's fastest lap, the
 * record that fell in it and the personal bests it set.
 * @param {{ session: { kind: string }, standings: any[], crossings: Lap[],
 *   record: { driverId: string, seq: number } | null, bests: { seq: number }[],
 *   fell?: { lap: RecordLap, beat: RecordLap | null } | null, before?: Map<string, number> }} input
 *   `record` and `bests` are the track's record and personal bests now (the marks
 *   are present tense); `fell` the fastest record set in this session and the one
 *   it beat; `before` each driver's best on the track before the session.
 * @returns {Result}
 */
export function resultOf({ session, standings, crossings, record, bests, fell = null, before = new Map() }) {
  const pbSeq = new Set(bests.map((b) => b.seq));
  /** @type {Map<string, Lap[]>} */
  const laps = new Map();
  for (const c of crossings) {
    if (c.lapMs === null || c.driverId === null) continue;
    if (!laps.has(c.driverId)) laps.set(c.driverId, []);
    /** @type {Lap[]} */ (laps.get(c.driverId)).push(c);
  }
  /** The lap a row's best came from: its first counted lap of that time. */
  const bestOf = (row) => laps.get(row.driverId)?.find((c) => c.counts && c.lapMs === row.bestMs) ?? null;
  // The session's fastest lap: one lap only, the earlier on a tie (fastest lap spec §5).
  /** @type {Lap | null} */
  let fastest = null;
  for (const row of standings) {
    const c = bestOf(row);
    if (c && c.lapMs !== null && (!fastest || c.lapMs < /** @type {number} */ (fastest.lapMs) || (c.lapMs === fastest.lapMs && c.seq < fastest.seq))) fastest = c;
  }
  const race = session.kind === 'race';
  const lead = standings[0];
  /** @type {Row[]} */
  const rows = standings.map((row) => {
    const best = bestOf(row);
    const own = laps.get(row.driverId) ?? [];
    let gap = null;
    if (row !== lead) {
      if (race) gap = row.laps < lead.laps ? lapsBehind(lead.laps - row.laps)
        : row.elapsedMs !== null && lead.elapsedMs !== null ? plus(row.elapsedMs - lead.elapsedMs) : null;
      else gap = row.bestMs !== null && lead.bestMs !== null ? plus(row.bestMs - lead.bestMs) : null;
    }
    return {
      driverId: row.driverId, position: row.position, laps: row.laps, bestMs: row.bestMs, elapsedMs: row.elapsedMs ?? null,
      best, setOnLap: best ? own.indexOf(best) + 1 : null, gap,
      // A total over fewer laps reads faster than the winner's: only cars on the lead lap show one.
      onLeadLap: race && row.laps === lead.laps && row.elapsedMs !== null,
    };
  });
  /** A lap's mark: TR, FL (the session's fastest lap) or PB. */
  const markOf = (c, { list = false } = {}) => marks({ lapMs: c?.lapMs, isRecord: c?.seq === record?.seq, isFastest: fastest !== null && c?.seq === fastest.seq, isPb: pbSeq.has(c?.seq) }, { list });
  const order = [...standings.map((r) => r.driverId), ...[...laps.keys()].filter((id) => !standings.some((r) => r.driverId === id))];
  // The personal bests set here: each driver's fastest lap that counts for one (not tapped), faster than their best before.
  /** @type {PersonalBest[]} */
  const personalBests = [];
  for (const row of rows) {
    let lap = null;
    for (const c of laps.get(row.driverId) ?? []) if (c.counts && c.via !== 'tap' && (!lap || /** @type {number} */ (c.lapMs) < /** @type {number} */ (lap.lapMs))) lap = c;
    const beforeMs = before.get(row.driverId) ?? null;
    if (lap && (beforeMs === null || /** @type {number} */ (lap.lapMs) < beforeMs)) personalBests.push({ driverId: row.driverId, lap, beforeMs });
  }
  return { kind: session.kind, rows, laps, order, fastest, holderId: record?.driverId ?? null, recordSeq: record?.seq ?? null, fell, personalBests, markOf };
}

/** A label over a value, in the placed card's facts. */
const fact = (label, value) => html`<div><dt>${label}</dt><dd>${value}</dd></div>`;
const num = (value) => html`<span class="num">${value}</span>`;

/**
 * The result's markup: P1 (and P2, P3 for a race or qualifying), the rest in
 * a table, then a practice's personal bests. With `links` (the session page)
 * each card closes with "Lap times" and each name in the table links to that
 * driver's lap card (`#driver-<id>`); the board and the TV pass `links: false`,
 * which also leaves the personal bests out (the table's PB marks say who).
 * @param {Result} result
 * @param {{ drivers: { id: string, name: string, colour?: string }[], links?: boolean, personalBests?: boolean }} options
 */
export function resultView(result, { drivers, links = true, personalBests = links }) {
  const { kind, rows, holderId, markOf, fell } = result;
  const race = kind === 'race';
  const practice = kind === 'practice';
  const placed = rows.slice(0, practice ? 1 : 3);
  const rest = rows.slice(placed.length);
  const lapTimes = (row) => (links ? html`<a class="place-more" href="#driver-${row.driverId}">Lap times</a>` : null);
  const name = (row) => chip(drivers, row.driverId, { holder: holderId === row.driverId });

  // A record set in a practice is said by the card whose lap it is (§6.6): what it beat, or that it
  // is the first on this track. That card already says it, so its driver has no personal-best card besides.
  const lead = rows[0];
  const setHere = Boolean(practice && lead && fell && lead.best?.seq === fell.lap.seq);
  const beat = setHere ? fell?.beat ?? null : null;

  /** @param {Row} row @param {number} i */
  const card = (row, i) => {
    const first = i === 0;
    const record = first ? beat : null;
    const firstRecord = first && setHere && !beat;
    const bestLap = html`${num(formatLap(row.bestMs))}${markOf(row.best, { list: true })}`;
    let figure;
    let facts;
    if (race) {
      figure = first ? num(formatLap(row.elapsedMs)) : num(row.gap ?? '');
      facts = first ? [fact('Laps', num(row.laps)), fact('Best lap', bestLap)]
        : [row.onLeadLap ? fact('Time', num(formatLap(row.elapsedMs))) : null, fact('Best lap', bestLap)];
    } else if (first) {
      figure = html`${num(formatLap(row.bestMs))}${markOf(row.best, { list: true })}`;
      facts = [fact('Laps', num(row.laps)), row.setOnLap ? fact('Set on lap', num(row.setOnLap)) : null,
        record ? fact('New track record', html`<span class="fact-beat">Beat <span class="lap-credit">${num(formatLap(record.lapMs))} ${chip(drivers, record.driverId)}</span></span>`) : null,
        firstRecord ? fact('Track record', html`<span class="fact-word">First on this track</span>`) : null];
    } else {
      figure = num(row.gap ?? '');
      facts = [fact('Best lap', bestLap), fact('Laps', num(row.laps))];
    }
    return html`<article class="place${first ? ' is-first' : ''}${record ? ' is-record' : ''}">
  <p class="place-pos"><span class="visually-hidden">Position </span>${row.position}</p>
  <h3 class="place-name">${name(row)}</h3>
  <p class="place-figure">${figure}</p>
  <div class="place-foot"><dl class="place-facts">${facts}</dl>${lapTimes(row)}</div>
</article>`;
  };

  const table = rest.length === 0 ? null : html`<div class="board-scroll"><table class="board-table standings-table result-table${tableClasses({ positions: rows.length })}${timeWidths(rows.map((r) => r.bestMs), rows.map((r) => r.elapsedMs))}">
  <colgroup><col class="col-pos"><col>${race ? html`<col class="col-laps v-laps">` : null}<col class="col-gap"><col class="col-time"><col class="col-mark">${race ? html`<col class="col-total v-total">` : html`<col class="col-laps v-laps">`}</colgroup>
  <thead><tr>${posHead}<th scope="col">Driver</th>${race ? html`<th scope="col" class="num v-laps">Laps</th>` : null}<th scope="col" class="num">Gap</th><th scope="col" class="num">Best lap</th>${marksHead}${race ? html`<th scope="col" class="num v-total">Time</th>` : html`<th scope="col" class="num v-laps">Laps</th>`}</tr></thead>
  <tbody>${rest.map((row) => html`<tr>
    <td class="pos">${row.position}</td>
    <td class="board-driver">${links ? html`<a href="#driver-${row.driverId}">${name(row)}</a>` : name(row)}</td>
    ${race ? html`<td class="num v-laps">${row.laps}</td>` : null}
    <td class="num gap">${row.gap ?? ''}</td>
    <td class="num">${formatLap(row.bestMs)}</td>
    ${markOf(row.best)}
    ${race ? html`<td class="num v-total">${row.onLeadLap ? formatLap(row.elapsedMs) : ''}</td>` : html`<td class="num v-laps">${row.laps}</td>`}
  </tr>`)}</tbody>
</table></div>`;

  const shownBests = result.personalBests.filter((pb) => !(setHere && pb.driverId === lead.driverId));
  const pbs = practice && personalBests && shownBests.length ? html`<section class="result-pbs" aria-label="Personal bests">
  <div class="place-tier">${shownBests.map((pb) => html`<article class="place is-pb">
  <h3 class="place-name">${chip(drivers, pb.driverId)}</h3>
  <p class="place-figure">${num(formatLap(pb.lap.lapMs))}${marks({ lapMs: pb.lap.lapMs, isRecord: pb.lap.seq === result.recordSeq, isPb: true }, { list: true })}</p>
  <div class="place-foot"><dl class="place-facts">${pb.beforeMs === null ? fact('Before', html`<span class="fact-word">First time on this track</span>`)
    : [fact('Before', num(formatLap(pb.beforeMs))), fact('Faster by', num(formatLap(pb.beforeMs - /** @type {number} */ (pb.lap.lapMs))))]}</dl></div>
</article>`)}</div>
</section>` : null;

  return html`<div class="result is-${kind}">
  ${placed.length ? card(placed[0], 0) : null}
  ${placed.length > 1 ? html`<div class="place-tier is-runners">${placed.slice(1).map((row, i) => card(row, i + 1))}</div>` : null}
  ${table}
  ${pbs}
</div>`;
}
