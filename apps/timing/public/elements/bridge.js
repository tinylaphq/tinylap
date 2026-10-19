// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// <tl-bridge> (spec step three §3): while it is on the page, it runs the
// page side of the USB bridge (spec §6.5), Web Serial ↔ the server, on the
// #bridge markup the server rendered inside it. It shows one
// [data-bridge-state] section at a time, fills in the ready panel from the
// server's row templates, sends passings an earlier visit left behind, and
// guards leaving the page while a decoder is forwarding. Pairing posts to
// the JSON API, because the decoder's token must reach the board over serial.
// - Each start, on connect, makes a fresh run: the page's state, held in
//   one object.
// - Without #bridge, or without Web Serial and ?simulate, it does nothing,
//   and the server's "unsupported" notice stays.
// The Bridge class itself (serial, outbox, retries) is ../bridge.js.
import { Bridge, sendOutbox } from '../bridge.js';
import { formatLap } from '../format.js';
import { openOutbox } from '../outbox.js';
import { simulatedPort } from '../sim-port.js';

const simulate = new URLSearchParams(location.search).get('simulate');
const supported = 'serial' in navigator || simulate !== null;

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

const post = (decoderId, batch) => api('POST', `/decoders/${encodeURIComponent(decoderId)}/passings`, batch);

const STATE_TEXT = {
  connect: 'Ready to connect.',
  connecting: 'Talking to the decoder.',
  'not-tinylap': "This device doesn't answer like a TinyLap decoder.",
  unpaired: 'The decoder is not paired yet.',
  disconnected: 'Decoder disconnected.',
};

/** The browser's port picker; closing it is a choice, not an error. */
async function pickPort() {
  if (simulate !== null) return simulatedPort({ lapMs: simulate === 'fast' ? 2000 : 8000 });
  try {
    return await /** @type {any} */ (navigator).serial.requestPort();
  } catch (caught) {
    if (/** @type {any} */ (caught)?.name === 'NotFoundError') return null;
    throw caught;
  }
}

/**
 * One start's state. `names` maps a decoder id to the name it was paired
 * with; `made` is a decoder the server made but the cable didn't get yet:
 * its token is shown once, so a retry reuses it.
 * @typedef {{ root: HTMLElement, workspaceId: string, bridge: Bridge | null, preview: any[], names: Map<string, string>, asked: Set<string>, made: any }} Run
 */

class TlBridge extends HTMLElement {
  /** @type {Run | null} */ run = null;

  connectedCallback() { this.start(); }

  // Teardown follows (Task 5).
  disconnectedCallback() {}

  start() {
    if (this.run) return;
    const root = /** @type {HTMLElement | null} */ (this.querySelector('#bridge'));
    if (!root || !supported) return;
    const run = { root, workspaceId: root.dataset.workspace ?? '', bridge: null, preview: [], names: new Map(), asked: new Set(), made: null };
    this.run = run;
    this.show(run, 'connect');
    this.addEventListener('click', this);
    this.addEventListener('submit', this);
    addEventListener('beforeunload', this);
    void this.sendEarlier(run).catch(() => {});
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
      if (button && this.contains(button)) this.connect(run).then(() => this.ok(run), (caught) => this.fail(run, caught));
    } else if (event.type === 'submit') {
      const form = event.target;
      if (form instanceof HTMLFormElement && form.matches('[data-bridge-pair]') && this.contains(form)) {
        event.preventDefault();
        void this.pair(run, form);
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
    if (state === 'ready') this.update(run);
    else this.announce(run, STATE_TEXT[state] ?? '');
  }

  /** @param {Run} run */
  update(run) {
    const bridge = run.bridge;
    if (!bridge || bridge.state !== 'ready') return;
    this.$(run, '[data-bridge-status-box]').classList.toggle('is-offline', !bridge.online);
    const status = bridge.online ? `Forwarding from ${this.nameOf(run, bridge.decoder)}` : `Offline: passings wait here. ${bridge.lastError?.message ?? ''}`.trim();
    this.$(run, '[data-bridge-status]').textContent = status;
    this.announce(run, status);
    if (!run.names.has(bridge.decoder) && !run.asked.has(bridge.decoder)) void this.learnName(run, bridge.decoder);
    const refused = this.$(run, '[data-bridge-refused]');
    refused.hidden = !(bridge.online && bridge.lastError);
    refused.textContent = bridge.online && bridge.lastError ? `Some passings were refused: ${bridge.lastError.message}` : '';
    void bridge.outbox.count().then((n) => { this.$(run, '[data-bridge-outbox]').textContent = String(n); });
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
        this.update(run);
      }
    } catch {
      // The short id stays.
    }
  }

  /** @param {Run} run */
  async connect(run) {
    const port = await pickPort();
    if (!port) return;
    await run.bridge?.close();
    const next = new Bridge({ port, outbox: await openOutbox(), post });
    next.addEventListener('state', () => {
      if (next.state === 'not-tinylap') void next.close();
      if (run.bridge === next) this.show(run, next.state === 'idle' ? 'connecting' : next.state);
    });
    for (const type of ['outbox', 'online']) next.addEventListener(type, () => { if (run.bridge === next) this.update(run); });
    next.addEventListener('passing', (event) => {
      run.preview.unshift(/** @type {CustomEvent} */ (event).detail);
      run.preview.length = Math.min(run.preview.length, 20);
      if (run.bridge === next) this.update(run);
    });
    run.bridge = next;
    this.show(run, 'connecting');
    try {
      await next.start();
    } catch (caught) {
      await next.close();
      if (run.bridge === next) run.bridge = null;
      this.show(run, 'connect');
      throw caught;
    }
  }

  /** Passings an earlier tab left behind (a reload, a crash) go now, without waiting for the cable. @param {Run} run */
  async sendEarlier(run) {
    const note = this.$(run, '[data-bridge-earlier]');
    const outbox = await openOutbox();
    const say = (count, why = '') => {
      note.hidden = count === 0;
      note.textContent = `${count} ${count === 1 ? 'passing' : 'passings'} from earlier ${count === 1 ? 'is' : 'are'} waiting. ${why}`.trim();
      if (count > 0) this.announce(run, note.textContent);
    };
    let count = await outbox.count();
    if (count === 0) return;
    say(count, 'Sending them now…');
    const { refusal } = await sendOutbox(outbox, post, async () => say(await outbox.count(), 'Sending them now…')).catch((caught) => ({ refusal: caught }));
    count = await outbox.count();
    say(count, refusal && count ? `They couldn't be sent: ${refusal.message}` : '');
  }

  /** @param {Run} run @param {HTMLFormElement} pairForm */
  async pair(run, pairForm) {
    const nameField = /** @type {HTMLInputElement} */ (pairForm.elements.namedItem('name'));
    const submit = /** @type {HTMLButtonElement} */ (pairForm.querySelector('button[type="submit"]'));
    const form = new FormData(pairForm);
    const name = String(form.get('name') ?? '').trim();
    if (!run.made && !name) return this.fail(run, new Error('A decoder name is 1 to 60 characters.'));
    submit.disabled = true;
    try {
      if (!run.made) {
        run.made = await api('POST', `/workspaces/${encodeURIComponent(run.workspaceId)}/decoders`, { name });
        run.names.set(run.made.id, run.made.name);
        nameField.readOnly = true;
      }
      const ssid = String(form.get('ssid') ?? '').trim();
      await run.bridge.pair(run.made.id, run.made.token, ssid ? { ssid, password: String(form.get('password') ?? '') } : null);
      run.made = null;
      nameField.readOnly = false;
      this.ok(run);
    } catch (caught) {
      this.fail(run, run.made ? new Error(`${caught.message} The decoder "${run.made.name ?? name}" is created; press Pair again to send it to the device. The name stays as it is.`) : caught);
    } finally {
      submit.disabled = false;
    }
  }
}

if (!customElements.get('tl-bridge')) customElements.define('tl-bridge', TlBridge);
