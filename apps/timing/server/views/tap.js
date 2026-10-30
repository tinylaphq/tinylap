// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Tap entry (spec §6.3): one form per driver, a big button each. tl-tap
// submits them in place; without it each tap is a page load.
import { formatLap } from '../../public/format.js';
import { html } from './html.js';
import { layout } from './layout.js';
import { startPracticeForm } from './marks.js';

/** What a tap did, in words. @param {{ result: string, ms?: number | null }} result @param {{ name: string }} driver */
export function tapResultText(result, driver) {
  if (result.result === 'again') return 'Too fast, tap again.';
  if (result.result === 'started') return `${driver.name}: started`;
  return `${driver.name}: ${formatLap(result.ms ?? null)}`;
}

const STATE_LABEL = { started: 'Started', lap: 'Lap', again: 'Again' };

/** The bar above the tiles: the last tap's result, or the page's failure, or the instruction. */
function resultBar(result, error) {
  if (error) {
    return html`<div class="tap-bar" data-state="error"><div id="tap-alert"><p class="status status-error" role="alert"><span class="tap-state">Failed</span> <span class="tap-text">${error.message}</span></p></div>
  <p class="tap-result" id="tap-result" role="status" aria-live="polite"></p></div>`;
  }
  if (!result) {
    return html`<div class="tap-bar" data-state="idle"><div id="tap-alert"></div>
  <p class="tap-result" id="tap-result" role="status" aria-live="polite"><span class="tap-text">Tap a driver as their car crosses the line.</span></p></div>`;
  }
  return html`<div class="tap-bar" data-state="${result.result}" style="--driver: ${result.driver.colour}"><div id="tap-alert"></div>
  <p class="tap-result" id="tap-result" role="status" aria-live="polite"><span class="tap-state">${STATE_LABEL[result.result]}</span> <span class="tap-text">${tapResultText(result, result.driver)}</span></p></div>`;
}

/** The pieces tl-tap clones; one line each, so they add no text nodes. */
const tapTemplates = (request) => html`<template data-tap="result"><span class="tap-state"></span> <span class="tap-text"></span></template>
<template data-tap="alert"><p class="status status-error" role="alert"><span class="tap-state">Failed</span> <span class="tap-text"></span></p></template>
<template data-tap="signed-out"><a href="${request.url.pathname + request.url.search}">Sign in again</a> to keep tapping.</template>
`;

/** @param {any} request @param {{ drivers: any[], result?: any, error?: any, running?: boolean }} data */
export function tapPage(request, { drivers, result = null, error = null, running = true }) {
  const base = request.space.base;
  return layout(request, {
    title: 'Tap',
    screen: 'tap',
    scripts: drivers.length && running ? ['elements/tap.js'] : [],
    body: drivers.length && running
      ? html`<tl-tap>
<div class="tap-screen">
  <h1 class="visually-hidden">Tap</h1>
  ${resultBar(result, error)}
  <div class="tap-grid">${drivers.map((d) => html`<form method="post" action="${base}/tap" class="tap-form">
    <input type="hidden" name="driver" value="${d.id}">
    <button type="submit" class="tap-tile" style="--driver: ${d.colour}">${d.name}</button>
  </form>`)}</div>
</div>
${tapTemplates(request)}</tl-tap>`
      : html`<div class="container stack-lg screen">
  <h1>Tap</h1>
  ${error ? html`<p class="status status-error" role="alert"><span class="tap-state">Failed</span> <span class="tap-text">${error.message}</span></p>` : null}
  ${drivers.length
    ? html`<div class="card-static stack-md"><p>No session is running.</p>${startPracticeForm(request, { from: 'tap' })}</div>`
    : html`<div class="card-static stack-md"><p>Add drivers to tap their laps.</p><p><a class="btn btn-primary" href="${base}/setup#drivers">Add drivers</a></p></div>`}
</div>`,
  });
}
