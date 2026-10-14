// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pages the server renders itself. No scripts, and palace-ui's look written
// out literally, like the export page, so they need nothing from elsewhere.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** @param {unknown} value */
export const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const STYLE = `
  * { box-sizing: border-box; }
  body { font: 14px/1.5 'Space Grotesk', system-ui, sans-serif; color: #0a0a0a;
         background: #f0f0f0; margin: 0; padding: 48px 24px; }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 28px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 8px; }
  h2 { font-size: 16px; font-weight: 700; margin: 40px 0 8px; }
  .subtitle { color: #666; text-transform: uppercase; letter-spacing: 1px; font-size: 12px; font-weight: 600; margin: 0 0 32px; }
  .meta { color: #666; font-size: 12px; }
  .method { background: #0a0a0a; color: #fff; padding: 2px 6px; font-size: 12px; letter-spacing: 1px; }
  code { font: 13px ui-monospace, monospace; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 2px solid #0a0a0a; margin: 8px 0; }
  th, td { padding: 8px 12px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
  th { font-size: 12px; white-space: nowrap; }
  ul { padding-left: 20px; }
  a { color: inherit; }
`;

/** @param {string} title @param {string} body Already escaped HTML. */
export const page = (title, body) => `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
<main>
${body}
</main>
</html>
`;

/** @param {{ shapeKey: string, layouts: { key: string, trackId: string, createdAt: string }[] }} listing */
export function shapePage({ shapeKey, layouts }) {
  const items = layouts
    .map((l) => `<li><a href="/layouts/${esc(l.key)}"><code>${esc(l.key)}</code></a> <span class="meta">track ${esc(l.trackId)} &middot; ${esc(l.createdAt)}</span></li>`)
    .join('\n');
  return page('One build, every snapshot', `<h1>One build</h1>
<p class="subtitle">Shape ${esc(shapeKey)}</p>
<p>Every stored snapshot of this build. Snapshots with the same track id are the same track; different track ids are separate tracks built the same way.</p>
<ul>
${items}
</ul>`);
}
