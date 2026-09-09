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
  body { font: 16px/1.5 system-ui, sans-serif; margin: 2rem; background: #fafafa; color: #222; }
  svg { max-width: 100%; height: auto; background: #fff; border: 1px solid #ddd; }
  table { border-collapse: collapse; margin-top: 1rem; }
  th, td { border: 1px solid #ddd; padding: 0.25rem 0.75rem; text-align: left; }
  td { text-align: right; font-variant-numeric: tabular-nums; }
</style>
<h1>Circuit 30 layout</h1>
<figure>
  ${svg}
  <figcaption>${size} &middot; ${matCount} mats &middot; lap ${(lapMm / 1000).toFixed(2)} m</figcaption>
</figure>
<table><caption>Bill of materials</caption><tbody>${rows}</tbody></table>
<p>Open this file in the Circuit 30 Planner to keep editing it.</p>
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

export function importHtml(html) {
  const data = extractLayoutJson(html);

  if (data.version !== SUPPORTED_VERSION) {
    throw new Error(
      `This file was saved by a newer planner (version ${data.version}); this build reads version ${SUPPORTED_VERSION}.`,
    );
  }
  if (!Array.isArray(data.pieces)) {
    throw new Error('The layout data has no pieces array.');
  }
  for (const piece of data.pieces) {
    if (!PIECES[piece.type]) throw new Error(`Unknown piece type: ${piece.type}`);
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
