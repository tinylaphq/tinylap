// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A driver as people see them (drivers and transponders spec §3): their avatar,
// the initials on their colour, and their page.
import { localTime } from '@tinylap/design/html/local-time.js';
import { formatLap } from '../../public/format.js';
import { controlRow, errorsSummary, fieldNotes, textField } from './form-parts.js';
import { html, safe } from './html.js';
import { layout } from './layout.js';

/** The first letter of up to two words, upper-cased: "Mia Kraus" → "MK". @param {string} name */
export const initials = (name) => name.trim().split(/\s+/u).slice(0, 2).map((word) => [...word][0] ?? '').join('').toLocaleUpperCase();

/**
 * A driver's avatar. It repeats the name beside it, so it is hidden from screen readers.
 * @param {{ name: string, colour: string }} driver @param {{ large?: boolean, small?: boolean }} [options]
 */
export const avatar = (driver, { large = false, small = false } = {}) => html`<span class="avatar${large ? ' is-lg' : small ? ' is-sm' : ''}" style="--c: ${driver.colour}" aria-hidden="true">${initials(driver.name)}</span>`;

/** A transponder's label field, by its number. @param {string} code */
export const labelFieldOf = (code) => `label:${code}`;

/** The best laps (§3.5): one line per transponder when two or more of theirs are labelled, else their one best, unlabelled. */
function bestLaps(laps, transponders) {
  if (laps.length === 0) return null;
  const perTransponder = transponders.filter((t) => t.label !== null).length >= 2;
  const lines = perTransponder ? laps : laps.slice(0, 1);
  return html`<section class="space-sm" aria-labelledby="best-laps-title">
    <h2 id="best-laps-title">Best laps here</h2>
    <dl class="best-laps">${lines.map((lap) => html`<div><dt class="num">${formatLap(lap.lapMs)}</dt><dd>${perTransponder && lap.label ? html`<span class="best-lap-label">${lap.label}</span> ` : null}${safe(localTime(lap.at, 'date'))}</dd></div>`)}</dl>
  </section>`;
}

/**
 * A driver's page (§3.5): avatar, name and colour, their transponders each with a label and
 * Remove, and their best laps on the current track and direction. A failed save comes back
 * with the errors (each naming its input) and what was typed.
 * @param {any} request
 * @param {{ driver: { id: string, name: string, colour: string }, transponders: { code: string, label: string | null }[],
 *   laps: { transponder: string, label: string | null, lapMs: number, at: number }[],
 *   values?: Record<string, string>, errors?: { field?: string, message: string }[] }} m
 */
export function driverPage(request, { driver, transponders, laps, values = {}, errors = [] }) {
  const base = request.space.base;
  const action = `${base}/drivers/${driver.id}`;
  const errorOf = (name) => errors.find((e) => e.field === name) ?? null;
  const ids = { name: 'driver-name', colour: 'driver-colour', ...Object.fromEntries(transponders.map((t) => [labelFieldOf(t.code), `label-${t.code}`])) };
  // The swatch shows a colour it can show: a refused one would turn it black.
  const colour = /^#[0-9a-f]{6}$/i.test(values.colour ?? '') ? values.colour : driver.colour;
  return layout(request, {
    title: driver.name,
    screen: 'setup',
    modules: ['pkg/design/elements/local-time.js'],
    body: html`<section class="container-narrow page-header space-md driver-page">
  <p><a href="${base}/setup#drivers">Setup</a></p>
  <div class="driver-head">${avatar(driver, { large: true })}<h1 class="cut-words" title="${driver.name}">${driver.name}</h1></div>
  <div id="page-status">${errorsSummary(errors, (field) => ids[field ?? ''])}</div>
  <form method="post" action="${action}" class="card-static space-md">
    <div class="space-sm">
      ${controlRow([
        { id: ids.name, label: 'Name', name: 'name', maxlength: 60, required: true, value: values.name ?? driver.name, error: errorOf('name') },
        { id: ids.colour, label: 'Colour', name: 'colour', type: 'color', value: colour, error: errorOf('colour') },
      ], null)}
    </div>
    <section class="space-sm" aria-labelledby="transponders-title">
      <h2 id="transponders-title">Transponders</h2>
      ${transponders.length ? html`<ul class="driver-transponders">${transponders.map((t) => {
        const name = labelFieldOf(t.code);
        const error = errorOf(name);
        return html`<li class="space-sm">
        <div class="driver-transponder">
          <span class="transponder-number">${t.code}</span>
          ${textField({ id: ids[name], label: `Label for transponder ${t.code}`, labelHidden: true, name, maxlength: 24, placeholder: 'Label', value: values[name] ?? t.label ?? '', error, inRow: true })}
          <button type="submit" form="remove-${t.code}" class="driver-remove">Remove<span class="visually-hidden"> transponder ${t.code}</span></button>
        </div>
        ${fieldNotes({ id: ids[name], name, error })}
      </li>`;
      })}</ul>` : html`<p class="empty">No transponders yet.</p>`}
    </section>
    ${bestLaps(laps, transponders)}
    <div class="button-row"><input type="hidden" name="from" value="driver"><button type="submit" class="btn btn-primary">Save</button></div>
  </form>
  ${transponders.map((t) => html`<form id="remove-${t.code}" method="post" action="${base}/transponders/${t.code}/remove" hidden></form>`)}
</section>`,
  });
}
