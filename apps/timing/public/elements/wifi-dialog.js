// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Change Wi-Fi dialog (connections spec §5), driven by tl-bridge: the
// server renders #wifi-dialog with every step hidden; this shows one step at
// a time, fills the slots, and clones the server's row template for each
// network. It talks to the decoder through the bridge on this tab's cable:
// %TLSCAN on open and on Look again, %TLJOIN for a try (connections spec §4).
// - Picking an open network skips the password.
// - A try that fails comes back to the password, kept and focused, with the
//   reason on top; one the decoder never answers ends on "didn't answer".
// - Cancel during a try waits for the decoder's answer, then closes: the
//   board is never left half-way (spec §4.3).
// - Closing clears both passwords and gives focus back to the card's button
//   (or the card's name, when the cable was pulled and the button is gone).
// - showModal() makes the page outside inert, so while it is open the dialog
//   speaks through its own live region ([data-wifi-live]).
import { signalWord } from '@tinylap/timing';

const quoted = (name) => `“${name}”`;
const capital = (word) => word[0].toUpperCase() + word.slice(1);

/**
 * @typedef {{ name: string, signal: number | null, open: boolean }} Network
 * @typedef {{ bridge: () => import('../bridge.js').Bridge | null, announce: (text: string) => void,
 *   refocus: (decoderId: string) => void, problem: (ssid: string, password: string) => { field: 'ssid' | 'password', text: string } | null }} Host
 */
export class WifiWizard {
  /** Bumped by every open, look and close: an answer for an older one changes nothing. */
  #token = 0;
  /** @type {Network[]} */ #networks = [];
  /** @type {Network | null} */ #chosen = null;
  #joining = false;
  #closeAfterJoin = false;
  /** @type {string | null} */ decoder = null;

  /** @param {HTMLDialogElement} dialog @param {Host} host */
  constructor(dialog, host) {
    this.dialog = dialog;
    this.host = host;
    dialog.addEventListener('cancel', this);
    dialog.addEventListener('close', this);
  }

  stop() {
    this.dialog.removeEventListener('cancel', this);
    this.dialog.removeEventListener('close', this);
    if (this.dialog.open) this.dialog.close();
    this.#cleanUp();
  }

  /** @param {string} selector */
  $(selector) { return /** @type {HTMLElement} */ (this.dialog.querySelector(selector)); }

  /** Says it once: in the dialog's own live region while it is open, the page's otherwise. @param {string} text */
  #say(text) {
    const live = this.dialog.open ? this.dialog.querySelector('[data-wifi-live]') : null;
    if (!live) return this.host.announce(text);
    if (live.textContent !== text) live.textContent = text;
    return undefined;
  }

  /** @param {string} slot @param {string} text */
  #fill(slot, text) {
    for (const el of this.dialog.querySelectorAll(`[data-slot="${slot}"]`)) el.textContent = text;
  }

  /** Opens it for the decoder on the cable. @param {string} decoderId @param {string} name @param {string} title Change Wi-Fi or Set up Wi-Fi */
  open(decoderId, name, title) {
    this.#cleanUp();
    this.decoder = decoderId;
    this.#fill('decoder', name);
    this.$('#wifi-title-looking').textContent = title;
    this.$('#wifi-title-list').textContent = title;
    this.dialog.showModal();
    void this.#look();
  }

  close() {
    if (this.dialog.open) this.dialog.close();
  }

  /** @param {Event} event */
  handleEvent(event) {
    if (event.type === 'cancel' && this.#joining) {
      // Escape during a try: as Cancel, it closes once the decoder answers.
      event.preventDefault();
      this.#cancel();
    } else if (event.type === 'close') {
      const decoder = this.decoder;
      this.#cleanUp();
      if (decoder) this.host.refocus(decoder);
    }
  }

  /** A click inside the dialog (tl-bridge passes them on). @param {MouseEvent} event */
  click(event) {
    const target = event.target instanceof Element ? event.target : null;
    const show = target?.closest('[data-wifi-show]');
    if (show instanceof HTMLButtonElement) return this.#toggle(show);
    const net = target?.closest('button.net');
    if (net instanceof HTMLButtonElement) return this.#pick(this.#networks[Number(net.dataset.index)]);
    const action = target?.closest('[data-wifi-action]');
    if (!(action instanceof HTMLElement)) return undefined;
    switch (action.dataset.wifiAction) {
      case 'cancel': return this.#cancel();
      case 'again': return void this.#look();
      case 'another': return this.#show('another');
      case 'back': return this.#show('list');
      case 'done': return this.close();
      default: return undefined;
    }
  }

  /** A submit of one of its forms: Join network. Never the dialog's own close. @param {SubmitEvent} event */
  submit(event) {
    const form = /** @type {HTMLFormElement} */ (event.target);
    event.preventDefault();
    if (this.#joining) return;
    const field = (name) => /** @type {HTMLInputElement} */ (form.elements.namedItem(name));
    const password = field('password').value;
    if (form.dataset.wifiForm === 'another') {
      const name = field('ssid').value;
      if (!name.trim()) return this.#refuse(field('ssid'), "Enter the network's name.");
      const wrong = this.host.problem(name, password);
      if (wrong) return this.#refuse(field(wrong.field), wrong.text);
      const seen = this.#networks.find((n) => n.name === name);
      this.#chosen = { name, signal: seen?.signal ?? null, open: password === '' };
    }
    const chosen = /** @type {Network} */ (this.#chosen);
    if (form.dataset.wifiForm === 'password') {
      // A locked network can't be joined without its password: no 20 s try that can't work.
      if (!chosen.open && password === '') return this.#refuse(field('password'), `Enter the password of ${quoted(chosen.name)}.`);
      const wrong = this.host.problem(chosen.name, password);
      if (wrong) return this.#refuse(field('password'), wrong.text);
    }
    return void this.#join(password);
  }

  /** Any edit settles a field's check: Join network checks again. @param {Event} event */
  input(event) {
    if (event.target instanceof HTMLInputElement) event.target.setCustomValidity('');
  }

  /** @param {HTMLInputElement} field @param {string} text */
  #refuse(field, text) {
    field.setCustomValidity(text);
    field.reportValidity();
  }

  /** @param {HTMLButtonElement} button */
  #toggle(button) {
    const input = /** @type {HTMLInputElement} */ (this.dialog.querySelector(`#${button.getAttribute('aria-controls')}`));
    const shown = input.type === 'password';
    input.type = shown ? 'text' : 'password';
    // The visible text and the accessible name change together (spec §5), so no aria-pressed.
    button.textContent = shown ? 'Hide' : 'Show';
    button.setAttribute('aria-label', shown ? 'Hide password' : 'Show password');
  }

  /** Shows one step, names the dialog by its heading, says it once, and puts focus in it. @param {string} step @param {string} [said] */
  #show(step, said) {
    for (const section of /** @type {NodeListOf<HTMLElement>} */ (this.dialog.querySelectorAll('[data-step]'))) section.hidden = section.dataset.step !== step;
    this.dialog.setAttribute('aria-labelledby', `wifi-title-${step}`);
    const name = this.#chosen ? quoted(this.#chosen.name) : '';
    const n = this.#networks.length;
    const words = {
      looking: 'Looking for networks near the decoder…',
      list: n === 0 ? 'No networks near the decoder. Look again, or enter another network.' : `${n} ${n === 1 ? 'network' : 'networks'} near the decoder.`,
      password: `Password for ${name}.`,
      another: 'Another network: its name and password.',
      joining: `Joining ${name}…`,
    };
    this.#say(said ?? words[step] ?? '');
    const focus = {
      looking: '[data-step="looking"] [data-wifi-action="cancel"]',
      list: this.#networks.length ? '[data-step="list"] button.net' : '[data-step="list"] [data-wifi-action="again"]',
      password: '#wifi-password',
      another: '#wifi-another-name',
      joining: '[data-step="joining"] [data-wifi-action="cancel"]',
      result: '[data-wifi-action="done"]',
    }[step];
    /** @type {HTMLElement | null} */ (this.dialog.querySelector(focus))?.focus();
  }

  /** Step 1, then 2: the decoder scans, and the list shows what it found, strongest first. */
  async #look() {
    const token = ++this.#token;
    this.#show('looking');
    /** @type {Network[]} */
    let found = [];
    let failed = false;
    try {
      const bridge = this.host.bridge();
      if (!bridge) throw new Error('The decoder is disconnected.');
      found = await bridge.scan();
    } catch {
      // A %TLERR scan, no answer, or no decoder: the list says the scan couldn't run, not that it found nothing.
      failed = true;
    }
    if (token !== this.#token || !this.dialog.open) return;
    this.#networks = [...found].sort((a, b) => (b.signal ?? 0) - (a.signal ?? 0));
    const net = this.host.bridge()?.net;
    const current = net && net.state !== 'off' ? net.name : null;
    const row = /** @type {HTMLTemplateElement} */ (this.$('template[data-wifi-row]')).content.firstElementChild;
    this.$('[data-slot="networks"]').replaceChildren(...this.#networks.map((n, i) => {
      const li = /** @type {HTMLElement} */ (row.cloneNode(true));
      const button = /** @type {HTMLButtonElement} */ (li.querySelector('button.net'));
      const word = signalWord(n.signal ?? -100);
      button.dataset.index = String(i);
      button.dataset.signal = word;
      /** @type {HTMLElement} */ (li.querySelector('[data-slot="name"]')).textContent = n.name;
      /** @type {HTMLElement} */ (li.querySelector('[data-slot="signal"]')).textContent = capital(word);
      const note = /** @type {HTMLElement} */ (li.querySelector('[data-slot="note"]'));
      note.textContent = n.name === current ? 'Current network' : n.open ? 'Open' : '';
      note.hidden = note.textContent === '';
      return li;
    }));
    this.$('[data-slot="networks"]').hidden = this.#networks.length === 0;
    const failure = this.$('[data-scan="failed"]');
    failure.hidden = !failed;
    this.$('[data-scan="empty"]').hidden = failed || this.#networks.length > 0;
    // A failure is said by its own alert; the status region stays quiet, so it isn't said twice.
    this.#show('list', failed ? '' : undefined);
  }

  /** A network from the list: its password, or straight to the try for an open one. @param {Network | undefined} network */
  #pick(network) {
    if (!network) return;
    this.#chosen = network;
    if (network.open) return void this.#join('');
    this.#password('', null);
    return undefined;
  }

  /** Step 3, with the password typed so far and the reason the last try failed, if it did. @param {string} password @param {string | null} error */
  #password(password, error) {
    const chosen = /** @type {Network} */ (this.#chosen);
    this.#fill('network', chosen.name);
    this.$('[data-step="password"] [data-slot="signal"]').textContent = chosen.signal === null ? 'unknown' : signalWord(chosen.signal);
    const alert = this.$('[data-step="password"] [data-slot="error"]');
    alert.textContent = error ?? '';
    alert.hidden = !error;
    const field = /** @type {HTMLInputElement} */ (this.$('#wifi-password'));
    field.value = password;
    field.setCustomValidity('');
    this.#show('password', error ?? undefined);
  }

  /** Steps 4 and 5: the try, then its result. @param {string} password */
  async #join(password) {
    const chosen = /** @type {Network} */ (this.#chosen);
    const bridge = this.host.bridge();
    const token = this.#token;
    // What the board was on: a failed try puts it back there (spec §4.3).
    const before = bridge?.net ?? null;
    this.#fill('network', chosen.name);
    this.#joining = true;
    this.#show('joining');
    let cause = null;
    /** @type {any} */
    let error = null;
    try {
      if (!bridge) throw new Error('The decoder is disconnected. Connect it again.');
      cause = await bridge.join(chosen.name, password);
    } catch (caught) {
      error = caught;
    }
    // A close since (or an unplug) cleaned up already, and a newer try may be running: only this one's own state.
    if (token !== this.#token || !this.dialog.open) return;
    this.#joining = false;
    if (this.#closeAfterJoin) return this.close();
    const name = quoted(chosen.name);
    if (cause === 'ok') {
      const net = bridge?.net;
      const word = net?.state === 'connected' && net.name === chosen.name ? signalWord(net.signal) : chosen.signal === null ? null : signalWord(chosen.signal);
      this.#fill('signal', word ?? 'unknown');
      this.$('[data-result="joined"]').hidden = false;
      this.$('[data-result="timeout"]').hidden = true;
      return this.#show('result', `Joined ${name}.`);
    }
    if (!cause && error?.timeout) {
      this.$('[data-result="joined"]').hidden = true;
      this.$('[data-result="timeout"]').hidden = false;
      return this.#show('result', "The decoder didn't answer.");
    }
    // A refusal of the try (its cause), of its bytes (a reason), or anything else (its own words): back to the password.
    const why = cause === 'password' ? `${name} refused the password.`
      : cause === 'notfound' ? `Can't find ${name} from here.`
        : cause ? `Can't join ${name}.`
          : error?.unstored ? `The decoder joined ${name} but couldn't keep the settings. Try again.`
            : typeof error?.reason === 'string' ? `The decoder refused it: ${error.reason}.` : String(error?.message ?? error);
    // Joined but not kept: it is on the new network, not back on the old one.
    const back = !error?.unstored && before?.state === 'connected' && before.name !== chosen.name ? ` The decoder is back on ${quoted(before.name)}.` : '';
    return this.#password(password, why + back);
  }

  #cancel() {
    if (!this.#joining) return this.close();
    this.#closeAfterJoin = true;
    for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (this.dialog.querySelectorAll('[data-step="joining"] [data-wifi-action="cancel"]'))) b.disabled = true;
    this.#say('Closing once the decoder answers…');
    return undefined;
  }

  /** Back as the server rendered it, with no password left in a field. */
  #cleanUp() {
    this.#token += 1;
    this.#networks = [];
    this.#chosen = null;
    this.#closeAfterJoin = false;
    this.#joining = false;
    this.decoder = null;
    for (const step of /** @type {NodeListOf<HTMLElement>} */ (this.dialog.querySelectorAll('[data-step]'))) step.hidden = true;
    for (const input of /** @type {NodeListOf<HTMLInputElement>} */ (this.dialog.querySelectorAll('input'))) {
      input.value = '';
      input.setCustomValidity('');
      if (input.name === 'password') input.type = 'password';
    }
    for (const button of /** @type {NodeListOf<HTMLButtonElement>} */ (this.dialog.querySelectorAll('[data-wifi-show]'))) {
      button.textContent = 'Show';
      button.setAttribute('aria-label', 'Show password');
    }
    for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (this.dialog.querySelectorAll('[data-wifi-action="cancel"]'))) b.disabled = false;
    this.$('[data-slot="error"]').hidden = true;
    for (const el of /** @type {NodeListOf<HTMLElement>} */ (this.dialog.querySelectorAll('[data-result], [data-scan]'))) el.hidden = true;
    const live = this.dialog.querySelector('[data-wifi-live]');
    if (live) live.textContent = '';
    this.$('[data-slot="networks"]').replaceChildren();
    this.dialog.setAttribute('aria-labelledby', 'wifi-title-looking');
  }
}
