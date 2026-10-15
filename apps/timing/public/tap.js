// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Taps without a page load (spec §6.3): the tap forms are submitted with
// fetch and the result is shown in place. Without this script, or if a
// request fails, each form submits normally.
const status = document.querySelector('#tap-result');

for (const form of /** @type {NodeListOf<HTMLFormElement>} */ (document.querySelectorAll('form.tap-form'))) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const tile = form.querySelector('.tap-tile');
    tile?.classList.add('is-tapped');
    setTimeout(() => tile?.classList.remove('is-tapped'), 150);
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { accept: 'application/json' },
        body: new URLSearchParams(/** @type {Record<string, string>} */ (Object.fromEntries(new FormData(form)))),
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (status) status.textContent = res.ok ? data.text : data.error;
    } catch {
      form.submit();
    }
  });
}
