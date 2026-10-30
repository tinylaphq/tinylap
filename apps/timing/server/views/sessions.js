// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Sessions tab (records spec §5.2): the running session with End or
// Abort, Start practice and the qualifying or race form, the history of
// sessions, and the latest track records.
import { localTime } from '@tinylap/design/html/local-time.js';
import { clockAt, formatClock, formatLap, formatLength } from '../../public/format.js';
import { html, safe } from './html.js';
import { errorSummary, textField } from './form-parts.js';
import { layout } from './layout.js';
import { chip, crown, idleNotice, marks, marksHead, startPracticeForm } from './marks.js';
import { recordsTable, trackName } from './records.js';

export const KIND = { practice: 'Practice', qualifying: 'Qualifying', race: 'Race' };
const STATE = { countdown: 'counting down', running: 'running', finishing: 'finishing the last lap' };
// The summary links to the first control of the field an error names.
const FIELD_ID = { kind: 'race-kind', roster: 'race-roster', duration: 'race-duration', countdown: 'race-countdown' };

/** A length short enough for a table cell: "18 s", "12 min". @param {number} ms */
export const shortLength = (ms) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min`);

/** How long an ended session was driven: from its start (after any countdown) to its end. */
export const drivenMs = (session) => Math.max(0, (session.endedAt ?? session.opensAt ?? 0) - (session.opensAt ?? session.createdAt));

function startForm(request, { drivers, error, values }) {
  const base = request.space.base;
  if (drivers.length === 0) {
    return html`<div class="card-static stack-md"><h3 class="h3">Qualifying or race</h3><p>Add drivers before you start a race.</p><p><a class="btn btn-primary" href="${base}/setup#drivers">Add drivers</a></p></div>`;
  }
  const kind = values?.kind ?? 'race';
  const roster = values ? new Set(values.roster) : new Set(drivers.map((d) => d.id));
  const rosterError = error?.field === 'roster' ? error.message : null;
  const kindError = error?.field === 'kind' ? error.message : null;
  return html`<form method="post" action="${base}/sessions" class="card-static stack-md">
  <h3 class="h3">Qualifying or race</h3>
  <fieldset${kindError ? html` aria-describedby="race-kind-error"` : null}>
    <legend>Session</legend>
    <div class="choices choices-inline">${['race', 'qualifying'].map((k, i) => html`<label class="choice"><input type="radio" name="kind" value="${k}"${i === 0 ? html` id="race-kind"` : null}${k === kind ? html` checked` : null}> ${KIND[k]}</label>`)}</div>
    ${kindError ? html`<p class="field-error" id="race-kind-error">${kindError}</p>` : null}
  </fieldset>
  <fieldset${rosterError ? html` aria-describedby="race-roster-error"` : null}>
    <legend>Drivers</legend>
    <div class="choices">${drivers.map((d, i) => html`<label class="choice"><input type="checkbox" name="roster" value="${d.id}"${i === 0 ? html` id="race-roster"` : null}${roster.has(d.id) ? html` checked` : null}> ${d.name}</label>`)}</div>
    ${rosterError ? html`<p class="field-error" id="race-roster-error">${rosterError}</p>` : null}
  </fieldset>
  <fieldset>
    <legend>Length</legend>
    <div class="race-times">
      ${textField({ id: 'race-duration', label: 'Minutes', name: 'duration', type: 'number', inputmode: 'numeric', required: true, min: 1, max: 60, value: values?.duration ?? '5', error })}
      ${textField({ id: 'race-countdown', label: 'Countdown (seconds)', name: 'countdown', type: 'number', inputmode: 'numeric', min: 0, max: 30, value: values?.countdown ?? '10', hint: 'Races only.', error })}
    </div>
  </fieldset>
  <div class="button-row"><button type="submit" class="btn btn-primary">Start</button></div>
</form>`;
}

/** The panel of a running session. `reload` (only on the 200 GET) lets its clock reload the page once at a phase change. */
function runningPanel(request, session, drivers, { reload }) {
  const base = request.space.base;
  const now = request.now();
  const clock = clockAt({ ...session, opensAt: session.opensAt ?? null, closesAt: session.closesAt ?? null }, now);
  const time = html`<time class="race-clock-time" data-clock data-kind="${session.kind}" data-state="${session.state}" data-opens="${session.opensAt ?? ''}" data-closes="${session.closesAt ?? ''}" data-now="${now}">${formatClock(clock.ms)}</time>`;
  if (session.kind === 'practice') {
    // The clock counts up from the start; the label says when that was (records spec §5.3).
    return html`<div class="card-static stack-md running-panel">
  <h2 class="h3">Practice, running</h2>
  <tl-countdown class="race-clock"${reload ? html` reload-on-phase` : null}><span class="stat-label">Started ${safe(localTime(session.opensAt, 'time'))}</span> ${time}</tl-countdown>
  <div class="button-row">
    <a class="btn btn-outline" href="${base}/board">Show the board</a>
    <a class="btn btn-danger" href="${base}/sessions/${session.id}/end">End</a>
  </div>
</div>`;
  }
  const names = (session.roster ?? []).map((id) => drivers.find((d) => d.id === id)?.name ?? 'Former driver');
  return html`<div class="card-static stack-md running-panel">
  <h2 class="h3">${KIND[session.kind]}, ${STATE[session.state] ?? session.state}</h2>
  <p>${names.join(', ')}. ${formatLength(session.durationMs ?? 0)}.</p>
  <tl-countdown class="race-clock"${reload ? html` reload-on-phase` : null}><span class="stat-label" data-clock-label>${clock.label}</span> ${time}</tl-countdown>
  <div class="button-row">
    <a class="btn btn-outline" href="${base}/board">Show the board</a>
    <a class="btn btn-danger" href="${base}/sessions/${session.id}/abort">Abort</a>
  </div>
</div>`;
}

/**
 * Past sessions, newest first, 20 a page. The columns have fixed widths
 * (app.css); the track and the fastest driver share what is left.
 * @param {any} request @param {{ rows: any[], older: number | null, newer: boolean }} history @param {any[]} drivers
 */
function historySection(request, { rows, older, newer }, drivers) {
  const base = request.space.base;
  const table = rows.length === 0 ? html`<p class="empty">No sessions yet.</p>` : html`<div class="board-scroll"><table class="board-table history-table">
  <colgroup><col class="col-started"><col class="col-kind"><col><col class="col-count"><col class="col-count"><col><col class="col-time"><col class="col-mark"></colgroup>
  <thead><tr><th scope="col">Started</th><th scope="col">Session</th><th scope="col">Track</th><th scope="col" class="num">Length</th><th scope="col" class="num">Drivers</th><th scope="col">Fastest</th><th scope="col" class="num">Best</th>${marksHead}</tr></thead>
  <tbody>${rows.map(({ session, track, drivers: count, best }) => html`<tr class="history-row">
    <td><a href="${base}/sessions/${session.id}">${safe(localTime(session.opensAt ?? session.createdAt, 'datetime'))}</a></td>
    <td>${KIND[session.kind]}${session.state === 'aborted' ? html` <span class="tag">Aborted</span>` : null}</td>
    <td>${trackName(track, session.direction)}</td>
    <td class="num">${shortLength(drivenMs(session))}</td>
    <td class="num">${count}</td>
    <td class="board-driver">${best ? html`${chip(drivers, best.driverId)}${crown(best.isHolder)}` : null}</td>
    <td class="num">${formatLap(best?.lapMs)}</td>
    ${marks({ lapMs: best?.lapMs, isRecord: Boolean(best?.isRecord), isPb: Boolean(best?.isPb) })}
  </tr>`)}</tbody>
</table></div>`;
  const links = [
    newer ? html`<a class="btn btn-outline btn-sm" href="${base}/sessions#history">Newest sessions</a>` : null,
    older !== null ? html`<a class="btn btn-outline btn-sm" href="${base}/sessions?before=${older}#history">Older sessions</a>` : null,
  ].filter(Boolean);
  return html`<section id="history" class="stack-md" aria-labelledby="history-title">
  <h2 id="history-title">History</h2>
  ${table}
  ${links.length ? html`<div class="button-row">${links}</div>` : null}
</section>`;
}

function recordsSection(request, { track, direction, rows }, drivers) {
  return html`<section class="stack-md" aria-labelledby="records-title">
  <div class="stack-xs">
    <h2 id="records-title">Track record</h2>
    ${track ? html`<p class="subtitle">${trackName(track, direction)}</p>` : null}
  </div>
  ${recordsTable(request, { track, rows, drivers })}
  ${rows.length ? html`<p><a href="${request.space.base}/records">All track records</a></p>` : null}
</section>`;
}

/**
 * @param {any} request
 * @param {{ session: any, drivers: any[], idle?: any, history: any, records: any, error?: any, values?: any, reload?: boolean }} model
 */
export function sessionsPage(request, { session, drivers, idle = null, history, records, error = null, values = null, reload = false }) {
  return layout(request, {
    title: 'Sessions',
    screen: 'sessions',
    scripts: session ? ['elements/countdown.js'] : [],
    modules: ['pkg/design/elements/local-time.js'],
    body: html`<div class="container sessions-screen stack-xl screen">
  <h1>Sessions</h1>
  ${errorSummary(error, FIELD_ID[error?.field])}
  ${idleNotice(idle, drivers)}
  ${session ? runningPanel(request, session, drivers, { reload }) : null}
  <section class="stack-md" aria-labelledby="start-title">
    <h2 id="start-title">Start</h2>
    <div class="start-grid">
      <div class="card-static stack-md start-practice-card">
        <h3 class="h3">Practice</h3>
        <p>Times everyone whose car has a driver, for as long as you like. It ends when you end it, or after an hour without a car.</p>
        ${startPracticeForm(request)}
      </div>
      ${startForm(request, { drivers, error, values: values?.kind === 'practice' ? null : values })}
    </div>
  </section>
  ${historySection(request, history, drivers)}
  ${recordsSection(request, records, drivers)}
</div>`,
  });
}
