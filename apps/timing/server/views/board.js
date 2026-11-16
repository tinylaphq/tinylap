// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board (spec §6.1), rendered on the server from engine.snapshot. All
// that changes lives in #board-live, which the stream replaces whole; the
// watchers board is the same without member parts. Every board is headed by
// the strip (board hub spec §3). While a session runs it is the table and the
// last laps; while nobody races, the latest result on this track, and beside
// it the fastest here (board hub spec §4). On a member's own board the Start
// panel (views/start.js) sits beside #board-live, outside it (§5).
import { clockAt, formatClock, formatLap } from '../../public/format.js';
import { formatAgo } from '@tinylap/design/format-ago.js';
import { localTime } from '@tinylap/design/html/local-time.js';
import { html, safe } from './html.js';
import { layout } from './layout.js';
import { directionIcon } from './direction.js';
import { chip as driverChip, marks, marksHead, posHead, tableClasses, timeWidths } from './marks.js';
import { resultOf, resultView } from './result.js';
import { shortLength } from './sessions.js';
import { boardStart } from './start.js';

const KIND = { practice: 'Practice', qualifying: 'Qualifying', race: 'Race' };

/** What the session clock shows at server time `now`. */
export function clockOf(session, now) {
  if (!session) return null;
  const { label, ms } = clockAt({ ...session, opensAt: session.opensAt ?? null, closesAt: session.closesAt ?? null }, now);
  return { label, ms };
}

const chip = (snap, id, options) => driverChip(snap.drivers, id, options);

/** The session's fastest lap's row: the fastest counted best, the earlier lap on a tie (fastest lap spec §2). */
function fastestRow(standings) {
  let best = null;
  for (const row of standings) {
    if (row.bestMs !== null && (!best || row.bestMs < best.bestMs || (row.bestMs === best.bestMs && row.bestAt < best.bestAt))) best = row;
  }
  return best;
}

/** The record's crown at the end of its cell, for the eye only: the label says whose record it is. */
const stripCrown = html`<svg class="crown strip-crown" viewBox="0 0 26 18" aria-hidden="true"><path d="M1.125 16.875V4.5l6.5 5.5L13 1.6l5.375 8.4 6.5-5.5v12.475Z"/></svg>`;

/**
 * The strip's record cell (board hub spec §3), the track's headline: filled in
 * the record's colour, its label, the time, who drove it and when, and the
 * crown; no TR mark, the fill says it. With no record yet the cell keeps its
 * place, unfilled. While a record has just fallen it says so: "New track
 * record", the new time and holder, and the record it beat.
 */
function recordCell(snap) {
  const n = snap.recordNew;
  if (n) {
    return html`<p class="strip-cell is-record is-new board-record-line"><span class="strip-label">New track record</span><span class="num strip-figure">${formatLap(n.lapMs)}</span><span class="strip-by">${chip(snap, n.driverId)}</span>${n.beat ? html`<span class="strip-beat">Beat <span class="num">${formatLap(n.beat.lapMs)}</span> ${chip(snap, n.beat.driverId)}</span>` : null}${stripCrown}</p>`;
  }
  const r = snap.record;
  if (!r) return html`<p class="strip-cell is-record is-empty board-record-line"><span class="strip-label">Track record</span><span class="strip-none">None yet</span><span class="strip-by">The first lap sets it.</span></p>`;
  return html`<p class="strip-cell is-record board-record-line"><span class="strip-label">Track record</span><span class="num strip-figure">${formatLap(r.lapMs)}</span><span class="strip-by">${chip(snap, r.driverId)} <span class="strip-when">${safe(localTime(r.at, 'date'))}</span></span>${stripCrown}</p>`;
}

/**
 * The strip's fastest lap cell while a session runs (§3): the session's
 * fastest lap and its driver, filled in the fastest lap's colour; before any
 * lap counts, unfilled. It is a polite live region, which tl-board keeps
 * across swaps, so a new fastest lap is read out.
 */
function fastestCell(snap) {
  const best = fastestRow(snap.standings);
  if (!best) return html`<p class="strip-cell is-fastest is-empty board-fastest-line" role="status"><span class="strip-label">Fastest lap</span><span class="strip-none">No laps yet</span></p>`;
  return html`<p class="strip-cell is-fastest board-fastest-line" role="status"><span class="strip-label">Fastest lap</span><span class="num strip-figure">${formatLap(best.bestMs)}</span><span class="strip-by">${chip(snap, best.driverId)}</span></p>`;
}

/** One item per decoder heard in the last 30 minutes, beside the track (decoder connections spec §6). */
function decoderStates(snap) {
  const words = { reporting: 'reporting', idle: 'idle', offline: 'not reporting' };
  if (!snap.decoders?.length) return null;
  return html`<ul class="board-decoders" role="list" aria-label="Decoders">${snap.decoders.map((d) => html`<li class="board-decoder is-${d.state}">${d.name}: ${words[d.state]}</li>`)}</ul>`;
}

/**
 * The strip (board hub spec §3): one box above every board, the same on each.
 * On the left where you are: the track, its direction as an icon, its
 * decoders. On the right the track record and, while a session runs, the
 * session's fastest lap beside it. While a record has just fallen it carries
 * data-record-new, so tl-board plays the record moment on its record cell.
 */
function strip(snap) {
  const n = snap.recordNew;
  return html`<header class="board-track strip${snap.session ? ' is-live' : ''}"${n ? html` data-record-new="${n.seq}"` : null}>
  <div class="strip-where">
    <p class="board-track-name"><strong class="cut-words">${snap.track.name}</strong> ${directionIcon(snap.direction)}</p>
    ${decoderStates(snap)}
  </div>
  <div class="strip-cells">
    ${recordCell(snap)}
    ${snap.session ? fastestCell(snap) : null}
  </div>
</header>`;
}

/**
 * What runs, in a few words (board hub spec §4.2): "4 drivers, 10 min",
 * "Everyone on the track, 10 min" with no roster, "Every car with a driver"
 * for a practice.
 */
function sessionWords(s) {
  if (s.kind === 'practice') return 'Every car with a driver';
  const length = s.durationMs ? `, ${shortLength(s.durationMs)}` : '';
  const n = s.roster?.length ?? 0;
  return `${n ? `${n} driver${n === 1 ? '' : 's'}` : 'Everyone on the track'}${length}`;
}

/**
 * The running session's title and clock. Under the title what runs and, on a
 * member's own screen, End (practice) or Abort (race, qualifying): a link to
 * its confirm page, which returns to the board. A practice counts up under
 * "Started 14:32", written here alone: tl-countdown changes only the labels
 * marked data-clock-label, so it leaves this one as it is.
 */
function header(request, snap, { members }) {
  const s = snap.session;
  const clock = clockOf(s, snap.now);
  const label = s.kind === 'practice'
    ? html`<span class="stat-label board-clock-label">${clock.label} ${safe(localTime(s.opensAt, 'time'))}</span>`
    : html`<span class="stat-label board-clock-label" data-clock-label>${clock.label}</span>`;
  return html`<header class="board-head">
  <div class="board-title-block">
    <h1 class="board-title">${KIND[s.kind]}</h1>
    <p class="board-session-line"><span>${sessionWords(s)}</span>${members ? html` <a class="btn btn-outline btn-sm board-stop" href="${request.space.base}/sessions/${s.id}/${s.kind === 'practice' ? 'end' : 'abort'}">${s.kind === 'practice' ? 'End' : 'Abort'}</a>` : null}</p>
  </div>
  <tl-countdown class="board-clock">${label}<time class="board-clock-time" data-clock data-kind="${s.kind}" data-state="${s.state}" data-opens="${s.opensAt ?? ''}" data-closes="${s.closesAt ?? ''}" data-now="${snap.now}">${formatClock(clock.ms)}</time></tl-countdown>
</header>`;
}

/**
 * The marks of a leaderboard (records spec §4.2, fastest lap spec §2), from
 * what the snapshot already holds: a row's best lap is the record or the
 * driver's best when it is the same lap (time, driver, when it was driven).
 * The record and personal bests only on the track and direction they belong
 * to. FL on the session's fastest lap, in every kind of session: in a table
 * sorted by best lap it is row 1's.
 */
function markers(snap, session, standings) {
  const here = session.trackId === snap.track.id && session.direction === snap.direction;
  const record = here ? snap.record : null;
  const pbs = new Map(here ? snap.bests.map((b) => [b.driverId, b]) : []);
  const same = (lap, row) => lap !== null && lap !== undefined && row.bestMs !== null && lap.lapMs === row.bestMs && lap.at === row.bestAt;
  // The session's fastest lap: one row only, the earlier lap on a tie.
  const best = fastestRow(standings);
  const fastest = best && { driverId: best.driverId, lapMs: best.bestMs, at: best.bestAt };
  return {
    /** Whether the row's driver holds the record: their name gets the crown. */
    holder: (row) => record?.driverId === row.driverId,
    /** The mark cell after a row's best lap; in a list, a span. */
    mark: (row, list = false) => {
      const pb = pbs.get(row.driverId);
      return marks({ lapMs: row.bestMs, isRecord: record?.driverId === row.driverId && same(record, row), isFastest: row === best, isPb: same(pb && { lapMs: pb.bestMs, at: pb.at }, row) }, { list });
    },
    /**
     * The mark after a lap in Last laps (fastest lap spec §3.3): TR on the
     * record's lap, FL on the current fastest lap, and no PB, which would
     * mark every early lap.
     */
    lap: (c) => {
      const is = (lap) => Boolean(lap) && c.counts && c.driverId === lap.driverId && c.lapMs === lap.lapMs && c.at === lap.at;
      return marks({ lapMs: c.lapMs, isRecord: is(record), isFastest: is(fastest), isPb: false }, { list: true });
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

/**
 * The moment its row plays, when its driver's latest counted lap set a mark that plays (fastest lap spec §4.1):
 * `data-moment="<seq> fl|pb|tr"`. The server decides it; tl-board plays each seq once.
 */
function moment(snap, row) {
  const m = snap.moments?.[row.driverId];
  return m ? html` data-moment="${m.seq} ${m.mark}"` : null;
}

/**
 * The leaderboard. Its columns have fixed widths (app.css), so a live update
 * never moves one; the driver takes what is left. A race's Last column goes on
 * a phone, where the feed below repeats it. A driver who has finished keeps
 * their row as it was, with the chequered flag after their position.
 */
function standingsTable(snap) {
  const race = snap.session?.kind === 'race';
  // The last counted lap: one before the session opened is in the feed, marked, not here.
  const last = new Map();
  for (const c of snap.crossings) if (c.lapMs !== null && c.driverId && c.counts && !last.has(c.driverId)) last.set(c.driverId, c.lapMs);
  const m = markers(snap, snap.session, snap.standings);
  if (snap.standings.length === 0) return html`<p class="empty board-empty">No laps yet.</p>`;
  return html`<div class="board-scroll"><table class="board-table standings-table${race ? ' is-race' : ''}${tableClasses({ positions: snap.standings.length, flags: race })}${timeWidths([...snap.standings.map((row) => row.bestMs), ...last.values()], snap.standings.map((row) => row.elapsedMs))}">
  <colgroup><col class="col-pos"><col><col class="col-laps"><col class="col-time"><col class="col-mark"><col class="col-time col-last">${race ? html`<col class="col-total">` : null}</colgroup>
  <thead><tr>${posHead}<th scope="col">Driver</th><th scope="col" class="num">Laps</th><th scope="col" class="num">Best</th>${marksHead}<th scope="col" class="num col-last">Last</th>${race ? html`<th scope="col" class="num">Time</th>` : null}</tr></thead>
  <tbody>${snap.standings.map((row) => html`<tr${row.finished ? html` class="is-finished"` : null} data-driver="${row.driverId}"${moment(snap, row)}>
    <td class="pos">${row.position}${row.finished ? html`<span class="finish" role="img" aria-label="Finished" title="Finished"></span>` : null}</td>
    <td class="board-driver">${chip(snap, row.driverId, { holder: m.holder(row) })}${ago(snap, row)}</td>
    <td class="num">${row.laps}</td>
    <td class="num">${formatLap(row.bestMs)}</td>
    ${m.mark(row)}
    <td class="num col-last">${formatLap(last.get(row.driverId))}</td>
    ${race ? html`<td class="num">${formatLap(row.elapsedMs)}</td>` : null}
  </tr>`)}</tbody>
</table></div>`;
}

/** Last laps: the twelve newest, eleven on the big screen, where a twelfth runs past a 1080 screen. */
function feed(snap, big = false) {
  const m = markers(snap, snap.session, snap.standings);
  const laps = snap.crossings.filter((c) => c.lapMs !== null).slice(0, big ? 11 : 12);
  return html`<aside class="board-feed" aria-label="Last laps">
  <h2 class="h3">Last laps</h2>
  ${laps.length === 0 ? html`<p class="empty">Laps show up here as cars cross the line.</p>` : html`<ol class="board-laps${timeWidths(laps.map((c) => c.lapMs))}">${laps.map((c) => html`<li${c.counts ? null : html` class="is-not-counted"`}>${chip(snap, c.driverId)}<span class="board-laps-tags">${c.via === 'tap' ? html`<span class="tag tag-sm">Tap</span>` : null}${!c.counts && c.driverId ? html`<span class="tag tag-sm">Not counted</span>` : null}</span><span class="num">${formatLap(c.lapMs)}</span>${m.lap(c)}</li>`)}</ol>`}
</aside>`;
}

/** "41", "41 and 52", "41, 52 and 66". @param {string[]} codes */
const andList = (codes) => codes.length < 2 ? codes.join('') : `${codes.slice(0, -1).join(', ')} and ${codes.at(-1)}`;

/**
 * Where "Assign it" or "Assign them" goes (spec §4): one transponder to its
 * form, back to the board after; several to the page that collects them.
 */
const assignHref = (base, unknown) => unknown.length === 1
  ? `${base}/transponders/${encodeURIComponent(unknown[0])}?returnTo=${encodeURIComponent(`${base}/board`)}`
  : `${base}/transponders/new`;

/**
 * The unassigned transponders by number, so the line reads the same, and is
 * not announced again, while their cars keep crossing.
 */
const byNumber = (codes) => [...codes].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

/** The transponders not assigned yet while nobody races, quietly: their laps are not lost yet. */
function unassigned(request, snap) {
  const n = snap.unknown?.length ?? 0;
  if (!n) return null;
  return html`<p class="board-quiet" role="status">${n === 1 ? html`Transponder ${snap.unknown[0]} isn't assigned yet.` : html`${n} transponders aren't assigned yet.`} <a href="${assignHref(request.space.base, snap.unknown)}">${n === 1 ? 'Assign it' : 'Assign them'}</a></p>`;
}

/**
 * Each driver's best on the current track and direction, fastest first. The
 * first is the track record, marked TR as on every other list; the rest are
 * each their driver's best, which a PB mark would only repeat.
 */
const fastestList = (snap) => {
  const isRecord = (b) => snap.record?.driverId === b.driverId && snap.record?.lapMs === b.bestMs;
  return html`<ol class="board-ranks lap-credit${timeWidths(snap.fastest.map((b) => b.bestMs))}">${snap.fastest.map((b, i) => html`<li><span class="pos">${i + 1}</span><span class="board-driver">${chip(snap, b.driverId)}</span><span class="num">${formatLap(b.bestMs)}</span>${marks({ lapMs: b.bestMs, isRecord: isRecord(b), isPb: false }, { list: true })}</li>`)}</ol>`;
};

const RESULT_TITLE = { practice: 'Practice result', qualifying: 'Qualifying result', race: 'Race result' };

/**
 * The left of the idle board (board hub spec §4.1): the latest finished
 * session on this track as its result, under its head ("Race result", "Ended
 * at 20:26", Full results on a member's own screen), nothing inside it a link.
 * The TV stops it after P6 (§6.4). With no finished session here, "No sessions
 * yet" and one sentence in the result's place.
 */
function latestResult(request, snap, { members, big }) {
  const latest = snap.latest;
  if (!latest) {
    return html`<section class="board-result is-none" aria-labelledby="result-title">
  <div class="result-head is-board"><h1 class="board-result-title" id="result-title">No sessions yet</h1></div>
  <div class="board-none"><p>Start a session and drive. Every lap shows up here as it is timed, and the first one sets the track record on ${snap.track.name}.</p></div>
</section>`;
  }
  const { session } = latest;
  const result = resultOf(latest);
  const body = result.rows.length === 0
    ? html`<p class="empty">No laps were counted.</p>`
    : resultView(result, { drivers: snap.drivers, links: false, upTo: big ? 6 : Infinity });
  return html`<section class="board-result" aria-labelledby="result-title">
  <div class="result-head is-board"><h1 class="board-result-title" id="result-title">${RESULT_TITLE[session.kind]}</h1><p class="result-when">Ended at ${safe(localTime(session.endedAt ?? session.createdAt, 'time'))}</p>${members ? html`<a href="${request.space.base}/sessions/${session.id}">Full results</a>` : null}</div>
  ${body}
</section>`;
}

/**
 * The right of the idle board: on a member's own screen Fastest on this track,
 * under the Start panel that sits beside #board-live (board hub spec §5); on
 * the watchers' board Fastest on this track alone, under the side's title. The
 * TV has no side (§4.3).
 */
function side(request, snap, { members }) {
  const any = snap.fastest.length > 0;
  if (!any) return null;
  if (members) {
    return html`<section class="board-fastest is-side" aria-labelledby="board-fastest-title">
  <h2 class="h3" id="board-fastest-title">Fastest on this track</h2>
  ${fastestList(snap)}
</section>`;
  }
  return html`<aside class="board-next" aria-labelledby="board-fastest-title">
  <h2 class="board-next-title" id="board-fastest-title">Fastest on this track</h2>
  <div class="board-next-body">${fastestList(snap)}</div>
</aside>`;
}

/**
 * The board while nobody races (board hub spec §4.1): the strip, today's
 * warnings above the result, the result, and the side. The TV and the
 * watchers have no controls and no links.
 */
function idleBoard(request, snap, { watcher, big, events }) {
  const members = !watcher && !big;
  const notices = [...offlineBanners(snap), members ? unassigned(request, snap) : null].filter(Boolean);
  return html`<div id="board-live" class="board is-idle" data-events="${events}">
${strip(snap)}
${notices.length ? html`<div class="board-notices">${notices}</div>` : null}
${latestResult(request, snap, { members, big })}
${big ? null : side(request, snap, { members })}
</div>`;
}

/** One warning per Wi-Fi decoder that has gone quiet (decoder Wi-Fi spec §6); its laps arrive once it is back. */
function offlineBanners(snap) {
  return (snap.offline ?? []).map((decoder) => html`<p class="status status-warning flag board-offline" role="status">${decoder.name} isn't reporting. Laps will appear once it's back.</p>`);
}

/** Everything on the board that changes, in one element the stream replaces. */
export function boardLive(request, snap, { watcher = false, big = false, token = null } = {}) {
  const events = `${watcher ? `/watch/${token}` : `${request.space.base}/board`}/events${big ? '?big' : ''}`;
  if (!snap.session) return idleBoard(request, snap, { watcher, big, events });
  // A transponder not assigned yet loses its laps while a session runs: that is worth a warning (spec §4).
  const codes = !watcher && !big && snap.unknown?.length ? byNumber(snap.unknown) : [];
  const unknown = codes.length
    ? html`<p class="status status-warning flag board-unknown" role="status">${codes.length === 1
      ? html`Transponder ${codes[0]} isn't assigned yet, so its laps aren't counted.`
      : html`Transponders ${andList(codes)} aren't assigned yet, so their laps aren't counted.`} <a href="${assignHref(request.space.base, codes)}">${codes.length === 1 ? 'Assign it' : 'Assign them'}</a></p>`
    : null;
  return html`<div id="board-live" class="board" data-events="${events}">
${strip(snap)}
${offlineBanners(snap)}
${header(request, snap, { members: !watcher && !big })}
${unknown}
<div class="board-main">${standingsTable(snap)}</div>
${feed(snap, big)}
</div>`;
}

/**
 * The board: #board-live and, on a member's own screen, the Start panel beside
 * it (board hub spec §5). `start` is a failed start's errors and values, shown
 * again. Without script the page reloads every ten seconds only while a session
 * runs, so a reload never takes a half-filled form away.
 */
export function boardPage(request, snap, { watcher = false, big = false, token = null, start = {} } = {}) {
  return layout(request, {
    title: watcher ? 'Live board' : 'Board',
    screen: watcher ? null : 'board',
    watcher,
    big,
    scripts: ['board.js', 'elements/board.js', 'elements/countdown.js'],
    modules: ['pkg/design/elements/relative-time.js', 'pkg/design/elements/local-time.js'],
    head: snap.session ? html`<noscript><meta http-equiv="refresh" content="10"></noscript>\n` : null,
    body: html`<tl-board status="live-status" sound="sound-switch" notify="notify-setting">\n${boardLive(request, snap, { watcher, big, token })}\n${watcher || big ? null : boardStart(request, snap, start)}\n</tl-board>`,
  });
}
