// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// Speculation rules for every TinyLap page: when a pointer rests on a link
// to this site (or a finger goes down on it), the browser fetches the page,
// so the click opens it at once. Prefetch only, never prerender: a
// prerendered page would run its scripts and open its streams unseen. The
// sign-in flow and the APIs are left out; their GETs set cookies or redirect.
// Server-side: a page puts SPECULATION_RULES in its <head> and
// SPECULATION_HASH in its CSP's script-src.
import { createHash } from 'node:crypto';

const RULES = {
  prefetch: [{
    where: {
      and: [
        { href_matches: '/*' },
        { not: { href_matches: ['/auth/*', '/oauth2/*', '/api/*'] } },
      ],
    },
    eagerness: 'moderate',
  }],
};

const body = JSON.stringify(RULES);

export const SPECULATION_RULES = `<script type="speculationrules">${body}</script>`;
export const SPECULATION_HASH = `sha256-${createHash('sha256').update(body).digest('base64')}`;
