// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// <tl-menu>: the <details> inside it is a disclosure menu (the WAI-ARIA
// disclosure pattern, not role=menu), such as the navbar's account menu.
// Without this element it opens and closes by click and keyboard, and
// <details name> keeps one open at a time. With it:
// - Escape closes it and returns to the summary, wherever focus is in the
//   menu, or on the page after a mouse open; focus elsewhere (a dialog)
//   keeps its Escape;
// - a press outside, or focus moving outside, closes it;
// - a click on an in-page item (button type=button) closes it first;
// - leaving the page closes it, so Back never shows it open.
// The document listeners exist only while it is open.

class TlMenu extends HTMLElement {
  /** The menu's <details>, looked up each time, so markup filled in or replaced later works. */
  get details() { return this.querySelector('details'); }

  // Watches `open` on any <details> inside. Not the toggle event: browsers
  // fire it a moment late, and a quick Escape or press would come first.
  observer = new MutationObserver(() => this.listen(Boolean(this.details?.open)));

  connectedCallback() {
    this.observer.observe(this, { subtree: true, attributes: true, attributeFilter: ['open'] });
    this.addEventListener('click', this, true);
    this.addEventListener('focusout', this);
    addEventListener('pagehide', this);
    if (this.details?.open) this.listen(true);
  }

  disconnectedCallback() {
    this.observer.disconnect();
    this.removeEventListener('click', this, true);
    this.removeEventListener('focusout', this);
    removeEventListener('pagehide', this);
    this.listen(false);
  }

  /** @param {boolean} on */
  listen(on) {
    const method = on ? 'addEventListener' : 'removeEventListener';
    document[method]('keydown', this, true);
    document[method]('pointerdown', this, true);
  }

  /** Closes the menu if open; with focus, always puts focus on the summary (e.g. after an app's dialog closes). */
  close({ focus = false } = {}) {
    const details = this.details;
    if (details?.open) details.open = false;
    if (focus) details?.querySelector('summary')?.focus();
  }

  /** @param {Event} event */
  handleEvent(event) {
    const details = this.details;
    // A menu hidden while open (an app hiding its account control) closes,
    // and leaves the page's keys and presses alone.
    if ((event.type === 'keydown' || event.type === 'pointerdown') && details?.open && !this.checkVisibility()) {
      this.close();
      return;
    }
    switch (event.type) {
      case 'keydown': {
        if (/** @type {KeyboardEvent} */ (event).key !== 'Escape' || !details?.open) break;
        const at = document.activeElement;
        if (at && at !== document.body && !this.contains(at)) break;
        event.preventDefault();
        event.stopPropagation();
        this.close({ focus: true });
        break;
      }
      case 'pointerdown':
        if (event.target instanceof Node && !this.contains(event.target)) this.close();
        break;
      case 'focusout': {
        const next = /** @type {FocusEvent} */ (event).relatedTarget;
        if (next instanceof Node && !this.contains(next)) this.close();
        break;
      }
      case 'click':
        if (event.target instanceof Element && event.target.closest('details > :not(summary) button[type="button"]')) this.close();
        break;
      case 'pagehide':
        this.close();
        break;
    }
  }
}

if (!customElements.get('tl-menu')) customElements.define('tl-menu', TlMenu);
