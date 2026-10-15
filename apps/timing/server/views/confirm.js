// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// "Delete Ana?": a destructive action asks on a page of its own with its
// own form (spec §2), so it works without JavaScript and never uses confirm().
import { html } from './html.js';
import { layout } from './layout.js';

export function confirmPage(request, { title, text, action, button, back, screen = 'setup' }) {
  return layout(request, {
    title,
    screen,
    body: html`<section class="container-narrow page-header stack-md">
  <h1>${title}</h1>
  <div class="card-static stack-md">
    <p>${text}</p>
    <form method="post" action="${action}" class="button-row">
      <button type="submit" class="btn btn-danger">${button}</button>
      <a class="btn btn-outline" href="${back}">Cancel</a>
    </form>
  </div>
</section>`,
  });
}
