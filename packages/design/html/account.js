// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// The navbar's account control, the same in every TinyLap app: the signed-in
// name opens a menu (your clubs where the app has them, its own items, Account,
// the app's settings in a group of their own, Sign out), and a signed-out visitor gets Sign in. A <details> works without
// script; tl-menu (elements/menu.js) adds Escape and closing from outside.
// No ids of its own (only the ones a caller gives its items), so two menus
// never collide; apps find the parts by class
// (.nav-account-name, .nav-account-link, .nav-sign-in). These return plain
// strings: a server template marks them as safe HTML.
// The planner's static page writes this markup out literally, and its test
// checks it against these functions.
import { escapeHtml as e, safeHref as url } from './escape.js';

/**
 * @param {{
 *   name: string, accountUrl: string, signOutAction?: string,
 *   clubs?: { href: string, name: string, current?: boolean }[] | null,
 *   items?: { id: string, label: string, hidden?: boolean }[],
 *   settings?: string,
 * }} menu  clubs: personal first, as the caller lists them; settings: the
 *   app's own markup after Account, before Sign out (a .navbar-menu-group of
 *   settings, each a button.navbar-menu-setting with aria-pressed), trusted as given
 */
export function accountMenu({ name, accountUrl, signOutAction = '/auth/logout', clubs = null, items = [], settings = '' }) {
  const clubList = clubs?.length ? `
      <p class="navbar-menu-label" aria-hidden="true">Your clubs</p>
      <ul aria-label="Your clubs">
${clubs.map((c) => `        <li><a href="${url(c.href)}"${c.current ? ' aria-current="true"' : ''}>${e(c.name)}</a></li>`).join('\n')}
      </ul>` : '';
  const extra = items.map((i) => `
      <button type="button" class="nav-account-item" id="${e(i.id)}"${i.hidden ? ' hidden' : ''}>${e(i.label)}</button>`).join('');
  return `<tl-menu class="nav-account">
  <details class="navbar-menu" name="tl-account">
    <summary><span class="visually-hidden">Account: </span><span class="nav-account-name">${e(name)}</span></summary>
    <div class="nav-account-menu navbar-menu-panel">${clubList}${extra}
      <a class="nav-account-link" href="${url(accountUrl)}">Account</a>${settings ? `
      ${settings}` : ''}
      <form method="post" action="${url(signOutAction)}">
        <button type="submit" class="nav-account-signout">Sign out</button>
      </form>
    </div>
  </details>
</tl-menu>`;
}

/** @param {{ href: string }} link */
export const signInLink = ({ href }) => `<a class="btn btn-sm btn-outline nav-sign-in" href="${url(href)}">Sign in</a>`;
