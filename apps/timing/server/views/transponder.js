// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// "Whose transponder is 41?" (drivers and transponders spec §3.3, §3.4): a form
// where each driver is a submit button, so one click assigns, and a form of its
// own where a new driver goes in by name. Assigning someone else's asks first, on a page of its own.
import { avatar } from './driver.js';
import { errorSummary, fieldNotes } from './form-parts.js';
import { html } from './html.js';
import { layout } from './layout.js';

const NAME_ID = 'new-driver-name';
// The new driver's name and button belong to a form of their own (their form attribute), so Enter in
// the name submits its button, not the first driver's.
const NEW_FORM_ID = 'new-driver';
/** How long after a crossing or passing a page shows its transponder as crossing now. */
export const CROSSING_NOW_MS = 10_000;

/** Whether a transponder last crossed or passed `crossedAt` is crossing now: never for one that never crossed. @param {any} request @param {number | null} crossedAt */
export const crossingNow = (request, crossedAt) => crossedAt !== null && request.now() - crossedAt <= CROSSING_NOW_MS;

/** The live stream tl-crossing-now lights slots from. @param {any} request */
export const liveSrc = (request) => `${request.space.base}/live`;
const LIST_ID = 'assign-to';

/** "has 23, 31": the numbers a driver has, or nothing. @param {string[]} codes */
const has = (codes) => (codes.length ? html`<span class="meta">has ${codes.join(', ')}</span>` : null);

/**
 * The form. `transponders` give each driver's "has 23, 31"; `crossingNow` shows the live line,
 * which is always there (hidden otherwise) for the page's live element to show.
 * @param {any} request
 * @param {{ base: string, code: string, crossingNow: boolean, drivers: { id: string, name: string, colour: string }[],
 *   transponders: { code: string, driverId: string | null }[],
 *   values?: { name?: string }, errors?: { field?: string, message: string } | null, returnTo: string }} m
 */
export function transponderFormPage(request, { base, code, crossingNow, drivers, transponders, values = {}, errors = null, returnTo }) {
  const title = `Whose transponder is ${code}?`;
  const codesOf = (id) => transponders.filter((t) => t.driverId === id).map((t) => t.code).sort((a, b) => a.length - b.length || a.localeCompare(b));
  const field = { [NAME_ID]: 'name', [LIST_ID]: 'driver' };
  const fieldId = Object.keys(field).find((id) => field[id] === errors?.field) ?? null;
  const nameError = errors?.field === 'name' ? errors : null;
  const described = nameError ? html` aria-invalid="true" aria-describedby="${NAME_ID}-error"` : null;
  return layout(request, {
    title,
    screen: 'setup',
    modules: ['public/elements/crossing-now.js'],
    body: html`<tl-crossing-now src="${liveSrc(request)}"><section class="container-narrow page-header space-md">
  <h1 title="${title}">Whose transponder is <span class="assign-big">${code}</span>?</h1>
  <p class="subtitle pick-live crossing-now" data-code="${code}"${crossingNow ? null : html` hidden`}>It's on the track now.</p>
  <div id="page-status">${errorSummary(errors, fieldId)}</div>
  <form method="post" action="${base}/transponders/${code}" class="space-md">
    <input type="hidden" name="returnTo" value="${returnTo}">
    <div class="pick" role="group" aria-labelledby="${LIST_ID}">
      <p class="pick-group" id="${LIST_ID}">Assign it to</p>
      ${drivers.map((d) => html`<button type="submit" name="driver" value="${d.id}" class="pick-button">${avatar(d, { small: true })}<span class="visually-hidden">Assign to </span><span class="pick-name">${d.name}</span>${has(codesOf(d.id))}</button>`)}
      <p class="pick-group"><label for="${NAME_ID}">Or a new driver</label></p>
      <div class="pick-new space-sm">
        <div class="pick-new-row">
          <input type="text" id="${NAME_ID}" name="name" value="${values.name ?? ''}" maxlength="60" placeholder="Name" autocomplete="off" form="${NEW_FORM_ID}"${described}>
          <button type="submit" name="driver" value="" form="${NEW_FORM_ID}" class="btn btn-primary">Assign to a new driver</button>
        </div>
        ${fieldNotes({ id: NAME_ID, name: 'name', error: nameError })}
      </div>
    </div>
    <p><a href="${returnTo}">Not now</a></p>
  </form>
  <form method="post" action="${base}/transponders/${code}" id="${NEW_FORM_ID}" hidden><input type="hidden" name="returnTo" value="${returnTo}"></form>
</section></tl-crossing-now>`,
  });
}

/**
 * "Transponder 17 is Simon's." (§3.4): give it to the one chosen, or keep it. The form sends
 * the choice again with confirm=1.
 * @param {any} request
 * @param {{ base: string, code: string, owner: { name: string }, to: string, driver: string, name: string, returnTo: string }} m
 */
export function moveQuestionPage(request, { base, code, owner, to, driver, name, returnTo }) {
  const title = `Give transponder ${code} to ${to}?`;
  return layout(request, {
    title,
    screen: 'setup',
    body: html`<section class="container-narrow page-header space-md">
  <h1 class="cut-words" title="${title}">${title}</h1>
  <div class="card-static space-md">
    <p class="cut-words">Transponder ${code} is ${owner.name}'s.</p>
    <form method="post" action="${base}/transponders/${code}" class="button-row confirm-actions">
      <input type="hidden" name="driver" value="${driver}">
      <input type="hidden" name="name" value="${name}">
      <input type="hidden" name="returnTo" value="${returnTo}">
      <input type="hidden" name="confirm" value="1">
      <button type="submit" class="btn btn-primary">Give it to ${to}</button>
      <a class="btn btn-outline" href="${returnTo}">Keep it with ${owner.name}</a>
    </form>
  </div>
</section>`,
  });
}
