// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Tap entry (spec §6.3): one form per driver, a big button each. tap.js
// submits them in place; without it each tap is a page load.
import { formatLap } from '../../public/format.js';
import { errorSummary } from './form-parts.js';
import { html } from './html.js';
import { layout } from './layout.js';

/** What a tap did, in words. @param {{ result: string, ms?: number | null }} result @param {{ name: string }} driver */
export function tapResultText(result, driver) {
  if (result.result === 'again') return 'Too fast, tap again.';
  if (result.result === 'started') return `${driver.name}: started`;
  return `${driver.name}: ${formatLap(result.ms ?? null)}`;
}

/** @param {any} request @param {{ drivers: any[], result?: any, error?: any }} data */
export function tapPage(request, { drivers, result = null, error = null }) {
  const base = request.space.base;
  const said = result ? tapResultText(result, result.driver) : 'Tap a driver as their car crosses the line.';
  return layout(request, {
    title: 'Tap',
    screen: 'tap',
    scripts: drivers.length ? ['tap.js'] : [],
    body: drivers.length
      ? html`<div class="tap-screen">
  <h1 class="visually-hidden">Tap</h1>
  ${errorSummary(error)}
  <div class="tap-grid">${drivers.map((d) => html`<form method="post" action="${base}/tap" class="tap-form">
    <input type="hidden" name="driver" value="${d.id}">
    <button type="submit" class="tap-tile" style="--driver: ${d.colour}">${d.name}</button>
  </form>`)}</div>
  <p class="tap-result" id="tap-result" role="status" aria-live="polite">${said}</p>
</div>`
      : html`<div class="container stack-lg screen">
  <h1>Tap</h1>
  ${errorSummary(error)}
  <div class="card-static stack-md"><p>Add drivers to tap their laps.</p><p><a class="btn btn-primary" href="${base}/setup#drivers">Add drivers</a></p></div>
</div>`,
  });
}
