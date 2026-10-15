// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The app: the watchers view for #watch=<token> (no log-in, the token never
// leaves the fragment), otherwise log-in, a workspace, and its screens.
import { api } from './api.js';
import { mountBoard } from './board.js';
import { h } from './dom.js';
import { connect } from './live.js';
import { applyEvent, createView } from './view.js';

/** The screens, by hash. */
export const SCREENS = [
  { id: 'board', label: 'Board', mount: mountBoard },
];

const app = document.querySelector('#app');
const nav = /** @type {HTMLElement} */ (document.querySelector('#nav'));
const status = document.querySelector('#live-status');
const STATUS = { live: 'Live', reconnecting: 'Reconnecting…', closed: 'Disconnected' };

const tryStorage = (fn) => {
  try {
    return fn();
  } catch {
    return null;
  }
};

/** A full-page message, with an optional link. */
function notice(title, text, link) {
  app.replaceChildren(h('section', { class: 'container-narrow stack-md notice' },
    h('h1', {}, title), h('p', { class: 'subtitle' }, text),
    link && h('a', { class: 'btn btn-primary', href: link.href }, link.label)));
}

/** A live view: events go into `view`, then every listener runs. */
function live(url, onStatus) {
  const view = createView();
  const listeners = new Set();
  const close = connect(url, (type, data) => {
    applyEvent(view, type, data);
    for (const fn of listeners) fn();
  }, onStatus);
  return { view, close, onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)) };
}

function bigScreen() {
  document.body.classList.toggle('big');
  if (document.body.classList.contains('big')) document.documentElement.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function watch(token) {
  document.body.classList.add('watching');
  const stream = live(`/watch/${encodeURIComponent(token)}/live`, (state) => {
    if (state === 'closed') notice('This watchers link no longer works', 'Ask someone at the track for a new one.');
  });
  mountBoard(app, { view: stream.view, watcher: true, onChange: stream.onChange });
}

function member(me) {
  const workspaces = me.workspaces;
  const asked = new URLSearchParams(location.search).get('w');
  const stored = tryStorage(() => localStorage.getItem('timing.workspace'));
  const workspaceId = [asked, stored].find((id) => workspaces.some((w) => w.id === id)) ?? workspaces[0].id;
  tryStorage(() => localStorage.setItem('timing.workspace', workspaceId));

  nav.hidden = false;
  const select = /** @type {HTMLSelectElement} */ (document.querySelector('#workspace'));
  select.replaceChildren(...workspaces.map((w) => h('option', { value: w.id, selected: w.id === workspaceId }, w.name ?? 'Workspace')));
  select.addEventListener('change', () => { location.search = `?w=${encodeURIComponent(select.value)}`; });
  document.querySelector('#btn-big').addEventListener('click', bigScreen);
  // Big screen hides the navbar; leaving full screen (Escape) leaves it.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) document.body.classList.remove('big');
  });

  const stream = live(`/workspaces/${encodeURIComponent(workspaceId)}/live`, (state) => { status.textContent = STATUS[state]; });
  const ctx = { workspaceId, me, view: stream.view, watcher: false, onChange: stream.onChange, api };
  const tabs = document.querySelector('#tabs');
  let unmount = () => {};
  const show = () => {
    const id = location.hash.slice(1);
    const screen = SCREENS.find((s) => s.id === id) ?? SCREENS[0];
    tabs.replaceChildren(...SCREENS.map((s) => h('a', { class: 'nav-tab', href: `#${s.id}`, 'aria-current': s === screen ? 'page' : null }, s.label)));
    unmount();
    app.replaceChildren();
    unmount = screen.mount(app, ctx);
  };
  window.addEventListener('hashchange', show);
  show();
}

async function start() {
  const token = new URLSearchParams(location.hash.slice(1)).get('watch');
  if (token) return watch(token);
  let me;
  try {
    me = await api('GET', '/auth/me');
  } catch {
    return notice("Timing can't be reached", 'Try again in a minute.');
  }
  if (!me.available) return notice('Log-in is not set up', 'This server has no TinyLap accounts to log in with.');
  const returnTo = location.pathname + location.search + location.hash;
  if (!me.loggedIn) return notice('TinyLap Timing', 'Log in to time laps on your track.', { href: `/auth/login?returnTo=${encodeURIComponent(returnTo)}`, label: 'Log in' });
  if (me.workspaces.length === 0) return notice('No workspace yet', 'Create a club in your TinyLap account first.', { href: me.accountUrl, label: 'Account' });
  member(me);
}

start();
