// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Tap entry (spec §8): a tile per driver; a tap is a passing. For racing
// before the decoder exists, or when it's down.
import { h } from './dom.js';
import { formatLap } from './format.js';

export function mountTap(root, ctx) {
  const section = h('section', { class: 'tap-screen' });
  root.append(section);
  const result = h('p', { class: 'tap-result', role: 'status' }, 'Tap a driver as their car crosses the line.');

  const tile = (driver) => {
    const button = h('button', { type: 'button', class: 'tap-tile' }, driver.name);
    button.style.setProperty('--driver', driver.colour);
    button.addEventListener('click', async () => {
      button.classList.add('is-tapped');
      setTimeout(() => button.classList.remove('is-tapped'), 150);
      try {
        const { stored, lapMs } = await ctx.api('POST', `/workspaces/${encodeURIComponent(ctx.workspaceId)}/tap`, { driverId: driver.id });
        result.textContent = !stored ? 'Too fast, tap again.' : lapMs === null ? `${driver.name}: started` : `${driver.name}: ${formatLap(lapMs)}`;
      } catch (error) {
        result.textContent = error.message;
      }
    });
    return button;
  };

  let key = null;
  const draw = () => {
    const drivers = [...ctx.view.drivers.values()];
    const next = drivers.map((d) => `${d.id}:${d.name}:${d.colour}`).join('|');
    if (next === key) return;
    key = next;
    section.replaceChildren(
      drivers.length ? h('div', { class: 'tap-grid' }, drivers.map(tile)) : h('p', { class: 'empty' }, 'Add drivers in Setup first.'),
      result);
  };
  draw();
  const off = ctx.onChange(draw);
  return () => {
    off();
    section.remove();
  };
}
