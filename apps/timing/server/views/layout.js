// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The shell every timing page shares (spec §4.2), modelled on accounts'
// layout.js: palace's stylesheets, the TinyLap mark, a navbar with the
// space's screens and the account menu, and only external scripts.
import { accountMenu as sharedAccountMenu, signInLink } from '@tinylap/design/html/account.js';
import { brand } from '@tinylap/design/html/brand.js';
import { SPECULATION_RULES } from '@tinylap/design/html/speculation.js';
import { html, safe } from './html.js';

export const SCREENS = /** @type {const} */ ([['board', 'Board'], ['sessions', 'Sessions'], ['tap', 'Tap'], ['setup', 'Setup'], ['bridge', 'Bridge']]);

/** An asset's URL: versioned under /v/<build>/ in production. @param {any} request @param {string} path without a leading slash */
export const asset = (request, path) => (request.build && request.build !== 'dev' ? `/v/${request.build}/${path}` : `/${path}`);

/** The shared account menu (@tinylap/design), with your clubs: personal first, then the clubs. */
function accountMenu(request) {
  if (!request.session) return null;
  const current = request.space?.id;
  return safe(sharedAccountMenu({
    name: request.displayName ?? 'Account',
    accountUrl: request.auth.accountUrl,
    clubs: (request.spaces ?? []).map((s) => ({ href: `${s.base}/board`, name: s.name, current: s.id === current })),
  }));
}

/**
 * @param {any} request
 * @param {{ title: string, body: unknown, screen?: string | null, scripts?: string[], modules?: string[], importMap?: unknown, head?: unknown, watcher?: boolean, big?: boolean, navSignIn?: boolean }} page
 *   `navSignIn: false` leaves the navbar's Sign in out, for a page whose own body has one.
 */
export function layout(request, { title, body, screen = null, scripts = [], modules = [], importMap = null, head = null, watcher = false, big = false, navSignIn = true }) {
  const space = watcher ? null : request.space;
  const signIn = !request.session && !watcher && navSignIn ? safe(signInLink({ href: `/auth/login?${new URLSearchParams({ returnTo: request.url.pathname + request.url.search })}` })) : null;
  const menu = request.session && !watcher ? ['pkg/design/elements/menu.js'] : [];
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
<link rel="icon" href="${asset(request, 'pkg/design/mark.svg')}" type="image/svg+xml">
${safe(SPECULATION_RULES)}
${importMap}${importMap && request.settings?.simulate ? html`<script type="module" src="${asset(request, 'public/sim/install.js')}" data-model="${request.settings.simulate}"></script>\n` : null}${scripts.map((s) => html`<script type="module" src="${asset(request, `public/${s}`)}"></script>\n`)}${[...menu, ...modules].map((m) => html`<script type="module" src="${asset(request, m)}"></script>\n`)}${head}</head>
<body${big ? html` class="big"` : null}>
<nav class="navbar">
  ${safe(brand({ href: '/', name: 'TinyLap Timing', markSrc: asset(request, 'pkg/design/mark.svg') }))}
  ${space ? html`<ul class="nav-tabs">${SCREENS.map(([id, label]) => html`<li><a class="nav-tab" href="${space.base}/${id}"${id === screen ? html` aria-current="page"` : null}>${label}</a></li>`)}</ul>` : null}
  <div class="navbar-right">
    ${screen === 'board' || watcher ? html`${big ? html`<button type="button" class="btn btn-sm btn-outline" data-fullscreen hidden>Full screen</button>
    ` : null}<span class="live-status" id="live-status" data-state="off" hidden></span>
    <button type="button" class="btn btn-sm btn-outline" id="sound-switch" aria-pressed="false" hidden>Sound on</button>
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
