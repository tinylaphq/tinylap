// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The shell every timing page shares (spec §4.2), modelled on accounts'
// layout.js: palace's stylesheets, the TinyLap mark, a navbar with the
// space's screens and the account menu, and only external scripts.
import { html } from './html.js';

export const SCREENS = /** @type {const} */ ([['board', 'Board'], ['race', 'Race'], ['tap', 'Tap'], ['setup', 'Setup'], ['bridge', 'Bridge']]);

/** An asset's URL: versioned under /v/<build>/ in production. @param {any} request @param {string} path without a leading slash */
export const asset = (request, path) => (request.build && request.build !== 'dev' ? `/v/${request.build}/${path}` : `/${path}`);

function accountMenu(request) {
  if (!request.session) return null;
  const current = request.space?.id;
  return html`<details class="nav-account">
  <summary class="btn btn-sm btn-outline">${request.displayName ?? 'Account'}</summary>
  <div class="nav-account-menu">
    <p class="nav-account-label">Your spaces</p>
    <ul>${(request.spaces ?? []).map((s) => html`<li><a href="${s.base}/board"${s.id === current ? html` aria-current="true"` : null}>${s.name}</a></li>`)}</ul>
    <a href="${request.auth.accountUrl}">Account</a>
    <form method="post" action="/auth/logout">
      <button type="submit" class="nav-account-signout">Sign out</button>
    </form>
  </div>
</details>`;
}

/**
 * @param {any} request
 * @param {{ title: string, body: unknown, screen?: string | null, scripts?: string[], importMap?: unknown, head?: unknown, watcher?: boolean, big?: boolean }} page
 */
export function layout(request, { title, body, screen = null, scripts = [], importMap = null, head = null, watcher = false, big = false }) {
  const space = watcher ? null : request.space;
  const signIn = !request.session && !watcher ? html`<a class="btn btn-sm btn-outline" href="/auth/login?${new URLSearchParams({ returnTo: request.url.pathname + request.url.search })}">Sign in</a>` : null;
  const bigLink = big ? request.url.pathname : `${request.url.pathname}?big`;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${title === 'TinyLap Timing' ? title : `${title} · TinyLap Timing`}</title>
<link rel="stylesheet" href="${asset(request, 'pkg/palace-ui/palace.css')}">
<link rel="stylesheet" href="${asset(request, 'pkg/design/design.css')}">
<link rel="stylesheet" href="${asset(request, 'public/app.css')}">
<link rel="icon" href="${asset(request, 'public/mark.svg')}" type="image/svg+xml">
${importMap}${scripts.map((s) => html`<script type="module" src="${asset(request, `public/${s}`)}"></script>\n`)}${head}</head>
<body${big ? html` class="big"` : null}>
<nav class="navbar">
  <a class="navbar-brand" href="/"><img src="${asset(request, 'public/mark.svg')}" alt="" width="24" height="24"> TinyLap Timing</a>
  ${space ? html`<ul class="nav-tabs">${SCREENS.map(([id, label]) => html`<li><a class="nav-tab" href="${space.base}/${id}"${id === screen ? html` aria-current="page"` : null}>${label}</a></li>`)}</ul>` : null}
  <div class="navbar-right">
    ${screen === 'board' || watcher ? html`<span class="live-status" id="live-status" data-state="off" hidden></span>
    <a class="btn btn-sm btn-outline" href="${bigLink}">${big ? 'Leave big screen' : 'Big screen'}</a>` : null}
    ${watcher ? null : accountMenu(request)}${signIn}
  </div>
</nav>
<main>
${body}
</main>
</body>
</html>
`;
}
