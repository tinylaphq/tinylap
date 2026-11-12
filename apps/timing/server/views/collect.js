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

const byCode = (a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code);
const idOf = (code, form) => `collect-${code}-${form}`;

/**
 * One row: the number, its hidden "Crossing now" and when it last crossed, then the two forms.
 * `failed` is this row's refused form, its input kept.
 */
function row(request, m, t) {
  const base = request.space.base;
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
  return html`<li class="collect-row" data-code="${t.code}">
  <span class="tp">${t.code}</span>
  <div class="collect-body">
    <p class="collect-seen"><span class="crossing-now" hidden>Crossing now</span>${t.crossedAt === null ? null : html`<span class="crossed">Crossed <time datetime="${new Date(t.crossedAt).toISOString()}">${formatAgo(t.crossedAt, request.now())}</time></span>`}</p>
    ${driverForm}
    <form method="post" action="${base}/transponders/${t.code}" class="space-sm">
      <input type="hidden" name="returnTo" value="${back}&amp;added=1">${hidden}
      ${controlRow([{ id: idOf(t.code, 'name'), label: 'A new driver', name: 'name', maxlength: 60, placeholder: 'Name', value: kept('name')?.values.name ?? '', error: kept('name')?.error }],
        html`<button type="submit" class="btn btn-outline">Add and assign<span class="visually-hidden"> transponder ${t.code}</span></button>`)}
    </form>
  </div>
</li>`;
}

/** "Transponder 41 is Lena's now. Change", after an assign that came back here. */
function doneLine(request, done) {
  if (!done) return null;
  const change = `${request.space.base}/transponders/${done.code}?returnTo=${encodeURIComponent(`${request.space.base}/transponders/new`)}`;
  return html`<p class="status status-success cut-words" role="status">Transponder ${done.code} is ${done.name}'s now${done.added ? ', a new driver' : ''}. <a href="${change}">Change</a></p>`;
}

/**
 * The page. `transponders` are the club's; the unassigned ones get rows, newest first.
 * @param {any} request
 * @param {{ workspaceId: string, drivers: { id: string, name: string }[],
 *   transponders: { code: string, driverId: string | null, firstSeenAt: number, crossedAt: number | null }[],
 *   done?: { code: string, name: string, added: boolean } | null,
 *   failed?: { code: string, form: 'driver' | 'name', error: { field?: string, message: string }, values: { driver?: string, name?: string } } | null }} m
 */
export function collectPage(request, m) {
  const free = m.transponders.filter((t) => t.driverId === null).sort((a, b) => b.firstSeenAt - a.firstSeenAt || byCode(a, b));
  const failed = m.failed ?? null;
  const fieldId = failed?.error.field ? idOf(failed.code, failed.form) : null;
  return layout(request, {
    title: 'New transponders',
    screen: 'setup',
    modules: ['pkg/design/elements/frame.js', 'public/elements/crossing-now.js'],
    body: html`<div class="container screen space-md">
  <p class="visually-hidden" role="status" id="frame-status"></p>
  <tl-crossing-now src="/workspaces/${m.workspaceId}/live">
  <tl-frame id="collect"><section class="space-md" aria-labelledby="collect-title">
    <div class="space-xs">
      <h1 id="collect-title">New transponders</h1>
      ${free.length ? html`<p class="subtitle">${free.length === 1 ? html`1 crossed the line and isn't assigned yet.` : html`${free.length} crossed the line and aren't assigned yet.`}</p>` : null}
    </div>
    <div id="page-status">${failed ? errorSummary(failed.error, fieldId) : null}</div>
    ${doneLine(request, m.done ?? null)}
    ${free.length ? html`<ul class="collect">${free.map((t) => row(request, m, t))}</ul>`
      : html`<p class="empty">Run its car over the line, and it shows up here.</p>`}
  </section></tl-frame>
  </tl-crossing-now>
</div>`,
  });
}
