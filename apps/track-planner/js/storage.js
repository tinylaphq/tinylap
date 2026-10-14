// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { layoutToSvgString } from './render.js';
import { assignTrack, computeMetrics, layoutFromData, layoutFromHtml, extractLayoutJson, LAYOUT_SCRIPT_ID, SUPPORTED_VERSION, MAT_MM } from '@tinylap/track-format';
import { billOfMaterials, PART_LABELS } from './inventory.js';

export { layoutFromData, SUPPORTED_VERSION, extractLayoutJson, LAYOUT_SCRIPT_ID };
// Kept under its planner name; the package calls it layoutFromHtml.
export const importHtml = layoutFromHtml;

const metres = (mats) => ((mats * MAT_MM) / 1000).toFixed(2);

// The track identity is settled when a layout leaves as a file. The caller
// keeps the returned layout, so the next export compares against the id this
// file carries; edits in between never touch it.
export function prepareExport(layout) {
  const settled = assignTrack(layout);
  return { layout: settled, html: exportHtml(settled) };
}

// Undo restores a snapshot that may predate the last export. Carry the
// current track over, so re-building the exported shape keeps its id;
// assignTrack re-checks the shape at the next export, so a stale track is
// never wrongly kept.
export function carryTrack(previous, current) {
  return previous.track || !current.track ? previous : { ...previous, track: current.track };
}

export function exportHtml(layout) {
  const { bbox, matCount, lapMm } = computeMetrics(layout);
  const bom = billOfMaterials(layout);
  const svg = layoutToSvgString(layout);

  const rows = [
    ...Object.entries(bom.mats).map(([k, v]) => [PART_LABELS[`mats.${k}`], v]),
    ...Object.entries(bom.barriers).map(([k, v]) => [PART_LABELS[`barriers.${k}`], v]),
    ['Joint A', bom.joints.a],
    ['Joint B', bom.joints.b],
  ]
    .filter(([, v]) => v > 0)
    .map(([label, v]) => `<tr><th scope="row">${label}</th><td>${v}</td></tr>`)
    .join('');

  const size = bbox ? `${metres(bbox.w)} m &times; ${metres(bbox.h)} m` : 'empty';

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Circuit 30 layout</title>
<style>
  /* Standalone: palace-ui's look written out literally, with no external
     requests, so the exported file works offline and off this machine. */
  * { box-sizing: border-box; }
  body { font: 14px/1.5 'Space Grotesk', system-ui, sans-serif; color: #0a0a0a;
         background: #f0f0f0; margin: 0; padding: 48px 24px; }
  main { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 28px; font-weight: 700; text-transform: uppercase;
       letter-spacing: 2px; margin: 0 0 8px; }
  .subtitle { color: #666; text-transform: uppercase; letter-spacing: 1px;
              font-size: 12px; font-weight: 600; margin: 0 0 32px; }
  figure { margin: 0 0 32px; }
  svg { width: 100%; height: auto; background: #0a0a0a;
        border: 2px solid #0a0a0a; display: block; }
  figcaption { margin-top: 12px; font-size: 12px; font-weight: 700;
               text-transform: uppercase; letter-spacing: 1px; color: #444; }
  table { width: 100%; border-collapse: collapse; background: #fff;
          border: 2px solid #0a0a0a; }
  caption { text-align: left; font-size: 12px; font-weight: 700;
            text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  th, td { padding: 8px 12px; border-bottom: 1px solid #ddd; }
  th { text-align: left; font-size: 11px; text-transform: uppercase;
       letter-spacing: 1px; color: #6b6b6b; font-weight: 600; }
  td { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  tr:last-child th, tr:last-child td { border-bottom: 0; }
  .note { margin-top: 24px; font-size: 12px; color: #666; }
</style>
<main>
<h1>Circuit 30 layout</h1>
<p class="subtitle">Kyosho Mini-Z Grand Prix Circuit 30</p>
<figure>
  ${svg}
  <figcaption>${size} &middot; ${matCount} mats &middot; lap ${(lapMm / 1000).toFixed(2)} m</figcaption>
</figure>
<table><caption>Bill of materials</caption><tbody>${rows}</tbody></table>
<p class="note">Open this file in the Circuit 30 Planner to keep editing it.</p>
</main>
<script type="application/json" id="${LAYOUT_SCRIPT_ID}">
${JSON.stringify(layout, null, 2).replace(/</g, '\\u003c')}
</script>
</html>
`;
}
