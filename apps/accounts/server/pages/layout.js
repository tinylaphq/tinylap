// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The shell every accounts page shares: palace-ui's narrow auth layout, the
// TinyLap mark, and one external module script. No inline scripts or styles
// (the page CSP forbids both, except the speculation rules, allowed by hash);
// state the scripts need travels in data-*.
import { SPECULATION_RULES } from '@tinylap/design/html/speculation.js';

/** @param {unknown} text */
export const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * The query a page was opened with, to carry an OAuth request (the
 * provider's signed `sig`/`exp` query) from page to page. Empty when there
 * is none.
 * @param {URL} url
 */
export const carry = (url) => (url.search.length > 1 ? url.search : '');

/**
 * `wide` pages (clubs) use palace's 640px container instead of the 420px
 * auth column.
 * @param {{ title: string, heading?: string, lede?: string, body: string, script?: string, data?: Record<string, string>, wide?: boolean }} page
 */
export function layout({ title, heading = title, lede = '', body, script, data = {}, wide = false }) {
  const attrs = Object.entries(data).map(([k, v]) => ` data-${k}="${escapeHtml(v)}"`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)} · TinyLap</title>
<link rel="stylesheet" href="/pkg/palace-ui/palace.css">
<link rel="stylesheet" href="/pkg/design/design.css">
<link rel="stylesheet" href="/public/accounts.css">
<link rel="icon" href="/public/mark.svg" type="image/svg+xml">
${SPECULATION_RULES}
${script ? `<script type="module" src="/public/${script}"></script>\n` : ''}</head>
<body${attrs}>
<main class="${wide ? 'container accounts-wide' : 'container-narrow'} page-header accounts">
<p class="brand-lockup accounts-brand"><img src="/public/mark.svg" alt="" width="32" height="32"><span class="brand">TinyLap</span></p>
<h1>${escapeHtml(heading)}</h1>
${lede ? `<p class="subtitle">${lede}</p>\n` : ''}${body}
</main>
</body>
</html>
`;
}

/** The message every passkey page shows when scripts are off. */
export const NOSCRIPT = `<noscript><p class="status status-warning">Passkeys need JavaScript. Turn it on for this page to continue.</p></noscript>`;
