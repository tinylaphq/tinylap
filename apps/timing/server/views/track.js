// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A track's page (named tracks spec §3.4, §4): its name, the current layout
// drawn, the earlier ones by date with who attached them, and the record
// history per direction, each record naming the layout it was driven on.
// It is for looking back years later, so every date has its year, and a
// layout its time too, so two attached on one day stay apart.
import { localTime } from '@tinylap/design/html/local-time.js';
import { layoutToSvgString, parseLayout } from '@tinylap/track-format';
import { html, safe } from './html.js';
import { layout } from './layout.js';
import { recordsTable } from './records.js';

const DIRECTIONS = [['ccw', 'Anticlockwise'], ['cw', 'Clockwise']];

/**
 * The layout drawn, or null if its stored data does not parse. The SVG is
 * trusted markup: layoutToSvgString writes only numbers checked finite and
 * its own colours, never a string from the layout.
 * @param {string} data
 */
function drawing(data) {
  try {
    return safe(layoutToSvgString(parseLayout(data)));
  } catch {
    return null;
  }
}

/** @param {any} entry @param {string} trackName @param {boolean} current */
const figure = (entry, trackName, current) => {
  const art = drawing(entry.layout);
  return html`<figure class="track-drawing${current ? ' is-current' : ''}" id="layout-${entry.attachedAt}">
  ${art ? html`<div class="track-drawing-art" role="img" aria-label="Layout of ${trackName}">${art}</div>` : null}
  <figcaption>${current ? 'Since ' : null}${safe(localTime(entry.attachedAt, 'datetime-year'))}, by ${entry.by ?? (entry.byMember ? 'a member' : 'former member')}</figcaption>
</figure>`;
};

/**
 * @param {any} request
 * @param {{ track: { id: string, name: string, archivedAt: number | null }, layouts: any[], current: boolean, direction: string,
 *   records: Record<string, any[]>, drivers: any[], layoutOf: (at: number) => any }} model
 */
export function trackPage(request, { track, layouts, current, direction, records, drivers, layoutOf }) {
  const base = request.space.base;
  const [now, ...earlier] = layouts;
  // The direction the club races now first, on the current track.
  const order = current && direction === 'cw' ? [...DIRECTIONS].reverse() : DIRECTIONS;
  return layout(request, {
    title: track.name,
    screen: 'setup',
    modules: ['pkg/design/elements/local-time.js'],
    body: html`<div class="container sessions-screen track-page stack-xl screen">
  <div class="stack-sm">
    <p><a href="${base}/setup#track">Setup</a></p>
    <h1>${track.name}</h1>
    ${current ? html`<p class="subtitle">The current track, ${direction === 'cw' ? 'clockwise' : 'anticlockwise'}.</p>` : null}
    ${track.archivedAt !== null ? html`<p class="subtitle">Archived ${safe(localTime(track.archivedAt, 'datetime-year'))}.</p>` : null}
  </div>
  <section class="stack-md" aria-labelledby="layout-title">
    <h2 id="layout-title">Layout</h2>
    ${now ? figure(now, track.name, true) : html`<p class="empty">No layout. Attach one in <a href="${base}/setup#track">Setup</a>.</p>`}
  </section>
  ${earlier.length > 0 ? html`<section class="stack-md" aria-labelledby="earlier-title">
    <h2 id="earlier-title">Earlier layouts</h2>
    <div class="track-drawings">${earlier.map((entry) => figure(entry, track.name, false))}</div>
  </section>` : null}
  <section class="stack-lg" aria-labelledby="records-title">
    <h2 id="records-title">Records</h2>
    ${order.map(([id, label]) => html`<section class="stack-sm" aria-labelledby="records-${id}">
      <h3 id="records-${id}">${label}</h3>
      ${recordsTable(request, { track, rows: records[id], drivers, layoutOf: layouts.length > 0 ? layoutOf : null, dates: 'datetime-year' })}
    </section>`)}
  </section>
</div>`,
  });
}
