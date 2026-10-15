// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The live board (spec §8): session and clock, standings, the last laps.
// One layout from a phone to the wall; the watchers view is the same board
// without setup hints.
import { h } from './dom.js';
import { formatClock, formatLap } from './format.js';
import { clockOf, driverName, serverNow } from './view.js';

const KIND = { practice: 'Practice', qualifying: 'Qualifying', race: 'Race' };
const DIRECTION = { cw: 'clockwise', ccw: 'anticlockwise' };

function driverChip(view, id) {
  const chip = h('span', { class: 'driver' }, driverName(view, id));
  const colour = view.drivers.get(id)?.colour;
  if (colour) chip.style.setProperty('--driver', colour);
  return chip;
}

function header(view, now) {
  const s = view.session;
  const clock = clockOf(s, now);
  const where = view.track ? `${view.track.name} · ${DIRECTION[view.direction]}` : 'No track set';
  return h('header', { class: 'board-head' },
    h('div', {},
      h('p', { class: 'eyebrow' }, where),
      h('h1', { class: 'board-title' }, s ? KIND[s.kind] : 'Waiting for the first car')),
    clock && h('div', { class: 'board-clock' },
      h('span', { class: 'stat-label board-clock-label' }, clock.label),
      h('span', { class: 'board-clock-time' }, formatClock(clock.ms))));
}

function table(view) {
  if (view.standings.length === 0) return h('p', { class: 'empty board-empty' }, 'No laps yet.');
  const race = view.session?.kind === 'race';
  const last = new Map();
  for (const c of view.crossings) if (c.lapMs !== null && c.driverId && !last.has(c.driverId)) last.set(c.driverId, c.lapMs);
  return h('table', { class: 'board-table' },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, 'Pos'), h('th', { scope: 'col' }, 'Driver'), h('th', { scope: 'col', class: 'num' }, 'Laps'),
      h('th', { scope: 'col', class: 'num' }, 'Best'), h('th', { scope: 'col', class: 'num' }, 'Last'),
      race && h('th', { scope: 'col', class: 'num' }, 'Time'))),
    h('tbody', {}, view.standings.map((row) => h('tr', { class: row.finished ? 'is-finished' : null },
      h('td', { class: 'pos' }, String(row.position)),
      h('td', {}, driverChip(view, row.driverId)),
      h('td', { class: 'num' }, String(row.laps)),
      h('td', { class: 'num' }, formatLap(row.bestMs), row.bestMs !== null && view.bests.get(row.driverId) === row.bestMs ? h('span', { class: 'badge pb' }, 'PB') : null),
      h('td', { class: 'num' }, formatLap(last.get(row.driverId))),
      race && h('td', { class: 'num' }, formatLap(row.elapsedMs))))));
}

function feed(view) {
  const laps = view.crossings.filter((c) => c.lapMs !== null).slice(0, 12);
  return h('aside', { class: 'board-feed', 'aria-label': 'Last laps' },
    h('h2', { class: 'h3' }, 'Last laps'),
    laps.length === 0
      ? h('p', { class: 'empty' }, 'Laps show up here as cars cross the line.')
      : h('ol', { class: 'board-laps' }, laps.map((c) => h('li', {},
        driverChip(view, c.driverId),
        h('span', { class: 'num' }, formatLap(c.lapMs)),
        c.via === 'tap' ? h('span', { class: 'tag' }, 'tap') : null,
        !c.counts && c.driverId ? h('span', { class: 'tag' }, 'not counted') : null))));
}

/** Draws the board into `section`. */
export function renderBoard(section, view, now, { watcher = false } = {}) {
  const unknown = !watcher && view.unknown.length > 0
    ? h('p', { class: 'status status-warning board-unknown', role: 'status' },
      `Unknown ${view.unknown.length === 1 ? 'car' : 'cars'}: ${view.unknown.join(', ')}. `, h('a', { href: '#setup' }, 'Assign in Setup'))
    : null;
  section.replaceChildren(header(view, now), unknown ?? '', h('div', { class: 'board-main' }, table(view)), feed(view));
}

/** Mounts the board; it redraws on every change and ticks its clock. */
export function mountBoard(root, ctx) {
  const section = h('section', { class: 'board' });
  root.append(section);
  const draw = () => renderBoard(section, ctx.view, serverNow(ctx.view), { watcher: ctx.watcher });
  draw();
  const off = ctx.onChange(draw);
  const timer = setInterval(() => {
    const clock = clockOf(ctx.view.session, serverNow(ctx.view));
    const time = section.querySelector('.board-clock-time');
    if (clock && time) time.textContent = formatClock(clock.ms);
  }, 200);
  return () => {
    off();
    clearInterval(timer);
    section.remove();
  };
}
