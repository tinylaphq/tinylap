// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board's Start panel (board hub spec §5): one form, the only place to
// start a session, read top to bottom: the kind as a segmented choice in night
// order, only that kind's settings, one Start button named by the kind and
// one hint. Every part of one kind carries data-for="<kind>"; the server marks
// the parts of the kinds not chosen data-off (not `hidden`, which palace makes
// !important), and CSS :has() follows a changed choice without script.
//
// It sits beside #board-live, not in it, so the stream's swaps never wipe a
// half-filled form: its data-key says what it shows (idle, first steps, or the
// running session), and tl-board replaces it only when that changes, taking
// only the line that a car is on the track from each update.
import { startDefaults } from '../start-form.js';
import { errorsSummary } from './form-parts.js';
import { html } from './html.js';
import { idleNotice } from './marks.js';

const KINDS = /** @type {const} */ (['practice', 'qualifying', 'race']);
const WORD = { practice: 'Practice', qualifying: 'Qualifying', race: 'Race' };
/** The hint under the button: where the values came from, or with no session of the kind yet, what it does. */
const HINT = {
  practice: () => 'Runs until you end it, timing every car with a driver.',
  qualifying: (earlier) => (earlier ? 'Same drivers and length as the last qualifying.' : 'Ranked by each driver’s best lap.'),
  race: (earlier) => (earlier ? 'Same drivers, length and countdown as the last race.' : 'Counts down, then runs for its length.'),
};

/** Off unless it is the chosen kind's (or, for the roster, unless Chosen drivers is checked). */
const off = (on) => (on ? null : html` data-off`);

/** A field's error, its id for aria-describedby, and the attributes that tie them. */
function errorParts(errors, name) {
  const message = errors.find((e) => e.field === name)?.message ?? null;
  return {
    attributes: message ? html` aria-invalid="true" aria-describedby="${name}-error"` : null,
    note: message ? html`<p class="field-error" id="${name}-error">${message}</p>` : null,
  };
}

/** A number box with its unit after it ("min", "s"). Its id is its name, which an error summary links to. */
function numberField({ name, label, unit, value, min, max, required = false }, errors) {
  const { attributes, note } = errorParts(errors, name);
  return html`<div class="field">
        <label for="${name}">${label}</label>
        <div class="input-unit"><input type="number" id="${name}" name="${name}" value="${value}"${required ? html` required` : null} min="${min}" max="${max}" inputmode="numeric"${attributes}><span class="input-unit-word">${unit}</span></div>
        ${note}
      </div>`;
}

/** The settings one kind needs: who drives, then its length (and a race's countdown) side by side. */
function settings(kind, chosen, values, drivers, errors) {
  const name = (field) => `${kind}-${field}`;
  const pick = values.drivers === 'chosen';
  const roster = new Set(values.roster);
  const who = errorParts(errors, name('drivers'));
  const ticked = errorParts(errors, name('roster'));
  // The group is described by its error; its controls stay as they were.
  const described = [who.note ? `${name('drivers')}-error` : null, ticked.note ? `${name('roster')}-error` : null].filter(Boolean).join(' ');
  const waits = kind === 'race' ? ' The race waits for each of them.' : '';
  return html`<div class="start-settings" data-for="${kind}"${off(kind === chosen)}>
    <fieldset class="start-drivers"${described ? html` aria-describedby="${described}"` : null}>
      <legend>Drivers</legend>
      <label class="start-option"><input type="radio" name="${name('drivers')}" value="everyone" id="${name('drivers')}"${pick ? null : html` checked`}><span><strong>Everyone on the track</strong><small>Whoever’s car crosses the line.</small></span></label>
      <label class="start-option"><input type="radio" name="${name('drivers')}" value="chosen"${pick ? html` checked` : null}><span><strong>Chosen drivers</strong><small>Only their laps count.${waits}</small></span></label>
      <div class="choices start-roster"${off(pick)}>${drivers.map((d, i) => html`<label class="choice"><input type="checkbox" name="${name('roster')}" value="${d.id}"${i === 0 ? html` id="${name('roster')}"` : null}${roster.has(d.id) ? html` checked` : null}> <span class="cut-words" title="${d.name}">${d.name}</span></label>`)}</div>
      ${who.note}${ticked.note}
    </fieldset>
    <div class="start-times">
      ${numberField({ name: name('minutes'), label: 'Length', unit: 'min', value: values.minutes, min: 1, max: 60, required: true }, errors)}
      ${kind === 'race' ? numberField({ name: name('countdown'), label: 'Countdown', unit: 's', value: values.countdown, min: 0, max: 30 }, errors) : null}
    </div>
  </div>`;
}

/**
 * The panel's state, for tl-board: the running session's id, the first
 * steps, or the form. @param {any} snap
 */
/** Whether a decoder of this space reports (the board header's decoders, on a cable or over Wi-Fi). */
const heard = (snap) => Boolean(snap.decoders?.some((d) => d.state === 'reporting' || d.state === 'idle'));
// The first steps' key says whether Connect the decoder is among them, so the board swaps them when that changes.
const keyOf = (snap) => (snap.session ? `run ${snap.session.id}` : snap.drivers.length ? 'idle' : heard(snap) ? 'first heard' : 'first');

/**
 * The form, under the server's defaults (startDefaults), with a failed form's
 * sent kind and values laid over them. @param {any} request @param {any} snap
 * @param {{ errors?: any[], values?: any }} [sent] readStart's `errors` and `values`
 */
function form(request, snap, { errors = [], values = null } = {}) {
  const defaults = startDefaults(request);
  const chosen = KINDS.includes(values?.kind) ? values.kind : defaults.kind;
  const of = (kind) => ({ ...defaults[kind], ...(values?.kind === kind ? values[kind] : {}) });
  const kindError = errorParts(errors, 'kind');
  return html`<form method="post" action="${request.space.base}/sessions" class="start-panel" aria-labelledby="start-title">
    ${errors.length ? errorsSummary(errors, (field) => (field === 'kind' ? 'start-kind' : field)) : null}
    <fieldset class="start-kind"${kindError.attributes}>
      <legend class="visually-hidden">Session</legend>
      ${KINDS.map((kind, i) => html`<label class="start-kind-option"><input type="radio" name="kind" value="${kind}"${i === 0 ? html` id="start-kind"` : null}${kind === chosen ? html` checked` : null}><span>${WORD[kind]}</span></label>`)}
    </fieldset>
    ${kindError.note}
    ${settings('qualifying', chosen, of('qualifying'), snap.drivers, errors)}
    ${settings('race', chosen, of('race'), snap.drivers, errors)}
    <div class="start-go-row">
      <div class="start-on-track" id="start-on-track">${idleNotice(snap.idle, snap.drivers)}</div>
      <button type="submit" class="btn btn-primary start-go">Start ${KINDS.map((kind) => html`<span data-for="${kind}"${off(kind === chosen)}>${kind}</span>`)}</button>
      ${KINDS.map((kind) => html`<p class="start-hint" data-for="${kind}"${off(kind === chosen)}>${HINT[kind](defaults[kind].earlier)}</p>`)}
    </div>
  </form>`;
}

/**
 * With no drivers a session times nothing: the first steps take the panel's place, under a car already crossing.
 * Connecting the decoder is a step only while none reports.
 */
function firstSteps(request, snap) {
  const base = request.space.base;
  return html`<div class="start-panel start-first">
    <div class="start-on-track" id="start-on-track">${idleNotice(snap.idle, snap.drivers)}</div>
    <p>A session times the cars that have a driver.</p>
    <p class="button-row"><a class="btn btn-primary" href="${base}/setup#drivers">Add drivers</a>${heard(snap) ? null : html`
    <a class="btn btn-outline" href="${base}/bridge">Connect the decoder</a>`}</p>
  </div>`;
}

/**
 * The Start region beside #board-live, on a member's own board (never on the
 * TV or the watchers' link). While a session runs it is an empty slot, so the
 * stream can fill it when the session ends.
 * @param {any} request @param {any} snap @param {{ errors?: any[], values?: any }} [sent]
 */
export function boardStart(request, snap, sent = {}) {
  const key = keyOf(snap);
  if (snap.session) return html`<aside id="board-start" class="board-next" data-key="${key}" hidden></aside>`;
  return html`<aside id="board-start" class="board-next" data-key="${key}" aria-labelledby="start-title">
  <h2 id="start-title" class="board-next-title">Start</h2>
  <div class="board-next-body">${snap.drivers.length ? form(request, snap, sent) : firstSteps(request, snap)}</div>
</aside>`;
}
