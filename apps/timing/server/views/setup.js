// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The setup page (spec §6.4): the tracks, drivers, transponders, decoders
// and the watchers link, each its own card-static section and forms.
import { formatAgo } from '@tinylap/design/format-ago.js';
import { localTime } from '@tinylap/design/html/local-time.js';
import { html, safe } from './html.js';
import { copyable, errorSummary, selectField, textField } from './form-parts.js';
import { layout } from './layout.js';

const DIRECTIONS = [{ value: 'ccw', label: 'Anticlockwise' }, { value: 'cw', label: 'Clockwise' }];
const DIRECTION_NAME = { cw: 'clockwise', ccw: 'anticlockwise' };

// A track's rename and layout forms, folded away until wanted; open while one
// of them has an error. The layout form loads a page: a new
// layout may answer with its confirmation, which no card swap can show.
function trackEdit(request, m, t) {
  const base = request.space.base;
  const rename = `track-rename:${t.id}`;
  const attach = `track-layout:${t.id}`;
  const open = m.errors[rename] || m.errors[attach];
  return html`<details class="track-edit"${open ? html` open` : null}>
    <summary>${t.layout ? 'Rename or change layout' : 'Rename or attach a layout'}</summary>
    <div class="track-edit-forms">
    <form method="post" action="${base}/tracks/${t.id}" class="inline-form">
      ${textField({ id: `track-name-${t.id}`, label: `New name for ${t.name}`, labelHidden: true, name: 'name', maxlength: 60, required: true, value: m.values[rename]?.name ?? t.name, error: m.errors[rename] ?? null })}
      <button type="submit" class="btn btn-sm btn-outline">Rename</button>
    </form>
    <form method="post" action="${base}/tracks/${t.id}/layout" class="inline-form" data-frame="off">
      ${textField({ id: `track-link-${t.id}`, label: `Planner link for ${t.name}`, labelHidden: true, name: 'link', type: 'url', required: true, placeholder: 'Planner link', value: m.values[attach]?.link ?? '', error: m.errors[attach] ?? null })}
      <button type="submit" class="btn btn-sm btn-outline">${t.layout ? 'Change layout' : 'Attach layout'}</button>
    </form>
    </div>
  </details>`;
}

/** A track's layout in a few words: since when, or none. */
const layoutNote = (t) => html`<span class="meta">${t.layout ? html`Layout since ${safe(localTime(t.layout.attachedAt, 'date'))}` : 'No layout'}</span>`;

// The track list (named tracks spec §4): the current track and direction with
// the form to switch, the other active tracks, Add track, and the archive.
function trackSection(request, m) {
  const base = request.space.base;
  const error = m.errors.track ?? null;
  const values = m.values.track ?? {};
  const add = m.values['add-track'] ?? {};
  const addError = m.errors['add-track'] ?? null;
  const others = m.tracks.filter((t) => t.id !== m.track.id);
  // A refused choice that names no track falls back to the current one, not to the list's first.
  const chosen = m.tracks.some((t) => t.id === values.id) ? values.id : m.track.id;
  return html`<tl-frame id="track"><section class="card-static stack-md" aria-labelledby="track-title">
  <h2 id="track-title">Track</h2>
  <div class="track-now stack-sm">
    <p class="track-head cut-words">Now: <a href="${base}/tracks/${m.track.id}"><strong>${m.track.name}</strong></a>, ${DIRECTION_NAME[m.direction]}. ${layoutNote(m.track)}</p>
    <form method="post" action="${base}/track" class="inline-form">
      ${selectField({ id: 'current-track', label: 'Current track', name: 'id', options: m.tracks.map((t) => ({ value: t.id, label: t.name })), value: chosen, error })}
      ${selectField({ id: 'current-direction', label: 'Direction', name: 'direction', options: DIRECTIONS, value: values.direction ?? m.direction, error })}
      <button type="submit" class="btn btn-primary">Save</button>
    </form>
    ${trackEdit(request, m, m.track)}
  </div>
  ${others.length ? html`<div class="stack-sm">
    <h3 class="track-subhead" id="other-tracks-title">Other tracks</h3>
    <ul class="setup-list" aria-labelledby="other-tracks-title">${others.map((t) => html`<li class="track-row">
      <p class="track-head cut-words"><a href="${base}/tracks/${t.id}">${t.name}</a> ${layoutNote(t)}</p>
      <div class="button-row">
        <form method="post" action="${base}/track"><input type="hidden" name="id" value="${t.id}"><input type="hidden" name="direction" value="${m.direction}"><button type="submit" class="btn btn-sm btn-outline">Make current</button></form>
        <form method="post" action="${base}/tracks/${t.id}/archive"><button type="submit" class="btn btn-sm btn-outline">Archive</button></form>
      </div>
      ${trackEdit(request, m, t)}
    </li>`)}</ul>
  </div>` : null}
  <form method="post" action="${base}/tracks" class="stack-sm">
    <h3 class="track-subhead">Add a track</h3>
    <div class="inline-form">
      ${textField({ id: 'add-track-name', label: 'Name', name: 'name', maxlength: 60, required: true, value: add.name ?? '', error: addError })}
      ${textField({ id: 'add-track-link', label: 'Planner link', name: 'link', type: 'url', placeholder: 'Optional', value: add.link ?? '', error: addError })}
      <button type="submit" class="btn btn-outline">Add track</button>
    </div>
  </form>
  ${m.archived.length ? html`<details class="track-archive"${m.archived.some((t) => m.errors[`track-restore:${t.id}`] || m.errors[`track-delete:${t.id}`]) ? html` open` : null}>
    <summary>Archived tracks (${m.archived.length})</summary>
    <ul class="setup-list">${m.archived.map((t) => html`<li class="setup-row">
      <a class="cut-words" href="${base}/tracks/${t.id}" title="${t.name}">${t.name}</a>
      <div class="button-row">
        <form method="post" action="${base}/tracks/${t.id}/restore"><button type="submit" class="btn btn-sm btn-outline">Restore</button></form>
        ${m.mayDelete ? html`<a class="btn btn-sm btn-danger" href="${base}/tracks/${t.id}/delete">Delete</a>` : null}
      </div>
    </li>`)}</ul>
  </details>` : null}
</section></tl-frame>`;
}

function driversSection(request, m) {
  const base = request.space.base;
  const addError = m.errors['add-driver'] ?? null;
  return html`<tl-frame id="drivers" refreshes="transponders"><section class="card-static stack-md" aria-labelledby="drivers-title">
  <h2 id="drivers-title">Drivers</h2>
  ${m.drivers.length ? html`<ul class="setup-list">${m.drivers.map((d) => {
    const error = m.errors[`rename:${d.id}`] ?? null;
    const kept = m.values[`rename:${d.id}`] ?? {};
    // The swatch shows a colour it can show: a refused one would turn it black.
    const colour = /^#[0-9a-f]{6}$/i.test(kept.colour ?? '') ? kept.colour : d.colour;
    return html`<li class="setup-row">
    <form method="post" action="${base}/drivers/${d.id}" class="inline-form driver-form">
      ${textField({ id: `colour-${d.id}`, label: `Colour for ${d.name}`, labelHidden: true, name: 'colour', type: 'color', value: colour, error })}
      ${textField({ id: `rename-${d.id}`, label: `New name for ${d.name}`, labelHidden: true, name: 'name', maxlength: 60, required: true, value: kept.name ?? d.name, error })}
      <button type="submit" class="btn btn-sm btn-outline">Save</button>
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
  <h2 id="transponders-title">Transponders</h2>
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
  <h2 id="decoders-title">Decoders</h2>
  ${m.paired ? html`<div class="status status-info">
    <p class="cut-words">${m.paired.name} is paired. Its token is shown only this once:</p>
    ${copyable(html`<code class="token">${m.paired.token}</code>`)}
    <p>Decoder id:</p>
    ${copyable(html`<code class="token token-id">${m.paired.id}</code>`)}
    <p>Put both on the decoder now.</p>
  </div>` : null}
  ${m.decoders.length ? html`<ul class="setup-list">${m.decoders.map((d) => html`<li class="setup-row">
    <div class="decoder-info">
      <span class="cut-words" title="${d.name}">${d.name}</span>
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
  <h2 id="watchers-title">Watchers link</h2>
  <p>Anyone with this link sees the board, read-only, without signing in.</p>
  ${link ? html`${textField({ id: 'watch-link', label: 'Watchers link', labelHidden: true, name: 'link', value: link, readonly: true, copy: true })}
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
    modules: ['pkg/design/elements/frame.js', 'pkg/design/elements/copy.js', 'pkg/design/elements/local-time.js'],
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
