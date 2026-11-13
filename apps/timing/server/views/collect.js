// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Collect (drivers and transponders spec §3.6): every unassigned transponder on one
// page, each row with two small forms, a driver or a new one. The list is one
// tl-frame, so assigning a row keeps your place; tl-crossing-now shows the row's
// hidden "Crossing now" while its transponder crosses the line.
import { formatAgo } from '@tinylap/design/format-ago.js';
import { controlRow, errorSummary } from './form-parts.js';
import { html } from './html.js';
import { layout } from './layout.js';
import { crossingNow, liveSrc } from './transponder.js';

const byCode = (a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code);
const idOf = (code, form) => `collect-${code}-${form}`;

/**
 * The move question in the row (§3.4): its number became someone else's since the page was loaded.
 * Give it sends the choice again with confirm=1; its button has the focus, as the answer.
 */
function askRow(request, t, asking) {
  const base = request.space.base;
  return html`<form method="post" action="${base}/transponders/${t.code}" class="space-sm">
      <input type="hidden" name="driver" value="${asking.driver}"><input type="hidden" name="name" value="${asking.name}">
      <input type="hidden" name="from" value="collect"><input type="hidden" name="returnTo" value="${asking.returnTo}">
      <input type="hidden" name="confirm" value="1">
      <p class="pick-move cut-words">Transponder ${t.code} is ${asking.owner.name}'s. Giving it to ${asking.to} takes it off ${asking.owner.name}.</p>
      <div class="button-row">
        <button type="submit" class="btn btn-primary" autofocus>Give it to ${asking.to}</button>
        <a class="btn btn-outline" href="${base}/transponders/new">Keep it with ${asking.owner.name}</a>
      </div>
    </form>`;
}

/**
 * One row: the number, its "Crossing now" (shown by the server within 10 s of a crossing, else by
 * tl-crossing-now) and when it last crossed, then the two forms, or the move question it asks.
 * `failed` is this row's refused form, its input kept.
 */
function row(request, m, t) {
  const base = request.space.base;
  const asking = m.asking?.code === t.code ? m.asking : null;
  const now = crossingNow(request, t.crossedAt);
  const failed = m.failed?.code === t.code ? m.failed : null;
  const kept = (form) => (failed?.form === form ? failed : null);
  const back = `${base}/transponders/new?assigned=${t.code}`;
  const hidden = html`<input type="hidden" name="from" value="collect">`;
  const driverForm = m.drivers.length ? html`<form method="post" action="${base}/transponders/${t.code}" class="space-sm">
      <input type="hidden" name="returnTo" value="${back}">${hidden}
      ${controlRow([{ id: idOf(t.code, 'driver'), label: 'Driver', name: 'driver', value: kept('driver')?.values.driver ?? '', error: kept('driver')?.error,
        options: [{ value: '', label: 'Choose a driver' }, ...m.drivers.map((d) => ({ value: d.id, label: d.name }))] }],
      html`<button type="submit" class="btn btn-outline">Assign<span class="visually-hidden"> transponder ${t.code}</span></button>`)}
    </form>
    <p class="collect-or">or</p>` : null;
  return html`<li class="collect-row${now ? ' is-crossing' : ''}" data-code="${t.code}">
  <span class="tp">${t.code}</span>
  <div class="collect-body">
    <p class="collect-seen"><span class="crossing-now"${now ? null : html` hidden`}>Crossing now</span>${t.crossedAt === null ? null : html`<span class="crossed">Crossed <time datetime="${new Date(t.crossedAt).toISOString()}">${formatAgo(t.crossedAt, request.now())}</time></span>`}</p>
    ${asking ? askRow(request, t, asking) : html`${driverForm}
    <form method="post" action="${base}/transponders/${t.code}" class="space-sm">
      <input type="hidden" name="returnTo" value="${back}&amp;added=1">${hidden}
      ${controlRow([{ id: idOf(t.code, 'name'), label: 'A new driver', name: 'name', maxlength: 60, placeholder: 'Name', value: kept('name')?.values.name ?? '', error: kept('name')?.error }],
        html`<button type="submit" class="btn btn-outline">Add and assign<span class="visually-hidden"> transponder ${t.code}</span></button>`)}
    </form>`}
  </div>
</li>`;
}

/** "Transponder 41 is Lena's now. Change", after an assign that came back here: what the page, and tl-frame after the save, focuses. */
function doneLine(request, done) {
  if (!done) return null;
  const change = `${request.space.base}/transponders/${done.code}?returnTo=${encodeURIComponent(`${request.space.base}/transponders/new`)}`;
  return html`<p class="status status-success cut-words" role="status" tabindex="-1" autofocus>Transponder ${done.code} is ${done.name}'s now${done.added ? ', a new driver' : ''}. <a href="${change}">Change</a></p>`;
}

/**
 * The page. `transponders` are the club's; the unassigned ones get rows, newest first.
 * @param {any} request
 * @param {{ drivers: { id: string, name: string }[],
 *   transponders: { code: string, driverId: string | null, firstSeenAt: number, crossedAt: number | null }[],
 *   done?: { code: string, name: string, added: boolean } | null,
 *   failed?: { code: string, form: 'driver' | 'name', error: { field?: string, message: string }, values: { driver?: string, name?: string } } | null,
 *   asking?: { code: string, owner: { name: string }, to: string, driver: string, name: string, returnTo: string } | null }} m
 */
export function collectPage(request, m) {
  const free = m.transponders.filter((t) => t.driverId === null);
  // The rows: the unassigned, and the one asking whether to move it, in its place.
  const rows = m.transponders.filter((t) => t.driverId === null || t.code === m.asking?.code).sort((a, b) => b.firstSeenAt - a.firstSeenAt || byCode(a, b));
  const crossed = free.filter((t) => t.crossedAt !== null).length;
  const failed = m.failed ?? null;
  const fieldId = failed?.error.field ? idOf(failed.code, failed.form) : null;
  return layout(request, {
    title: 'New transponders',
    screen: 'setup',
    modules: ['pkg/design/elements/frame.js', 'public/elements/crossing-now.js'],
    body: html`<div class="container screen space-md">
  <p class="visually-hidden" role="status" id="frame-status"></p>
  <tl-crossing-now src="${liveSrc(request)}">
  <tl-frame id="collect"><section class="space-md" aria-labelledby="collect-title">
    <div class="space-xs">
      <h1 id="collect-title">New transponders</h1>
      ${crossed ? html`<p class="subtitle">${crossed === 1 ? html`1 crossed the line and isn't assigned yet.` : html`${crossed} crossed the line and aren't assigned yet.`}</p>` : null}
    </div>
    <div id="page-status">${failed ? errorSummary(failed.error, fieldId) : null}</div>
    ${doneLine(request, m.done ?? null)}
    ${rows.length ? html`<ul class="collect">${rows.map((t) => row(request, m, t))}</ul>`
      : html`<p class="empty">Run its car over the line, and it shows up here.</p>`}
  </section></tl-frame>
  </tl-crossing-now>
</div>`,
  });
}
