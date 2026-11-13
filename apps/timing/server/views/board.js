// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board (spec §6.1), rendered on the server from engine.snapshot. All
// that changes lives in #board-live, which the stream replaces whole; the
// watchers board is the same without member parts. While a session runs it
// is the table and the last laps; while nobody races, the track record, the
// fastest here and the last session (named tracks spec §4).
import { clockAt, formatClock, formatLap } from '../../public/format.js';
import { formatAgo } from '@tinylap/design/format-ago.js';
import { localTime } from '@tinylap/design/html/local-time.js';
import { html, safe } from './html.js';
import { layout } from './layout.js';
import { directionIcon } from './direction.js';
import { chip as driverChip, idleNotice, markLetters, marks, marksHead, posHead, startPracticeForm, tableClasses, timeWidths } from './marks.js';

const KIND = { practice: 'Practice', qualifying: 'Qualifying', race: 'Race' };

/** What the session clock shows at server time `now`. */
export function clockOf(session, now) {
  if (!session) return null;
  const { label, ms } = clockAt({ ...session, opensAt: session.opensAt ?? null, closesAt: session.closesAt ?? null }, now);
  return { label, ms };
}

const chip = (snap, id, options) => driverChip(snap.drivers, id, options);

/** A record's time, holder and date, apart by their line's gap, not by dots: "7.412  Haris  12 Oct". */
const recordLine = (snap, r) => html`<span class="num board-track-time">${formatLap(r.lapMs)}</span> <span class="board-track-by cut-words">${chip(snap, r.driverId)}</span> <span class="board-track-by cut-words">${safe(localTime(r.at, 'date'))}</span>`;

/** The session's fastest lap's row: the fastest counted best, the earlier lap on a tie (fastest lap spec §2). */
function fastestRow(standings) {
  let best = null;
  for (const row of standings) {
    if (row.bestMs !== null && (!best || row.bestMs < best.bestMs || (row.bestMs === best.bestMs && row.bestAt < best.bestAt))) best = row;
  }
  return best;
}

/**
 * One of the strip's two times to beat (fastest lap spec §3.1): the time, its
 * mark, the driver, and no words on screen; the line's name is for screen
 * readers. Without a lap, a muted dash and the mark, and the line's title says why.
 */
function toBeat(snap, { kind, letters, title, name, none }, lap, attributes = null) {
  const mark = markLetters(letters.toLowerCase(), letters, title);
  if (!lap) return html`<p class="board-${kind}-line lap-credit is-empty" title="${none}"${attributes}><span class="visually-hidden">${name}: ${none.toLowerCase()}</span><span class="num board-track-time" aria-hidden="true">—</span>${mark}</p>`;
  return html`<p class="board-${kind}-line lap-credit"${attributes}><span class="visually-hidden">${name} </span><span class="num board-track-time">${formatLap(lap.lapMs)}</span><span class="visually-hidden">, </span>${mark}${chip(snap, lap.driverId)}</p>`;
}

/**
 * The strip's two times to beat while a session runs: the track record, then
 * the session's fastest lap. The fastest lap's line is a polite live region,
 * which tl-board keeps across swaps, so a new fastest lap is read out.
 */
function timesToBeat(snap) {
  const best = fastestRow(snap.standings);
  return html`<div class="board-track-times">
    ${toBeat(snap, { kind: 'record', letters: 'TR', title: 'Track record', name: 'Track record', none: 'No record yet' }, snap.record)}
    ${toBeat(snap, { kind: 'fastest', letters: 'FL', title: 'Fastest lap of the session', name: 'Fastest lap', none: 'No laps yet' }, best && { lapMs: best.bestMs, driverId: best.driverId }, html` role="status"`)}
  </div>`;
}

/** One item per decoder heard in the last 30 minutes, beside the track (decoder connections spec §6). */
function decoderStates(snap) {
  const words = { reporting: 'reporting', idle: 'idle', offline: 'not reporting' };
  if (!snap.decoders?.length) return null;
  return html`<ul class="board-decoders" role="list" aria-label="Decoders">${snap.decoders.map((d) => html`<li class="board-decoder is-${d.state}">${d.name}: ${words[d.state]}</li>`)}</ul>`;
}

/**
 * The track, its direction as an icon, and while a session runs the two times
 * to beat, above every board (records spec §5.1, named tracks spec §4,
 * fastest lap spec §3.1). While nobody races the record is the big thing
 * below, so the header leaves them out. While a record has just
 * fallen it is in the record state (§4.3): the new time and holder in the
 * record colour, and the record it beat; the record lap is the fastest lap
 * too, so that line waits until the state is over. While nobody races it is the top
 * band of the record card (`band`, drivers and transponders spec §4).
 */
function trackHeader(snap, { band = false } = {}) {
  const states = decoderStates(snap);
  const where = html`<p class="board-track-name"><strong class="cut-words">${snap.track.name}</strong> ${directionIcon(snap.direction)}</p>`;
  const n = snap.recordNew;
  if (n) {
    return html`<header class="board-track is-record" data-record-new="${n.seq}">
  ${where}
  <div class="board-track-record">
    <p class="board-track-new cut-words"><strong class="board-track-label">New track record</strong> <span class="num board-track-time">${formatLap(n.lapMs)}</span> ${chip(snap, n.driverId)}</p>
    ${n.beat ? html`<p class="board-track-beat cut-words">Beat ${recordLine(snap, n.beat)}</p>` : null}
  </div>
  ${states}
</header>`;
  }
  return html`<header class="board-track${band ? ' is-band' : ''}">
  ${where}
  ${snap.session ? timesToBeat(snap) : null}
  ${states}
</header>`;
}

/**
 * The running session's title and clock. A practice counts up under "Started
 * 14:32", written here alone: tl-countdown changes only the labels marked
 * data-clock-label, so it leaves this one as it is.
 */
function header(snap) {
  const s = snap.session;
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

function feed(snap) {
  const m = markers(snap, snap.session, snap.standings);
  const laps = snap.crossings.filter((c) => c.lapMs !== null).slice(0, 12);
  return html`<aside class="board-feed" aria-label="Last laps">
  <h2 class="h3">Last laps</h2>
  ${laps.length === 0 ? html`<p class="empty">Laps show up here as cars cross the line.</p>` : html`<ol class="board-laps${timeWidths(laps.map((c) => c.lapMs))}">${laps.map((c) => html`<li${c.counts ? null : html` class="is-not-counted"`}>${chip(snap, c.driverId)}<span class="board-laps-tags">${c.via === 'tap' ? html`<span class="tag">Tap</span>` : null}${!c.counts && c.driverId ? html`<span class="tag">Not counted</span>` : null}</span><span class="num">${formatLap(c.lapMs)}</span>${m.lap(c)}</li>`)}</ol>`}
</aside>`;
}

/** What a record beat: "beat Mia’s 8.200", or "beat their own 8.200". */
const beaten = (snap, r) => html`, beat ${r.beat.driverId === r.driverId ? 'their own' : html`${chip(snap, r.beat.driverId)}’s`} <span class="num">${formatLap(r.beat.lapMs)}</span>`;

/**
 * The track record as the big thing (named tracks spec §4): the time, the
 * holder (no crown: the card says whose record it is), when it was set and what it beat. Beside it, for
 * members on their own screen, Start practice: over it the line saying a car
 * is on the track, under it the transponders not assigned yet, quietly; and
 * while nobody races, the track strip as its top band.
 */
function hero(request, snap, members, band) {
  const r = snap.record;
  // While a record has just fallen the card says so like the strip, so tl-board can play its moment here.
  return html`<section class="board-hero"${snap.recordNew ? html` data-record-new="${snap.recordNew.seq}"` : null}>
  ${band}
  <div class="board-hero-record lap-credit">
    <h1 class="board-hero-label">Track record</h1>
    ${r ? html`<p class="num board-hero-time">${formatLap(r.lapMs)}</p>
    <p class="board-hero-by cut-words">${chip(snap, r.driverId)} set ${safe(localTime(r.at, 'datetime-short'))}${r.beat ? beaten(snap, r) : null}</p>` : html`<p class="board-hero-none">No record yet</p>`}
  </div>
  ${members ? go(request, snap) : null}
</section>`;
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

/** Start practice, with the car on the track over it and the transponders not assigned yet under it, quietly. */
function go(request, snap) {
  const base = request.space.base;
  const n = snap.unknown.length;
  const quiet = n
    ? html`<p class="board-quiet" role="status">${n === 1 ? html`Transponder ${snap.unknown[0]} isn't assigned yet.` : html`${n} transponders aren't assigned yet.`} <a href="${assignHref(base, snap.unknown)}">${n === 1 ? 'Assign it' : 'Assign them'}</a></p>`
    : html`<p class="board-quiet">Or a <a href="${base}/sessions#start-title">qualifying or race</a>.</p>`;
  return html`<div class="board-hero-go">
    ${idleNotice(snap.idle, snap.drivers)}
    ${startPracticeForm(request)}
    ${quiet}
  </div>`;
}

/**
 * Each driver's best on the current track and direction, fastest first. The
 * first is the track record, marked TR as on every other list; the rest are
 * each their driver's best, which a PB mark would only repeat.
 */
function fastest(snap) {
  if (!snap.fastest.length) return null;
  const isRecord = (b) => snap.record?.driverId === b.driverId && snap.record?.lapMs === b.bestMs;
  return html`<section class="board-fastest" aria-labelledby="board-fastest-title">
  <h2 class="h3" id="board-fastest-title">Fastest on this track</h2>
  <ol class="board-ranks lap-credit">${snap.fastest.map((b, i) => html`<li><span class="pos">${i + 1}</span><span class="board-driver">${chip(snap, b.driverId)}</span><span class="num">${formatLap(b.bestMs)}</span>${marks({ lapMs: b.bestMs, isRecord: isRecord(b), isPb: false }, { list: true })}</li>`)}</ol>
</section>`;
}

/** The last session's top three, with their marks, when it ended, and a link to its page on a member's own screen. */
function lastSession(request, snap, link) {
  const r = snap.lastResults;
  if (!r) return null;
  const m = markers(snap, r.session, r.standings);
  const ended = r.session.endedAt ?? r.session.createdAt;
  return html`<section class="board-last" aria-labelledby="board-last-title">
  <h2 class="h3" id="board-last-title">Last session</h2>
  ${r.standings.length === 0 ? html`<p class="empty">No laps were counted.</p>` : html`<ol class="board-ranks lap-credit">${r.standings.slice(0, 3).map((row) => html`<li><span class="pos">${row.position}</span><span class="board-driver">${chip(snap, row.driverId, { holder: m.holder(row) })}</span><span class="num">${formatLap(row.bestMs)}</span>${m.mark(row, true)}</li>`)}</ol>`}
  <p class="board-last-meta">${KIND[r.session.kind]}, ended ${safe(localTime(ended, 'datetime-short'))}${r.session.state === 'aborted' ? html` <span class="tag">Aborted</span>` : null}${link ? html` · <a href="${request.space.base}/sessions/${r.session.id}">All laps</a>` : null}</p>
</section>`;
}

/** A club that has never driven a lap: one card instead of an empty board; its button the next thing to do. */
function firstRun(request, snap) {
  const base = request.space.base;
  const drivers = html`<a${snap.drivers.length ? null : html` class="btn btn-primary"`} href="${base}/setup#drivers">Add drivers</a>`;
  const decoder = html`<a${snap.drivers.length ? html` class="btn btn-primary"` : null} href="${base}/bridge">Connect the decoder</a>`;
  return html`<section class="board-first" aria-labelledby="board-first-title">
  <h1 id="board-first-title">Ready when your cars are</h1>
  <p>Add your drivers, then connect the decoder. The first lap sets the track record.</p>
  <p class="board-first-links">
    ${snap.drivers.length ? html`${decoder}
    ${drivers}` : html`${drivers}
    ${decoder}`}
    <a href="${base}/tap">Tap laps by hand</a>
  </p>
</section>`;
}

/** Whether the idle board is the first-run card: a member's own screen, for a club that has never driven. */
const isFirstRun = (snap, { watcher, big }) => !watcher && !big && !snap.driven && !snap.idle;

/** The board while nobody races: the record and what is worth seeing, not warnings. `band` is the track strip, when it is the record card's top. */
function idleBoard(request, snap, { watcher, big, band }) {
  // The display (?big) and the watchers never get a member line or a button (records spec §5.3).
  const members = !watcher && !big;
  if (isFirstRun(snap, { watcher, big })) return firstRun(request, snap);
  const lists = [fastest(snap), lastSession(request, snap, members)].filter(Boolean);
  // Under the card whose top band names the decoders, a warning that one has gone quiet.
  return html`${hero(request, snap, members, band)}
${band ? offlineBanners(snap) : null}
${lists.length ? html`<div class="board-idle${timeWidths([...snap.fastest.map((b) => b.bestMs), ...(snap.lastResults?.standings ?? []).slice(0, 3).map((row) => row.bestMs)])}">${lists}</div>` : null}`;
}

/** One warning per Wi-Fi decoder that has gone quiet (decoder Wi-Fi spec §6); its laps arrive once it is back. */
function offlineBanners(snap) {
  return (snap.offline ?? []).map((decoder) => html`<p class="status status-warning flag board-offline" role="status">${decoder.name} isn't reporting. Laps will appear once it's back.</p>`);
}

/** Everything on the board that changes, in one element the stream replaces. */
export function boardLive(request, snap, { watcher = false, big = false, token = null } = {}) {
  const events = `${watcher ? `/watch/${token}` : `${request.space.base}/board`}/events${big ? '?big' : ''}`;
  if (!snap.session) {
    // The strip is the record card's top band (spec §4), unless a record has just fallen or there is no card yet.
    const band = !snap.recordNew && !isFirstRun(snap, { watcher, big }) ? trackHeader(snap, { band: true }) : null;
    return html`<div id="board-live" class="board is-idle" data-events="${events}">
${band ? null : trackHeader(snap)}
${band ? null : offlineBanners(snap)}
${idleBoard(request, snap, { watcher, big, band })}
</div>`;
  }
  // A transponder not assigned yet loses its laps while a session runs: that is worth a warning (spec §4).
  const codes = !watcher && !big && snap.unknown?.length ? byNumber(snap.unknown) : [];
  const unknown = codes.length
    ? html`<p class="status status-warning flag board-unknown" role="status">${codes.length === 1
      ? html`Transponder ${codes[0]} isn't assigned yet, so its laps aren't counted.`
      : html`Transponders ${andList(codes)} aren't assigned yet, so their laps aren't counted.`} <a href="${assignHref(request.space.base, codes)}">${codes.length === 1 ? 'Assign it' : 'Assign them'}</a></p>`
    : null;
  return html`<div id="board-live" class="board" data-events="${events}">
${trackHeader(snap)}
${offlineBanners(snap)}
${header(snap)}
${unknown}
<div class="board-main">${standingsTable(snap)}</div>
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
    body: html`<tl-board status="live-status" sound="sound-switch" notify="notify-setting">\n${boardLive(request, snap, { watcher, big, token })}\n</tl-board>`,
  });
}
