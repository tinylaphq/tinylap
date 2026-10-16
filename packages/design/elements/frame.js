// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// <tl-frame id="…" refreshes="other ids">: submits the forms inside it with
// fetch and swaps in the frame of the same id from the page the server
// answers with, so a card saves in place and the page keeps its place.
// The server answers as it does without script: a 303 to the page, or the
// page with the error. Anything unexpected loads the form's page instead,
// and a submit is never sent twice: a GET on a form target redirects to
// its page.

const TIMEOUT_MS = 30_000;
// One submit per page: a response may refresh other frames, so two in
// flight could swap in each other's stale cards.
let busy = false;

// A page the back/forward cache brings back, after a fallback load or one
// the user stopped, starts over: no submit in flight, every button live.
addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  busy = false;
  for (const frame of document.querySelectorAll('tl-frame[aria-busy]')) {
    frame.removeAttribute('aria-busy');
    for (const b of frame.querySelectorAll('[data-frame-disabled]')) {
      /** @type {HTMLButtonElement} */ (b).disabled = false;
      b.removeAttribute('data-frame-disabled');
    }
  }
});

/** @param {Element | null} el */
const focusOn = (el) => {
  if (!(el instanceof HTMLElement)) return;
  if (!el.matches('input, select, textarea, button, a[href]')) el.tabIndex = -1;
  el.focus({ preventScroll: true });
};

/** Whether the user has changed a control without submitting it. @param {Element} root */
function changed(root) {
  for (const el of root.querySelectorAll('input, select, textarea')) {
    if (el instanceof HTMLSelectElement) {
      const initial = [...el.options].findIndex((o) => o.defaultSelected);
      if (el.selectedIndex !== (initial === -1 ? 0 : initial)) return true;
    } else if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      if (el.checked !== el.defaultChecked) return true;
    } else {
      const field = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (el);
      if (field.value !== field.defaultValue) return true;
    }
  }
  return false;
}

/** @param {HTMLFormElement} form */
const firstFieldId = (form) => [...form.querySelectorAll('input, select, textarea')]
  .find((el) => !(el instanceof HTMLInputElement && el.type === 'hidden') && !el.hasAttribute('readonly') && !el.hasAttribute('disabled'))?.id ?? '';

/** @param {string} text */
function announce(text) {
  const status = document.getElementById('frame-status');
  if (!status) return;
  status.textContent = '';
  requestAnimationFrame(() => { status.textContent = text; });
}

class TlFrame extends HTMLElement {
  connectedCallback() { this.addEventListener('submit', this); }

  disconnectedCallback() { this.removeEventListener('submit', this); }

  /** @param {Event} event */
  handleEvent(event) {
    const { target: form, submitter } = /** @type {SubmitEvent} */ (event);
    if (!(form instanceof HTMLFormElement) || event.defaultPrevented || !this.id) return;
    const button = /** @type {HTMLButtonElement | HTMLInputElement | null} */ (submitter);
    const method = button?.hasAttribute('formmethod') ? button.formMethod : form.method;
    const action = new URL(button?.hasAttribute('formaction') ? button.formAction : form.action);
    // A fragment would make the fallback's location.assign scroll instead of load.
    action.hash = '';
    if (method !== 'post' || action.origin !== location.origin || form.target || button?.formTarget
      || form.dataset.frame === 'off' || form.querySelector('input[type="file"]')) return;
    event.preventDefault();
    if (busy) {
      announce('Still saving. Try again in a moment.');
      return;
    }
    busy = true;
    this.send(form, button, action);
  }

  /** @param {HTMLFormElement} form @param {HTMLButtonElement | HTMLInputElement | null} submitter @param {URL} action */
  async send(form, submitter, action) {
    try {
      const body = new URLSearchParams(/** @type {any} */ (new FormData(form, submitter)));
      const fieldId = firstFieldId(form);
      this.setAttribute('aria-busy', 'true');
      // Marked, so a page restored from the cache re-enables only these.
      for (const b of form.querySelectorAll('button:enabled, input[type="submit"]:enabled')) {
        /** @type {HTMLButtonElement} */ (b).disabled = true;
        b.setAttribute('data-frame-disabled', '');
      }
      const res = await fetch(action, { method: 'POST', body, redirect: 'follow', headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!(res.headers.get('content-type') ?? '').startsWith('text/html')) throw new Error(`not a page: ${res.status}`);
      const page = new DOMParser().parseFromString(await res.text(), 'text/html');
      const next = page.getElementById(this.id);
      if (next?.localName !== 'tl-frame') throw new Error(`no frame #${this.id}`);
      this.swap(page, next, res, fieldId);
    } catch {
      // The write may have happened: show the page, never send again. The page is leaving, so `busy` stays set.
      location.assign(action);
      return;
    }
    busy = false;
  }

  /** @param {Document} page @param {Element} next @param {Response} res @param {string} fieldId */
  swap(page, next, res, fieldId) {
    this.replaceChildren(...next.childNodes);
    this.removeAttribute('aria-busy');
    for (const id of (this.getAttribute('refreshes') ?? '').split(/\s+/).filter(Boolean)) {
      const mine = document.getElementById(id);
      const theirs = page.getElementById(id);
      if (mine?.localName !== 'tl-frame' || theirs?.localName !== 'tl-frame') continue;
      if (mine.contains(document.activeElement) || changed(mine)) continue;
      mine.replaceChildren(...theirs.childNodes);
    }
    const status = document.getElementById('page-status');
    const nextStatus = page.getElementById('page-status');
    if (status && nextStatus) status.replaceWith(nextStatus);
    document.title = page.title;
    if (res.redirected) {
      const url = new URL(res.url);
      if (url.pathname + url.search !== location.pathname + location.search) history.replaceState(null, '', url.pathname + url.search + location.hash);
    }
    const heading = this.querySelector('h1, h2, h3');
    if (res.ok) {
      focusOn((fieldId && this.querySelector(`#${CSS.escape(fieldId)}`)) || heading);
      announce(`${heading?.textContent?.trim() ?? 'Changes'} saved`);
    } else {
      focusOn(this.querySelector('[aria-invalid="true"]') ?? document.querySelector('#page-status [role="alert"]'));
    }
  }
}

if (!customElements.get('tl-frame')) customElements.define('tl-frame', TlFrame);
