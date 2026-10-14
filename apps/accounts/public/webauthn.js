// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Passkeys through the platform WebAuthn API only, against the endpoints of
// @better-auth/passkey 1.7.7. No Better Auth client SDK: the plugin's
// options are WebAuthn's JSON forms (from @simplewebauthn/server), which
// PublicKeyCredential.parse*OptionsFromJSON read as they are, and
// credential.toJSON() is the shape its verify endpoints take.

/** Thrown with a message meant for the person in front of the page. */
export class PageError extends Error {}

export const supported = () =>
  typeof PublicKeyCredential !== 'undefined' &&
  typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function' &&
  typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function';

/**
 * A same-origin JSON request. Better Auth errors come back as
 * `{ message, code }`; TinyLap's as Problem Details `{ title, detail }`.
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [init]
 */
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 429) throw new PageError(data?.detail ?? 'Too many tries. Wait a while and try again.');
    throw new PageError(data?.detail ?? data?.message ?? `The server answered ${res.status}. Try again.`);
  }
  return data;
}

/** The person cancelled, timed out, or the device refused: say so plainly. */
function ceremonyError(error) {
  if (error instanceof PageError) return error;
  if (error?.name === 'NotAllowedError') return new PageError('No passkey was used. Try again when you are ready.');
  if (error?.name === 'InvalidStateError') return new PageError('This device already has a passkey for this account.');
  return new PageError('Your browser could not use a passkey here. Try another browser or device.');
}

/**
 * Registers a passkey. `params` go to generate-register-options as its
 * query: `context` (the display name, for passkey-first sign-up) or
 * `name` (what the authenticator shows). Returns the verify response.
 * @param {Record<string, string>} params
 * @param {{ createSession?: boolean }} [verify]
 */
export async function registerPasskey(params, { createSession = false } = {}) {
  if (!supported()) throw new PageError('This browser cannot create passkeys. Use a current Chrome, Edge, Firefox or Safari.');
  const options = await api(`/passkey/generate-register-options?${new URLSearchParams(params)}`);
  let credential;
  try {
    credential = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options) });
  } catch (error) {
    throw ceremonyError(error);
  }
  return api('/passkey/verify-registration', { method: 'POST', body: { response: credential.toJSON(), createSession } });
}

/**
 * Signs in with a discoverable passkey. The plugin asks for user
 * verification only as 'preferred'; TinyLap requires it (the server checks
 * the flag), so the request says 'required'. `oauthQuery`, the provider's
 * signed query, makes the answer a redirect back into the OAuth flow.
 * @param {string | null} oauthQuery
 */
export async function signInWithPasskey(oauthQuery) {
  if (!supported()) throw new PageError('This browser cannot use passkeys. Use a current Chrome, Edge, Firefox or Safari.');
  const options = await api('/passkey/generate-authenticate-options');
  let credential;
  try {
    const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON({ ...options, userVerification: 'required' });
    credential = await navigator.credentials.get({ publicKey });
  } catch (error) {
    throw ceremonyError(error);
  }
  const body = { response: credential.toJSON() };
  if (oauthQuery) body.oauth_query = oauthQuery;
  return api('/passkey/verify-authentication', { method: 'POST', body });
}

/** The provider's signed query this page was opened with, or null. */
export function oauthQuery() {
  const params = new URLSearchParams(location.search);
  return params.has('sig') ? location.search.slice(1) : null;
}

/**
 * Where to go once a new account or a recovered one has its passkey: back
 * to /oauth2/authorize with the client's own parameters, which re-checks
 * everything and now finds a session. The provider's signature fields are
 * dropped, and so is prompt=login/create: the person has just proved it.
 * Null when the page wasn't opened from an OAuth request.
 */
export function authorizeUrl() {
  const params = new URLSearchParams(location.search);
  if (!params.has('sig') || !params.has('client_id')) return null;
  for (const name of ['sig', 'exp', 'ba_iat', 'ba_pl', 'ba_param']) params.delete(name);
  const prompt = (params.get('prompt') ?? '').split(' ').filter((p) => p && p !== 'login' && p !== 'create');
  if (prompt.length) params.set('prompt', prompt.join(' '));
  else params.delete('prompt');
  return `/oauth2/authorize?${params}`;
}

/**
 * Shows a message in a status line: kind is 'error', 'success', 'info' or ''.
 * @param {HTMLElement} el
 * @param {string} text
 * @param {string} [kind]
 */
export function show(el, text, kind = '') {
  el.textContent = text;
  el.className = kind ? `status status-${kind}` : 'status';
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.hidden = false;
}

/**
 * Runs a form's async action with its submit button disabled, reporting
 * errors in `status`.
 * @param {HTMLFormElement} form
 * @param {HTMLElement} status
 * @param {() => Promise<void>} action
 */
export function onSubmit(form, status, action) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = /** @type {HTMLButtonElement} */ (form.querySelector('button[type=submit]'));
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      show(status, error instanceof PageError ? error.message : 'Something went wrong. Try again.', 'error');
      if (!(error instanceof PageError)) console.error(error);
    } finally {
      button.disabled = false;
    }
  });
}

/** Marks a step of the progress list as the current one. */
export function stepTo(id) {
  for (const li of document.querySelectorAll('.accounts-progress li')) {
    if (li instanceof HTMLElement && li.dataset.step === id) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  }
}
