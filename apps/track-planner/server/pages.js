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

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Renders an OpenAPI 3.1 document. Local $refs only; that is all ours uses. @param {any} doc */
export function apiPage(doc) {
  const resolve = (node) => (typeof node?.$ref === 'string' && node.$ref.startsWith('#/')
    ? node.$ref.slice(2).split('/').reduce((o, k) => o[k], doc)
    : node);

  const operations = Object.entries(doc.paths).flatMap(([path, item]) =>
    METHODS.filter((m) => item[m]).map((method) => {
      const op = item[method];
      const params = (op.parameters ?? []).map(resolve)
        .map((p) => `<li><code>${esc(p.name)}</code> <span class="meta">${esc(p.in)}</span> ${esc(p.description ?? '')}</li>`).join('');
      const body = op.requestBody
        ? `<p>Request body: ${Object.keys(resolve(op.requestBody).content).map((t) => `<code>${esc(t)}</code>`).join(', ')}</p>`
        : '';
      const responses = Object.entries(op.responses).map(([status, r]) => {
        const res = resolve(r);
        const types = Object.keys(res.content ?? {});
        return `<tr><th scope="row">${esc(status)}</th><td>${esc(res.description)}${types.length ? ` <span class="meta">${types.map(esc).join(', ')}</span>` : ''}</td></tr>`;
      }).join('');
      return `<section>
<h2><span class="method">${method.toUpperCase()}</span> <code>${esc(path)}</code></h2>
<p>${esc(op.summary)}</p>
${op.description ? `<p>${esc(op.description)}</p>` : ''}
${params ? `<ul>${params}</ul>` : ''}
${body}
<table><tbody>${responses}</tbody></table>
</section>`;
    }));

  const problems = Object.entries(doc['x-tinylap-problems'])
    .map(([name, p]) => `<tr id="problem-${esc(name)}"><th scope="row"><code>${esc(name)}</code><br>${p.status}</th><td><strong>${esc(p.title)}.</strong> ${esc(p.description)}</td></tr>`)
    .join('');

  return page(doc.info.title, `<h1>${esc(doc.info.title)}</h1>
<p class="subtitle">OpenAPI ${esc(doc.openapi)} &middot; <a href="/openapi.json">openapi.json</a> &middot; <a href="/schemas/layout.json">layout schema</a></p>
<p>${esc(doc.info.description)}</p>
<p><a href="${esc(doc.externalDocs.url)}">${esc(doc.externalDocs.description)}</a></p>
${operations.join('\n')}
<section id="problems">
<h2>Problem types</h2>
<p>Errors are RFC 9457 Problem Details. Their <code>type</code> ends in one of these names.</p>
<table><tbody>${problems}</tbody></table>
</section>`);
}
