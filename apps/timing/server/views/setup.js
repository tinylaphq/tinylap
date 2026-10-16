// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The setup page (spec §6.4): the track, drivers, transponders, decoders
// and the watchers link, each its own card-static section and forms.
import { formatAgo } from '../../public/format.js';
import { html } from './html.js';
import { copyable, errorSummary, selectField, textField } from './form-parts.js';
import { layout } from './layout.js';

const DIRECTIONS = [{ value: 'ccw', label: 'Anticlockwise' }, { value: 'cw', label: 'Clockwise' }];
const DIRECTION_NAME = { cw: 'clockwise', ccw: 'anticlockwise' };

// The colour swatch only: the rename field beside it already carries the name.
const driverChip = (d) => html`<span class="driver" style="--driver: ${d.colour}" aria-hidden="true"></span>`;

function trackSection(request, m) {
  const base = request.space.base;
  const error = m.errors.track ?? null;
  const values = m.values.track ?? {};
  return html`<tl-frame id="track"><section class="card-static stack-md" aria-labelledby="track-title">
  <h2 class="h3" id="track-title">Track</h2>
  <p>${m.track ? html`Now: <strong>${m.track.name}</strong>, ${DIRECTION_NAME[m.direction]}.` : 'No track yet. Share a closed track from the planner and paste its link here.'}</p>
  <form method="post" action="${base}/track" class="stack-sm">
    ${textField({ id: 'track-link', label: 'Planner link', name: 'link', type: 'url', required: true, placeholder: 'https://…/layouts/…', value: values.link ?? '', error })}
    ${textField({ id: 'track-name', label: 'Track name', name: 'name', maxlength: 60, value: values.name ?? m.track?.name ?? '', error })}
    ${selectField({ id: 'track-direction', label: 'Direction', name: 'direction', options: DIRECTIONS, value: values.direction ?? m.direction, error })}
    <button type="submit" class="btn btn-primary">Use this track</button>
  </form>
</section></tl-frame>`;
}

function driversSection(request, m) {
  const base = request.space.base;
  const addError = m.errors['add-driver'] ?? null;
  return html`<tl-frame id="drivers" refreshes="transponders"><section class="card-static stack-md" aria-labelledby="drivers-title">
  <h2 class="h3" id="drivers-title">Drivers</h2>
  ${m.drivers.length ? html`<ul class="setup-list">${m.drivers.map((d) => {
    const error = m.errors[`rename:${d.id}`] ?? null;
    return html`<li class="setup-row">
    ${driverChip(d)}
    <form method="post" action="${base}/drivers/${d.id}" class="inline-form">
      ${textField({ id: `rename-${d.id}`, label: `New name for ${d.name}`, labelHidden: true, name: 'name', maxlength: 60, required: true, value: m.values[`rename:${d.id}`]?.name ?? d.name, error })}
      <button type="submit" class="btn btn-sm btn-outline">Rename</button>
    </form>
    ${m.mayDelete ? html`<a class="btn btn-sm btn-danger" href="${base}/drivers/${d.id}/delete">Delete</a>` : null}
  </li>`;
  })}</ul>` : html`<p class="empty">No drivers yet.</p>`}
  <form method="post" action="${base}/drivers" class="inline-form">
    ${textField({ id: 'add-driver-name', label: 'New driver', name: 'name', maxlength: 60, required: true, value: m.values['add-driver']?.name ?? '', error: addError })}
    <button type="submit" class="btn btn-primary">Add driver</button>
  </form>
</section></tl-frame>`;
}

function transpondersSection(request, m) {
  const base = request.space.base;
  const options = [{ value: '', label: '— none' }, ...m.drivers.map((d) => ({ value: d.id, label: d.name }))];
  const rows = [...m.transponders].sort((a, b) => Number(a.driverId !== null) - Number(b.driverId !== null) || a.code.localeCompare(b.code));
  return html`<tl-frame id="transponders"><section class="card-static stack-md" aria-labelledby="transponders-title">
  <h2 class="h3" id="transponders-title">Transponders</h2>
  ${rows.length ? html`<table class="setup-table">
    <thead><tr><th scope="col" class="num">Code</th><th scope="col">Driver</th></tr></thead>
    <tbody>${rows.map((t) => {
      const key = `transponder:${t.code}`;
      return html`<tr${t.driverId === null ? html` class="is-unknown"` : null}>
      <td class="num">${t.code}</td>
      <td><form method="post" action="${base}/transponders/${t.code}" class="inline-form">
        ${selectField({ id: `transponder-${t.code}`, label: `Driver for ${t.code}`, labelHidden: true, name: 'driver', options, value: m.values[key]?.driver ?? t.driverId ?? '', error: m.errors[key] ?? null })}
        <button type="submit" class="btn btn-sm btn-outline">Assign</button>
      </form></td>
    </tr>`;
    })}</tbody>
  </table>` : html`<p class="empty">Transponders show up here when a car first crosses the line.</p>`}
</section></tl-frame>`;
}

function decodersSection(request, m) {
  const base = request.space.base;
  const error = m.errors.pair ?? null;
  return html`<section class="card-static stack-md" id="decoders" aria-labelledby="decoders-title">
  <h2 class="h3" id="decoders-title">Decoders</h2>
  ${m.paired ? html`<div class="status status-info" role="status">
    <p>${m.paired.name} is paired. Its token is shown only this once:</p>
    ${copyable(html`<code class="token">${m.paired.token}</code>`)}
    <p>Decoder id:</p>
    ${copyable(html`<code class="token token-id">${m.paired.id}</code>`)}
    <p>Put both on the decoder now.</p>
  </div>` : null}
  ${m.decoders.length ? html`<ul class="setup-list">${m.decoders.map((d) => html`<li class="setup-row">
    <div class="decoder-info">
      <span>${d.name}</span>
      <span class="meta">${d.lastSeenAt ? html`seen <time datetime="${new Date(d.lastSeenAt).toISOString()}">${formatAgo(d.lastSeenAt, request.now())}</time>` : 'never seen'}</span>
    </div>
    ${m.mayDelete ? html`<a class="btn btn-sm btn-danger" href="${base}/decoders/${d.id}/unpair">Unpair</a>` : null}
  </li>`)}</ul>` : null}
  <p>Pair a decoder by USB on the <a href="${base}/bridge">Bridge</a> page, or here if it only uses Wi-Fi:</p>
  <form method="post" action="${base}/decoders" class="inline-form" data-frame="off">
    ${textField({ id: 'pair-name', label: 'Decoder name', name: 'name', maxlength: 60, value: m.values.pair?.name ?? '', placeholder: 'Start line', error })}
    <button type="submit" class="btn btn-outline">Pair over Wi-Fi only</button>
  </form>
</section>`;
}

function watchersSection(request, m) {
  const base = request.space.base;
  const link = m.watchToken ? `${request.origin}/watch/${m.watchToken}` : null;
  return html`<tl-frame id="watchers"><section class="card-static stack-md" aria-labelledby="watchers-title">
  <h2 class="h3" id="watchers-title">Watchers link</h2>
  <p>Anyone with this link sees the board, read-only, without signing in.</p>
  ${link ? html`${textField({ id: 'watch-link', label: 'Watchers link', name: 'link', value: link, readonly: true, copy: true })}
  <p><a class="btn btn-outline" href="${base}/watch-link/new">Make a new watchers link</a></p>` : html`<form method="post" action="${base}/watch-link">
    <button type="submit" class="btn btn-primary">Make a watchers link</button>
  </form>`}
</section></tl-frame>`;
}

export function setupPage(request, model) {
  const m = { errors: {}, values: {}, paired: null, failed: null, ...model };
  return layout(request, {
    title: 'Setup',
    screen: 'setup',
    modules: ['pkg/design/elements/frame.js', 'pkg/design/elements/copy.js'],
    body: html`<div class="container stack-xl screen">
  <h1>Setup</h1>
  <div id="page-status">${m.failed ? errorSummary(m.failed.error, m.failed.fieldId) : null}</div>
  <p class="visually-hidden" role="status" id="frame-status"></p>
  ${trackSection(request, m)}
  ${driversSection(request, m)}
  ${transpondersSection(request, m)}
  ${decodersSection(request, m)}
  ${watchersSection(request, m)}
</div>`,
  });
}
