import { layoutToSvgString } from './render.js';
import { computeMetrics, createLayout } from './model.js';
import { billOfMaterials, PART_LABELS } from './inventory.js';
import { PIECES, MAT_MM } from './geometry.js';

export const LAYOUT_SCRIPT_ID = 'layout';
export const SUPPORTED_VERSION = 1;

const metres = (mats) => ((mats * MAT_MM) / 1000).toFixed(2);

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

const BLOCK = new RegExp(
  `<script[^>]*id=["']${LAYOUT_SCRIPT_ID}["'][^>]*>([\\s\\S]*?)</script>`,
  'i',
);

export function extractLayoutJson(html) {
  const match = BLOCK.exec(html);
  if (!match) throw new Error('This file has no layout data in it.');
  try {
    return JSON.parse(match[1]);
  } catch (cause) {
    throw new Error('The layout data in this file is not valid JSON.', { cause });
  }
}

// Validate and rebuild a layout from plain data in the persisted shape.
// Split out of importHtml so the session store validates by exactly the
// same rules — two copies of "is this piece type real, is this rotation
// one of four, is this coordinate finite" is how the two paths drift, and
// these particular checks are what stop a hand-edited payload reaching
// the renderer.
export function layoutFromData(data) {

  if (data.version !== SUPPORTED_VERSION) {
    throw new Error(
      `This file was saved by a newer planner (version ${data.version}); this build reads version ${SUPPORTED_VERSION}.`,
    );
  }
  if (!Array.isArray(data.pieces)) {
    throw new Error('The layout data has no pieces array.');
  }
  for (const piece of data.pieces) {
    // Object.hasOwn, not a truthy lookup: PIECES['__proto__'] and
    // PIECES['constructor'] are inherited and truthy, so a crafted file
    // or a hand-edited session entry got a bogus piece type past this
    // guard and threw deep in the renderer instead.
    if (!Object.hasOwn(PIECES, piece.type)) throw new Error(`Unknown piece type: ${piece.type}`);
    if (![0, 90, 180, 270].includes(piece.rot)) {
      throw new Error(`Unknown rotation: ${piece.rot}`);
    }
    if (!Number.isFinite(piece.x)) throw new Error(`Invalid piece x: ${piece.x}`);
    if (!Number.isFinite(piece.y)) throw new Error(`Invalid piece y: ${piece.y}`);
  }

  let room = null;
  if (data.room != null) {
    const { w, h } = data.room;
    if (!Number.isFinite(w) || !Number.isFinite(h)) {
      throw new Error(`Invalid room: ${JSON.stringify(data.room)}`);
    }
    room = { w, h };
  }

  return createLayout({
    room,
    pieces: data.pieces.map(({ type, x, y, rot }) => ({ type, x, y, rot })),
  });
}

export function importHtml(html) {
  return layoutFromData(extractLayoutJson(html));
}
