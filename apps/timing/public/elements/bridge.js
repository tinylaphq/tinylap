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
// - Without #bridge it does nothing. Without Web Serial and WebHID it only keeps
//   the cards live (the cards stream); the server's "unsupported" notice stays.
// - A plain ZRound decoder or an EasyLap is chosen on the choose form on
//   every connect; the browser remembers only which decoder a device was,
//   and offers that one to confirm.
// - The decoder cards (connections spec §2, §3): the server renders what it
//   knows; this overlays the decoder on this tab's cable (Connected, and its
//   own Wi-Fi from %TLNET), and writes times in the browser's time zone.
//   Change Wi-Fi opens ./wifi-dialog.js.
// - One stream at a time (cable presence spec §2): while a decoder on this
//   tab's cable is ready, the page holds its cable stream (#bridge's
//   data-cable-stream), and the server counts it on a cable for exactly as
//   long as it is open; otherwise the cards stream (data-cards-stream), which
//   holds nothing. Each message is the server's #bridge-decoders, swapped in,
//   with the cable painted over it again. The port closing, the bridge being
//   replaced, the page going and the element leaving all close the stream.
// - The cable has one place, its card (connections spec §2): after an
//   unplug the card shows the server's notes for a decoder this tab had, and
//   when the serial port this tab last had comes back (navigator.serial's
//   connect event), it is opened again without the picker. That card's
//   Connect decoder tries the same port first, and the picker after.
// The Bridge class itself (serial, outbox, retries) is ../bridge.js.
import { signalWord, wifiError } from '@tinylap/timing';
import { Bridge, ServerUnconfirmedError, WifiRefusedError, WifiUnconfirmedError, sendOutbox } from '../bridge.js';
import { formatLap, formatWhen } from '../format.js';
import { EASYLAP_FILTER, hidTransport } from '../link/hid.js';
import { robitronicProtocol } from '../link/robitronic.js';
import { serialTransport } from '../link/serial.js';
import { zroundProtocol } from '../link/zround.js';
import { openDevices } from '../devices.js';
import { openOutbox } from '../outbox.js';
import { WifiWizard } from './wifi-dialog.js';

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
/** A stream the server refused (a 503 while it restarts, a sign-in redirect) is opened again after this long, doubling up to the cap. */
const STREAM_RETRY_MS = 1000;
const STREAM_RETRY_MAX_MS = 30_000;

const quoted = (name) => `“${name}”`;
/**
 * The Wi-Fi row of the decoder on this tab's cable, from its %TLNET (connections spec §2.1), or null before one came.
 * @param {Bridge['net']} net @param {boolean} mayChange @param {boolean} [silent] it didn't answer %TLNET& (firmware without it)
 * @returns {{ state: string, signal?: string, words: string, detail: string }}
 */
function netRow(net, mayChange, silent = false) {
  if (!net && silent) return { state: 'unknown', words: '', detail: "This decoder doesn't report its Wi-Fi." };
  if (!net) return { state: 'unknown', words: '', detail: 'Asking the decoder about its Wi-Fi…' };
  const name = quoted(net.name);
  if (net.state === 'off') return { state: 'off', words: 'Not set up', detail: 'With Wi-Fi, laps get through even with the cable out.' };
  if (net.state === 'joining') return { state: 'busy', words: `Joining ${name}…`, detail: '' };
  if (net.state === 'connected') {
    const word = signalWord(net.signal);
    return { state: 'ok', signal: word, words: `Connected to ${name}`, detail: `Signal ${word}.` };
  }
  if (net.cause === 'password') return { state: 'fail', words: `${name} refused the password`, detail: mayChange ? 'Enter it again under Change Wi-Fi.' : '' };
  if (net.cause === 'notfound') return { state: 'fail', words: `Can't find ${name} from here`, detail: 'It may be out of reach of the decoder, or switched off.' };
  return { state: 'fail', words: `Can't join ${name}`, detail: '' };
}

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
  if (!res.ok) throw Object.assign(new Error(data?.detail ?? data?.error ?? 'Timing is not answering right now. Try again in a minute.'), { status: res.status });
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

/** A serial port's USB chip, or null without USB ids (such a port is only ever itself). @param {any} port */
const chipOf = (port) => {
  const { usbVendorId, usbProductId } = port.getInfo?.() ?? {};
  return usbVendorId === undefined || usbProductId === undefined ? null : serialTransport(port).device;
};

/** Whether `port` may be the serial port this tab last had: the same object, or the same USB chip. @param {any} port @param {{ port: any, device: string } | null} last */
const isLast = (port, last) => Boolean(last) && (port === last?.port || (chipOf(port) !== null && chipOf(port) === last?.device));

/** Whether two serial ports are one device: the same object, or the same USB chip (never two ports without USB ids). @param {any} a @param {any} b */
const sameDevice = (a, b) => a === b || (chipOf(a) !== null && chipOf(a) === chipOf(b));

/** The serial ports this page may open without the picker; none without Web Serial. @returns {Promise<any[]>} */
const permittedPorts = async () => {
  const serial = /** @type {any} */ (navigator).serial;
  return typeof serial?.getPorts === 'function' ? serial.getPorts().catch(() => []) : [];
};

/**
 * The port this page may open without the picker that is the one it last had: the same SerialPort when it is
 * still listed, else the one port with the same USB chip, leaving out `before` (ports that were there already,
 * so another decoder's); null when there is none, or more than one. With no `last` (after a reload) and `lone`
 * (the member clicked), the one permitted port with USB ids.
 * @param {{ port: any, device: string } | null} last @param {any[]} [before] @param {boolean} [lone]
 */
async function permittedPort(last, before = [], lone = false) {
  if (!last && !lone) return null;
  const ports = await permittedPorts();
  if (!last) return ports.length === 1 && chipOf(ports[0]) !== null ? ports[0] : null;
  if (ports.includes(last.port)) return last.port;
  const same = ports.filter((port) => !before.includes(port) && isLast(port, last));
  return same.length === 1 ? same[0] : null;
}

/** The USB chips whose port came back without the picker once in this browser: Chrome keeps the permission only for some. */
const RECONNECTS_KEY = 'tinylap-bridge-reconnects';
const reconnects = {
  /** @returns {string[]} */
  all() {
    try {
      const list = JSON.parse(localStorage.getItem(RECONNECTS_KEY) ?? '[]');
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  },
  /** @param {string} device */
  has(device) { return this.all().includes(device); },
  /** @param {string} device */
  add(device) {
    if (this.has(device)) return;
    try {
      localStorage.setItem(RECONNECTS_KEY, JSON.stringify([...this.all(), device]));
    } catch {
      // No storage: the card says to connect it again, as before.
    }
  },
};

const STATE_TEXT = {
  connect: 'Ready to connect.',
  connecting: 'Talking to the decoder.',
  listening: 'Connected. Nothing from the device yet.',
  unpaired: 'The decoder is not paired yet.',
  choose: 'Choose which decoder this is.',
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
 *   remembered: string | null, devices: any, connecting: boolean, wizard: WifiWizard | null, silent: Bridge | null,
 *   stream: { url: string, source: EventSource, retry?: ReturnType<typeof setTimeout> } | null, retryMs: number,
 *   last: { port: any, device: string, decoder: string | null, refused?: boolean } | null,
 *   gone: { decoder: string, kind: string, serial: boolean, back: boolean, before: any[], port: any } | null,
 *   onPort: ((event: Event) => void) | null, autoFocus?: { id: string | null, which: string | null } | null }} Run
 * `last` is the serial port this tab last had (and its decoder once known; `refused` once it wouldn't open, so the
 * button goes to the picker); `gone` the decoder this tab had when its cable was pulled, until a decoder is on the
 * cable again: `back` when its chip has reconnected without the picker before, `before` the ports there already.
 * `stream` is the one stream the page holds (cable presence spec §2), with the timer that opens it again after the
 * server refused it; `retryMs` that timer's next wait.
 */

class TlBridge extends HTMLElement {
  /** @type {Run | null} */ run = null;
  /** The cards as the server rendered them, by decoder id: what a card goes back to when the cable leaves. @type {Map<string, Node>} */
  served = new Map();

  connectedCallback() { this.start(); }

  disconnectedCallback() { this.stop(); }

  start() {
    if (this.run) return;
    const root = /** @type {HTMLElement | null} */ (this.querySelector('#bridge'));
    if (!root) return;
    const run = { root, workspaceId: root.dataset.workspace ?? '', bridge: null, preview: [], names: new Map(), asked: new Set(), made: null, transport: null, list: null, remembered: null, devices: null, connecting: false,
      wizard: null, silent: null, last: null, gone: null, onPort: null, stream: null, retryMs: STREAM_RETRY_MS };
    this.run = run;
    // Without Web Serial or WebHID only the live cards are on: no cable, no connect flow, the server's notice stays.
    if (!supported) {
      this.keep(run);
      addEventListener('pagehide', this);
      addEventListener('pageshow', this);
      this.follow(run);
      return;
    }
    this.reset(run);
    const dialog = this.$(run, '#wifi-dialog');
    if (dialog instanceof HTMLDialogElement) {
      run.wizard = new WifiWizard(dialog, {
        bridge: () => (run === this.run ? run.bridge : null),
        announce: (text) => { if (run === this.run) this.announce(run, text); },
        refocus: (id) => { if (run === this.run) this.refocus(run, { id, which: '[data-bridge-wifi]' }); },
        problem: (ssid, password) => this.wifiProblem(ssid, password),
      });
    }
    // A card painted by an earlier start isn't the server's: after a move this element still has the server's copy;
    // a clone (which has none) gets one from the stream's first message.
    if (!this.$(run, '#bridge-decoders [data-cabled]')) this.keep(run);
    this.paint(run);
    for (const which of /** @type {const} */ (['serial', 'hid'])) {
      const missing = !has[which];
      this.$(run, `[data-bridge-connect="${which}"]`).hidden = missing;
      this.$(run, `[data-bridge-missing="${which}"]`).hidden = !missing;
    }
    this.show(run, 'connect');
    this.addEventListener('click', this);
    this.addEventListener('submit', this);
    this.addEventListener('input', this);
    addEventListener('beforeunload', this);
    addEventListener('pagehide', this);
    addEventListener('pageshow', this);
    run.onPort = (event) => { if (run === this.run) void this.portBack(run, event); };
    /** @type {any} */ (navigator).serial?.addEventListener?.('connect', run.onPort);
    void this.sendEarlier(run).catch(() => {});
  }

  stop() {
    const run = this.run;
    this.run = null;
    if (!run) return;
    this.removeEventListener('click', this);
    this.removeEventListener('submit', this);
    this.removeEventListener('input', this);
    removeEventListener('beforeunload', this);
    removeEventListener('pagehide', this);
    removeEventListener('pageshow', this);
    if (run.onPort) /** @type {any} */ (navigator).serial?.removeEventListener?.('connect', run.onPort);
    this.unfollow(run);
    run.wizard?.stop();
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
    for (const form of /** @type {NodeListOf<HTMLFormElement>} */ (run.root.querySelectorAll('[data-bridge-pair], [data-bridge-repair]'))) {
      /** @type {HTMLInputElement} */ (form.elements.namedItem('name')).readOnly = false;
      /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]')).disabled = false;
    }
    for (const which of ['serial', 'hid']) {
      this.$(run, `[data-bridge-connect="${which}"]`).hidden = false;
      this.$(run, `[data-bridge-missing="${which}"]`).hidden = true;
    }
    this.$(run, '[data-bridge-taken]').hidden = true;
    this.$(run, '[data-bridge-listening]').hidden = false;
    this.$(run, '[data-bridge-unreadable]').hidden = true;
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

  /** @param {Event} event @returns {void} */
  handleEvent(event) {
    if (event.type === 'beforeunload') {
      if (this.run?.bridge?.state === 'ready') event.preventDefault();
      return;
    }
    // Leaving the page closes the port, and the stream: a page in the back/forward cache forwards nothing either.
    if (event.type === 'pagehide') {
      if (this.run) this.unfollow(this.run);
      return;
    }
    // Back from the back/forward cache: the stream it needs again.
    if (event.type === 'pageshow') {
      if (this.run && /** @type {PageTransitionEvent} */ (event).persisted) this.follow(this.run);
      return;
    }
    const run = this.run;
    if (!run) return;
    const inDialog = event.target instanceof Element && event.target.closest('#wifi-dialog') !== null;
    if (inDialog && run.wizard) {
      if (event.type === 'click') run.wizard.click(/** @type {MouseEvent} */ (event));
      else if (event.type === 'submit') run.wizard.submit(/** @type {SubmitEvent} */ (event));
      else if (event.type === 'input') run.wizard.input(event);
      return;
    }
    if (event.type === 'input') {
      // Any edit in the pair form may settle the Wi-Fi check (clearing the name drops the password's): Pair checks again.
      const form = event.target instanceof Element ? event.target.closest('[data-bridge-pair]') : null;
      if (form instanceof HTMLFormElement && this.contains(form)) {
        for (const name of ['ssid', 'password']) /** @type {HTMLInputElement} */ (form.elements.namedItem(name)).setCustomValidity('');
      }
    } else if (event.type === 'click') {
      const wifi = event.target instanceof Element ? event.target.closest('[data-bridge-wifi]') : null;
      if (wifi instanceof HTMLElement && this.contains(wifi)) return this.openWifi(run, wifi);
      const button = event.target instanceof Element ? event.target.closest('[data-bridge-connect]') : null;
      if (button && this.contains(button)) {
        let which = /** @type {any} */ (button).dataset.bridgeConnect || 'serial';
        // The card of the decoder this tab last had (or the one Connect decoder of an empty list) tries its port first; after a reload, with no port had, the one permitted port.
        const card = /** @type {HTMLElement | null} */ (button.closest('[data-decoder]'));
        if (which === 'serial' && (!run.last || (!run.last.refused && (!card || card.dataset.decoder === run.last.decoder)))) which = 'again';
        this.connect(run, which).then(() => { if (run === this.run) this.ok(run); }, (caught) => { if (run === this.run) this.fail(run, caught); });
      }
    } else if (event.type === 'submit') {
      const form = event.target;
      // Pair again, for a decoder whose pairing the server doesn't know, is the same pairing without Wi-Fi.
      if (form instanceof HTMLFormElement && form.matches('[data-bridge-pair], [data-bridge-repair]') && this.contains(form)) {
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
    // Unplugged: the card says so; below the cards, the ways to connect, as before any connect.
    const shown = state === 'disconnected' ? 'connect' : state;
    for (const section of /** @type {NodeListOf<HTMLElement>} */ (run.root.querySelectorAll('[data-bridge-state]'))) section.hidden = section.dataset.bridgeState !== shown;
    if (state === 'ready') this.update(run);
    // The unknown pairing's warning is said by the live region only, in the server's words.
    else if (state === 'unknown') this.announce(run, this.$(run, '[data-bridge-unknown]').textContent);
    // The unplug, in the server's words.
    else if (state === 'disconnected') this.announce(run, this.$(run, '[data-bridge-say="disconnected"]')?.textContent ?? '');
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

  /**
   * 'again' opens the serial port this tab last had without the picker, and falls back to the picker when it isn't
   * there or won't open; 'auto' (the port came back) only tries it, quietly.
   * @param {Run} run @param {'serial' | 'hid' | 'last' | 'again' | 'auto'} which @param {any} [port] for 'auto': the port that came back
   */
  async connect(run, which, port = null) {
    // One connect at a time until its bridge exists: a second click would put a second bridge on the picked port.
    if (run.connecting) return;
    run.connecting = true;
    this.paint(run);
    const mine = which === 'again' || which === 'auto';
    const remembered = mine ? port ?? await permittedPort(run.last, [], which === 'again') : null;
    if (which === 'auto' && !remembered) {
      run.connecting = false;
      if (run === this.run) this.paint(run);
      return undefined;
    }
    const next = await this.prepare(run, mine ? 'serial' : which, remembered).finally(() => {
      run.connecting = false;
      if (run === this.run) this.paint(run);
    });
    if (!next) return undefined;
    try {
      await next.start();
      if (run !== this.run) await next.close();
    } catch (caught) {
      await next.close();
      if (run.bridge === next) run.bridge = null;
      if (run === this.run) this.show(run, 'connect');
      // Held by another tab, say: a click goes on to the picker, and the next one goes there at once; a port that came
      // back is left alone. The picker needs the click, which the stores and the decoder list may have outlasted: then
      // the card's Connect decoder stays for a click of its own.
      if (remembered && which === 'again' && run === this.run) {
        if (run.last) run.last.refused = true;
        return this.connect(run, 'serial').catch((error) => { if (error?.name !== 'SecurityError') throw error; });
      }
      if (which === 'auto') return undefined;
      throw caught;
    }
    return undefined;
  }

  /**
   * A port came back (navigator.serial's connect event): when it is the one this tab last had, its decoder's cable was
   * pulled, and nothing else is on the cable or connecting, it is opened again, without the picker (connections spec §2).
   * @param {Run} run @param {Event} event
   */
  async portBack(run, event) {
    const gone = run.gone;
    if (!gone?.serial || run.connecting || (run.bridge && run.bridge.state !== 'disconnected')) return;
    // Chrome fires it at the port that came, a new SerialPort: open it only when it is the last one, or the one new
    // port of the same chip; never one that was there already (another decoder, perhaps another tab's).
    const target = /** @type {any} */ (event.target);
    const permitted = await permittedPort(run.last, gone.before);
    const port = target && typeof target.getInfo === 'function' ? (target === run.last?.port || target === permitted ? target : null) : permitted;
    if (!port || run !== this.run || run.gone !== gone) return;
    run.autoFocus = this.focusOf(this.$(run, '#bridge-decoders'));
    await this.connect(run, 'auto', port).catch(() => {});
  }

  /**
   * Picks the device (or takes `port`, a permitted one) and makes its bridge, or null when the picker was closed or the run ended.
   * @param {Run} run @param {'serial' | 'hid' | 'last'} which @param {any} [port]
   */
  async prepare(run, which, port = null) {
    const chosen = which === 'last' ? run.transport ?? 'serial' : which;
    const transport = port ? serialTransport(port) : await pick(chosen);
    if (run !== this.run) return null;
    if (!transport) return null;
    run.transport = chosen;
    // The same port keeps its decoder until the cable says otherwise, so a reopen that fails leaves its card's button to it.
    if (chosen === 'serial') run.last = { port: transport.port, device: transport.device, decoder: run.last && sameDevice(run.last.port, transport.port) ? run.last.decoder : null };
    // A port that came back after this chip's cable was pulled: Chrome made it anew (re-enumerated), permission kept.
    const cameBack = Boolean(port && run.gone?.serial && port !== run.gone.port && chipOf(port) !== null && sameDevice(port, run.gone.port));
    if (run.made && run.made.device !== transport.device) this.forget(run);
    this.$(run, '[data-bridge-taken]').hidden = true;
    await run.bridge?.close();
    // From here the replaced bridge's late events find no bridge, and leaving the page isn't guarded; its stream goes.
    run.bridge = null;
    this.follow(run);
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
      if (next.state === 'disconnected') {
        void release();
        // Unplugged, not replaced: its card says what a replug does, and the ports there now are other decoders'.
        if (run.bridge === next && next.decoder) {
          const gone = { decoder: next.decoder, kind: next.kind, serial: chosen === 'serial', back: chosen === 'serial' && chipOf(transport.port) !== null && reconnects.has(transport.device), before: [], port: transport.port };
          run.gone = gone;
          if (gone.serial) void permittedPorts().then((ports) => { gone.before = ports.filter((p) => p !== transport.port); });
        }
      }
      if (run.bridge !== next) return;
      if (next.state === 'ready') {
        run.gone = null;
        if (chosen === 'serial' && run.last && sameDevice(run.last.port, transport.port)) run.last.decoder = next.decoder;
        // It came back after an unplug, opened without the picker, and said who it is: this chip's ports come back on their own.
        if (cameBack) reconnects.add(transport.device);
      }
      this.paint(run);
      // A TinyLap decoder sends %TLNET at boot; one connected while running hasn't, so it is asked once it says who it is.
      if (next.state === 'ready' && next.kind === 'tinylap' && !next.net) {
        next.queryNet().catch(() => {
          if (run.bridge !== next || next.net) return;
          run.silent = next;
          this.paint(run);
        });
      }
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
    next.addEventListener('net', () => { if (run.bridge === next) this.paint(run); });
    next.addEventListener('passing', (event) => {
      run.preview.unshift(/** @type {CustomEvent} */ (event).detail);
      run.preview.length = Math.min(run.preview.length, 20);
      if (run.bridge === next) this.update(run);
    });
    run.bridge = next;
    return next;
  }

  /**
   * Keeps the server's copy of every card in `list` (default: the page's), before anything is painted on it.
   * @param {Run} run @param {Element | null} [list]
   */
  keep(run, list = this.$(run, '#bridge-decoders')) {
    if (!list) return;
    this.served = new Map([...list.querySelectorAll('[data-decoder]')].map((card) => [/** @type {HTMLElement} */ (card).dataset.decoder ?? '', card.cloneNode(true)]));
  }

  /**
   * The cards as this tab sees them. Who owns Connect decoder: app.css hides every card's where this browser can't
   * reach USB decoders at all (or tl-bridge can't run); this disables them all while a connection is in progress or
   * a decoder is on the cable (a second picker would replace the open port), and hides the one on the cabled card.
   * @param {Run} run
   */
  paint(run) {
    const list = this.$(run, '#bridge-decoders');
    if (!list) return;
    const focus = this.focusOf(list);
    const bridge = run.bridge;
    const id = bridge?.decoder && (bridge.state === 'ready' || bridge.state === 'connecting') ? bridge.decoder : null;
    for (const card of /** @type {NodeListOf<HTMLElement>} */ (list.querySelectorAll('[data-decoder][data-cabled]'))) {
      if (card.dataset.decoder !== id) this.uncable(run, card);
    }
    const card = id ? /** @type {HTMLElement | null} */ (list.querySelector(`[data-decoder="${CSS.escape(id)}"]`)) : null;
    if (card && bridge) {
      this.cable(card, bridge, run.silent === bridge);
      // Its Connect decoder is gone (a reconnect on its own, say): focus goes to the card's name. A reconnect on its own
      // disabled the button first, which lost focus, so it counts where focus was when the port came back.
      const was = focus ?? (document.activeElement === document.body ? run.autoFocus : null);
      run.autoFocus = null;
      if (was?.id === id && was.which === '[data-bridge-connect]') this.refocus(run, was);
    }
    // A decoder paired since the cards came has none yet: its cable stream's first message brings it.
    this.follow(run);
    this.notes(run, list, card && bridge ? id : null);
    this.arrange(run, list, card && bridge ? id : null);
    const busy = run.connecting || (bridge !== null && bridge.state !== 'disconnected');
    for (const button of /** @type {NodeListOf<HTMLButtonElement>} */ (list.querySelectorAll('[data-bridge-connect]'))) button.disabled = busy;
    for (const time of /** @type {NodeListOf<HTMLTimeElement>} */ (list.querySelectorAll('time[data-when]'))) {
      const at = Date.parse(time.dateTime);
      const text = Number.isNaN(at) ? time.textContent : formatWhen(at, Date.now());
      if (time.textContent !== text) time.textContent = text;
    }
    // The dialog is for the decoder on the cable only.
    if (run.wizard?.dialog.open && run.wizard.decoder !== id) run.wizard.close();
  }

  /**
   * The Cable row's notes for the decoder this tab had when its cable was pulled, as the server wrote them:
   * [data-cable-note="back"] when its serial port is known to reconnect on its own (its chip has before, in this
   * browser: Chrome forgets the permission of chips without a serial number), and [data-cable-note="gap"] for a decoder
   * without Wi-Fi (plain ZRound, EasyLap), whose crossings meanwhile are lost. The "plug it in" help gives way to them.
   * @param {Run} run @param {Element} list @param {string | null} cabled
   */
  notes(run, list, cabled) {
    for (const card of /** @type {NodeListOf<HTMLElement>} */ (list.querySelectorAll(':scope > [data-decoder]'))) {
      // A card still painted for the cable (no server's copy of it yet) keeps what it showed.
      if (card.dataset.decoder === cabled || card.hasAttribute('data-cabled')) continue;
      // While any decoder is on the cable (or connecting), the notes about a replug are not true.
      const busy = run.bridge !== null && run.bridge.state !== 'disconnected';
      const had = !busy && run.gone?.decoder === card.dataset.decoder ? run.gone : null;
      const show = { back: Boolean(had?.back), gap: Boolean(had && BROWSER_ASSIGNED.has(had.kind)) };
      for (const note of /** @type {NodeListOf<HTMLElement>} */ (card.querySelectorAll('[data-row="cable"] [data-cable-note]'))) {
        const hidden = !show[/** @type {'back' | 'gap'} */ (note.dataset.cableNote)];
        if (note.hidden !== hidden) note.hidden = hidden;
      }
      const detail = /** @type {HTMLElement | null} */ (card.querySelector('[data-row="cable"] [data-slot="detail"]'));
      if (detail && detail.hidden !== (show.back || show.gap)) detail.hidden = show.back || show.gap;
    }
  }

  /**
   * Paints the decoder on this tab's cable over its card (connections spec §2.1, with the cable): Connected, and for a
   * TinyLap decoder its own Wi-Fi with Change Wi-Fi; a plain ZRound decoder or EasyLap has no Wi-Fi row.
   * @param {HTMLElement} card @param {Bridge} bridge @param {boolean} [silent]
   */
  cable(card, bridge, silent = false) {
    card.dataset.cabled = '';
    /** @param {Element | null} row @param {{ state: string, signal?: string, words: string, detail: string }} view */
    const fill = (row, { state, signal, words, detail }) => {
      if (!row) return;
      const lamp = /** @type {HTMLElement} */ (row.querySelector('.lamp'));
      lamp.dataset.state = state;
      if (signal) lamp.dataset.signal = signal;
      else delete lamp.dataset.signal;
      for (const [slot, text] of [['state', words], ['detail', detail]]) {
        const el = /** @type {HTMLElement} */ (row.querySelector(`[data-slot="${slot}"]`));
        if (el.textContent !== text) el.textContent = text;
      }
    };
    const cableRow = card.querySelector('[data-row="cable"]');
    fill(cableRow, { state: 'ok', words: 'Connected', detail: '' });
    for (const b of /** @type {NodeListOf<HTMLElement>} */ (cableRow?.querySelectorAll('[data-bridge-connect]') ?? [])) b.hidden = true;
    for (const note of /** @type {NodeListOf<HTMLElement>} */ (cableRow?.querySelectorAll('[data-cable-note]') ?? [])) note.hidden = true;
    const wifiRow = /** @type {HTMLElement | null} */ (card.querySelector('[data-row="wifi"]'));
    const tinylap = bridge.kind === 'tinylap';
    if (wifiRow) wifiRow.hidden = !tinylap;
    const change = /** @type {HTMLButtonElement | null} */ (wifiRow?.querySelector('[data-bridge-wifi]') ?? null);
    if (wifiRow && tinylap) {
      fill(wifiRow, netRow(bridge.net, change !== null, silent));
      for (const hint of /** @type {NodeListOf<HTMLElement>} */ (wifiRow.querySelectorAll('[data-slot="action"] > .decoder-row-help'))) hint.hidden = true;
      if (change) {
        change.hidden = !bridge.net;
        const label = bridge.net?.state === 'off' ? 'Set up Wi-Fi' : 'Change Wi-Fi';
        if (change.textContent !== label) change.textContent = label;
      }
    }
    const status = /** @type {HTMLElement | null} */ (card.querySelector('[data-slot="status"]'));
    if (status) {
      status.className = 'status status-success';
      const [first, ...rest] = status.querySelectorAll('p');
      // Wi-Fi counts once the server hears it (or knows it idle), not when the decoder says it joined.
      const served = /** @type {Element | undefined} */ (this.served.get(card.dataset.decoder ?? ''));
      const heard = /** @type {HTMLElement | null | undefined} */ (served?.querySelector('[data-row="wifi"] > .lamp'))?.dataset.state;
      const text = `Laps get through over the cable${tinylap && (heard === 'ok' || heard === 'idle') ? ' and Wi-Fi' : ''}.`;
      if (first && first.textContent !== text) first.textContent = text;
      for (const p of rest) p.remove();
    }
  }

  /**
   * The decoder on the cable first, then the server's order (connections spec §2). Moves cards only when the order is
   * off, keeping focus where it was. @param {Run} run @param {Element} list @param {string | null} cabled
   */
  arrange(run, list, cabled) {
    const cards = /** @type {HTMLElement[]} */ ([...list.querySelectorAll(':scope > [data-decoder]')]);
    const rank = new Map([...this.served.keys()].map((id, i) => [id, i]));
    const place = (card) => (card.dataset.decoder === cabled ? -1 : rank.get(card.dataset.decoder ?? '') ?? rank.size);
    const wanted = [...cards].sort((a, b) => place(a) - place(b));
    if (wanted.every((card, i) => card === cards[i])) return;
    const focus = this.focusOf(list);
    list.append(...wanted);
    this.refocus(run, focus);
  }

  /** The cable left this card: back to the server's copy; without one, the stream's next message brings it. @param {Run} run @param {HTMLElement} card */
  uncable(run, card) {
    const served = this.served.get(card.dataset.decoder ?? '');
    if (!served) {
      // Change Wi-Fi needs the cable, so it goes now.
      for (const b of /** @type {NodeListOf<HTMLElement>} */ (card.querySelectorAll('[data-bridge-wifi]'))) b.hidden = true;
      return;
    }
    const focus = this.focusOf(card.parentElement);
    card.replaceWith(served.cloneNode(true));
    this.refocus(run, focus);
  }

  /** Where focus is inside the cards, as a card and its button, to find again in a new copy. @param {Element | null} list */
  focusOf(list) {
    const active = document.activeElement;
    if (!list || !(active instanceof HTMLElement) || !list.contains(active)) return null;
    const card = /** @type {HTMLElement | null} */ (active.closest('[data-decoder]'));
    const which = active.matches('[data-bridge-wifi]') ? '[data-bridge-wifi]' : active.matches('[data-bridge-connect]') ? '[data-bridge-connect]' : null;
    return { id: card?.dataset.decoder ?? null, which };
  }

  /** Puts focus back on the same button of the same card, or on that card's name when the button is gone or can't take it. @param {Run} run @param {{ id: string | null, which: string | null } | null} focus */
  refocus(run, focus) {
    if (!focus?.id) return;
    const card = this.$(run, `#bridge-decoders [data-decoder="${CSS.escape(focus.id)}"]`);
    const button = focus.which ? /** @type {HTMLButtonElement | null} */ (card?.querySelector(focus.which)) : null;
    if (button && !button.hidden && !button.disabled) {
      button.focus();
      return;
    }
    const name = /** @type {HTMLElement | null} */ (card?.querySelector('[data-slot="name"]'));
    if (name) {
      name.tabIndex = -1;
      name.focus();
    }
  }

  /**
   * Holds the one stream this page needs (cable presence spec §2): the cable stream of the decoder on this tab's cable
   * while it is ready (a TinyLap decoder that said who it is; a plain ZRound or EasyLap once chosen), for as long as the
   * server should count it on a cable; otherwise the cards stream. Both carry this render's page id (#bridge's
   * data-page), so the server leaves this page's own cable out of its cards. A dropped stream reconnects by itself
   * (EventSource); one the server refused, which EventSource gives up on, is opened again after STREAM_RETRY_MS,
   * doubling to STREAM_RETRY_MAX_MS until a message comes. The addresses are #bridge's.
   * @param {Run} run
   */
  follow(run) {
    if (!('EventSource' in window)) return;
    const bridge = run.bridge;
    const id = bridge?.decoder && bridge.state === 'ready' ? bridge.decoder : null;
    const address = id ? run.root.dataset.cableStream?.replace('{id}', encodeURIComponent(id)) : run.root.dataset.cardsStream;
    if (!address) return;
    const page = run.root.dataset.page;
    const url = page ? `${address}?${new URLSearchParams({ page })}` : address;
    if (run.stream?.url === url && run.stream.source.readyState !== EventSource.CLOSED) return;
    // One at a time: the old one closes first.
    this.unfollow(run);
    const source = new EventSource(url);
    /** @type {NonNullable<Run['stream']>} */
    const stream = { url, source };
    source.addEventListener('bridge', (event) => {
      if (run !== this.run || run.stream !== stream) return;
      run.retryMs = STREAM_RETRY_MS;
      this.swap(run, /** @type {MessageEvent} */ (event).data);
    });
    source.addEventListener('error', () => {
      if (run !== this.run || run.stream !== stream || source.readyState !== EventSource.CLOSED || stream.retry) return;
      stream.retry = setTimeout(() => { if (run === this.run && run.stream === stream) this.follow(run); }, run.retryMs);
      run.retryMs = Math.min(run.retryMs * 2, STREAM_RETRY_MAX_MS);
    });
    run.stream = stream;
  }

  /** Closes the page's stream: a cable stream's decoder is on no cable from now, as far as this tab goes. @param {Run} run */
  unfollow(run) {
    clearTimeout(run.stream?.retry);
    run.stream?.source.close();
    run.stream = null;
  }

  /**
   * Swaps in the server's #bridge-decoders from the stream (rendered and escaped by the server), keeps its cards, and
   * paints the cable over them again. The dialog sits outside it and stays. Anything else keeps the cards as they are.
   * @param {Run} run @param {string} html
   */
  swap(run, html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const fresh = template.content.firstElementChild;
    const current = this.$(run, '#bridge-decoders');
    if (!fresh || fresh.id !== 'bridge-decoders' || !current) return;
    const next = document.importNode(fresh, true);
    this.keep(run, next);
    const focus = this.focusOf(current);
    current.replaceWith(next);
    this.paint(run);
    this.refocus(run, focus);
  }

  /** Change Wi-Fi on the card of the decoder on this tab's cable. @param {Run} run @param {HTMLElement} button */
  openWifi(run, button) {
    const card = /** @type {HTMLElement | null} */ (button.closest('[data-decoder]'));
    const id = card?.dataset.decoder;
    if (!id || !run.wizard || run.bridge?.decoder !== id || run.bridge.kind !== 'tinylap') return;
    run.wizard.open(id, card.querySelector('[data-slot="name"]')?.textContent ?? '', button.textContent ?? 'Change Wi-Fi');
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
    for (const form of /** @type {NodeListOf<HTMLFormElement>} */ (run.root.querySelectorAll('[data-bridge-pair], [data-bridge-repair]'))) {
      /** @type {HTMLInputElement} */ (form.elements.namedItem('name')).readOnly = false;
    }
  }

  /**
   * Which Wi-Fi field the decoder would refuse, and why, in bytes as it counts them; or null.
   * @param {string} ssid @param {string} password @returns {{ field: 'ssid' | 'password', text: string } | null}
   */
  wifiProblem(ssid, password) {
    const error = wifiError(ssid, password);
    const bytes = (text) => new TextEncoder().encode(text).length;
    if (error === 'Wi-Fi name too long') return { field: 'ssid', text: `A Wi-Fi name is at most 32 bytes. This one is ${bytes(ssid)}: letters like é take 2, emoji 4.` };
    if (error === 'Wi-Fi password length') {
      const why = password.length === 64 ? 'This one is 64 characters, but not all hex digits.' : `This one is ${bytes(password)} bytes.`;
      return { field: 'password', text: `A Wi-Fi password is 8 to 63 bytes, or 64 hex digits. ${why}` };
    }
    return null;
  }

  /** @param {Run} run @param {HTMLFormElement} pairForm */
  async pair(run, pairForm) {
    const nameField = /** @type {HTMLInputElement} */ (pairForm.elements.namedItem('name'));
    const submit = /** @type {HTMLButtonElement} */ (pairForm.querySelector('button[type="submit"]'));
    const form = new FormData(pairForm);
    const name = String(form.get('name') ?? '').trim();
    if (!run.made && !name) return this.fail(run, new Error('A decoder name is 1 to 60 characters.'));
    const ssid = String(form.get('ssid') ?? '').trim();
    const password = String(form.get('password') ?? '');
    // The decoder's own checks, before anything is created or sent (spec §5.2); the browser shows the text.
    const wrong = ssid ? this.wifiProblem(ssid, password) : null;
    if (wrong) {
      const field = /** @type {HTMLInputElement} */ (pairForm.elements.namedItem(wrong.field));
      field.setCustomValidity(wrong.text);
      field.reportValidity();
      return undefined;
    }
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
      await current().pair(run.made.id, run.made.token, ssid ? { ssid, password } : null, run.root.dataset.server ?? '');
      run.made = null;
      nameField.readOnly = false;
      if (run === this.run) this.ok(run);
    } catch (caught) {
      if (caught instanceof ServerUnconfirmedError || caught instanceof WifiRefusedError || caught instanceof WifiUnconfirmedError) {
        // The pairing is stored and the bridge is ready: only the server address or the Wi-Fi settings didn't take.
        run.made = null;
        nameField.readOnly = false;
        if (run === this.run) {
          this.fail(run, new Error(caught instanceof ServerUnconfirmedError
            ? 'The decoder is paired, but its firmware is too old for Wi-Fi. Update it, then pair again. Its passings still reach TinyLap over this cable.'
            : caught instanceof WifiRefusedError
              ? `The decoder is paired, but it refused the Wi-Fi settings: ${caught.reason}.`
              : "The decoder is paired, but it didn't confirm the Wi-Fi settings. Its passings still reach TinyLap over this cable."));
        }
        return;
      }
      if (run === this.run) this.fail(run, run.made ? new Error(`${caught.message} The decoder "${run.made.name ?? name}" is created; press Pair again to send it to the device. The name stays as it is.`) : caught);
    } finally {
      // After a move the new run shares this button; its reset enabled it, and its own pairing may hold it.
      if (run === this.run) submit.disabled = false;
    }
  }
}

if (!customElements.get('tl-bridge')) customElements.define('tl-bridge', TlBridge);
