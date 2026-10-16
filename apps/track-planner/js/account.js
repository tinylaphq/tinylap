// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The navbar's account control, the shared one from @tinylap/design written
// into index.html: "Sign in" when signed out, the display name opening the
// menu (Library, Account, Sign out; tl-menu does the opening and closing)
// when signed in, nothing when the server has sign-in turned off. This only
// shows, hides and fills in that markup. Signing in is a plain navigation,
// so the canvas survives through sessionStorage (session-store.js saves it
// on pagehide). Signing out is a same-origin form POST, never a script call.

/** @typedef {{ state: 'off' } | { state: 'out' } | { state: 'down' } | { state: 'in', name: string, accountUrl: string }} AccountView */

/**
 * Asks the planner server who is logged in.
 * @returns {Promise<AccountView>}
 */
export async function loadAccount({ fetch = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetch('/auth/me', { cache: 'no-store', credentials: 'same-origin', headers: { accept: 'application/json' } });
  } catch {
    return { state: 'off' };
  }
  if (res.status === 503) return { state: 'down' };
  if (!res.ok) return { state: 'off' };
  const me = await res.json().catch(() => null);
  if (!me?.available) return { state: 'off' };
  if (!me.loggedIn) return { state: 'out' };
  return { state: 'in', name: me.user?.name || 'Account', accountUrl: me.accountUrl };
}

/** Where "Sign in" goes: back to this page, query included. @param {{ pathname: string, search: string }} location */
export const loginHref = ({ pathname, search }) => `/auth/login?${new URLSearchParams({ returnTo: pathname + search })}`;

/** Shows "Sign in", "unavailable" or the menu for `view`. */
function show(/** @type {Document} */ doc, /** @type {AccountView} */ view) {
  /** @type {HTMLElement} */ (doc.querySelector('#account')).hidden = false;
  /** @type {HTMLElement} */ (doc.querySelector('#account .nav-sign-in')).hidden = view.state !== 'out';
  /** @type {HTMLElement} */ (doc.querySelector('#account .account-down')).hidden = view.state !== 'down';
  const menu = /** @type {any} */ (doc.querySelector('#account .nav-account'));
  if (view.state !== 'in') menu.close?.();
  menu.hidden = view.state !== 'in';
}

/**
 * Asks again who is signed in and updates the control, after the server
 * said the session is gone (a 401), so no stale name stays in the navbar.
 * @returns {Promise<AccountView>}
 */
export async function refreshAccount(doc = document) {
  const view = await loadAccount();
  if (view.state === 'out' || view.state === 'down') show(doc, view);
  return view;
}

/** Wires the control in the page; resolves with the state it shows. @returns {Promise<AccountView | undefined>} */
export async function initAccount(doc = document) {
  const login = /** @type {HTMLAnchorElement | null} */ (doc.querySelector('#account .nav-sign-in'));
  const menu = doc.querySelector('#account .nav-account');
  if (!login || !menu || !doc.querySelector('#account .account-down')) return;

  const view = await loadAccount();
  if (view.state === 'off') return view;
  show(doc, view);

  // The query can change while the page is open (?layout=…), so the link is
  // worked out when it is followed.
  const refresh = () => { login.href = loginHref(location); };
  refresh();
  login.addEventListener('click', refresh);

  if (view.state !== 'in') return view;
  /** @type {HTMLElement} */ (menu.querySelector('.nav-account-name')).textContent = view.name;
  /** @type {HTMLAnchorElement} */ (menu.querySelector('.nav-account-link')).href = view.accountUrl;
  return view;
}
