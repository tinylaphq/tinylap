// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// <tl-autoplay> around a muted, looping <video controls>: plays it by itself
// unless the visitor asked for less motion, and swaps the browser's controls
// for one pause/play button in the corner. Without it the video keeps its
// controls and plays on click.
const ICONS = '<svg class="pause" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12"/><rect x="8.5" y="1" width="3.5" height="12"/></svg>'
  + '<svg class="play" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1l10 6-10 6z"/></svg>';

class Autoplay extends HTMLElement {
  /** @type {HTMLVideoElement | null} */ video = null;
  /** @type {HTMLButtonElement | null} */ button = null;
  sync = () => this.button?.setAttribute('aria-pressed', String(!this.video?.paused));
  toggle = () => { if (this.video?.paused) this.video.play().catch(this.sync); else this.video?.pause(); };

  connectedCallback() {
    this.video = this.querySelector('video');
    if (!this.video) return;
    this.video.controls = false;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'autoplay-toggle';
    this.button.setAttribute('aria-label', 'Play animation');
    this.button.innerHTML = ICONS;
    this.button.addEventListener('click', this.toggle);
    this.video.addEventListener('play', this.sync);
    this.video.addEventListener('pause', this.sync);
    this.append(this.button);
    this.sync();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) this.video.play().catch(this.sync);
  }

  disconnectedCallback() {
    this.video?.removeEventListener('play', this.sync);
    this.video?.removeEventListener('pause', this.sync);
    this.video?.pause();
    this.button?.remove();
    this.button = null;
  }
}

customElements.define('tl-autoplay', Autoplay);
