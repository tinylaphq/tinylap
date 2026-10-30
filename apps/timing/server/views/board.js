// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board (spec §6.1), rendered on the server from engine.snapshot. All
// that changes lives in #board-live, which the stream replaces whole; the
// watchers board is the same without member parts.
import { clockAt, formatClock, formatLap } from '../../public/format.js';
import { formatAgo } from '@tinylap/design/format-ago.js';
import { localTime } from '@tinylap/design/html/local-time.js';
import { html, safe } from './html.js';
import { layout } from './layout.js';
import { chip as driverChip, crown, idleNotice, marks, startPracticeForm } from './marks.js';

const KIND = { practice: 'Practice', qualifying: 'Qualifying', race: 'Race' };
const DIRECTION = { cw: 'clockwise', ccw: 'anticlockwise' };

/** What the session clock shows at server time `now`. */
export function clockOf(session, now) {
  if (!session) return null;
  const { label, ms } = clockAt({ ...session, opensAt: session.opensAt ?? null, closesAt: session.closesAt ?? null }, now);
  return { label, ms };
}

const chip = (snap, id) => driverChip(snap.drivers, id);

/** A record's time, holder and date: "7.412 · Haris · 12 Oct". */
const recordLine = (snap, r) => html`<span class="num board-track-time">${formatLap(r.lapMs)}</span> <span class="board-track-by">· ${chip(snap, r.driverId)} · ${safe(localTime(r.at, 'date'))}</span>`;

/**
 * The track and its record, above the session on every board (records spec
 * §5.1). While a record has just fallen it is in the record state (§4.3): the
 * new time and holder in the record colour, and the record it beat.
 */
function trackHeader(snap) {
  const where = snap.track
    ? html`<p class="board-track-name"><strong>${snap.track.name}</strong> ${DIRECTION[snap.direction]}</p>`
    : html`<p class="board-track-name">No track set</p>`;
  const n = snap.recordNew;
  if (n) {
    return html`<header class="board-track is-record" data-record-new="${n.seq}">
  ${where}
  <div class="board-track-record">
    <p class="board-track-new"><strong class="board-track-label">New track record</strong> <span class="num board-track-time">${formatLap(n.lapMs)}</span> ${chip(snap, n.driverId)}</p>
    ${n.beat ? html`<p class="board-track-beat">Beat ${recordLine(snap, n.beat)}</p>` : null}
  </div>
</header>`;
  }
  const record = snap.record
    ? html`<p class="board-track-record"><span class="board-track-label">Track record</span> ${recordLine(snap, snap.record)}</p>`
    : snap.track ? html`<p class="board-track-record"><span class="board-track-label">No record yet</span></p>` : null;
  return html`<header class="board-track">
  ${where}
  ${record}
</header>`;
}

/**
 * The session's title and clock; with none running, the last session and when
 * it ended (records spec §5.3). A practice counts up under "Started 14:32",
 * written here alone: tl-countdown changes only the labels marked
 * data-clock-label, so it leaves this one as it is.
 */
function header(snap, start) {
  const s = snap.session;
  if (!s) {
    const last = snap.lastResults?.session;
    return html`<header class="board-head">
  <div>
    <h1 class="board-title">${last ? KIND[last.kind] : 'No session yet'}</h1>
    ${last ? html`<p class="board-ended">Ended ${safe(localTime(last.endedAt ?? last.createdAt, 'time'))}${last.state === 'aborted' ? html` <span class="tag">Aborted</span>` : null}</p>` : null}
  </div>
  ${start}
</header>`;
  }
  const clock = clockOf(s, snap.now);
  const label = s.kind === 'practice'
    ? html`<span class="stat-label board-clock-label">${clock.label} ${safe(localTime(s.opensAt, 'time'))}</span>`
    : html`<span class="stat-label board-clock-label" data-clock-label>${clock.label}</span>`;
  return html`<header class="board-head">
  <div><h1 class="board-title">${KIND[s.kind]}</h1></div>
  <tl-countdown class="board-clock">${label}<time class="board-clock-time" data-clock data-kind="${s.kind}" data-state="${s.state}" data-opens="${s.opensAt ?? ''}" data-closes="${s.closesAt ?? ''}" data-now="${snap.now}">${formatClock(clock.ms)}</time></tl-countdown>
</header>`;
}

/**
 * The marks of a leaderboard (records spec §4.2), from what the snapshot
 * already holds: a row's best lap is the record or the driver's best when it
 * is the same lap (time, driver, when it was driven). Only on the track and
 * direction the record belongs to.
 */
function markers(snap, session, standings) {
  const here = snap.track !== null && session.trackId === snap.track.id && session.direction === snap.direction;
  const record = here ? snap.record : null;
  const pbs = new Map(here ? snap.bests.map((b) => [b.driverId, b]) : []);
  const same = (lap, row) => lap !== null && lap !== undefined && row.bestMs !== null && lap.lapMs === row.bestMs && lap.at === row.bestAt;
  // The session's best lap: one row only, the earlier lap on a tie.
  let best = null;
  for (const row of standings) {
    if (row.bestMs !== null && (!best || row.bestMs < best.bestMs || (row.bestMs === best.bestMs && row.bestAt < best.bestAt))) best = row;
  }
  return {
    isBest: (row) => row === best,
    crown: (row) => crown(record?.driverId === row.driverId),
    best: (row) => {
      const pb = pbs.get(row.driverId);
      return html`${formatLap(row.bestMs)}${marks({ lapMs: row.bestMs, isRecord: record?.driverId === row.driverId && same(record, row), isPb: same(pb && { lapMs: pb.bestMs, at: pb.at }, row) })}${row === best ? html`<span class="visually-hidden">Session best</span>` : null}`;
    },
  };
}

/** "last lap 3 min ago" under a driver who has stopped (spec §2.3); hidden under a minute. */
function ago(snap, row) {
  const s = snap.session;
  if (!s || s.state === 'countdown' || row.lastAt === null || row.finished) return null;
  if (s.kind !== 'practice' && row.lastAt < s.opensAt) return null;
  const hidden = snap.now - row.lastAt < 60_000;
  return html`<tl-relative-time class="board-ago" now="${snap.now}" min="60000"${hidden ? html` hidden` : null}>last lap <time datetime="${new Date(row.lastAt).toISOString()}">${formatAgo(row.lastAt, snap.now)}</time></tl-relative-time>`;
}

function standingsTable(snap) {
  const race = snap.session?.kind === 'race';
  const last = new Map();
  for (const c of snap.crossings) if (c.lapMs !== null && c.driverId && !last.has(c.driverId)) last.set(c.driverId, c.lapMs);
  const m = markers(snap, snap.session, snap.standings);
  if (snap.standings.length === 0) return html`<p class="empty board-empty">No laps yet.</p>`;
  return html`<div class="board-scroll"><table class="board-table">
  <thead><tr><th scope="col">Pos</th><th scope="col">Driver</th><th scope="col" class="num">Laps</th><th scope="col" class="num">Best</th><th scope="col" class="num">Last</th>${race ? html`<th scope="col" class="num">Time</th>` : null}</tr></thead>
  <tbody>${snap.standings.map((row) => { const cls = [row.finished && 'is-finished', m.isBest(row) && 'is-best'].filter(Boolean).join(' '); return html`<tr${cls ? html` class="${cls}"` : null}>
    <td class="pos">${row.position}</td>
    <td class="board-driver">${chip(snap, row.driverId)}${m.crown(row)}${ago(snap, row)}</td>
    <td class="num">${row.laps}</td>
    <td class="num">${m.best(row)}</td>
    <td class="num">${formatLap(last.get(row.driverId))}</td>
    ${race ? html`<td class="num">${formatLap(row.elapsedMs)}</td>` : null}
  </tr>`; })}</tbody>
</table></div>`;
}

/** With no session running: the last one's final table, under its "Ended" header. */
function results(snap) {
  const r = snap.lastResults;
  const race = r.session.kind === 'race';
  const m = markers(snap, r.session, r.standings);
  return html`<section class="board-results" aria-label="Results">
  ${r.standings.length === 0 ? html`<p class="empty">No laps were counted.</p>` : html`<div class="board-scroll"><table class="board-table">
    <thead><tr><th scope="col">Pos</th><th scope="col">Driver</th><th scope="col" class="num">Laps</th><th scope="col" class="num">Best</th>${race ? html`<th scope="col" class="num">Time</th>` : null}</tr></thead>
    <tbody>${r.standings.map((row) => html`<tr${m.isBest(row) ? html` class="is-best"` : null}><td class="pos">${row.position}</td><td class="board-driver">${chip(snap, row.driverId)}${m.crown(row)}</td><td class="num">${row.laps}</td><td class="num">${m.best(row)}</td>${race ? html`<td class="num">${formatLap(row.elapsedMs)}</td>` : null}</tr>`)}</tbody>
  </table></div>`}
</section>`;
}

function feed(snap) {
  const laps = snap.crossings.filter((c) => c.lapMs !== null).slice(0, 12);
  return html`<aside class="board-feed" aria-label="Last laps">
  <h2 class="h3">Last laps</h2>
  ${laps.length === 0 ? html`<p class="empty">Laps show up here as cars cross the line.</p>` : html`<ol class="board-laps">${laps.map((c) => html`<li>${chip(snap, c.driverId)}<span class="num">${formatLap(c.lapMs)}</span>${c.via === 'tap' ? html`<span class="tag">tap</span>` : null}${!c.counts && c.driverId ? html`<span class="tag">not counted</span>` : null}</li>`)}</ol>`}
</aside>`;
}

function steps(request, snap) {
  const base = request.space.base;
  const where = snap.track && `${snap.track.name}, ${DIRECTION[snap.direction]}`;
  const n = snap.drivers.length;
  const step = (title, done, text, links) => html`<li class="board-step${done ? ' is-done' : ''}"><h3>${title}</h3><p>${done ?? text}</p>${links ? html`<p class="board-step-links">${links}</p>` : null}</li>`;
  return html`<section class="board-steps" aria-labelledby="board-steps-title">
  <h2 class="h3" id="board-steps-title">Get the track ready</h2>
  <ol>
    ${step('Choose the track', where, 'Paste a share link from the planner, and pick the direction you race.', where ? null : html`<a href="${base}/setup#track">Set the track</a>`)}
    ${step('Add drivers', n ? `${n} ${n === 1 ? 'driver' : 'drivers'}` : null, 'Give everyone a name, then their car’s transponder once it has crossed the line.', n ? null : html`<a href="${base}/setup#drivers">Add drivers</a>`)}
    ${step('Start timing', null, 'Connect the decoder by USB, or tap each crossing by hand.', html`<a href="${base}/bridge">Connect the decoder</a> <a href="${base}/tap">Tap laps by hand</a>`)}
  </ol>
</section>`;
}

/** Everything on the board that changes, in one element the stream replaces. */
export function boardLive(request, snap, { watcher = false, big = false, token = null } = {}) {
  const events = `${watcher ? `/watch/${token}` : `${request.space.base}/board`}/events${big ? '?big' : ''}`;
  const unknown = !watcher && !big && snap.unknown?.length
    ? html`<p class="status status-warning board-unknown" role="status">Unknown ${snap.unknown.length === 1 ? 'car' : 'cars'}: ${snap.unknown.join(', ')}. <a href="${request.space.base}/setup#transponders">Assign in Setup</a></p>`
    : null;
  // The display (?big) and the watchers never get a notice or a button (records spec §5.3).
  const notice = !watcher && !big ? idleNotice(request, snap.idle, snap.drivers) : null;
  const start = !watcher && !big && !snap.session && !notice ? startPracticeForm(request) : null;
  const main = snap.session ? standingsTable(snap)
    : snap.lastResults ? results(snap)
      : watcher ? html`<p class="empty board-empty">No laps yet.</p>` : steps(request, snap);
  return html`<div id="board-live" class="board" data-events="${events}">
${trackHeader(snap)}
${notice}
${header(snap, start)}
${unknown}
<div class="board-main">${main}</div>
${feed(snap)}
</div>`;
}

export function boardPage(request, snap, { watcher = false, big = false, token = null } = {}) {
  return layout(request, {
    title: watcher ? 'Live board' : 'Board',
    screen: watcher ? null : 'board',
    watcher,
    big,
    scripts: ['board.js', 'elements/board.js', 'elements/countdown.js'],
    modules: ['pkg/design/elements/relative-time.js', 'pkg/design/elements/local-time.js'],
    head: html`<noscript><meta http-equiv="refresh" content="10"></noscript>\n`,
    body: html`<tl-board status="live-status" sound="sound-switch" notify="notify-switch">\n${boardLive(request, snap, { watcher, big, token })}\n</tl-board>`,
  });
}
