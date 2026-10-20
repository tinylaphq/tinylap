// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// <tl-tap> (spec step three §2): taps without a page load. The server renders
// the tap screen inside it, with one form per driver, and three templates:
// the result line, the alert, and the signed-out message.
// - Each tap form inside it is submitted with fetch, and the answer is shown
//   in the result bar from the templates; the script builds no markup.
// - A failed request is never retried and never falls back to a normal
//   submit: the server may have stored the tap already, so the driver is
//   told to check the board.
// - A newer tap's answer wins; the submitted tile flashes for 150 ms.
// - Each answer cancels a fill still waiting for its frame, so an error never
//   leaves an older result under the alert.
// - A disconnect stops listening but doesn't abort a request in flight: it
//   can't unsend a tap the server may have stored, and after a move its
//   answer is still the latest.
// Without JavaScript each form submits normally.

const NO_ANSWER = 'No answer from the server. Check the board before tapping again.';
const LABEL = { started: 'Started', lap: 'Lap', again: 'Again' };

class TlTap extends HTMLElement {
  latest = 0;
  frame = 0;
  timers = new WeakMap();

  connectedCallback() { this.addEventListener('submit', this); }

  disconnectedCallback() { this.removeEventListener('submit', this); }

  /** @param {string} name */
  template(name) { return /** @type {HTMLTemplateElement | null} */ (this.querySelector(`template[data-tap="${name}"]`)); }

  show(state, text, colour, signedOut = false) {
    cancelAnimationFrame(this.frame);
    const bar = /** @type {HTMLElement | null} */ (this.querySelector('.tap-bar'));
    const status = this.querySelector('#tap-result');
    const alertBox = this.querySelector('#tap-alert');
    const alert = this.template('alert');
    const result = this.template('result');
    const out = this.template('signed-out');
    const ready = state === 'error' ? alert && (!signedOut || out) : result;
    if (!bar || !status || !alertBox || !ready) return;
    bar.dataset.state = state;
    if (colour) bar.style.setProperty('--driver', colour);
    alertBox.replaceChildren();
    if (state === 'error') {
      const box = /** @type {DocumentFragment} */ (alert.content.cloneNode(true));
      const words = box.querySelector('.tap-text');
      if (signedOut) words.replaceChildren(out.content.cloneNode(true));
      else words.textContent = text;
      alertBox.append(box);
      status.replaceChildren();
      return;
    }
    // Cleared first, so that identical text is announced again.
    status.replaceChildren();
    this.frame = requestAnimationFrame(() => {
      const line = /** @type {DocumentFragment} */ (result.content.cloneNode(true));
      line.querySelector('.tap-state').textContent = LABEL[state];
      line.querySelector('.tap-text').textContent = text;
      status.replaceChildren(line);
    });
  }

  /** @param {Event} event */
  handleEvent(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches('form.tap-form') || !this.contains(form)) return;
    event.preventDefault();
    void this.tap(form);
  }

  /** @param {HTMLFormElement} form */
  async tap(form) {
    const mine = ++this.latest;
    const tile = /** @type {HTMLElement | null} */ (form.querySelector('.tap-tile'));
    if (tile) {
      clearTimeout(this.timers.get(tile));
      tile.classList.add('is-tapped');
      this.timers.set(tile, setTimeout(() => tile.classList.remove('is-tapped'), 150));
    }
    const colour = tile ? tile.style.getPropertyValue('--driver') : '';
    let state = 'error';
    let text = NO_ANSWER;
    let signedOut = false;
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { accept: 'application/json' },
        body: new URLSearchParams(/** @type {Record<string, string>} */ (Object.fromEntries(new FormData(form)))),
        credentials: 'same-origin',
        // An expired session answers with a redirect to sign-in, which fetch must not follow across origins.
        redirect: 'manual',
      });
      signedOut = res.type === 'opaqueredirect';
      const data = await res.json().catch(() => null);
      if (res.ok && typeof data?.text === 'string') {
        state = data.stored ? (data.lapMs === null ? 'started' : 'lap') : 'again';
        text = data.text;
      } else if (typeof data?.error === 'string') {
        text = data.error;
      }
    } catch {
      // Keep the fallback text.
    }
    if (mine === this.latest) this.show(state, text, state === 'error' ? '' : colour, signedOut);
  }
}

if (!customElements.get('tl-tap')) customElements.define('tl-tap', TlTap);
