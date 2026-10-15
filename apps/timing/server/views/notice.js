// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The start page and the notices (spec §6.6): the brand lockup, a
// card-static, and what to do next, as accounts' pages do it.
import { html } from './html.js';
import { asset, layout } from './layout.js';

/** @param {any} request @param {{ title: string, heading?: string, text: string, action?: { href: string, label: string } }} content */
function notice(request, { title, heading = title, text, action }) {
  return layout(request, {
    title,
    body: html`<section class="container-narrow page-header notice">
  <p class="brand-lockup"><img src="${asset(request, 'public/mark.svg')}" alt="" width="32" height="32"><span class="brand">TinyLap Timing</span></p>
  <h1>${heading}</h1>
  <div class="card-static stack-md">
    <p>${text}</p>
    ${action ? html`<p><a class="btn btn-primary" href="${action.href}">${action.label}</a></p>` : null}
  </div>
</section>`,
  });
}

export const startPage = (request) => notice(request, {
  title: 'TinyLap Timing',
  heading: 'Lap times, live',
  text: 'Time your track from a decoder on USB or Wi-Fi, or tap laps by hand, and show the board on every screen.',
  action: { href: '/auth/login?returnTo=%2F', label: 'Sign in' },
});

export const notFoundPage = (request) => notice(request, {
  title: 'Not found',
  text: "There's nothing at this address, or it belongs to a club you're not in.",
  action: { href: '/', label: 'Go to your board' },
});

export const forbiddenPage = (request, detail = "Your role in this club can't do this.") => notice(request, {
  title: 'Not allowed',
  text: detail,
  action: { href: '/', label: 'Go to your board' },
});

export const unavailablePage = (request) => notice(request, {
  title: 'Not available',
  text: "Timing can't read or store anything right now. Try again in a minute.",
});

export const serverErrorPage = (request) => notice(request, {
  title: 'Something went wrong',
  text: 'Timing hit a problem it did not expect. Try again in a minute.',
  action: { href: '/', label: 'Go to your board' },
});

export const watchGonePage = (request) => notice(request, {
  title: 'Link no longer works',
  text: 'This watchers link no longer works. Ask someone at the track for the new one.',
});
