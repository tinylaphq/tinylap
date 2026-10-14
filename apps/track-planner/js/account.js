// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The navbar's account control: "Log in" when logged out, the display name
// opening a menu (Library, Account, Log out) when logged in, nothing when
// the server has log-in turned off. Logging in is a plain navigation, so
// the canvas survives through sessionStorage (session-store.js saves it on
// pagehide). Logging out is a same-origin form POST, never a script call.

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

/** Where "Log in" goes: back to this page, query included. @param {{ pathname: string, search: string }} location */
export const loginHref = ({ pathname, search }) => `/auth/login?${new URLSearchParams({ returnTo: pathname + search })}`;

/** Shows "Log in", "unavailable" or the name for `view`. */
function show(/** @type {Document} */ doc, /** @type {AccountView} */ view) {
  /** @type {HTMLElement} */ (doc.querySelector('#account')).hidden = false;
  /** @type {HTMLElement} */ (doc.querySelector('#btn-login')).hidden = view.state !== 'out';
  /** @type {HTMLElement} */ (doc.querySelector('#account-down')).hidden = view.state !== 'down';
  /** @type {HTMLElement} */ (doc.querySelector('#btn-account')).hidden = view.state !== 'in';
}

/**
 * Asks again who is logged in and updates the control, after the server
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
  const root = /** @type {HTMLElement} */ (doc.querySelector('#account'));
  const login = /** @type {HTMLAnchorElement} */ (doc.querySelector('#btn-login'));
  const button = /** @type {HTMLButtonElement} */ (doc.querySelector('#btn-account'));
  const down = /** @type {HTMLElement} */ (doc.querySelector('#account-down'));
  const menu = /** @type {HTMLElement} */ (doc.querySelector('#account-menu'));
  if (!root || !login || !button || !down || !menu) return;

  const view = await loadAccount();
  if (view.state === 'off') return view;
  show(doc, view);

  // The query can change while the page is open (?layout=…), so the link is
  // worked out when it is followed.
  const refresh = () => { login.href = loginHref(location); };
  refresh();
  login.addEventListener('click', refresh);

  if (view.state !== 'in') return view;
  button.textContent = view.name;
  button.setAttribute('aria-expanded', 'false');
  /** @type {HTMLAnchorElement} */ (menu.querySelector('#menu-account')).href = view.accountUrl;

  const items = () => /** @type {HTMLElement[]} */ ([...menu.querySelectorAll('[role="menuitem"]')].filter((el) => !el.closest('[hidden]')));

  // Under the button, right edges aligned.
  menu.addEventListener('toggle', (/** @type {any} */ event) => {
    const open = event.newState === 'open';
    button.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const rect = button.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.right = `${Math.max(8, doc.documentElement.clientWidth - rect.right)}px`;
    items()[0]?.focus();
  });

  menu.addEventListener('keydown', (event) => {
    const list = items();
    const at = list.indexOf(/** @type {HTMLElement} */ (doc.activeElement));
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    list[(to + list.length) % list.length]?.focus();
  });
  return view;
}
