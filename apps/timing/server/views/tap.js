// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Tap entry (spec §6.3): one form per driver, a big button each. tl-tap
// submits them in place; without it each tap is a page load.
import { formatLap } from '../../public/format.js';
import { html } from './html.js';
import { layout } from './layout.js';
import { startPracticeForm } from './marks.js';

/**
 * What a tap did, in two parts for the eye: the driver's name, which the bar
 * may cut short, and what follows it, which always shows. Again has no name.
 * And as one sentence for a screen reader, which reads the bar's label and
 * parts as fragments: "Lap for Ana: 7.000."
 * @param {{ result: string, ms?: number | null }} result @param {{ name: string }} driver
 */
export function tapResultParts(result, driver) {
  if (result.result === 'again') return { name: '', detail: 'Too fast, tap again.', spoken: 'Too fast, tap again.' };
  if (result.result === 'started') return { name: driver.name, detail: ': started', spoken: `${driver.name} started.` };
  const time = formatLap(result.ms ?? null);
  return { name: driver.name, detail: `: ${time}`, spoken: `Lap for ${driver.name}: ${time}.` };
}

/** The result's words: the sentence a screen reader reads, then the name and the rest for the eye. @param {{ name: string, detail: string, spoken: string }} parts */
const resultText = ({ name, detail, spoken }) => html`<span class="visually-hidden tap-spoken">${spoken}</span><span class="tap-text" aria-hidden="true"><span class="tap-name">${name}</span><span class="tap-detail">${detail}</span></span>`;

/** The letters in a name's longest word, for its tile's type size. @param {string} name */
const longestWord = (name) => Math.max(1, ...name.split(/\s+/).map((w) => [...w].length));

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
  <p class="tap-result" id="tap-result" role="status" aria-live="polite"><span class="tap-state" aria-hidden="true">${STATE_LABEL[result.result]}</span> ${resultText(tapResultParts(result, result.driver))}</p></div>`;
}

/** The pieces tl-tap clones; one line each, so they add no text nodes. */
const tapTemplates = (request) => html`<template data-tap="result"><span class="tap-state" aria-hidden="true"></span> <span class="visually-hidden tap-spoken"></span><span class="tap-text" aria-hidden="true"><span class="tap-name"></span><span class="tap-detail"></span></span></template>
<template data-tap="alert"><p class="status status-error" role="alert"><span class="tap-state">Failed</span> <span class="tap-text"></span></p></template>
<template data-tap="signed-out"><a href="${request.url.pathname + request.url.search}">Sign in again</a> to keep tapping.</template>
`;

/**
 * `missed`: a tap just found no session, here or (?result=no-session) from
 * tl-tap; the card then says the tap was not counted, and why.
 * @param {any} request @param {{ drivers: any[], result?: any, error?: any, running?: boolean, missed?: boolean }} data
 */
export function tapPage(request, { drivers, result = null, error = null, running = true, missed = false }) {
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
    <button type="submit" class="tap-tile" style="--driver: ${d.colour}; --word: ${longestWord(d.name)}"><span class="tap-tile-name" title="${d.name}">${d.name}</span></button>
  </form>`)}</div>
</div>
${tapTemplates(request)}</tl-tap>`
      : html`<div class="container stack-lg screen">
  <h1>Tap</h1>
  ${error && error.problem !== 'no-session' ? html`<p class="status status-error" role="alert"><span class="tap-state">Failed</span> <span class="tap-text">${error.message}</span></p>` : null}
  ${drivers.length
    ? html`<div class="card-static stack-md"><p>${missed || error?.problem === 'no-session' ? 'That tap wasn’t counted: no session is running.' : 'No session is running.'}</p>${startPracticeForm(request, { from: 'tap' })}</div>`
    : html`<div class="card-static stack-md"><p>Add drivers to tap their laps.</p><p><a class="btn btn-primary" href="${base}/setup#drivers">Add drivers</a></p></div>`}
</div>`,
  });
}
