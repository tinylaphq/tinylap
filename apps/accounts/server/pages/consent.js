// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// GET /consent: the provider's consent page (oauthProvider consentPage),
// opened with its signed query. Only MCP clients see it: first-party clients
// skip consent. The client's verified identity is the host of its client id
// URL, so that is what stands out; its own name is plain text and its logo
// is never shown (timing MCP spec §4.4). An app that returns to a loopback
// address gets a warning: any local program could listen there. Allow and
// Cancel are plain forms that post the signed query back to /consent.
import { escapeHtml, layout } from './layout.js';

const isLoopbackHost = (host) => host === 'localhost' || host === '[::1]' || /^127\./.test(host);

/**
 * @param {{
 *   client: { name: string, host: string },
 *   query: string,
 *   redirectUri: string,
 *   scopes: string[],
 *   error?: string,
 * }} view `query` is the provider's signed query, without the leading "?"
 */
export function consentPage({ client, query, redirectUri, scopes, error }) {
  let redirectHost = '';
  let local = false;
  try {
    const url = new URL(redirectUri);
    local = url.protocol === 'http:' && isLoopbackHost(url.hostname);
    if (!local && url.host !== client.host) redirectHost = url.host;
  } catch {
    // the provider checked it; nothing to add
  }
  const stays = scopes.includes('offline_access');
  const form = (accept, label, kind) => `<form method="post" action="/consent">
      <input type="hidden" name="oauth_query" value="${escapeHtml(query)}">
      <input type="hidden" name="accept" value="${accept ? '1' : '0'}">
      <button type="submit" class="btn ${kind} btn-block">${label}</button>
    </form>`;
  return layout({
    title: 'Allow access',
    heading: `Allow ${client.name} to run timing as you?`,
    body: `
<div class="card-static stack-md">
  <p class="accounts-consent-host"><strong>${escapeHtml(client.host)}</strong></p>
  <p class="accounts-hint">This is the website that asks. The name above is the one it gives itself.${redirectHost ? ` It will send you back to <strong>${escapeHtml(redirectHost)}</strong>.` : ''}</p>
  ${local ? '<p class="status status-warning" role="note">This app runs on this computer: it gets the answer on a local address, which any program here could listen on. Allow it only if you just started it yourself.</p>' : ''}
  ${error ? `<p class="status status-error" role="alert">${escapeHtml(error)}</p>` : ''}
  <p>It can see which clubs you're in and your role in each, and read and change timing there as you can: drivers, transponders, tracks, decoders, sessions and the watchers link.</p>
  <p>It can't change your account or your clubs.</p>
  ${stays ? '<p><strong>Stays connected</strong> until you disconnect it on your account page.</p>' : ''}
  <div class="stack-sm">
    ${form(true, 'Allow', 'btn-primary')}
    ${form(false, 'Cancel', 'btn-outline')}
  </div>
</div>`,
  });
}

/** The page for a consent request that can't be shown: expired, or not one of ours. */
export const consentGonePage = () => layout({
  title: 'This request has expired',
  body: `
<div class="card-static stack-md">
  <p>The app's request to connect is no longer valid. Go back to the app and connect again.</p>
  <p><a href="/account">Your account</a></p>
</div>`,
});
