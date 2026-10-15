// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Setup (spec §8): the track, drivers, transponders, decoders and the
// watchers link. Deleting needs owner or admin, as the server enforces.
import { h, screenHref } from './dom.js';

const DIRECTIONS = [['ccw', 'Anticlockwise'], ['cw', 'Clockwise']];

export function mountSetup(root, ctx) {
  const base = `/workspaces/${encodeURIComponent(ctx.workspaceId)}`;
  const role = ctx.me.workspaces.find((w) => w.id === ctx.workspaceId)?.role;
  const mayDelete = role === 'owner' || role === 'admin';
  const section = h('section', { class: 'container stack-xl screen' });
  root.append(section);
  const parts = { track: h('div'), drivers: h('div'), transponders: h('div'), decoders: h('div'), watch: h('div') };
  section.append(h('h1', {}, 'Setup'), ...Object.values(parts));

  /** Runs `call`; a failure shows in `box`. */
  const attempt = async (box, call) => {
    box.hidden = true;
    try {
      await call();
    } catch (error) {
      box.textContent = error.message;
      box.hidden = false;
    }
  };
  const errorBox = () => h('p', { class: 'status status-error', role: 'alert', hidden: true });
  const card = (title, ...children) => h('section', { class: 'card stack-md' }, h('h2', { class: 'h3' }, title), ...children);
  const field = (label, input) => h('label', { class: 'field' }, label, input);

  function drawTrack() {
    const error = errorBox();
    const link = /** @type {HTMLInputElement} */ (h('input', { type: 'url', name: 'link', required: true, placeholder: 'https://…/layouts/…' }));
    const name = /** @type {HTMLInputElement} */ (h('input', { type: 'text', name: 'name', maxlength: '60', value: ctx.view.track?.name ?? '' }));
    const direction = /** @type {HTMLSelectElement} */ (h('select', { name: 'direction' }, DIRECTIONS.map(([v, l]) => h('option', { value: v, selected: v === ctx.view.direction }, l))));
    const form = h('form', { class: 'stack-sm' }, field('Planner link', link), field('Track name', name), field('Direction', direction), error,
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Use this track'));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      attempt(error, () => ctx.api('PUT', `${base}/track`, { link: link.value, name: name.value || undefined, direction: direction.value }));
    });
    parts.track.replaceChildren(card('Track',
      h('p', {}, ctx.view.track ? `Now: ${ctx.view.track.name}, ${ctx.view.direction === 'cw' ? 'clockwise' : 'anticlockwise'}.` : 'No track yet: paste a share link from the planner.'),
      form));
  }

  // The driver form is built once: a driver arriving must not wipe what is being typed.
  const driversList = h('ul', { class: 'setup-list' });
  const driversError = errorBox();
  const driverName = /** @type {HTMLInputElement} */ (h('input', { type: 'text', name: 'name', maxlength: '60', required: true }));
  const driverForm = h('form', { class: 'inline-form' }, field('New driver', driverName), h('button', { type: 'submit', class: 'btn btn-primary' }, 'Add driver'));
  driverForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const typed = driverName.value;
    driverName.value = '';
    attempt(driversError, async () => {
      try {
        await ctx.api('POST', `${base}/drivers`, { name: typed });
      } catch (error) {
        driverName.value = typed;
        throw error;
      }
    });
  });
  const driversCard = card('Drivers', driversList, driverForm, driversError);
  parts.drivers.append(driversCard);
  function drawDrivers() {
    const error = driversError;
    const item = (driver) => {
      const chip = h('span', { class: 'driver' }, driver.name);
      chip.style.setProperty('--driver', driver.colour);
      const rename = h('button', { type: 'button', class: 'btn btn-sm btn-outline' }, 'Rename');
      rename.addEventListener('click', () => {
        const next = prompt('New name', driver.name);
        if (next) attempt(error, () => ctx.api('PATCH', `${base}/drivers/${encodeURIComponent(driver.id)}`, { name: next }));
      });
      const remove = mayDelete && h('button', { type: 'button', class: 'btn btn-sm btn-danger' }, 'Delete');
      if (remove) remove.addEventListener('click', () => {
        if (confirm(`Delete ${driver.name}? Their laps stay, under "former driver".`)) attempt(error, () => ctx.api('DELETE', `${base}/drivers/${encodeURIComponent(driver.id)}`));
      });
      return h('li', { class: 'setup-row' }, chip, rename, remove);
    };
    driversList.replaceChildren(...[...ctx.view.drivers.values()].map(item));
  }

  async function drawTransponders() {
    const error = errorBox();
    const { transponders } = await ctx.api('GET', `${base}/transponders`);
    const drivers = [...ctx.view.drivers.values()];
    const rows = transponders.map((t) => {
      const select = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': `Driver for ${t.code}` },
        h('option', { value: '', selected: t.driverId === null }, '— unassigned'),
        drivers.map((d) => h('option', { value: d.id, selected: d.id === t.driverId }, d.name))));
      select.addEventListener('change', () => attempt(error, () => ctx.api('PUT', `${base}/transponders/${t.code}`, { driverId: select.value || null })));
      return h('tr', { class: t.driverId === null ? 'is-unknown' : null }, h('td', { class: 'num' }, t.code), h('td', {}, select));
    });
    parts.transponders.replaceChildren(card('Transponders',
      rows.length ? h('table', { class: 'board-table' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Code'), h('th', { scope: 'col' }, 'Driver'))), h('tbody', {}, rows))
        : h('p', { class: 'empty' }, 'Transponders show up here when a car first crosses the line.'),
      error));
  }

  async function drawDecoders() {
    const error = errorBox();
    const { decoders } = await ctx.api('GET', `${base}/decoders`);
    const shown = h('div');
    const wifiOnly = h('button', { type: 'button', class: 'btn btn-outline' }, 'Pair without USB');
    wifiOnly.addEventListener('click', () => attempt(error, async () => {
      const decoder = await ctx.api('POST', `${base}/decoders`, { name: 'Decoder' });
      shown.replaceChildren(h('p', { class: 'status status-info' }, `Decoder ${decoder.id}, token ${decoder.token}. Shown once: copy it now.`));
      await drawDecoders();
    }));
    const item = (d) => {
      const remove = mayDelete && h('button', { type: 'button', class: 'btn btn-sm btn-danger' }, 'Unpair');
      if (remove) remove.addEventListener('click', () => {
        if (confirm(`Unpair ${d.name}? Its token stops working.`)) attempt(error, async () => { await ctx.api('DELETE', `${base}/decoders/${encodeURIComponent(d.id)}`); await drawDecoders(); });
      });
      return h('li', { class: 'setup-row' }, h('span', {}, d.name), h('span', { class: 'meta' }, d.lastSeenAt ? `seen ${new Date(d.lastSeenAt).toLocaleString()}` : 'never seen'), remove);
    };
    parts.decoders.replaceChildren(card('Decoders',
      h('ul', { class: 'setup-list' }, decoders.map(item)),
      h('p', {}, 'Pair a decoder over USB in ', h('a', { href: screenHref('bridge') }, 'Bridge'), '.'),
      wifiOnly, shown, error));
  }

  async function drawWatch() {
    const error = errorBox();
    const { token } = await ctx.api('GET', `${base}/watch-token`);
    const url = token ? `${location.origin}/#watch=${token}` : '';
    const make = h('button', { type: 'button', class: 'btn btn-primary' }, token ? 'Make a new watchers link' : 'Make a watchers link');
    make.addEventListener('click', () => {
      if (token && !confirm('The old link stops working. Make a new one?')) return;
      attempt(error, async () => { await ctx.api('POST', `${base}/watch-token`); await drawWatch(); });
    });
    parts.watch.replaceChildren(card('Watchers link',
      h('p', {}, 'Anyone with this link sees the board, read-only, without logging in.'),
      token && field('Watchers link', h('input', { type: 'text', readonly: true, value: url })),
      make, error));
  }

  let keys = {};
  const draw = () => {
    const drivers = [...ctx.view.drivers.values()].map((d) => `${d.id}:${d.name}:${d.colour}`).join('|');
    const next = { track: `${ctx.view.track?.id}:${ctx.view.track?.name}:${ctx.view.direction}`, drivers, transponders: `${drivers}#${ctx.view.unknown.join(',')}` };
    if (next.track !== keys.track) drawTrack();
    if (next.drivers !== keys.drivers) drawDrivers();
    if (next.transponders !== keys.transponders) drawTransponders().catch(() => {});
    keys = next;
  };
  draw();
  drawDecoders().catch(() => {});
  drawWatch().catch(() => {});
  const off = ctx.onChange(draw);
  return () => {
    off();
    section.remove();
  };
}
