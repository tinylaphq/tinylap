// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge (spec §6.5): the server renders every state; tl-bridge
// shows the one that applies. Without JavaScript or Web Serial, the page
// says what the bridge needs.
import { createHash } from 'node:crypto';
import { html, safe } from './html.js';
import { asset, layout } from './layout.js';

/** The import map the bridge's modules need, and its CSP hash. @param {any} request */
export function bridgeImportMap(request) {
  const text = JSON.stringify({ imports: { '@tinylap/timing': asset(request, 'pkg/timing/index.js') } });
  return { tag: html`<script type="importmap">${safe(text)}</script>\n`, hash: `sha256-${createHash('sha256').update(text).digest('base64')}` };
}

const connect = (label) => html`<button type="button" class="btn btn-primary btn-lg" data-bridge-connect>${label}</button>`;

/** @param {any} request @param {{ tag: unknown }} importMap */
export function bridgePage(request, importMap) {
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
    <p class="status status-warning" data-bridge-earlier hidden></p>
    <section data-bridge-state="unsupported" class="card-static stack-md">
      <p>The bridge reads the decoder over USB with Web Serial, which needs Chrome or Edge on a laptop, with JavaScript on.</p>
      <p>Timing still works without it: the decoder can send its passings over Wi-Fi (<a href="${base}/setup">Pair over Wi-Fi only</a> on Setup), and you can <a href="${base}/tap">tap laps by hand</a>.</p>
    </section>
    <section data-bridge-state="connect" hidden class="card-static stack-md">
      <p>Plug the decoder in by USB, then connect. Keep this tab open while racing; the board runs in any other tab or screen.</p>
      ${connect('Connect decoder')}
    </section>
    <section data-bridge-state="connecting" hidden class="card-static"><p>Talking to the decoder…</p></section>
    <section data-bridge-state="not-tinylap" hidden class="card-static stack-md">
      <p class="status status-error">This device doesn't answer like a TinyLap decoder.</p>
      ${connect('Try another port')}
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
      ${connect('Connect again')}
    </section>
    <p class="status status-error" role="alert" data-bridge-error hidden></p>
  </div>
  </tl-bridge>
</div>`,
  });
}
