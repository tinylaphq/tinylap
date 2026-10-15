// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Form fields with palace's label-above-input look and accessible errors
// (spec §5): the field an error names is aria-invalid and described by it.
import { html } from './html.js';

/** @param {{ field?: string, message: string } | null | undefined} error @param {string} name */
const errorFor = (error, name) => (error && error.field === name ? error.message : null);

export function textField({ label, name, value = '', error = null, type = 'text', required = false, maxlength = null, placeholder = null, readonly = false, labelHidden = false, min = null, max = null, id }) {
  const message = errorFor(error, name);
  return html`<div class="field">
  <label for="${id}"${labelHidden ? html` class="visually-hidden"` : null}>${label}</label>
  <input type="${type}" id="${id}" name="${name}" value="${value}"${required ? html` required` : null}${readonly ? html` readonly` : null}${min !== null ? html` min="${min}"` : null}${max !== null ? html` max="${max}"` : null}${maxlength ? html` maxlength="${maxlength}"` : null}${placeholder ? html` placeholder="${placeholder}"` : null}${message ? html` aria-invalid="true" aria-describedby="${id}-error"` : null}>
  ${message ? html`<p class="field-error" id="${id}-error">${message}</p>` : null}
</div>`;
}

export function selectField({ label, name, options, value = '', error = null, labelHidden = false, id }) {
  const message = errorFor(error, name);
  return html`<div class="field">
  <label for="${id}"${labelHidden ? html` class="visually-hidden"` : null}>${label}</label>
  <select id="${id}" name="${name}"${message ? html` aria-invalid="true" aria-describedby="${id}-error"` : null}>
    ${options.map((o) => html`<option value="${o.value}"${o.value === value ? html` selected` : null}>${o.label}</option>`)}
  </select>
  ${message ? html`<p class="field-error" id="${id}-error">${message}</p>` : null}
</div>`;
}

/**
 * The page-level message for a failed form (spec §5): role="alert", with a link to
 * the field when the error names one. @param {{ field?: string, message: string } | null | undefined} error @param {string | null} [fieldId]
 */
export const errorSummary = (error, fieldId = null) => (error
  ? html`<p class="status status-error" role="alert">${error.field && fieldId ? html`<a href="#${fieldId}">${error.message}</a>` : error.message}</p>`
  : null);
