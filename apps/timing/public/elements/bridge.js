// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// <tl-bridge> (spec step three §3): while it is on the page, it runs the
// page side of the USB bridge (spec §6.5), Web Serial or WebHID ↔ the server, on the
// #bridge markup the server rendered inside it. It shows one
// [data-bridge-state] section at a time, fills in the ready panel from the
// server's row templates, sends passings an earlier visit left behind, and
// guards leaving the page while a decoder is forwarding. Pairing posts to
// the JSON API, because the decoder's token must reach the board over serial.
// - Each start, on connect, makes a fresh run: the page's state, held in
//   one object. Every async path writes to the page only while its run is
//   current, so a move (a stop and a fresh start) shows Connect again.
// - On disconnect it stops: the port is closed, and the click, submit and
//   beforeunload listeners are removed. Work in flight (the picker, a
//   pairing request, a name lookup, earlier passings) finishes, unseen.
// - Without #bridge, or without Web Serial and WebHID, it does nothing,
//   and the server's "unsupported" notice stays.
// - A plain ZRound decoder or an EasyLap is chosen on the choose form on
//   every connect; the browser remembers only which decoder a device was,
//   and offers that one to confirm.
// The Bridge class itself (serial, outbox, retries) is ../bridge.js.
import { Bridge, sendOutbox } from '../bridge.js';
import { formatLap } from '../format.js';
import { EASYLAP_FILTER, hidTransport } from '../link/hid.js';
import { robitronicProtocol } from '../link/robitronic.js';
import { serialTransport } from '../link/serial.js';
import { zroundProtocol } from '../link/zround.js';
import { openDevices } from '../devices.js';
import { openOutbox } from '../outbox.js';

// No simulation code here: a simulator, when the server sets one, stands in for navigator.serial and
// navigator.hid before this module runs (decoders spec §5.4).
const has = { serial: 'serial' in navigator, hid: 'hid' in navigator };
const supported = has.serial || has.hid;
/** Opening a serial port resets an Arduino-based decoder: give it this long (decoders spec §2.4, C2). */
const SERIAL_OPEN_DELAY_MS = 1500;
const BROWSER_ASSIGNED = new Set(['zround', 'easylap']);
/** A decoder seen this recently, by the server's clock, is in use elsewhere (decoders spec §3.2, I7). */
const IN_USE_MS = 2 * 60_000;
/** What a decoder without its own pairing is, in the choose form (decoders spec §4.2). */
const KIND_TEXT = {
  zround: (where) => `This decoder speaks plain ZRound, so it can't keep a pairing. This browser remembers which decoder it is for ${where}.`,
  easylap: (where) => `An EasyLap can't keep a pairing. This browser remembers which decoder it is for ${where}.`,
};

/** The decoder-list GET gives up after this long, as a failed one (F3). */
const LIST_TIMEOUT_MS = 3000;

let warned = false;
/**
 * The remembered choices only suggest, so a failing store never blocks a connect or a choice:
 * its failure gives `fallback`, logged once per page. @template T @param {Promise<T>} call @param {T} [fallback]
 */
const quietly = (call, fallback = null) => call.catch((caught) => {
  if (!warned) {
    warned = true;
    console.warn('The remembered decoders are unavailable in this browser.', caught);
  }
  return fallback;
});

/** A same-origin JSON call; errors carry the server's status and detail. */
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.detail ?? data?.error ?? `Timing answered ${res.status}. Try again in a minute.`), { status: res.status });
  return data;
}

/**
 * The club's decoders and the server's time from the answer's Date header, or null when they can't be
 * fetched in time (decoders spec §2.4, R6, F3). serverNow is null without a readable Date header: then
 * nothing is marked in use.
 * @param {HTMLElement} root
 */
async function decoderList(root) {
  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(root.dataset.workspace ?? '')}/decoders`, {
      credentials: 'same-origin', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const { decoders } = await res.json();
    const date = Date.parse(res.headers.get('date') ?? '');
    return { decoders, serverNow: Number.isNaN(date) ? null : date };
  } catch {
    return null;
  }
}

const post = (decoderId, batch) => api('POST', `/decoders/${encodeURIComponent(decoderId)}/passings`, batch);

/** "1 passing", "2 passings from earlier": the subject of a sentence about `n` passings. @param {number} n @param {string} [from] */
const passings = (n, from = '') => `${n} ${n === 1 ? 'passing' : 'passings'}${from}`;
/** Says that `n` passings were refused for good and left the outbox. @param {number} n @param {string} message @param {string} [from] */
const refusedText = (n, message, from = '') => `${passings(n, from)} ${n === 1 ? 'was' : 'were'} refused and ${n === 1 ? 'is' : 'are'} no longer waiting to send: ${message}`;

/** A 401: signed out, so the passings wait for a new sign-in. */
const needsSignIn = (error) => error?.status === 401;
/** Says that `n` passings wait for a club this sign-in has no access to (a 403). Signing in again doesn't help. @param {number} n */
const blockedText = (n) => `${passings(n)} ${n === 1 ? 'is' : 'are'} for a decoder in a club you don't have access to, so ${n === 1 ? 'it waits' : 'they wait'} here.`;

const STATE_TEXT = {
  connect: 'Ready to connect.',
  connecting: 'Talking to the decoder.',
  listening: 'Connected. Nothing from the device yet.',
  unpaired: 'The decoder is not paired yet.',
  choose: 'Choose which decoder this is.',
  disconnected: 'Decoder disconnected.',
};

/**
 * Holds a Web Lock on an HID device for the life of a bridge: WebHID, unlike Web Serial, lets a second tab
 * open a device, so the lock keeps two tabs from forwarding one EasyLap. Resolves with the function that
 * lets go, whose promise settles once the lock is free, or null when another tab holds it. Without Web
 * Locks it connects as before.
 * @param {string} device
 * @returns {Promise<(() => Promise<unknown>) | null>}
 */
function holdDevice(device) {
  const locks = /** @type {any} */ (navigator).locks;
  const free = () => Promise.resolve();
  if (!locks) return Promise.resolve(free);
  return new Promise((resolve) => {
    const released = locks.request(`tinylap-bridge:${device}`, { ifAvailable: true }, (lock) => {
      if (!lock) return resolve(null);
      return new Promise((letGo) => resolve(() => {
        letGo(undefined);
        return released;
      }));
    }).catch(() => resolve(free));
  });
}

/** The picker for `which`; closing it is a choice, not an error. @param {'serial' | 'hid'} which */
async function pick(which) {
  try {
    if (which === 'serial') return serialTransport(await /** @type {any} */ (navigator).serial.requestPort());
    const [device] = await /** @type {any} */ (navigator).hid.requestDevice({ filters: [EASYLAP_FILTER] });
    return device ? hidTransport(device) : null;
  } catch (caught) {
    if (/** @type {any} */ (caught)?.name === 'NotFoundError') return null;
    throw caught;
  }
}

/**
 * One start's state. `names` maps a decoder id to the name it was paired
 * with; `made` is a decoder the server made but the cable didn't get yet:
 * its token is shown once, so a retry reuses it. It is bound to the device,
 * which is its USB chip: its vendor and product ids. Web Serial exposes no
 * serial number, so two decoders of the same model count as one device, and
 * the protection works only between different models. Re-plugging the same
 * decoder reuses it, which is the intended trade-off; a future decoder
 * firmware could report a chip id to tell decoders of one model apart.
 * `transport` is the last one picked, for "Connect again". `list` is this connect's decoder list (null
 * when it couldn't be fetched), `remembered` the decoder this browser remembers for the device, and
 * `devices` the store it came from. `connecting` is true from a click until its bridge exists.
 * @typedef {{ root: HTMLElement, workspaceId: string, bridge: Bridge | null, preview: any[], names: Map<string, string>, asked: Set<string>, made: any,
 *   transport: 'serial' | 'hid' | null, list: { decoders: { id: string, name: string, lastSeenAt: number | null }[], serverNow: number | null } | null,
 *   remembered: string | null, devices: any, connecting: boolean }} Run
 */

class TlBridge extends HTMLElement {
  /** @type {Run | null} */ run = null;

  connectedCallback() { this.start(); }

  disconnectedCallback() { this.stop(); }

  start() {
    if (this.run) return;
    const root = /** @type {HTMLElement | null} */ (this.querySelector('#bridge'));
    if (!root || !supported) return;
    const run = { root, workspaceId: root.dataset.workspace ?? '', bridge: null, preview: [], names: new Map(), asked: new Set(), made: null, transport: null, list: null, remembered: null, devices: null, connecting: false };
    this.run = run;
    this.reset(run);
    for (const which of /** @type {const} */ (['serial', 'hid'])) {
      const missing = !has[which];
      this.$(run, `[data-bridge-connect="${which}"]`).hidden = missing;
      this.$(run, `[data-bridge-missing="${which}"]`).hidden = !missing;
    }
    this.show(run, 'connect');
    this.addEventListener('click', this);
    this.addEventListener('submit', this);
    addEventListener('beforeunload', this);
    void this.sendEarlier(run).catch(() => {});
  }

  stop() {
    const run = this.run;
    this.run = null;
    if (!run) return;
    this.removeEventListener('click', this);
    this.removeEventListener('submit', this);
    removeEventListener('beforeunload', this);
    const bridge = run.bridge;
    run.bridge = null;
    void bridge?.close();
  }

  /** Puts back what an earlier run wrote, as the server rendered it; a first start changes nothing. @param {Run} run */
  reset(run) {
    const error = this.$(run, '[data-bridge-error]');
    error.hidden = true;
    error.textContent = '';
    this.$(run, '[data-bridge-earlier]').hidden = true;
    this.$(run, '[data-bridge-live]').textContent = '';
    const form = /** @type {HTMLFormElement} */ (this.$(run, '[data-bridge-pair]'));
    /** @type {HTMLInputElement} */ (form.elements.namedItem('name')).readOnly = false;
    /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]')).disabled = false;
    for (const which of ['serial', 'hid']) {
      this.$(run, `[data-bridge-connect="${which}"]`).hidden = false;
      this.$(run, `[data-bridge-missing="${which}"]`).hidden = true;
    }
    this.$(run, '[data-bridge-taken]').hidden = true;
    this.$(run, '[data-bridge-listening]').hidden = false;
    this.$(run, '[data-bridge-unreadable]').hidden = true;
    this.$(run, '[data-bridge-gap]').hidden = true;
    this.resetChoose(run);
  }

  /** Puts the choose form back as the server rendered it (R6). Removed options stay removed: their decoder is gone. @param {Run} run */
  resetChoose(run) {
    const form = /** @type {HTMLFormElement} */ (this.$(run, '[data-bridge-choose]'));
    this.$(run, '[data-bridge-choose-heading]').textContent = 'Which decoder is this?';
    const select = /** @type {HTMLSelectElement} */ (form.elements.namedItem('decoder'));
    for (const option of select.options) {
      option.disabled = false;
      if (option.value) option.textContent = option.dataset.name ?? option.textContent;
    }
    select.value = '';
    /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]')).disabled = false;
  }

  /** @param {Event} event */
  handleEvent(event) {
    if (event.type === 'beforeunload') {
      if (this.run?.bridge?.state === 'ready') event.preventDefault();
      return;
    }
    const run = this.run;
    if (!run) return;
    if (event.type === 'click') {
      const button = event.target instanceof Element ? event.target.closest('[data-bridge-connect]') : null;
      if (button && this.contains(button)) {
        this.connect(run, /** @type {any} */ (button).dataset.bridgeConnect || 'serial').then(() => { if (run === this.run) this.ok(run); }, (caught) => { if (run === this.run) this.fail(run, caught); });
      }
    } else if (event.type === 'submit') {
      const form = event.target;
      if (form instanceof HTMLFormElement && form.matches('[data-bridge-pair]') && this.contains(form)) {
        event.preventDefault();
        void this.pair(run, form);
      } else if (form instanceof HTMLFormElement && form.matches('[data-bridge-choose]') && this.contains(form)) {
        event.preventDefault();
        void this.choose(run, form);
      }
    }
  }

  /** @param {Run} run */
  $(run, selector) { return run.root.querySelector(selector); }

  /** Tells screen readers, once per change. @param {Run} run */
  announce(run, text) {
    const live = this.$(run, '[data-bridge-live]');
    if (live.textContent !== text) live.textContent = text;
  }

  /** "Sign in again to send them.", with its link, from the server's template. @param {Run} run @returns {Node} */
  signIn(run) {
    return /** @type {HTMLTemplateElement} */ (this.$(run, 'template[data-bridge-sign-in]')).content.cloneNode(true);
  }

  /** Sentences, a space between them. @param {(string | Node)[]} parts */
  spaced(parts) {
    return parts.flatMap((part, i) => (i > 0 ? [' ', part] : [part]));
  }

  /** @param {(string | Node)[]} parts */
  textOf(parts) {
    const holder = document.createElement('p');
    holder.replaceChildren(...this.spaced(parts.map((x) => (typeof x === 'string' ? x : x.cloneNode(true)))));
    return holder.textContent;
  }

  /** @param {Run} run */
  nameOf(run, id) { return run.names.get(id) ?? `decoder ${String(id).slice(0, 8)}`; }

  /** @param {Run} run */
  fail(run, caught) {
    const error = this.$(run, '[data-bridge-error]');
    error.textContent = caught.message;
    error.hidden = false;
  }

  /** @param {Run} run */
  ok(run) { this.$(run, '[data-bridge-error]').hidden = true; }

  /** @param {Run} run */
  show(run, state) {
    for (const section of /** @type {NodeListOf<HTMLElement>} */ (run.root.querySelectorAll('[data-bridge-state]'))) section.hidden = section.dataset.bridgeState !== state;
    if (state === 'disconnected') this.$(run, '[data-bridge-gap]').hidden = !BROWSER_ASSIGNED.has(run.bridge?.kind);
    if (state === 'ready') this.update(run);
    else this.announce(run, STATE_TEXT[state] ?? '');
    // After the state's own text, so unreadable data is what screen readers hear.
    if (state === 'listening') this.unreadable(run);
  }

  /** In listening: say so, and announce it, when data comes but fails its checksum (R8, spec §4.2). @param {Run} run */
  unreadable(run) {
    const bad = (run.bridge?.mismatches ?? 0) > 0;
    this.$(run, '[data-bridge-listening]').hidden = bad;
    const unreadable = this.$(run, '[data-bridge-unreadable]');
    unreadable.hidden = !bad;
    if (bad) this.announce(run, unreadable.textContent);
  }

  /** @param {Run} run */
  update(run) {
    const bridge = run.bridge;
    if (!bridge || bridge.state !== 'ready') return;
    this.$(run, '[data-bridge-status-box]').classList.toggle('is-offline', !bridge.online);
    const statusLine = this.$(run, '[data-bridge-status]');
    if (!bridge.online && needsSignIn(bridge.lastError)) {
      const parts = ['Passings wait here.', "You're signed out.", this.signIn(run)];
      // Rebuilt only when it changes, so a focused link stays put as passings come in.
      if (statusLine.textContent !== this.textOf(parts)) statusLine.replaceChildren(...this.spaced(parts));
    } else {
      statusLine.textContent = bridge.online ? `Forwarding from ${this.nameOf(run, bridge.decoder)}` : `Offline: passings wait here. ${bridge.lastError?.message ?? ''}`.trim();
    }
    this.announce(run, statusLine.textContent);
    if (!run.names.has(bridge.decoder) && !run.asked.has(bridge.decoder)) void this.learnName(run, bridge.decoder);
    const refused = this.$(run, '[data-bridge-refused]');
    const told = bridge.online ? [bridge.lastError ? refusedText(bridge.dropped, bridge.lastError.message) : '', bridge.blocked ? blockedText(bridge.blocked) : ''].filter(Boolean).join(' ') : '';
    refused.hidden = told === '';
    // Rewritten only when it changes, so the alert isn't announced again with every passing.
    if (refused.textContent !== told) refused.textContent = told;
    void bridge.outbox.count().then((n) => { if (run === this.run) this.$(run, '[data-bridge-outbox]').textContent = String(n); });
    const list = this.$(run, '[data-bridge-preview]');
    const row = (kind) => /** @type {HTMLTemplateElement} */ (this.$(run, `template[data-bridge-row="${kind}"]`)).content.firstElementChild;
    list.replaceChildren(...run.preview.map((p) => {
      const first = p.lapMs === null || p.lapMs === undefined;
      const li = /** @type {HTMLElement} */ (row(first ? 'first' : 'lap').cloneNode(true));
      li.querySelector('.bridge-code').textContent = p.transponder;
      if (!first) li.querySelector('.num').textContent = formatLap(p.lapMs);
      return li;
    }));
    this.$(run, '[data-bridge-preview-empty]').hidden = run.preview.length > 0;
  }

  /** A decoder paired in an earlier visit: look its name up once; the short id stands in until then. @param {Run} run */
  async learnName(run, id) {
    run.asked.add(id);
    try {
      const { decoders } = await api('GET', `/workspaces/${encodeURIComponent(run.workspaceId)}/decoders`);
      const found = decoders.find((d) => d.id === id);
      if (found) {
        run.names.set(id, found.name);
        if (run === this.run) this.update(run);
      }
    } catch {
      // The short id stays.
    }
  }

  /** @param {Run} run @param {'serial' | 'hid' | 'last'} which */
  async connect(run, which) {
    // One connect at a time until its bridge exists: a second click would put a second bridge on the picked port.
    if (run.connecting) return;
    run.connecting = true;
    const next = await this.prepare(run, which).finally(() => { run.connecting = false; });
    if (!next) return;
    try {
      await next.start();
      if (run !== this.run) await next.close();
    } catch (caught) {
      await next.close();
      if (run.bridge === next) run.bridge = null;
      if (run === this.run) this.show(run, 'connect');
      throw caught;
    }
  }

  /** Picks the device and makes its bridge, or null when the picker was closed or the run ended. @param {Run} run @param {'serial' | 'hid' | 'last'} which */
  async prepare(run, which) {
    const chosen = which === 'last' ? run.transport ?? 'serial' : which;
    const transport = await pick(chosen);
    if (run !== this.run) return null;
    if (!transport) return null;
    run.transport = chosen;
    if (run.made && run.made.device !== transport.device) this.forget(run);
    this.$(run, '[data-bridge-taken]').hidden = true;
    await run.bridge?.close();
    // From here the replaced bridge's late events find no bridge, and leaving the page isn't guarded.
    run.bridge = null;
    if (run !== this.run) return null;
    // Before the device is opened: an EasyLap another tab forwards is left alone.
    const release = chosen === 'hid' ? await holdDevice(transport.device) : () => Promise.resolve();
    if (!release) {
      if (run === this.run) {
        this.show(run, 'connect');
        const taken = this.$(run, '[data-bridge-taken]');
        taken.hidden = false;
        this.announce(run, taken.textContent);
      }
      return null;
    }
    if (run !== this.run) {
      void release();
      return null;
    }
    // From the pick on, the page says it is connecting, while the stores and the decoder list load.
    this.show(run, 'connecting');
    const [outbox, devices, list] = await Promise.all([openOutbox(), openDevices(), decoderList(run.root)]);
    if (run !== this.run) {
      void release();
      return null;
    }
    const remembered = await quietly(devices.recall(run.workspaceId, transport.device));
    if (run !== this.run) {
      void release();
      return null;
    }
    Object.assign(run, { devices, list, remembered });
    // In parallel with the start; the choose form waits for it.
    const refreshed = this.refreshChoose(run);
    const protocol = chosen === 'hid' ? robitronicProtocol() : zroundProtocol();
    // The lock goes with the device: when the bridge closes it, or it is unplugged.
    const held = { ...transport, close: () => transport.close().finally(release) };
    const next = new Bridge({ link: { transport: held, protocol }, outbox, post, openDelayMs: chosen === 'hid' ? 0 : SERIAL_OPEN_DELAY_MS });
    next.addEventListener('state', () => {
      if (next.state === 'disconnected') void release();
      if (run.bridge !== next) return;
      const state = next.state === 'idle' ? 'connecting' : next.state;
      if (state !== 'choose') {
        this.show(run, state);
        return;
      }
      void refreshed.then(() => {
        if (run.bridge !== next || next.state !== 'choose') return;
        this.fillChoose(run);
        this.show(run, 'choose');
        // The Connect button that had focus is hidden now: focus goes to the form's confirm, or its heading.
        /** @type {HTMLElement} */ (this.$(run, this.$(run, '#bridge-choose').value ? '[data-bridge-choose] button[type="submit"]' : '[data-bridge-choose-heading]')).focus();
      });
    });
    next.addEventListener('identity-changed', () => {
      if (run.bridge === next) void quietly(run.devices.forget(run.workspaceId, next.device));
    });
    next.addEventListener('noise', () => {
      if (run.bridge === next && next.state === 'listening') this.unreadable(run);
    });
    for (const type of ['outbox', 'online']) next.addEventListener(type, () => { if (run.bridge === next) this.update(run); });
    next.addEventListener('passing', (event) => {
      run.preview.unshift(/** @type {CustomEvent} */ (event).detail);
      run.preview.length = Math.min(run.preview.length, 20);
      if (run.bridge === next) this.update(run);
    });
    run.bridge = next;
    return next;
  }

  /**
   * Passings an earlier tab left behind (a reload, a crash) go now, without waiting for the cable.
   * The outbox is this browser's, so the note counts what waits for any club or personal space.
   * @param {Run} run
   */
  async sendEarlier(run) {
    const note = this.$(run, '[data-bridge-earlier]');
    const outbox = await openOutbox();
    /** @param {number} count @param {(string | Node)[]} more */
    const say = (count, ...more) => {
      if (run !== this.run) return;
      const waiting = count > 0 ? [`${passings(count, ' from earlier')} ${count === 1 ? 'is' : 'are'} waiting in this browser, from any club or personal space.`] : [];
      note.replaceChildren(...this.spaced([...waiting, ...more]));
      note.hidden = note.textContent === '';
      if (!note.hidden) this.announce(run, note.textContent);
    };
    let count = await outbox.count();
    if (count === 0) return;
    say(count, 'Sending them now…');
    // A failure after a drop carries the drop with it (sendOutbox), so the note tells both.
    const { failure, refusal, dropped, blocked } = await sendOutbox(outbox, post, async () => say(await outbox.count(), 'Sending them now…'))
      .then((sent) => ({ failure: null, ...sent }), (caught) => ({ failure: caught, refusal: caught?.refusal ?? null, dropped: caught?.dropped ?? 0, blocked: caught?.blocked ?? 0 }));
    count = await outbox.count();
    /** @type {(string | Node)[]} */
    const more = [];
    if (failure && count) more.push(...(needsSignIn(failure) ? ["You're signed out.", this.signIn(run)] : [`They couldn't be sent: ${failure.message}`]));
    if (blocked) more.push(blockedText(blocked));
    if (dropped) more.push(refusedText(dropped, refusal.message, ' from earlier'));
    say(count, ...more);
  }

  /**
   * A decoder made since this page loaded has no option in the choose form: then the form's select is
   * taken from a fresh copy of this page, as the server renders it. Without one in time, the options stay.
   * The select's data-known names every decoder the server knew when it rendered, choosable or not, so a
   * decoder on Wi-Fi, which has no option, doesn't count as new.
   * @param {Run} run
   */
  async refreshChoose(run) {
    const select = /** @type {HTMLSelectElement} */ (this.$(run, '#bridge-choose'));
    const known = new Set((select.dataset.known ?? '').split(' ').filter(Boolean));
    if (!run.list || run.list.decoders.every((d) => known.has(d.id))) return;
    try {
      const res = await fetch(location.pathname, { credentials: 'same-origin', headers: { accept: 'text/html' }, signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
      if (!res.ok) return;
      const fresh = new DOMParser().parseFromString(await res.text(), 'text/html').getElementById('bridge-choose');
      if (run !== this.run || !(fresh instanceof HTMLSelectElement)) return;
      select.replaceWith(fresh);
    } catch {
      // The options stay as they are.
    }
  }

  /** Fills the choose form for this connect (decoders spec §3.2). @param {Run} run */
  fillChoose(run) {
    // A second connect in the same run starts from the server's form, not the last connect's marks.
    this.resetChoose(run);
    const form = /** @type {HTMLFormElement} */ (this.$(run, '[data-bridge-choose]'));
    const select = /** @type {HTMLSelectElement} */ (form.elements.namedItem('decoder'));
    const kind = this.$(run, '[data-bridge-kind]');
    kind.textContent = KIND_TEXT[run.bridge.kind](kind.dataset.where ?? 'this club');
    const { list } = run;
    if (list) {
      for (const option of [...select.options]) {
        if (!option.value) continue;
        const found = list.decoders.find((d) => d.id === option.value);
        if (!found) {
          option.remove();
          continue;
        }
        const inUse = list.serverNow !== null && found.lastSeenAt !== null && list.serverNow - found.lastSeenAt < IN_USE_MS;
        option.textContent = inUse ? `${option.dataset.name} (in use)` : option.dataset.name;
        option.disabled = inUse && option.value !== run.remembered;
      }
    }
    const known = Boolean(run.remembered) && [...select.options].some((o) => o.value === run.remembered);
    // Forgotten only when the server no longer has it: one made after this page loaded has no option yet, but stays remembered.
    if (run.remembered && list && !list.decoders.some((d) => d.id === run.remembered)) void quietly(run.devices.forget(run.workspaceId, run.bridge.device));
    select.value = known ? run.remembered : '';
    this.$(run, '[data-bridge-choose-heading]').textContent = known ? `Is this ${select.selectedOptions[0].dataset.name}?` : 'Which decoder is this?';
  }

  /** "Use this decoder": an existing decoder, or a new one made on the server, then remembered and assigned. @param {Run} run @param {HTMLFormElement} form */
  async choose(run, form) {
    const bridge = run.bridge;
    if (!bridge) return;
    const select = /** @type {HTMLSelectElement} */ (form.elements.namedItem('decoder'));
    const name = String(/** @type {HTMLInputElement} */ (form.elements.namedItem('name')).value).trim();
    const submit = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
    if (submit.disabled) return;
    if (!select.value && !name) {
      this.fail(run, new Error('A decoder name is 1 to 60 characters.'));
      return;
    }
    submit.disabled = true;
    try {
      let id = select.value;
      if (id) {
        // fillChoose removed what the connect's list no longer has; one removed since 404s, and its passings are dropped.
        run.names.set(id, select.selectedOptions[0].dataset.name ?? id);
      } else {
        const made = await api('POST', `/workspaces/${encodeURIComponent(run.workspaceId)}/decoders`, { name });
        if (run !== this.run) return;
        id = made.id;
        run.names.set(id, made.name);
      }
      // A late %TLID can make it a TinyLap decoder meanwhile: that one says who it is, so nothing is remembered.
      if (run.bridge !== bridge || !BROWSER_ASSIGNED.has(bridge.kind)) return;
      await quietly(run.devices.remember(run.workspaceId, bridge.device, id));
      if (run !== this.run || run.bridge !== bridge) return;
      await bridge.assign(id);
      if (run === this.run) this.ok(run);
    } catch (caught) {
      if (run === this.run) this.fail(run, caught);
    } finally {
      // After a move the new run shares this button; its reset enabled it.
      if (run === this.run) submit.disabled = false;
    }
  }

  /** Forgets the decoder made for another device; it stays on the server, unpaired. @param {Run} run */
  forget(run) {
    run.made = null;
    /** @type {HTMLInputElement} */ (/** @type {HTMLFormElement} */ (this.$(run, '[data-bridge-pair]')).elements.namedItem('name')).readOnly = false;
  }

  /** @param {Run} run @param {HTMLFormElement} pairForm */
  async pair(run, pairForm) {
    const nameField = /** @type {HTMLInputElement} */ (pairForm.elements.namedItem('name'));
    const submit = /** @type {HTMLButtonElement} */ (pairForm.querySelector('button[type="submit"]'));
    const form = new FormData(pairForm);
    const name = String(form.get('name') ?? '').trim();
    if (!run.made && !name) return this.fail(run, new Error('A decoder name is 1 to 60 characters.'));
    submit.disabled = true;
    // While a connect replaces the bridge there is none: the pairing fails as for an unplugged decoder.
    const current = () => {
      if (!run.bridge) throw new Error('The decoder is disconnected. Connect it again.');
      return run.bridge;
    };
    try {
      if (!run.made) {
        const made = await api('POST', `/workspaces/${encodeURIComponent(run.workspaceId)}/decoders`, { name });
        if (run !== this.run) return;
        run.made = { ...made, device: current().device };
        run.names.set(run.made.id, run.made.name);
        nameField.readOnly = true;
      }
      const ssid = String(form.get('ssid') ?? '').trim();
      await current().pair(run.made.id, run.made.token, ssid ? { ssid, password: String(form.get('password') ?? '') } : null);
      run.made = null;
      nameField.readOnly = false;
      if (run === this.run) this.ok(run);
    } catch (caught) {
      if (run === this.run) this.fail(run, run.made ? new Error(`${caught.message} The decoder "${run.made.name ?? name}" is created; press Pair again to send it to the device. The name stays as it is.`) : caught);
    } finally {
      // After a move the new run shares this button; its reset enabled it, and its own pairing may hold it.
      if (run === this.run) submit.disabled = false;
    }
  }
}

if (!customElements.get('tl-bridge')) customElements.define('tl-bridge', TlBridge);
