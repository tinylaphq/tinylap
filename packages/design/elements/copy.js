// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// <tl-copy>: shows the server-rendered Copy button where the browser can
// copy, and copies the input's value or the code's text. Without it, or
// without the clipboard API, the value stays selectable and the button hidden.

class TlCopy extends HTMLElement {
  connectedCallback() {
    const button = this.querySelector('button');
    if (!button || !navigator.clipboard?.writeText) return;
    button.hidden = false;
    button.addEventListener('click', this);
  }

  disconnectedCallback() {
    this.querySelector('button')?.removeEventListener('click', this);
  }

  async handleEvent() {
    const input = this.querySelector('input');
    const code = this.querySelector('code');
    const status = this.querySelector('[role="status"]');
    const hint = /** @type {HTMLElement | null} */ (this.querySelector('.copy-hint'));
    try {
      await navigator.clipboard.writeText(input ? input.value : code?.textContent ?? '');
      if (hint) hint.hidden = true;
      // Cleared first, so a second copy is announced again.
      if (status) {
        status.textContent = '';
        requestAnimationFrame(() => { status.textContent = 'Copied'; });
      }
    } catch {
      if (hint) hint.hidden = false;
      if (input) input.select();
      else if (code) getSelection()?.selectAllChildren(code);
    }
  }
}

if (!customElements.get('tl-copy')) customElements.define('tl-copy', TlCopy);
