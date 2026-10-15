// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board (spec §6.1), rendered on the server from engine.snapshot. All
// that changes lives in #board-live, which the stream replaces whole; the
// watchers board is the same without member parts.
import { formatClock, formatLap } from '../../public/format.js';
import { html } from './html.js';
import { layout } from './layout.js';

const KIND = { practice: 'Practice', qualifying: 'Qualifying', race: 'Race' };
const DIRECTION = { cw: 'clockwise', ccw: 'anticlockwise' };

/** What the session clock shows at server time `now`. */
export function clockOf(session, now) {
  if (!session) return null;
  if (session.state === 'countdown') return { label: 'Starts in', ms: session.opensAt - now };
  if (session.kind === 'practice' && (session.state === 'done' || session.state === 'aborted')) return { label: 'Practice ended', ms: 0 };
  if (session.kind === 'practice') return { label: 'Practice', ms: now - session.opensAt };
  if (session.state === 'running') return { label: 'Remaining', ms: Math.max(0, session.closesAt - now) };
  if (session.state === 'finishing') return { label: 'Last lap', ms: 0 };
  return { label: session.state === 'aborted' ? 'Aborted' : 'Finished', ms: 0 };
}

function chip(snap, id) {
  const d = snap.drivers.find((x) => x.id === id);
  if (!d) return html`<span class="driver">${id ? 'former driver' : 'unknown car'}</span>`;
  return html`<span class="driver" style="--driver: ${d.colour}">${d.name}</span>`;
}

function header(snap) {
  const s = snap.session;
  const clock = clockOf(s, snap.now);
  const where = snap.track ? `${snap.track.name} · ${DIRECTION[snap.direction]}` : 'No track set';
  return html`<header class="board-head">
  <div><p class="eyebrow">${where}</p><h1 class="board-title">${s ? KIND[s.kind] : 'Waiting for the first car'}</h1></div>
  ${clock ? html`<div class="board-clock"><span class="stat-label board-clock-label">${clock.label}</span><time class="board-clock-time" data-clock data-kind="${s.kind}" data-state="${s.state}" data-opens="${s.opensAt ?? ''}" data-closes="${s.closesAt ?? ''}" data-now="${snap.now}">${formatClock(clock.ms)}</time></div>` : null}
</header>`;
}

function standingsTable(snap) {
  const race = snap.session?.kind === 'race';
  const last = new Map();
  for (const c of snap.crossings) if (c.lapMs !== null && c.driverId && !last.has(c.driverId)) last.set(c.driverId, c.lapMs);
  const best = new Map(snap.bests.map((b) => [b.driverId, b.bestMs]));
  if (snap.standings.length === 0) return html`<p class="empty board-empty">No laps yet.</p>`;
  return html`<div class="board-scroll"><table class="board-table">
  <thead><tr><th scope="col">Pos</th><th scope="col">Driver</th><th scope="col" class="num">Laps</th><th scope="col" class="num">Best</th><th scope="col" class="num">Last</th>${race ? html`<th scope="col" class="num">Time</th>` : null}</tr></thead>
  <tbody>${snap.standings.map((row) => html`<tr${row.finished ? html` class="is-finished"` : null}>
    <td class="pos">${row.position}</td>
    <td>${chip(snap, row.driverId)}</td>
    <td class="num">${row.laps}</td>
    <td class="num">${formatLap(row.bestMs)}${row.bestMs !== null && best.get(row.driverId) === row.bestMs ? html`<span class="badge pb">PB</span>` : null}</td>
    <td class="num">${formatLap(last.get(row.driverId))}</td>
    ${race ? html`<td class="num">${formatLap(row.elapsedMs)}</td>` : null}
  </tr>`)}</tbody>
</table></div>`;
}

function results(snap) {
  const r = snap.lastResults;
  if (!r || snap.session?.id === r.session.id) return null;
  const race = r.session.kind === 'race';
  return html`<section class="board-results" aria-label="Results">
  <h2 class="h3 board-results-title">${KIND[r.session.kind]} results <span class="tag">${r.session.state === 'aborted' ? 'Aborted' : 'Finished'}</span></h2>
  ${r.standings.length === 0 ? html`<p class="empty">No laps were counted.</p>` : html`<div class="board-scroll"><table class="board-table">
    <thead><tr><th scope="col">Pos</th><th scope="col">Driver</th><th scope="col" class="num">Laps</th><th scope="col" class="num">Best</th>${race ? html`<th scope="col" class="num">Time</th>` : null}</tr></thead>
    <tbody>${r.standings.map((row) => html`<tr><td class="pos">${row.position}</td><td>${chip(snap, row.driverId)}</td><td class="num">${row.laps}</td><td class="num">${formatLap(row.bestMs)}</td>${race ? html`<td class="num">${formatLap(row.elapsedMs)}</td>` : null}</tr>`)}</tbody>
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
  const events = watcher ? `/watch/${token}/events` : `${request.space.base}/board/events`;
  const unknown = !watcher && !big && snap.unknown?.length
    ? html`<p class="status status-warning board-unknown" role="status">Unknown ${snap.unknown.length === 1 ? 'car' : 'cars'}: ${snap.unknown.join(', ')}. <a href="${request.space.base}/setup#transponders">Assign in Setup</a></p>`
    : null;
  const main = !watcher && snap.standings.length === 0 ? steps(request, snap) : standingsTable(snap);
  return html`<div id="board-live" class="board" data-events="${events}">
${header(snap)}
${unknown}
<div class="board-main">${results(snap)}${main}</div>
${feed(snap)}
</div>`;
}

export function boardPage(request, snap, { watcher = false, big = false, token = null } = {}) {
  return layout(request, {
    title: watcher ? 'Live board' : 'Board',
    screen: watcher ? null : 'board',
    watcher,
    big,
    scripts: ['board.js'],
    head: html`<noscript><meta http-equiv="refresh" content="10"></noscript>\n`,
    body: boardLive(request, snap, { watcher, big, token }),
  });
}
