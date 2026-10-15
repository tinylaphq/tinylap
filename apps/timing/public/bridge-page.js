// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge page (spec §6.5): Web Serial ↔ the server, on the markup the
// server rendered. Shows one [data-bridge-state] section at a time and fills
// in the ready panel; pairing posts to the JSON API, because the decoder's
// token must reach the board over serial.
import { Bridge, sendOutbox } from './bridge.js';
import { formatLap } from './format.js';
import { openOutbox } from './outbox.js';
import { simulatedPort } from './sim-port.js';

const root = /** @type {HTMLElement | null} */ (document.querySelector('#bridge'));
const workspaceId = root?.dataset.workspace ?? '';
const $ = (selector) => root?.querySelector(selector);
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
  if (!res.ok) throw Object.assign(new Error(data?.detail ?? data?.error ?? `The server answered ${res.status}.`), { status: res.status });
  return data;
}

const post = (decoderId, batch) => api('POST', `/decoders/${encodeURIComponent(decoderId)}/passings`, batch);

/** @type {Bridge | null} */
let bridge = null;
const preview = [];
const error = $('[data-bridge-error]');
const live = $('[data-bridge-live]');
/** Tells screen readers, once per change. */
const announce = (text) => { if (live.textContent !== text) live.textContent = text; };
/** Decoder id → the name it was paired with, for this tab. */
const names = new Map();
const asked = new Set();
const nameOf = (id) => names.get(id) ?? `decoder ${String(id).slice(0, 8)}`;
const fail = (caught) => {
  error.textContent = caught.message;
  error.hidden = false;
};
const ok = () => { error.hidden = true; };

function show(state) {
  for (const section of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('[data-bridge-state]'))) section.hidden = section.dataset.bridgeState !== state;
  if (state === 'ready') update();
  else announce(STATE_TEXT[state] ?? '');
}

const STATE_TEXT = {
  connect: 'Ready to connect.',
  connecting: 'Talking to the decoder.',
  'not-tinylap': "This device doesn't answer like a TinyLap decoder.",
  unpaired: 'The decoder is not paired yet.',
  disconnected: 'Decoder disconnected.',
};

function update() {
  if (!bridge || bridge.state !== 'ready') return;
  $('[data-bridge-status-box]').classList.toggle('is-offline', !bridge.online);
  const status = bridge.online ? `Forwarding from ${nameOf(bridge.decoder)}` : `Offline: passings wait here. ${bridge.lastError?.message ?? ''}`.trim();
  $('[data-bridge-status]').textContent = status;
  announce(status);
  if (!names.has(bridge.decoder) && !asked.has(bridge.decoder)) void learnName(bridge.decoder);
  const refused = $('[data-bridge-refused]');
  refused.hidden = !(bridge.online && bridge.lastError);
  refused.textContent = bridge.online && bridge.lastError ? `Some passings were refused: ${bridge.lastError.message}` : '';
  void bridge.outbox.count().then((n) => { $('[data-bridge-outbox]').textContent = String(n); });
  const list = $('[data-bridge-preview]');
  list.replaceChildren(...preview.map((p) => {
    const li = document.createElement('li');
    const code = Object.assign(document.createElement('span'), { className: 'bridge-code', textContent: p.transponder });
    const lap = p.lapMs === null || p.lapMs === undefined
      ? Object.assign(document.createElement('span'), { className: 'bridge-first', textContent: 'first pass' })
      : Object.assign(document.createElement('span'), { className: 'num', textContent: formatLap(p.lapMs) });
    li.append(code, lap);
    return li;
  }));
  $('[data-bridge-preview-empty]').hidden = preview.length > 0;
}

/** A decoder paired in an earlier visit: look its name up once; the short id stands in until then. */
async function learnName(id) {
  asked.add(id);
  try {
    const { decoders } = await api('GET', `/workspaces/${encodeURIComponent(workspaceId)}/decoders`);
    const found = decoders.find((d) => d.id === id);
    if (found) {
      names.set(id, found.name);
      update();
    }
  } catch {
    // The short id stays.
  }
}

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

async function connect() {
  const port = await pickPort();
  if (!port) return;
  await bridge?.close();
  const next = new Bridge({ port, outbox: await openOutbox(), post });
  next.addEventListener('state', () => {
    if (next.state === 'not-tinylap') void next.close();
    if (bridge === next) show(next.state === 'idle' ? 'connecting' : next.state);
  });
  for (const type of ['outbox', 'online']) next.addEventListener(type, () => { if (bridge === next) update(); });
  next.addEventListener('passing', (event) => {
    preview.unshift(/** @type {CustomEvent} */ (event).detail);
    preview.length = Math.min(preview.length, 20);
    if (bridge === next) update();
  });
  bridge = next;
  show('connecting');
  try {
    await next.start();
  } catch (caught) {
    await next.close();
    if (bridge === next) bridge = null;
    show('connect');
    throw caught;
  }
}

/** Passings an earlier tab left behind (a reload, a crash) go now, without waiting for the cable. */
async function sendEarlier() {
  const note = $('[data-bridge-earlier]');
  const outbox = await openOutbox();
  const say = (count, why = '') => {
    note.hidden = count === 0;
    note.textContent = `${count} ${count === 1 ? 'passing' : 'passings'} from earlier ${count === 1 ? 'is' : 'are'} waiting. ${why}`.trim();
    if (count > 0) announce(note.textContent);
  };
  let count = await outbox.count();
  if (count === 0) return;
  say(count, 'Sending them now…');
  const { refusal } = await sendOutbox(outbox, post, async () => say(await outbox.count(), 'Sending them now…')).catch((caught) => ({ refusal: caught }));
  count = await outbox.count();
  say(count, refusal && count ? `They couldn't be sent: ${refusal.message}` : '');
}

if (root && supported) {
  show('connect');
  for (const button of root.querySelectorAll('[data-bridge-connect]')) button.addEventListener('click', () => connect().then(ok, fail));
  /** A decoder the server made but the cable didn't get yet: its token is shown once, so a retry reuses it. */
  let made = null;
  const pairForm = /** @type {HTMLFormElement} */ ($('[data-bridge-pair]'));
  const nameField = /** @type {HTMLInputElement} */ (pairForm.elements.namedItem('name'));
  pairForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = /** @type {HTMLButtonElement} */ (pairForm.querySelector('button[type="submit"]'));
    const form = new FormData(pairForm);
    const name = String(form.get('name') ?? '').trim();
    if (!made && !name) return fail(new Error('A decoder name is 1 to 60 characters.'));
    submit.disabled = true;
    try {
      if (!made) {
        made = await api('POST', `/workspaces/${encodeURIComponent(workspaceId)}/decoders`, { name });
        names.set(made.id, made.name);
        nameField.readOnly = true;
      }
      const ssid = String(form.get('ssid') ?? '').trim();
      await bridge.pair(made.id, made.token, ssid ? { ssid, password: String(form.get('password') ?? '') } : null);
      made = null;
      nameField.readOnly = false;
      ok();
    } catch (caught) {
      fail(made ? new Error(`${caught.message} The decoder "${made.name ?? name}" is created; press Pair again to send it to the device. The name stays as it is.`) : caught);
    } finally {
      submit.disabled = false;
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (bridge && bridge.state === 'ready') event.preventDefault();
  });
  void sendEarlier().catch(() => {});
}
