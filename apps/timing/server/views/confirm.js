// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// "Delete Ana?": a destructive action asks on a page of its own with its
// own form (spec §2), so it works without JavaScript and never uses confirm().
import { errorSummary, textField } from './form-parts.js';
import { html } from './html.js';
import { layout } from './layout.js';

/** `fields` are [name, value] pairs the form sends again, as a start that replaces a running session does. */
export function confirmPage(request, { title, text, action, button, back, screen = 'setup', fields = [] }) {
  return layout(request, {
    title,
    screen,
    body: html`<section class="container-narrow page-header stack-md">
  <h1>${title}</h1>
  <div class="card-static stack-md">
    <p>${text}</p>
    <form method="post" action="${action}" class="button-row confirm-actions">
      ${fields.map(([name, value]) => html`<input type="hidden" name="${name}" value="${value}">`)}
      <button type="submit" class="btn btn-danger">${button}</button>
      <a class="btn btn-outline" href="${back}">Cancel</a>
    </form>
  </div>
</section>`,
  });
}

/**
 * "Change the layout of Office?" (named tracks spec §3.4): change it, or add
 * the layout as a new track. Both forms carry the link, so it is pasted once;
 * a failed new track comes back here with its error and the name kept.
 */
export function changeLayoutPage(request, { track, link, back, error = null, name = '' }) {
  const action = `${request.space.base}/tracks/${track.id}/layout`;
  const title = `Change the layout of ${track.name}?`;
  return layout(request, {
    title,
    screen: 'setup',
    body: html`<section class="container-narrow page-header stack-md">
  <h1>${title}</h1>
  <div id="page-status">${errorSummary(error, error?.field === 'name' ? 'new-track-name' : null)}</div>
  <div class="card-static stack-md">
    <p>Records on ${track.name} stay and are compared with laps on the new layout. If the track itself changed, add it as a new track instead.</p>
    <form method="post" action="${action}">
      <input type="hidden" name="link" value="${link}">
      <input type="hidden" name="confirm" value="1">
      <button type="submit" class="btn btn-primary">Change the layout</button>
    </form>
    <hr class="divider">
    <p id="new-track-intro">Or add it as a new track:</p>
    <form method="post" action="${action}" class="inline-form" aria-labelledby="new-track-intro">
      <input type="hidden" name="link" value="${link}">
      <input type="hidden" name="as" value="new">
      ${textField({ id: 'new-track-name', label: 'New track name', name: 'name', maxlength: 60, required: true, value: name, error })}
      <button type="submit" class="btn btn-outline">Add as a new track</button>
    </form>
    <p><a class="btn btn-outline" href="${back}">Cancel</a></p>
  </div>
</section>`,
  });
}
