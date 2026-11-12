// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A driver as people see them (drivers and transponders spec §3): their avatar,
// the initials on their colour.
import { html } from './html.js';

/** The first letter of up to two words, upper-cased: "Mia Kraus" → "MK". @param {string} name */
export const initials = (name) => name.trim().split(/\s+/u).slice(0, 2).map((word) => [...word][0] ?? '').join('').toLocaleUpperCase();

/**
 * A driver's avatar. It repeats the name beside it, so it is hidden from screen readers.
 * @param {{ name: string, colour: string }} driver @param {{ large?: boolean, small?: boolean }} [options]
 */
export const avatar = (driver, { large = false, small = false } = {}) => html`<span class="avatar${large ? ' is-lg' : small ? ' is-sm' : ''}" style="--c: ${driver.colour}" aria-hidden="true">${initials(driver.name)}</span>`;
