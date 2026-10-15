// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Race control (spec §6.2): the start form, or the running session with Abort.
import { formatLength } from '../../public/format.js';
import { html } from './html.js';
import { errorSummary, textField } from './form-parts.js';
import { layout } from './layout.js';

const KIND = { qualifying: 'Qualifying', race: 'Race' };
const STATE = { countdown: 'counting down', running: 'running', finishing: 'finishing the last lap' };
// The summary links to the first control of the field an error names.
const FIELD_ID = { kind: 'race-kind', roster: 'race-roster', duration: 'race-duration', countdown: 'race-countdown' };

function startForm(request, { drivers, error, values }) {
  const base = request.space.base;
  if (drivers.length === 0) {
    return html`<div class="card-static stack-md"><p>Add drivers before you start a race.</p><p><a class="btn btn-primary" href="${base}/setup#drivers">Add drivers</a></p></div>`;
  }
  const kind = values?.kind ?? 'race';
  const roster = values ? new Set(values.roster) : new Set(drivers.map((d) => d.id));
  const rosterError = error?.field === 'roster' ? error.message : null;
  const kindError = error?.field === 'kind' ? error.message : null;
  return html`<form method="post" action="${base}/sessions" class="card-static stack-md">
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

function runningPanel(request, session, drivers) {
  const base = request.space.base;
  const names = (session.roster ?? []).map((id) => drivers.find((d) => d.id === id)?.name ?? 'Former driver');
  return html`<div class="card-static stack-md">
  <h2 class="h3">${KIND[session.kind]}, ${STATE[session.state] ?? session.state}</h2>
  <p>${names.join(', ')}. ${formatLength(session.durationMs ?? 0)}.</p>
  <div class="button-row">
    <a class="btn btn-outline" href="${base}/board">Show the board</a>
    <a class="btn btn-danger" href="${base}/sessions/${session.id}/abort">Abort</a>
  </div>
</div>`;
}

/** @param {any} request @param {{ session: any, drivers: any[], error?: any, values?: any }} model */
export function racePage(request, { session, drivers, error = null, values = null }) {
  return layout(request, {
    title: 'Race control',
    screen: 'race',
    body: html`<div class="container stack-lg screen">
  <h1>Race control</h1>
  ${errorSummary(error, FIELD_ID[error?.field])}
  ${session ? runningPanel(request, session, drivers) : startForm(request, { drivers, error, values })}
</div>`,
  });
}
