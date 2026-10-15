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
const fail = (caught) => {
  // Closing the browser's port picker is a choice, not an error.
  if (caught?.name === 'NotFoundError') return;
  error.textContent = caught.message;
  error.hidden = false;
};
const ok = () => { error.hidden = true; };

function show(state) {
  for (const section of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('[data-bridge-state]'))) section.hidden = section.dataset.bridgeState !== state;
  if (state === 'ready') update();
}

function update() {
  if (!bridge) return;
  $('[data-bridge-status-box]').classList.toggle('is-offline', !bridge.online);
  $('[data-bridge-status]').textContent = bridge.online ? `Forwarding from decoder ${bridge.decoder}` : `Offline: passings wait here. ${bridge.lastError?.message ?? ''}`;
  const refused = $('[data-bridge-refused]');
  refused.hidden = !(bridge.online && bridge.lastError);
  refused.textContent = bridge.online && bridge.lastError ? `Some passings were refused: ${bridge.lastError.message}` : '';
  void bridge.outbox.count().then((n) => { $('[data-bridge-outbox]').textContent = String(n); });
  const list = $('[data-bridge-preview]');
  list.replaceChildren(...preview.map((p) => {
    const li = document.createElement('li');
    const code = Object.assign(document.createElement('span'), { className: 'num', textContent: p.transponder });
    const lap = Object.assign(document.createElement('span'), { className: 'num', textContent: formatLap(p.lapMs) });
    li.append(code, lap);
    return li;
  }));
  $('[data-bridge-preview-empty]').hidden = preview.length > 0;
}

async function connect() {
  const port = simulate !== null ? simulatedPort({ lapMs: simulate === 'fast' ? 2000 : 8000 }) : await /** @type {any} */ (navigator).serial.requestPort();
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
  pairForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = /** @type {HTMLButtonElement} */ (pairForm.querySelector('button[type="submit"]'));
    const form = new FormData(pairForm);
    const name = String(form.get('name') ?? '').trim();
    if (!made && !name) return fail(new Error('A decoder name is 1 to 60 characters.'));
    submit.disabled = true;
    try {
      made ??= await api('POST', `/workspaces/${encodeURIComponent(workspaceId)}/decoders`, { name });
      const ssid = String(form.get('ssid') ?? '').trim();
      await bridge.pair(made.id, made.token, ssid ? { ssid, password: String(form.get('password') ?? '') } : null);
      made = null;
      ok();
    } catch (caught) {
      fail(made ? new Error(`${caught.message} The decoder "${made.name ?? name}" is created; press Pair again to send it to the device.`) : caught);
    } finally {
      submit.disabled = false;
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (bridge && bridge.state === 'ready') event.preventDefault();
  });
  void sendEarlier().catch(() => {});
}
