// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge (spec §6.5): the server renders every state, for both pickers;
// tl-bridge shows the one that applies. Without JavaScript, or without Web
// Serial and WebHID, the page says what the bridge needs.
import { createHash, randomBytes } from 'node:crypto';
import { formatAgo } from '@tinylap/design/format-ago.js';
import { formatWhen } from '../../public/format.js';
import { html, safe } from './html.js';
import { selectField, textField } from './form-parts.js';
import { asset, layout } from './layout.js';

/** The import map the bridge's modules need, and its CSP hash. @param {any} request */
export function bridgeImportMap(request) {
  const text = JSON.stringify({ imports: { '@tinylap/timing': asset(request, 'pkg/timing/index.js') } });
  return { tag: html`<script type="importmap">${safe(text)}</script>\n`, hash: `sha256-${createHash('sha256').update(text).digest('base64')}` };
}

// In the pair, re-pair and choose steps: a wrong port is never a trap (connections spec §2).
const anotherDevice = html`<p><button type="button" class="btn btn-outline" data-bridge-connect="last">Try another device</button></p>`;

/** @param {string} label @param {'serial' | 'hid' | 'last'} which @param {string} [style] */
const connect = (label, which, style = 'btn-primary') => html`<button type="button" class="btn ${style} btn-lg" data-bridge-connect="${which}">${label}</button>`;

// The lamps' icons, with every part a state needs; CSS shows them per the lamp's
// data-state (and data-signal), as SOUND_ICON does (connections spec §2).
const PLUG_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 2.5h14"/>'
  + '<g class="plug"><path d="M9.5 3v4.5M14.5 3v4.5"/><rect class="plug-body" x="7" y="7.5" width="10" height="7" rx="1"/><path d="M12 14.5v6"/></g></svg>';
const WIFI_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
  + '<path class="wifi-arc wifi-a1" d="M8.6 15.6a4.8 4.8 0 0 1 6.8 0"/><path class="wifi-arc wifi-a2" d="M5.4 12.4a9.3 9.3 0 0 1 13.2 0"/>'
  + '<path class="wifi-arc wifi-a3" d="M2.2 9.2a13.8 13.8 0 0 1 19.6 0"/><circle class="wifi-dot" cx="12" cy="19.2" r="1.6"/></svg>';
const BARS_ICON = '<svg class="bars" viewBox="0 0 16 14" aria-hidden="true" focusable="false">'
  + '<rect x="0" y="9" width="4" height="5"/><rect x="6" y="5" width="4" height="9"/><rect x="12" y="0" width="4" height="14"/></svg>';
const CHEVRON_ICON = '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6 3l5 5-5 5"/></svg>';

/** A lamp: a fixed square, its state in colour and icon shape; the row's words say it too. @param {string} state @param {string} icon */
const lamp = (state, icon) => html`<span class="lamp" data-state="${state}">${safe(icon)}</span>`;

/** A time the browser formats in its own time zone (tl-bridge); the server's words until then. @param {any} request @param {number} at */
const when = (request, at) => html`<time datetime="${new Date(at).toISOString()}" data-when>${formatAgo(at, request.now())}</time>`;
/** The same, with the time of day as the server's zone has it ("since 2 min ago" doesn't read). @param {any} request @param {number} at */
const clock = (request, at) => html`<time datetime="${new Date(at).toISOString()}" data-when>${formatWhen(at, request.now())}</time>`;

/** One connection: lamp, name, state, one line of help, at most one action. */
const connectionRow = ({ which, name, state, icon, words, detail, action, notes = null }) => html`<li class="decoder-row" data-row="${which}">
          ${lamp(state, icon)}
          <div class="decoder-row-text"><p class="decoder-row-name">${name}</p><p class="decoder-row-state" data-slot="state">${words}</p><p class="decoder-row-help" data-slot="detail">${detail}</p>${notes}</div>
          <div class="decoder-row-action" data-slot="action">${action}</div>
        </li>`;

const WIFI_ROW = {
  reporting: { state: 'ok', words: () => 'Reporting', detail: (request, at) => (at === null ? null : html`Last heard ${when(request, at)}.`) },
  idle: { state: 'idle', words: () => 'Idle', detail: () => 'Wakes up with the next lap.' },
  // The status line already says when it was last heard: the row doesn't say it again.
  offline: { state: 'fail', words: (request, at) => (at === null ? 'Not reporting' : html`Not reporting since ${clock(request, at)}`), detail: () => null },
  unknown: { state: 'unknown', words: () => null, detail: () => 'Connect the cable to see its Wi-Fi.' },
};

// What the Cable row says after this tab's cable to the decoder was pulled; tl-bridge shows them (connections spec §2).
const CABLE_NOTES = html`<p class="decoder-row-help" data-cable-note="back" hidden>It reconnects when you plug it back in.</p><p class="decoder-row-help" data-cable-note="gap" hidden>Crossings while it is unplugged are lost, and each car's lap starts over when you connect again.</p>`;

/** A decoder's card, as the server knows it: no cable on this tab (connections spec §3). @param {any} request @param {boolean} mayPair */
function decoderCard(request, d, mayPair) {
  const viaCable = d.cable.state === 'other';
  const viaWifi = d.wifi.state === 'reporting' || d.wifi.state === 'idle';
  const status = viaCable || viaWifi
    ? html`<div class="status status-success" data-slot="status"><p>Laps get through over ${viaCable && viaWifi ? 'the cable and Wi-Fi' : viaCable ? 'the cable' : 'Wi-Fi'}.</p></div>`
    : html`<div class="status status-warning" data-slot="status"><p>If it's on, its laps wait on it. Connect the cable to see why.</p><p>${d.lastSeenAt ? html`Last heard ${when(request, d.lastSeenAt)}.` : 'Never heard.'}</p></div>`;
  // Every card can connect: "another laptop" may be this one a moment ago (a reload, another tab).
  const action = html`<button type="button" class="btn btn-sm ${viaCable || viaWifi ? 'btn-outline' : 'btn-primary'}" data-bridge-connect="serial">Connect decoder</button>`;
  const cable = viaCable
    ? { state: 'ok', words: 'Connected on another laptop', detail: null, action }
    : { state: 'off', words: 'Not connected', detail: viaWifi ? 'Not needed while Wi-Fi works.' : 'Plug the decoder in by USB, then connect it.', action };
  const wifi = WIFI_ROW[d.wifi.state] ?? WIFI_ROW.unknown;
  // Unknown already says to connect the cable; the others say it under their state.
  const hint = d.wifi.state in WIFI_ROW && d.wifi.state !== 'unknown'
    ? html`<p class="decoder-row-help">${mayPair ? 'Connect the cable to see and change its Wi-Fi.' : 'Connect the cable to see its Wi-Fi.'}</p>`
    : null;
  const change = mayPair ? html`<button type="button" class="btn btn-sm btn-outline" data-bridge-wifi hidden>Change Wi-Fi</button>` : null;
  return html`<section class="card-static decoder-card" data-decoder="${d.id}">
      <h2 class="h3 cut-words" data-slot="name">${d.name}</h2>
      ${status}
      <ul class="decoder-rows">
        ${connectionRow({ which: 'cable', name: 'Cable', icon: PLUG_ICON, ...cable, notes: CABLE_NOTES })}
        ${connectionRow({ which: 'wifi', name: 'Wi-Fi', icon: WIFI_ICON, state: wifi.state, words: wifi.words(request, d.wifi.at), detail: wifi.detail(request, d.wifi.at), action: html`${hint}${change}` })}
      </ul>
    </section>`;
}

/*
 * The decoder cards (connections spec §2, §3): every decoder of the club, by
 * name, as the server knows it, which is never this tab's cable. tl-bridge
 * swaps in each #bridge-decoders its stream sends (#bridge's
 * data-cable-stream, with {id}, while a decoder is on this tab's cable;
 * data-cards-stream otherwise; both with ?page= and #bridge's data-page,
 * this render's own id), and overlays what this tab's cable says.
 * Its hooks:
 * - section[data-decoder="<id>"]: one card; [data-slot="name"] its name,
 *   [data-slot="status"] the status line (.status-success or .status-warning,
 *   one <p> per sentence).
 * - li[data-row="cable" | "wifi"]: a connection. Its .lamp carries data-state
 *   (ok | busy | fail | idle | unknown | off) and, for Wi-Fi, data-signal
 *   (strong | fair | weak); [data-slot="state"] the state in words (bold),
 *   [data-slot="detail"] one line of help (an empty one takes no room),
 *   [data-slot="action"] at most one action.
 * - [data-bridge-connect="serial"]: Connect decoder, in the Cable row.
 * - [data-cable-note="back" | "gap"] (hidden), in the Cable row: shown for the
 *   decoder this tab had when its cable was pulled: it reconnects on its own,
 *   and (no Wi-Fi) its crossings meanwhile are lost.
 * - [data-bridge-wifi]: Change Wi-Fi, hidden, in the Wi-Fi row, for members
 *   who may pair (timing.setup) only; shown while this decoder is on this
 *   tab's cable (named Set up Wi-Fi when it has none), with the help line
 *   before it dropped. It opens #wifi-dialog.
 * - time[data-when]: a time, with the server's "2 min ago" (or, after "since",
 *   its time of day) until the browser writes it in its own time zone (today
 *   the time; otherwise weekday or date).
 * A plain ZRound decoder or EasyLap has no Wi-Fi: remove its Wi-Fi row once
 * the cable shows what it is.
 */
/** @param {any} request @param {any[]} rows engine.connectionsOf's @param {{ mayPair?: boolean }} [options] */
export function decoderCards(request, rows, { mayPair = false } = {}) {
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
  return html`<div id="bridge-decoders">
    ${sorted.length > 0
    ? sorted.map((d) => decoderCard(request, d, mayPair))
    : html`<section class="card-static decoder-empty">
      <p>No decoder yet. Plug one in by USB, then connect it to pair it.</p>
      <p><button type="button" class="btn btn-primary" data-bridge-connect="serial">Connect decoder</button></p>
    </section>`}
  </div>`;
}

/** A password field with its Show button inside it (palace's .input-action). */
const passwordField = ({ id, hint = null }) => html`<div class="field">
            <label for="${id}">Password</label>
            <div class="input-action"><input type="password" id="${id}" name="password" autocomplete="off" spellcheck="false"${hint ? html` aria-describedby="${id}-hint"` : null}><button type="button" class="btn btn-sm btn-outline" data-wifi-show aria-controls="${id}" aria-label="Show password">Show</button></div>
            ${hint ? html`<p class="field-hint" id="${id}-hint">${hint}</p>` : null}
          </div>`;

/** A step's footer: its way back or aside on the left, its way on on the right, every button one size. @param {unknown} start @param {unknown} [end] */
const menu = (start, end = null) => html`<menu class="wifi-menu">${start ? html`<li>${start}</li>` : null}${end ? html`<li class="wifi-menu-end">${end}</li>` : null}</menu>`;
/** @param {string} label @param {string} action */
const outline = (label, action) => html`<button type="button" class="btn btn-outline" data-wifi-action="${action}">${label}</button>`;

/*
 * The Change Wi-Fi dialog (connections spec §5), closed; tl-bridge opens it
 * with showModal() and shows one [data-step] at a time, each with its own
 * heading (wifi-title-<step>: point aria-labelledby at the shown one). Text
 * the client fills: [data-slot="decoder"] the decoder's name,
 * [data-slot="network"] the network's name, [data-slot="signal"] strong |
 * fair | weak. Buttons: [data-wifi-action="cancel" | "again" | "another" |
 * "back" | "done"], the forms [data-wifi-form="password" | "another"] (submit
 * is Join network; method="dialog", so nothing ever reaches a URL), [data-wifi-show] the Show/Hide button (text and
 * aria-label change together). The list: ul[data-slot="networks"] takes
 * clones of template[data-wifi-row], whose button.net carries data-signal and
 * holds [data-slot="name"], [data-slot="note"] (Current network or Open,
 * hidden when neither) and [data-slot="signal"] (Strong, Fair, Weak). The
 * password and another-network steps' [data-slot="error"] (hidden) take a refusal. The result
 * step has [data-result="joined"] and [data-result="timeout"], both hidden.
 * The list step's [data-scan="empty"] and [data-scan="failed"] (hidden) say
 * that a scan found nothing or couldn't run. showModal() makes the page
 * outside the dialog inert, so the dialog has its own live region
 * ([data-wifi-live]): announce each step's state there while it is open.
 */
export function wifiDialog() {
  const decoder = html`<span data-slot="decoder"></span>`;
  const network = html`<span data-slot="network"></span>`;
  const busy = (text) => html`<div class="wifi-state">${lamp('busy', WIFI_ICON)}<p class="decoder-row-state">${text}</p></div>`;
  return html`<dialog id="wifi-dialog" class="wifi-dialog" aria-labelledby="wifi-title-looking">
    <p class="visually-hidden" role="status" data-wifi-live></p>
    <section class="wifi-step" data-step="looking" hidden>
      <h2 id="wifi-title-looking">Change Wi-Fi</h2>
      <p class="subtitle">${decoder}</p>
      ${busy('Looking for networks near the decoder…')}
      ${menu(null, outline('Cancel', 'cancel'))}
    </section>
    <section class="wifi-step" data-step="list" hidden>
      <h2 id="wifi-title-list">Change Wi-Fi</h2>
      <p class="subtitle">${decoder}</p>
      <div class="nets">
        <div class="nets-head"><h3 class="nets-title" id="wifi-nets-title">Networks near the decoder</h3><button type="button" class="btn btn-sm btn-outline" data-wifi-action="again">Look again</button></div>
        <p class="status status-error" role="alert" data-scan="failed" hidden>The decoder couldn't look for networks. Look again.</p>
        <p class="wifi-empty" data-scan="empty" hidden>No networks near the decoder. Look again, or enter another network.</p>
        <ul class="nets-list" data-slot="networks" aria-labelledby="wifi-nets-title"></ul>
        <template data-wifi-row><li><button type="button" class="net" data-signal=""><span class="net-name"><span data-slot="name"></span><span class="net-note" data-slot="note" hidden></span></span><span class="net-meta"><span data-slot="signal"></span>${safe(BARS_ICON)}</span>${safe(CHEVRON_ICON)}</button></li></template>
        <div class="wifi-notes"><p class="wifi-hint">Only 2.4 GHz networks show here.</p><p class="wifi-hint">TinyLap never sees the password: it goes from this laptop straight to the decoder.</p></div>
      </div>
      ${menu(outline('Another network…', 'another'), outline('Cancel', 'cancel'))}
    </section>
    <form class="wifi-step" data-step="password" data-wifi-form="password" method="dialog" hidden>
      <h2 id="wifi-title-password" class="cut-words">${network}</h2>
      <p class="subtitle">Signal <span data-slot="signal"></span></p>
      <p class="status status-error" role="alert" data-slot="error" hidden></p>
      ${passwordField({ id: 'wifi-password' })}
      ${menu(outline('Back to the list', 'back'), html`<button type="submit" class="btn btn-primary">Join network</button>`)}
    </form>
    <form class="wifi-step" data-step="another" data-wifi-form="another" method="dialog" hidden>
      <h2 id="wifi-title-another">Another network</h2>
      <p class="subtitle">Wi-Fi for ${decoder}</p>
      <p class="status status-error" role="alert" data-slot="error" hidden></p>
      <div class="field">
        <label for="wifi-another-name">Network name</label>
        <input type="text" id="wifi-another-name" name="ssid" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="wifi-another-name-hint">
        <p class="field-hint" id="wifi-another-name-hint">Exactly as it is written, capitals included.</p>
      </div>
      ${passwordField({ id: 'wifi-another-password', hint: 'Leave empty for an open network.' })}
      ${menu(outline('Back', 'back'), html`<button type="submit" class="btn btn-primary">Join network</button>`)}
    </form>
    <section class="wifi-step" data-step="joining" hidden>
      <h2 id="wifi-title-joining" class="cut-words">${network}</h2>
      <p class="subtitle">Wi-Fi for ${decoder}</p>
      ${busy(html`Joining “${network}”…`)}
      ${menu(null, outline('Cancel', 'cancel'))}
    </section>
    <section class="wifi-step" data-step="result" hidden>
      <h2 id="wifi-title-result" class="cut-words">${network}</h2>
      <p class="subtitle">Wi-Fi for ${decoder}</p>
      <div class="wifi-state" data-result="joined" hidden>${lamp('ok', WIFI_ICON)}<div><p class="decoder-row-state">Joined “${network}”</p><p class="decoder-row-help">Signal <span data-slot="signal"></span>. Laps now also get through over Wi-Fi.</p></div></div>
      <div class="wifi-state" data-result="timeout" hidden>${lamp('fail', WIFI_ICON)}<p class="decoder-row-state">The decoder didn't answer</p></div>
      ${menu(null, html`<button type="button" class="btn btn-primary" data-wifi-action="done">Done</button>`)}
    </section>
  </dialog>`;
}

/**
 * @param {any} request @param {{ tag: unknown }} importMap @param {{ id: string, name: string }[]} [decoders] the decoders a device may be chosen as
 * @param {string[]} [known] every decoder's id, choosable or not, so tl-bridge can tell when one was made since this render
 * @param {{ connections?: any[], mayPair?: boolean }} [cards] every decoder's connections (engine.connectionsOf), and whether the member may pair
 */
export function bridgePage(request, importMap, decoders = [], known = decoders.map((d) => d.id), { connections = [], mayPair = false } = {}) {
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
  <div id="bridge" data-workspace="${request.workspaceId}" data-server="${request.origin}" data-cable-stream="${base}/decoders/{id}/cable" data-cards-stream="${base}/bridge/events" data-page="${randomBytes(12).toString('base64url')}">
    <p class="visually-hidden" role="status" data-bridge-live></p>
    <p class="status status-error" role="alert" data-bridge-error hidden></p>
    <p hidden data-bridge-say="disconnected">Decoder disconnected.</p>
    <p class="status status-warning" data-bridge-earlier hidden></p>
    <template data-bridge-sign-in><a href="/auth/login?${new URLSearchParams({ returnTo: `${base}/bridge` })}">Sign in again</a> to send them.</template>
    <section data-bridge-state="unsupported" class="card-static stack-md">
      <p>The bridge needs Chrome or Edge on a laptop, with JavaScript on: it reads the decoder over USB with Web Serial, or an EasyLap with WebHID.</p>
      <p>Timing still works without it: the decoder can send its passings over Wi-Fi (<a href="${base}/setup">Pair over Wi-Fi only</a> on Setup), and you can <a href="${base}/tap">tap laps by hand</a>.</p>
    </section>
    ${decoderCards(request, connections, { mayPair })}
    <section data-bridge-state="connect" hidden class="bridge-more stack-sm">
      <p>Keep this tab open while racing; the board runs in any other tab or screen.</p>
      <p>An EasyLap? Use Connect EasyLap: it doesn't show up in the decoder list.</p>
      <p><button type="button" class="btn btn-outline" data-bridge-connect="hid">Connect EasyLap</button></p>
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
      ${anotherDevice}
    </section>
    <section data-bridge-state="unknown" hidden class="card-static stack-md">
      <p class="status status-warning" data-bridge-unknown>This decoder's pairing isn't known here. Its passings before you pair it again weren't recorded.</p>
      <p>Its decoder may have been deleted, or it was paired with another TinyLap server. Pairing again makes a new decoder for ${where} and sends its token to the device over this cable.</p>
      <form data-bridge-repair class="stack-sm">
        <div class="field"><label for="bridge-repair-name">Name for this decoder</label><input type="text" id="bridge-repair-name" name="name" value="Decoder" maxlength="60" required></div>
        <button type="submit" class="btn btn-primary">Pair again</button>
      </form>
      ${anotherDevice}
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
      ${anotherDevice}
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
    ${wifiDialog()}
  </div>
  </tl-bridge>
</div>`,
  });
}
