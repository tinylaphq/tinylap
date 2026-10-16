// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// The TinyLap mark with a product name: the navbar's brand link, and the
// larger lockup that heads a page without a navbar.
import { escapeHtml as e, safeHref as url } from './escape.js';

/** @param {{ href: string, name: string, markSrc: string }} brand */
export const brand = ({ href, name, markSrc }) =>
  `<a class="navbar-brand" href="${url(href)}"><img src="${url(markSrc)}" alt="" width="24" height="24"> ${e(name)}</a>`;

/** @param {{ name: string, markSrc: string }} lockup */
export const brandLockup = ({ name, markSrc }) =>
  `<p class="brand-lockup"><img src="${url(markSrc)}" alt="" width="32" height="32"><span class="brand">${e(name)}</span></p>`;
