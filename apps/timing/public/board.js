// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board's full-screen button (spec step two §6): the server renders it hidden on ?big; this shows it where the browser can go full screen. The stream and the clock are tl-board and tl-countdown.
const button = /** @type {HTMLButtonElement | null} */ (document.querySelector('[data-fullscreen]'));
if (button && document.documentElement.requestFullscreen) {
  const label = () => { button.textContent = document.fullscreenElement ? 'Leave full screen' : 'Full screen'; };
  button.hidden = false;
  label();
  button.addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}));
  document.addEventListener('fullscreenchange', label);
}
