// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge (spec §6.5): the server renders every state, for both pickers;
// tl-bridge shows the one that applies. Without JavaScript, or without Web
// Serial and WebHID, the page says what the bridge needs.
import { createHash } from 'node:crypto';
import { html, safe } from './html.js';
import { selectField, textField } from './form-parts.js';
import { asset, layout } from './layout.js';

/** The import map the bridge's modules need, and its CSP hash. @param {any} request */
export function bridgeImportMap(request) {
  const text = JSON.stringify({ imports: { '@tinylap/timing': asset(request, 'pkg/timing/index.js') } });
  return { tag: html`<script type="importmap">${safe(text)}</script>\n`, hash: `sha256-${createHash('sha256').update(text).digest('base64')}` };
}

/** @param {string} label @param {'serial' | 'hid' | 'last'} which @param {string} [style] */
const connect = (label, which, style = 'btn-primary') => html`<button type="button" class="btn ${style} btn-lg" data-bridge-connect="${which}">${label}</button>`;

/**
 * @param {any} request @param {{ tag: unknown }} importMap @param {{ id: string, name: string }[]} [decoders] the decoders a device may be chosen as
 * @param {string[]} [known] every decoder's id, choosable or not, so tl-bridge can tell when one was made since this render
 */
export function bridgePage(request, importMap, decoders = [], known = decoders.map((d) => d.id)) {
  const base = request.space.base;
  const where = request.space.kind === 'personal' ? 'your personal space' : 'this club';
  return layout(request, {
    title: 'Bridge',
    screen: 'bridge',
    importMap: importMap.tag,
    scripts: ['elements/bridge.js'],
    body: html`<div class="container stack-lg screen">
  <h1>Bridge</h1>
  <tl-bridge>
  <div id="bridge" data-workspace="${request.workspaceId}">
    <p class="visually-hidden" role="status" data-bridge-live></p>
    <p class="status status-error" role="alert" data-bridge-error hidden></p>
    <p class="status status-warning" data-bridge-earlier hidden></p>
    <template data-bridge-sign-in><a href="/auth/login?${new URLSearchParams({ returnTo: `${base}/bridge` })}">Sign in again</a> to send them.</template>
    <section data-bridge-state="unsupported" class="card-static stack-md">
      <p>The bridge needs Chrome or Edge on a laptop, with JavaScript on: it reads the decoder over USB with Web Serial, or an EasyLap with WebHID.</p>
      <p>Timing still works without it: the decoder can send its passings over Wi-Fi (<a href="${base}/setup">Pair over Wi-Fi only</a> on Setup), and you can <a href="${base}/tap">tap laps by hand</a>.</p>
    </section>
    <section data-bridge-state="connect" hidden class="card-static stack-md">
      <p>Plug the decoder in by USB, then connect. Keep this tab open while racing; the board runs in any other tab or screen.</p>
      <p>${connect('Connect decoder', 'serial')} ${connect('Connect EasyLap', 'hid', 'btn-secondary')}</p>
      <p>An EasyLap? Use Connect EasyLap: it doesn't show up in the decoder list.</p>
      <p class="status status-warning" data-bridge-missing="serial" hidden>This browser can't reach USB decoders, only an EasyLap.</p>
      <p class="status status-warning" data-bridge-missing="hid" hidden>This browser can't reach an EasyLap, only other USB decoders.</p>
      <p class="status status-warning" data-bridge-taken hidden>This decoder is connected in another tab.</p>
    </section>
    <section data-bridge-state="connecting" hidden class="card-static"><p>Talking to the decoder…</p></section>
    <section data-bridge-state="listening" hidden class="card-static stack-md">
      <p class="status status-warning" data-bridge-listening>Connected, but nothing has come from this device yet.</p>
      <p class="status status-warning" data-bridge-unreadable hidden>Data is coming, but it can't be read. Report this device.</p>
      <p>A decoder answers within a few seconds. If this is the wrong device, try another.</p>
      ${connect('Try another device', 'last')}
    </section>
    <section data-bridge-state="unpaired" hidden class="card-static stack-md">
      <h2 class="h3">Pair this decoder</h2>
      <p>It gets its own token for ${where}. Wi-Fi is optional: with it, the decoder also sends passings over the internet when the cable is out.</p>
      <form data-bridge-pair class="stack-sm">
        <div class="field"><label for="bridge-name">Decoder name</label><input type="text" id="bridge-name" name="name" value="Decoder" maxlength="60" required></div>
        <div class="field"><label for="bridge-ssid">Wi-Fi name (optional)</label><input type="text" id="bridge-ssid" name="ssid" autocomplete="off"></div>
        <div class="field"><label for="bridge-password">Wi-Fi password</label><input type="password" id="bridge-password" name="password" autocomplete="off"></div>
        <button type="submit" class="btn btn-primary">Pair</button>
      </form>
    </section>
    <section data-bridge-state="unknown" hidden class="card-static stack-md">
      <p class="status status-warning" data-bridge-unknown>This decoder's pairing isn't known here. Its passings before you pair it again weren't recorded.</p>
      <p>Its decoder may have been deleted, or it was paired with another TinyLap server. Pairing again makes a new decoder for ${where} and sends its token to the device over this cable.</p>
      <form data-bridge-repair class="stack-sm">
        <div class="field"><label for="bridge-repair-name">Name for this decoder</label><input type="text" id="bridge-repair-name" name="name" value="Decoder" maxlength="60" required></div>
        <button type="submit" class="btn btn-primary">Pair again</button>
      </form>
    </section>
    <section data-bridge-state="choose" hidden class="card-static stack-md">
      <h2 class="h3" tabindex="-1" data-bridge-choose-heading>Which decoder is this?</h2>
      <p data-bridge-kind data-where="${where}"></p>
      <p>If it comes unplugged, crossings until you connect again are lost, and each car's lap starts over.</p>
      <form data-bridge-choose class="stack-sm">
        ${selectField({ label: 'Decoder', name: 'decoder', id: 'bridge-choose', value: '', data: { known: known.join(' ') },
          hint: 'Choose an existing decoder only if it is this same device. A decoder that another laptop uses needs its own.',
          options: [...decoders.map((d) => ({ value: d.id, label: d.name, dataName: d.name })), { value: '', label: 'A new decoder' }] })}
        ${textField({ label: 'Name for the new decoder', name: 'name', id: 'bridge-choose-name', maxlength: 60 })}
        <button type="submit" class="btn btn-primary">Use this decoder</button>
      </form>
    </section>
    <section data-bridge-state="ready" hidden class="stack-md">
      <div class="bridge-state" data-bridge-status-box>
        <p data-bridge-status></p>
        <p class="bridge-stat"><span class="bridge-stat-label">Waiting to send</span><span class="bridge-outbox num" data-bridge-outbox>…</span></p>
      </div>
      <p class="status status-error" role="alert" data-bridge-refused hidden></p>
      <h2 class="h3">Straight from the cable</h2>
      <div class="bridge-preview">
        <p class="bridge-head"><span>Transponder</span><span>Lap</span></p>
        <ol class="board-laps" data-bridge-preview></ol>
        <template data-bridge-row="first"><li><span class="bridge-code"></span><span class="bridge-first">first pass</span></li></template>
        <template data-bridge-row="lap"><li><span class="bridge-code"></span><span class="num"></span></li></template>
      </div>
      <p class="empty" data-bridge-preview-empty>Passings show up here the moment the decoder reports them.</p>
    </section>
    <section data-bridge-state="disconnected" hidden class="card-static stack-md">
      <p class="status status-warning">Decoder disconnected.</p>
      <p data-bridge-gap hidden>Crossings while it is unplugged are lost, and each car's lap starts over when you connect again.</p>
      ${connect('Connect again', 'last')}
    </section>
  </div>
  </tl-bridge>
</div>`,
  });
}
