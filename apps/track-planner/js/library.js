// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The library (identity spec §5, §6): named tracks in the user's workspaces,
// each with its history. This module is the planner's side of /library and
// the UI around it: "Save to library", the library dialog, and the name of
// the track the canvas came from. The server enforces every permission; the
// role check here only decides which buttons to show.
import { request, fetchShared } from './share.js';
import { loadTrackRef, saveTrackRef } from './session-store.js';

/** @import { Layout } from '@tinylap/track-format' */
/** @typedef {{ id: string, name: string | null }} Saver */
/** @typedef {{ id: string, workspaceId: string, name: string, currentKey: string, createdAt: string, updatedAt: string, updatedBy: Saver }} Track */
/** @typedef {{ key: string, savedAt: string, savedBy: Saver }} Version */
/** @typedef {{ id: string, name: string | null, role: string, tracks: Track[] }} Workspace */
/** @typedef {{ id: string, name: string, workspaceId: string }} TrackRef */

const enc = encodeURIComponent;

/**
 * The library API. Each call returns the parsed JSON (null for a 204), or
 * throws `Error(problem.title)` with the HTTP `status`, like share.js. A
 * 401 (the session is gone) also calls `onUnauthorized`.
 * @param {{ fetch?: typeof globalThis.fetch, onUnauthorized?: () => void }} [options]
 */
export function libraryApi({ fetch = globalThis.fetch, onUnauthorized = () => {} } = {}) {
  /** @param {string} method @param {string} path @param {any} [body] */
  async function call(method, path, body) {
    let res;
    try {
      res = await request(fetch, path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (/** @type {any} */ (error).status === 401) onUnauthorized();
      throw error;
    }
    return res.status === 204 ? null : res.json();
  }
  const track = (/** @type {string} */ id) => `/library/tracks/${enc(id)}`;
  return {
    /** @returns {Promise<{ workspaces: Workspace[] }>} */
    list: () => call('GET', '/library'),
    /** @param {string} workspaceId @param {string} name @param {Layout} layout @returns {Promise<{ track: Track }>} */
    saveNew: (workspaceId, name, layout) => call('POST', '/library/tracks', { workspaceId, name, layout }),
    /** @param {string} id @param {Layout} layout @returns {Promise<{ track: Track, version: Version }>} */
    saveVersion: (id, layout) => call('POST', `${track(id)}/versions`, { layout }),
    /** @param {string} id @param {string} name @returns {Promise<{ track: Track }>} */
    rename: (id, name) => call('PATCH', track(id), { name }),
    /** @param {string} id @param {string} workspaceId @returns {Promise<{ track: Track }>} */
    copy: (id, workspaceId) => call('POST', `${track(id)}/copy`, { workspaceId }),
    /** @param {string} id */
    remove: (id) => call('DELETE', track(id)),
    /** @param {string} id @param {string} key */
    removeVersion: (id, key) => call('DELETE', `${track(id)}/versions/${enc(key)}`),
    /** @param {string} id @returns {Promise<{ versions: Version[], kept: number }>} */
    versions: (id) => call('GET', `${track(id)}/versions`),
    /** Publishes the current version. @param {string} id @returns {Promise<{ key: string, url: string, shapeKey: string | null }>} */
    share: (id) => call('POST', `${track(id)}/share`, {}),
    /** A version's layout (private snapshots are read with the session cookie). @param {string} key */
    layout: (key) => fetchShared(key, { fetch }),
  };
}

// The rows of identity spec §5 the library shows. A copy of @tinylap/auth's
// matrix for visibility only: the browser does not load that package.
const MATRIX = {
  'track.read': ['owner', 'admin', 'member'],
  'track.save': ['owner', 'admin', 'member'],
  'track.share': ['owner', 'admin', 'member'],
  'track.copy': ['owner', 'admin', 'member'],
  'track.delete': ['owner', 'admin'],
};

/** Whether `role` may do `action` (for showing a button, never for access). @param {string} role @param {string} action */
export const may = (role, action) => Object.hasOwn(MATRIX, action) && MATRIX[action].includes(role);

const UNITS = /** @type {const} */ ([['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3600], ['minute', 60]]);
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "5 minutes ago", "yesterday". @param {string} iso @param {number} [now] */
export function relativeTime(iso, now = Date.now()) {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const seconds = (at - now) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.trunc(seconds / size), unit);
  }
  return 'just now';
}

/** @param {Saver | null | undefined} saver */
export const saverName = (saver) => saver?.name || 'former member';

/**
 * A workspace as the UI names it. accounts lists the personal workspace
 * first, then clubs by name, and the token keeps that order: the first is
 * "Personal", as in timing and the account menu.
 * @param {{ name: string | null }} workspace @param {number} index
 */
export const workspaceLabel = (workspace, index) => (index === 0 ? 'Personal' : workspace.name || 'Unnamed club');

// ── The track on the canvas ─────────────────────────────────────────

/** @param {Document} doc @param {TrackRef | null} ref */
function showCurrent(doc, ref) {
  const label = /** @type {HTMLElement | null} */ (doc.querySelector('#library-current'));
  if (label) {
    // Only while the library is on (logged in); undo may restore a link at any time.
    label.hidden = !ref || !doc.querySelector('#btn-save[data-library]');
    label.textContent = ref?.name ?? '';
    label.title = ref ? `On the canvas: ${ref.name} from your library` : '';
  }
  const save = doc.querySelector('#btn-save');
  if (save && !save.hasAttribute('data-library')) return;
  save?.setAttribute('title', ref ? `Save a new version of ${ref.name}` : 'Save this track to your library');
}

/** Remembers which library track the canvas holds. @param {TrackRef | null} ref */
function setCurrent(ref, doc = document) {
  saveTrackRef(sessionStorage, ref);
  showCurrent(doc, ref);
}

/** The canvas no longer comes from a library track (a file, a shared link, a new layout). */
export function forgetTrack(doc = document) {
  setCurrent(null, doc);
}

/**
 * The undo stack, with the track link each layout had. app.js keeps its
 * history in this (push before a change, pop on undo), so undoing the open
 * of a library track also forgets the track, and undoing a file open brings
 * the track back: the link always belongs to the layout on the canvas.
 * @template T
 * @param {{ load?: () => TrackRef | null, restore?: (ref: TrackRef | null) => void }} [io]
 */
export function linkedHistory({ load = () => loadTrackRef(sessionStorage), restore = (ref) => setCurrent(ref) } = {}) {
  /** @type {{ layout: T, link: TrackRef | null }[]} */
  const entries = [];
  return {
    /** @param {T} layout */
    push(layout) {
      return entries.push({ layout, link: load() });
    },
    /** @returns {T | undefined} */
    pop() {
      const entry = entries.pop();
      if (!entry) return undefined;
      restore(entry.link);
      return entry.layout;
    },
    get length() {
      return entries.length;
    },
  };
}

// ── DOM helpers ─────────────────────────────────────────────────────

/** @param {Document} doc @param {string} tag @param {Record<string, any>} [props] @param {(Node | string)[]} [children] */
function el(doc, tag, props = {}, children = []) {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('data-') || key.startsWith('aria-') || key === 'role' || key === 'for') node.setAttribute(key, value === true ? '' : value);
    else /** @type {any} */ (node)[key] = value;
  }
  node.append(...children);
  return node;
}

/** @param {Document} doc @param {string} iso */
const when = (doc, iso) => el(doc, 'time', { dateTime: iso, title: new Date(iso).toLocaleString(), text: relativeTime(iso) });

/** "Just now", "5 minutes ago": a relative date that starts a line. @param {HTMLElement} node */
const capitalized = (node) => {
  node.textContent = (node.textContent ?? '').replace(/^./, (c) => c.toUpperCase());
  return node;
};

/** @param {Document} doc @param {string} text @param {string} act @param {string} [kind] */
const action = (doc, text, act, kind = 'btn-outline') => el(doc, 'button', { type: 'button', class: `btn btn-sm ${kind}`, 'data-act': act, text });

/**
 * Asks before something cannot be taken back. Resolves true on confirm.
 * @param {Document} doc @param {{ title: string, text: string, confirm: string }} copy
 */
function confirmAction(doc, { title, text, confirm }) {
  const dialog = /** @type {HTMLDialogElement} */ (doc.querySelector('#confirm-dialog'));
  /** @type {HTMLElement} */ (dialog.querySelector('#confirm-dialog-title')).textContent = title;
  /** @type {HTMLElement} */ (dialog.querySelector('#confirm-dialog-text')).textContent = text;
  /** @type {HTMLElement} */ (dialog.querySelector('#confirm-dialog-ok')).textContent = confirm;
  return new Promise((resolve) => {
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
  });
}

// ── The UI ──────────────────────────────────────────────────────────

/**
 * @typedef {object} Host what the planner lends the library
 * @property {() => Layout} settle the canvas's layout with its track settled, as Save keeps it
 * @property {(layout: Layout) => void} adopt replaces the canvas (one undo step)
 * @property {(message: { error?: string, notice?: string }) => void} report the status line
 * @property {() => void} [unauthorized] a library call answered 401: the session is gone
 */

/**
 * Wires the library into the page once the user is known to be logged in:
 * "Save" saves to the library, "Download" keeps the file, the account
 * menu's "Library" opens the dialog.
 * @param {Host} host @param {{ api?: ReturnType<typeof libraryApi>, doc?: Document }} [options]
 * @returns {{ save: () => Promise<void> }}
 */
export function initLibrary(host, { api = libraryApi({ onUnauthorized: host.unauthorized }), doc = document } = {}) {
  const dialog = /** @type {HTMLDialogElement} */ (doc.querySelector('#library-dialog'));
  const body = /** @type {HTMLElement} */ (doc.querySelector('#library-body'));
  const problem = /** @type {HTMLElement} */ (doc.querySelector('#library-error'));
  const saveDialog = /** @type {HTMLDialogElement} */ (doc.querySelector('#save-dialog'));
  const saveForm = /** @type {HTMLFormElement} */ (doc.querySelector('#save-form'));
  const saveError = /** @type {HTMLElement} */ (doc.querySelector('#save-error'));
  const saveName = /** @type {HTMLInputElement} */ (doc.querySelector('#save-name'));
  const saveWorkspace = /** @type {HTMLSelectElement} */ (doc.querySelector('#save-workspace'));
  const menuItem = /** @type {HTMLElement} */ (doc.querySelector('#menu-library'));
  const download = /** @type {HTMLElement} */ (doc.querySelector('#btn-download'));

  // Signed out, this button downloads a file and says so; signed in, it saves.
  const navSave = doc.querySelector('#btn-save');
  navSave?.setAttribute('data-library', '');
  if (navSave) navSave.textContent = 'Save';
  menuItem.hidden = false;
  download.hidden = false;
  showCurrent(doc, loadTrackRef(sessionStorage));

  /** @type {Workspace[]} */
  let workspaces = [];
  /** Which panel each track has open: 'history' | 'rename' | 'copy'. @type {Map<string, string>} */
  const panels = new Map();
  /** Loaded histories. @type {Map<string, { versions: Version[], kept: number }>} */
  const histories = new Map();

  /** @param {string | null} message */
  function fail(message) {
    problem.textContent = message ?? '';
    problem.hidden = !message;
    if (message) host.report({ error: message });
  }

  const trackById = (/** @type {string} */ id) => workspaces.flatMap((w) => w.tracks).find((t) => t.id === id);

  // ── Save ──

  // One save at a time: a double click must not post two versions.
  const saveButton = /** @type {HTMLButtonElement} */ (doc.querySelector('#btn-save'));
  let saving = false;
  async function save() {
    if (saving) return;
    saving = true;
    saveButton.disabled = true;
    try {
      await saveOnce();
    } finally {
      saving = false;
      saveButton.disabled = false;
    }
  }

  async function saveOnce() {
    const ref = loadTrackRef(sessionStorage);
    const layout = host.settle();
    if (ref) {
      try {
        const { track } = await api.saveVersion(ref.id, layout);
        setCurrent({ id: track.id, name: track.name, workspaceId: track.workspaceId }, doc);
        host.report({ notice: `Saved a new version of ${track.name}.` });
      } catch (error) {
        if (/** @type {any} */ (error).status === 404) {
          forgetTrack(doc);
          host.report({ error: `${ref.name} is no longer in your library. Save again to keep it as a new track.` });
        } else {
          host.report({ error: /** @type {Error} */ (error).message });
        }
      }
      return;
    }
    let list;
    try {
      list = await api.list();
    } catch (error) {
      host.report({ error: /** @type {Error} */ (error).message });
      return;
    }
    const writable = list.workspaces.map((w, i) => ({ w, i })).filter(({ w }) => may(w.role, 'track.save'));
    saveWorkspace.replaceChildren(...writable.map(({ w, i }) => el(doc, 'option', { value: w.id, text: workspaceLabel(w, i) })));
    saveWorkspace.selectedIndex = 0;
    /** @type {HTMLElement} */ (saveWorkspace.closest('.field')).hidden = writable.length < 2;
    saveName.value = '';
    saveError.hidden = true;
    saveDialog.showModal();
  }

  saveForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitter = /** @type {HTMLButtonElement} */ (doc.querySelector('#save-submit'));
    const name = saveName.value.trim();
    if (!name) {
      saveName.focus();
      return;
    }
    submitter.disabled = true;
    try {
      const { track } = await api.saveNew(saveWorkspace.value, name, host.settle());
      setCurrent({ id: track.id, name: track.name, workspaceId: track.workspaceId }, doc);
      saveDialog.close('saved');
      host.report({ notice: `Saved ${track.name} to your library.` });
    } catch (error) {
      saveError.textContent = /** @type {Error} */ (error).message;
      saveError.hidden = false;
    } finally {
      submitter.disabled = false;
    }
  });

  doc.querySelector('#save-cancel')?.addEventListener('click', () => saveDialog.close());

  // ── The dialog ──

  async function load() {
    try {
      ({ workspaces } = await api.list());
      fail(null);
    } catch (error) {
      fail(/** @type {Error} */ (error).message);
    }
    render();
  }

  function render() {
    const current = loadTrackRef(sessionStorage);
    const total = workspaces.reduce((n, w) => n + w.tracks.length, 0);
    const sections = workspaces.map((w, i) => {
      const head = el(doc, 'div', { class: 'library-ws-head' }, [
        el(doc, 'h3', { class: 'h3', text: workspaceLabel(w, i) }),
        ...(i === 0 ? [] : [el(doc, 'span', { class: 'tag', text: w.role[0].toUpperCase() + w.role.slice(1) })]),
      ]);
      const list = w.tracks.length
        ? el(doc, 'ul', { class: 'library-tracks' }, w.tracks.map((t) => trackRow(t, w, current)))
        : el(doc, 'p', { class: 'empty', text: 'No tracks here yet.' });
      return el(doc, 'section', { class: 'library-ws', 'aria-label': workspaceLabel(w, i) }, [head, list]);
    });
    if (workspaces.length && total === 0) {
      sections.unshift(el(doc, 'p', { class: 'library-hint', text: 'Nothing saved yet. Close this and press Save to keep the track on the canvas here.' }));
    }
    const focused = focusKey(doc.activeElement);
    body.replaceChildren(...sections);
    if (focused) refocus(focused);
  }

  // A re-render replaces every node, so the focus is carried over by what
  // it was on: the same button of the same track (and version), else the
  // button that opened the panel it was in, else the row, else its
  // neighbour, else the dialog's Close.

  /** @param {Element | null} node */
  function focusKey(node) {
    if (!(node instanceof HTMLElement) || !body.contains(node)) return null;
    const row = node.closest('[data-track-id]');
    if (!row) return null;
    return {
      track: /** @type {string} */ (row.getAttribute('data-track-id')),
      act: node.dataset.act,
      key: /** @type {HTMLElement | null} */ (node.closest('[data-key]'))?.dataset.key,
      panel: /** @type {HTMLElement | null} */ (node.closest('[data-panel]'))?.dataset.panel,
      index: [...body.querySelectorAll('.library-track')].indexOf(row),
    };
  }

  /** @param {NonNullable<ReturnType<typeof focusKey>>} k */
  function refocus({ track, act, key, panel, index }) {
    const row = body.querySelector(`[data-track-id="${CSS.escape(track)}"]`);
    const rows = body.querySelectorAll('.library-track');
    const own = act && act !== 'close-panel'
      ? key
        ? row?.querySelector(`[data-key="${CSS.escape(key)}"] [data-act="${act}"]`)
        : row?.querySelector(`.library-actions [data-act="${act}"]`)
      : null;
    const target = own
      ?? (panel ? row?.querySelector(`.library-actions [data-act="${panel}"]`) : null)
      ?? row
      ?? rows[Math.min(index, rows.length - 1)]
      ?? dialog.querySelector('.dialog-dismiss button');
    /** @type {HTMLElement | null | undefined} */ (target)?.focus();
  }

  /** @param {Track} t @param {Workspace} w @param {TrackRef | null} current */
  function trackRow(t, w, current) {
    const onCanvas = current?.id === t.id;
    const panel = panels.get(t.id);
    const others = workspaces.filter((o) => o.id !== w.id && may(o.role, 'track.save'));
    const actions = el(doc, 'div', { class: 'library-actions' }, [
      action(doc, 'Open', 'open', 'btn-primary'),
      el(doc, 'button', { type: 'button', class: 'btn btn-sm btn-outline', 'data-act': 'history', 'aria-expanded': String(panel === 'history'), text: 'History' }),
      action(doc, 'Rename', 'rename'),
      ...(others.length ? [action(doc, 'Copy to…', 'copy')] : []),
      ...(may(w.role, 'track.delete') ? [action(doc, 'Delete', 'delete', 'btn-danger')] : []),
    ]);
    const name = el(doc, 'div', { class: 'library-track-head' }, [
      el(doc, 'h4', { class: 'library-track-name', text: t.name }),
      ...(onCanvas ? [el(doc, 'span', { class: 'library-badge', text: 'On the canvas' })] : []),
    ]);
    const meta = el(doc, 'p', { class: 'library-meta' }, ['Updated ', when(doc, t.updatedAt), ` by ${saverName(t.updatedBy)}`]);
    const li = el(doc, 'li', { class: 'library-track', tabIndex: -1, 'data-track-id': t.id, 'aria-current': onCanvas ? 'true' : undefined }, [name, meta, actions]);
    if (panel === 'history') li.append(historyPanel(t, w));
    if (panel === 'rename') li.append(renamePanel(t));
    if (panel === 'copy') li.append(copyPanel(t, others));
    return li;
  }

  /** @param {Track} t @param {Workspace} w */
  function historyPanel(t, w) {
    const history = histories.get(t.id);
    if (!history) return el(doc, 'div', { class: 'library-panel', 'data-panel': 'history' }, [el(doc, 'p', { class: 'empty', text: 'Loading the history…' })]);
    const items = history.versions.map((v) => el(doc, 'li', { class: 'library-version', 'data-key': v.key, 'aria-current': v.key === t.currentKey ? 'true' : undefined }, [
      el(doc, 'span', { class: 'library-version-when' }, [
        capitalized(when(doc, v.savedAt)),
        ...(v.key === t.currentKey ? [el(doc, 'span', { class: 'library-version-current', text: 'Current' })] : []),
      ]),
      el(doc, 'span', { class: 'library-meta', text: `by ${saverName(v.savedBy)}` }),
      el(doc, 'span', { class: 'library-version-actions' }, [
        el(doc, 'button', { type: 'button', class: 'btn btn-sm btn-outline', 'data-act': 'open-version', text: 'Open', 'aria-label': `Open the version saved ${relativeTime(v.savedAt)}` }),
        ...(may(w.role, 'track.delete')
          ? [el(doc, 'button', { type: 'button', class: 'btn btn-sm btn-danger', 'data-act': 'delete-version', text: 'Delete', 'aria-label': `Delete the version saved ${relativeTime(v.savedAt)}` })]
          : []),
      ]),
    ]));
    return el(doc, 'div', { class: 'library-panel', 'data-panel': 'history' }, [
      el(doc, 'ol', { class: 'library-versions', 'aria-label': `Versions of ${t.name}, newest first` }, items),
      el(doc, 'p', { class: 'library-note', text: `The ${history.kept} newest versions are kept; older ones drop off.` }),
    ]);
  }

  /** @param {Track} t */
  function renamePanel(t) {
    const id = `rename-${t.id}`;
    return el(doc, 'form', { class: 'library-panel library-form', 'data-form': 'rename', 'data-panel': 'rename' }, [
      el(doc, 'label', { for: id, text: 'New name' }),
      el(doc, 'div', { class: 'library-form-row' }, [
        el(doc, 'input', { type: 'text', id, name: 'name', value: t.name, maxLength: 100, required: true, autocomplete: 'off' }),
        el(doc, 'button', { type: 'submit', class: 'btn btn-sm btn-primary', text: 'Save name' }),
        action(doc, 'Cancel', 'close-panel'),
      ]),
    ]);
  }

  /** @param {Track} t @param {Workspace[]} targets */
  function copyPanel(t, targets) {
    const id = `copy-${t.id}`;
    return el(doc, 'form', { class: 'library-panel library-form', 'data-form': 'copy', 'data-panel': 'copy' }, [
      el(doc, 'label', { for: id, text: 'Copy to' }),
      el(doc, 'div', { class: 'library-form-row' }, [
        el(doc, 'select', { id, name: 'workspace' }, targets.map((o) => el(doc, 'option', { value: o.id, text: workspaceLabel(o, workspaces.indexOf(o)) }))),
        el(doc, 'button', { type: 'submit', class: 'btn btn-sm btn-primary', text: 'Copy' }),
        action(doc, 'Cancel', 'close-panel'),
      ]),
      el(doc, 'p', { class: 'library-note', text: 'The copy starts with the current version only.' }),
    ]);
  }

  /** @param {string} id @param {string | undefined} panel */
  async function togglePanel(id, panel) {
    if (!panel || panels.get(id) === panel) panels.delete(id);
    else panels.set(id, panel);
    render();
    const li = body.querySelector(`[data-track-id="${CSS.escape(id)}"]`);
    /** @type {HTMLElement | null | undefined} */ (li?.querySelector('input, select'))?.focus();
    if (panels.get(id) === 'history') await loadHistory(id);
  }

  /** @param {string} id */
  async function loadHistory(id) {
    try {
      histories.set(id, await api.versions(id));
      fail(null);
    } catch (error) {
      panels.delete(id);
      fail(/** @type {Error} */ (error).message);
    }
    render();
  }

  /** Puts `key` of `t` on the canvas. @param {Track} t @param {string} key @param {string} notice */
  async function open(t, key, notice) {
    try {
      const layout = await api.layout(key);
      host.adopt(layout);
      setCurrent({ id: t.id, name: t.name, workspaceId: t.workspaceId }, doc);
      dialog.close();
      host.report({ notice });
    } catch (error) {
      fail(/** @type {Error} */ (error).message);
    }
  }

  /** Runs a change, then reloads the list (and the open history). @param {() => Promise<any>} change */
  async function change(change) {
    let result;
    let message = null;
    try {
      result = await change();
    } catch (error) {
      message = /** @type {Error} */ (error).message;
    }
    histories.clear();
    await load();
    for (const [id, panel] of [...panels]) {
      if (panel !== 'history') continue;
      if (trackById(id)) await loadHistory(id);
      else panels.delete(id);
    }
    if (message) fail(message);
    return result;
  }

  body.addEventListener('click', async (event) => {
    const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('[data-act]'));
    const li = button?.closest('[data-track-id]');
    const t = li && trackById(/** @type {string} */ (li.getAttribute('data-track-id')));
    if (!button || !t) return;
    const act = button.dataset.act;
    // The first workspace is the personal one: nobody else sees its tracks.
    const personal = workspaces.findIndex((o) => o.id === t.workspaceId) === 0;
    if (act === 'open') return open(t, t.currentKey, `Opened ${t.name}.`);
    if (act === 'history' || act === 'rename' || act === 'copy') return togglePanel(t.id, act);
    if (act === 'close-panel') return togglePanel(t.id, undefined);
    if (act === 'delete') {
      const ok = await confirmAction(doc, {
        title: `Delete ${t.name}?`,
        text: personal
          ? 'The track and its whole history are deleted. Links you shared keep working. This cannot be undone.'
          : 'The track and its whole history are deleted for everyone in the club. Links you shared keep working. This cannot be undone.',
        confirm: 'Delete track',
      });
      if (!ok) return;
      const done = await change(() => api.remove(t.id).then(() => true));
      if (done && loadTrackRef(sessionStorage)?.id === t.id) forgetTrack(doc);
      return;
    }
    const v = /** @type {HTMLElement} */ (button.closest('[data-key]'))?.dataset.key;
    const version = v && histories.get(t.id)?.versions.find((x) => x.key === v);
    if (!version) return;
    if (act === 'open-version') return open(t, version.key, `Opened ${t.name} as saved ${relativeTime(version.savedAt)}.`);
    if (act === 'delete-version') {
      const last = histories.get(t.id)?.versions.length === 1;
      const ok = await confirmAction(doc, {
        title: last ? `Delete ${t.name}?` : 'Delete this version?',
        text: last
          ? 'This is its only version, so the track goes too. This cannot be undone.'
          : `The version saved ${relativeTime(version.savedAt)} is deleted${personal ? '' : ' for everyone in the club'}. This cannot be undone.`,
        confirm: last ? 'Delete track' : 'Delete version',
      });
      if (!ok) return;
      const done = await change(() => api.removeVersion(t.id, version.key).then(() => true));
      if (done && last && loadTrackRef(sessionStorage)?.id === t.id) forgetTrack(doc);
    }
  });

  body.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = /** @type {HTMLFormElement} */ (event.target);
    const li = form.closest('[data-track-id]');
    const t = li && trackById(/** @type {string} */ (li.getAttribute('data-track-id')));
    if (!t) return;
    const data = new FormData(form);
    if (form.dataset.form === 'rename') {
      const name = String(data.get('name') ?? '').trim();
      if (!name || name === t.name) return togglePanel(t.id, undefined);
      panels.delete(t.id);
      const result = await change(() => api.rename(t.id, name));
      if (result && loadTrackRef(sessionStorage)?.id === t.id) setCurrent({ id: t.id, name: result.track.name, workspaceId: t.workspaceId }, doc);
    }
    if (form.dataset.form === 'copy') {
      const target = String(data.get('workspace') ?? '');
      panels.delete(t.id);
      const result = await change(() => api.copy(t.id, target));
      const i = workspaces.findIndex((o) => o.id === target);
      if (result) host.report({ notice: `Copied ${t.name} to ${i === -1 ? 'the library' : workspaceLabel(workspaces[i], i)}.` });
    }
  });

  // tl-menu closes the account menu on this click; once the library closes,
  // focus goes back to the menu's summary, not to the hidden Library item,
  // or to Save if the account control has gone (signed out meanwhile).
  dialog.addEventListener('close', () => {
    const menu = /** @type {any} */ (doc.querySelector('#account tl-menu'));
    if (menu && (menu.checkVisibility?.() ?? menu.getClientRects().length > 0)) menu.close({ focus: true });
    else /** @type {HTMLElement | null} */ (doc.querySelector('#btn-save'))?.focus();
  });
  menuItem.addEventListener('click', () => {
    panels.clear();
    histories.clear();
    fail(null);
    body.replaceChildren(el(doc, 'p', { class: 'empty', text: 'Loading your library…' }));
    dialog.showModal();
    load();
  });

  return { save };
}
