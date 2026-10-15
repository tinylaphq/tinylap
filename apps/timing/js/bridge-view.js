// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge screen (spec §8): connect the decoder on USB, pair it, watch
// the outbox and a local preview. The Bridge outlives the screen, so the
// board can be shown while it forwards.
import { Bridge } from './bridge.js';
import { h } from './dom.js';
import { formatLap } from './format.js';
import { openOutbox } from './outbox.js';
import { simulatedPort } from './sim-port.js';

/** @type {Bridge | null} */
let bridge = null;
const preview = [];
/** Redraw callbacks of the mounted screens: 'state' redraws the screen, 'live' updates the ready panel in place. */
const views = new Set();
const notify = (kind) => { for (const view of views) view(kind); };
let guarded = false;

const simulate = () => new URLSearchParams(location.search).get('simulate');

async function connectPort(ctx) {
  const mode = simulate();
  const port = mode !== null ? simulatedPort({ lapMs: mode === 'fast' ? 2000 : 8000 }) : await /** @type {any} */ (navigator).serial.requestPort();
  await bridge?.close();
  const next = new Bridge({
    port,
    outbox: await openOutbox(),
    post: (decoderId, batch) => ctx.api('POST', `/decoders/${encodeURIComponent(decoderId)}/passings`, batch),
  });
  next.addEventListener('state', () => {
    // Not a TinyLap decoder: the bridge stops and lets go of the port.
    if (next.state === 'not-tinylap') void next.close();
    notify('state');
  });
  for (const type of ['outbox', 'online']) next.addEventListener(type, () => notify('live'));
  next.addEventListener('passing', (event) => {
    preview.unshift(/** @type {CustomEvent} */ (event).detail);
    preview.length = Math.min(preview.length, 20);
    notify('live');
  });
  if (!guarded) {
    guarded = true;
    window.addEventListener('beforeunload', (event) => {
      if (bridge && bridge.state === 'ready') event.preventDefault();
    });
  }
  // Set before start() so the events its first replies cause are drawn.
  bridge = next;
  try {
    await next.start();
  } catch (error) {
    await next.close();
    if (bridge === next) bridge = null;
    notify('state');
    throw error;
  }
}

export function mountBridge(root, ctx) {
  const section = h('section', { class: 'container stack-lg screen' });
  root.append(section);
  /** @type {(() => void) | null} */
  let liveUpdate = null;
  const error = h('p', { class: 'status status-error', role: 'alert', hidden: true });
  const ok = () => { error.hidden = true; };
  const fail = (caught) => {
    error.textContent = caught.message;
    error.hidden = false;
  };

  const connectButton = (label) => {
    const button = h('button', { type: 'button', class: 'btn btn-primary btn-lg' }, label);
    button.addEventListener('click', () => connectPort(ctx).then(ok, fail));
    return button;
  };

  function pairForm() {
    const name = /** @type {HTMLInputElement} */ (h('input', { type: 'text', name: 'name', value: 'Decoder', maxlength: '60', required: true }));
    const ssid = /** @type {HTMLInputElement} */ (h('input', { type: 'text', name: 'ssid', autocomplete: 'off' }));
    const password = /** @type {HTMLInputElement} */ (h('input', { type: 'password', name: 'password', autocomplete: 'off' }));
    const form = h('form', { class: 'card stack-md' },
      h('h2', { class: 'h3' }, 'Pair this decoder'),
      h('p', {}, 'It gets its own token for this workspace. Wi-Fi is optional: with it, the decoder also sends passings over the internet when the cable is out.'),
      h('label', { class: 'field' }, 'Decoder name', name),
      h('label', { class: 'field' }, 'Wi-Fi name (optional)', ssid),
      h('label', { class: 'field' }, 'Wi-Fi password', password),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Pair'));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const decoder = await ctx.api('POST', `/workspaces/${encodeURIComponent(ctx.workspaceId)}/decoders`, { name: name.value });
        await bridge.pair(decoder.id, decoder.token, ssid.value ? { ssid: ssid.value, password: password.value } : null);
        ok();
      } catch (caught) {
        fail(caught);
      }
    });
    return form;
  }

  /** The ready panel and a function that refreshes its parts in place. */
  function readyPanel() {
    const state = h('div', {});
    const text = h('p', { role: 'status' });
    const outbox = h('span', { class: 'bridge-outbox num' }, '…');
    const list = h('div', {});
    state.append(text, h('p', {}, 'Waiting to send: ', outbox));
    const update = () => {
      state.className = `bridge-state${bridge.online ? '' : ' is-offline'}`;
      text.textContent = bridge.online ? `Forwarding from decoder ${bridge.decoder}` : `Offline: passings wait here. ${bridge.lastError?.message ?? ''}`;
      void bridge.outbox.count().then((n) => { outbox.textContent = String(n); });
      list.replaceChildren(preview.length
        ? h('ol', { class: 'board-laps bridge-preview' }, preview.map((p) => h('li', {}, h('span', { class: 'num' }, p.transponder), h('span', { class: 'num' }, formatLap(p.lapMs)))))
        : h('p', { class: 'empty' }, 'Passings show up here the moment the decoder reports them.'));
    };
    update();
    liveUpdate = update;
    return h('div', { class: 'stack-md' }, state, h('h2', { class: 'h3' }, 'Straight from the cable'), list);
  }

  function draw() {
    liveUpdate = null;
    const supported = 'serial' in /** @type {any} */ (navigator) || simulate() !== null;
    let body;
    if (!supported) body = h('p', { class: 'status status-warning' }, 'The bridge needs Chrome or Edge on a laptop: it uses Web Serial to read the decoder over USB.');
    else if (!bridge) body = h('div', { class: 'stack-md' }, h('p', {}, 'Plug the decoder in by USB, then connect. Keep this tab open while racing.'), connectButton('Connect decoder'));
    else if (bridge.state === 'connecting' || bridge.state === 'idle') body = h('p', { role: 'status' }, 'Talking to the decoder…');
    else if (bridge.state === 'not-tinylap') body = h('div', { class: 'stack-md' }, h('p', { class: 'status status-error' }, "This device doesn't answer like a TinyLap decoder."), connectButton('Try another port'));
    else if (bridge.state === 'unpaired') body = pairForm();
    else if (bridge.state === 'ready') body = readyPanel();
    else body = h('div', { class: 'stack-md' }, h('p', { class: 'status status-warning' }, 'Decoder disconnected.'), connectButton('Connect again'));
    section.replaceChildren(h('h1', {}, 'Bridge'), body, error);
  }

  draw();
  const view = (kind) => (kind === 'state' ? draw() : liveUpdate?.());
  views.add(view);
  return () => {
    views.delete(view);
    section.remove();
  };
}
