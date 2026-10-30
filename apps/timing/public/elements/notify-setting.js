// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// <tl-notify-setting>: the Notifications setting in a member's account menu,
// on every page but the big board. The server renders it hidden, with its
// button (palace's setting: its switch follows aria-pressed) and the text for a browser that blocks
// them; this element only switches attributes.
// - Where the browser has Notification, it reveals itself, and
//   localStorage['tinylap-notify'] remembers whether notifications are wanted.
// - A click turns it on, asking for permission from that click, or off. The
//   button shows pressed (On) only while wanted and granted.
// - Once the browser denies them it shows data-state="blocked": the button
//   gives way to the text that says how to allow them again. Denied from the
//   click, focus moves to that text (tabindex=-1), so it is read out and stays
//   in the open menu.
// - The permission and the remembered choice are read again when the page
//   shows, and the choice when another tab changes it (storage), so open
//   tabs agree.
// tl-board reads `on` when a record falls; only the board notifies.

const NOTIFY_KEY = 'tinylap-notify';

class TlNotifySetting extends HTMLElement {
  /** @type {HTMLButtonElement | null} */
  button = null;
  /** Whether notifications are wanted, as remembered or last chosen. */
  wanted = false;

  connectedCallback() {
    const button = this.querySelector('button');
    if (!button || !('Notification' in window)) return;
    this.button = button;
    this.remember();
    this.show();
    this.hidden = false;
    button.addEventListener('click', this);
    addEventListener('visibilitychange', this); // it bubbles from document
    addEventListener('storage', this);
  }

  disconnectedCallback() {
    this.button?.removeEventListener('click', this);
    this.button = null;
    removeEventListener('visibilitychange', this);
    removeEventListener('storage', this);
  }

  /** Reads the remembered choice; with storage blocked, the last one this page made stands. */
  remember() {
    try { this.wanted = localStorage.getItem(NOTIFY_KEY) === 'on'; } catch { /* storage blocked */ }
  }

  /** Notifications can show: wanted, and granted. */
  get on() {
    return Boolean(this.button) && this.wanted && Notification.permission === 'granted';
  }

  /** On only while it can notify; denied, it says blocked. */
  show() {
    if (!this.button) return;
    this.button.setAttribute('aria-pressed', String(this.on));
    if (Notification.permission === 'denied') this.setAttribute('data-state', 'blocked');
    else this.removeAttribute('data-state');
  }

  /** On turns it off; otherwise on, asking for permission from the click. */
  toggle() {
    this.wanted = !this.on;
    try { localStorage.setItem(NOTIFY_KEY, this.wanted ? 'on' : 'off'); } catch { /* storage blocked: the choice lasts this page */ }
    this.show();
    if (this.wanted && Notification.permission !== 'granted') {
      Notification.requestPermission().then(() => {
        this.show();
        if (Notification.permission === 'denied') /** @type {HTMLElement | null} */ (this.querySelector('.nav-account-blocked'))?.focus();
      }, () => {});
    }
  }

  /** @param {Event} event */
  handleEvent(event) {
    if (event.type === 'click') this.toggle();
    else if (event.type === 'storage' && /** @type {StorageEvent} */ (event).key !== NOTIFY_KEY) return;
    else if (event.type === 'storage' || (event.type === 'visibilitychange' && document.visibilityState === 'visible')) {
      this.remember();
      this.show();
    }
  }
}

if (!customElements.get('tl-notify-setting')) customElements.define('tl-notify-setting', TlNotifySetting);
