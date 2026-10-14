// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Keeps openapi.json honest: every response below is checked against what
// the description says for its path, method and status, and every response
// the description documents must have been produced at least once.
import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import openapi from '../../server/openapi.json' with { type: 'json' };
import layoutSchema from '@tinylap/track-format/layout.schema.json' with { type: 'json' };
import { snapshotKey, shapeKey } from '@tinylap/track-format';
import { mediaType } from '../../server/negotiate.js';
import { startServer, closedLayout, openLayout } from './helpers.js';

const BASE = 'http://tinylap.test';
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(layoutSchema, `${BASE}/schemas/layout.json`);

const local = (ref) => ref.slice(2).split('/').reduce((o, k) => o[k], openapi);
const deref = (node) => {
  if (Array.isArray(node)) return node.map(deref);
  if (!node || typeof node !== 'object') return node;
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) return deref(local(node.$ref));
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, deref(v)]));
};

// Longest first, so /layouts/{key}.json wins over /layouts/{key}.
const templates = Object.keys(openapi.paths)
  .map((path) => ({ path, re: new RegExp(`^${path.replace(/[.]/g, '\\.').replace(/\{[^}]+\}/g, '[^/]+')}$`) }))
  .sort((a, b) => b.path.length - a.path.length);

const seen = new Set();
let schemas = 0;

async function check(method, url, res) {
  const path = new URL(url).pathname;
  const template = templates.find((t) => t.re.test(path));
  assert.ok(template, `undocumented path ${path}`);
  const op = deref(openapi.paths[template.path])[method.toLowerCase()];
  assert.ok(op, `undocumented ${method} ${template.path}`);
  const documented = op.responses[String(res.status)];
  assert.ok(documented, `${method} ${template.path} does not document ${res.status}`);
  seen.add(`${method} ${template.path} ${res.status}`);
  const text = await res.text();
  if (!documented.content) return assert.equal(text, '', `${res.status} has an undocumented body`);
  const type = mediaType(res.headers.get('content-type'));
  const media = documented.content[type];
  assert.ok(media, `${method} ${template.path} ${res.status} does not document ${type}`);
  if (!type.endsWith('json')) return;
  const validate = ajv.compile({ $id: `${BASE}/r/${schemas++}`, ...media.schema });
  assert.ok(validate(JSON.parse(text)), `${method} ${path} ${res.status}: ${ajv.errorsText(validate.errors)}`);
}

const CHROME = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

test('every response matches the description', async () => {
  const up = await startServer();
  const limited = await startServer({ rateLimit: 0 });
  const down = await startServer({ store: null });
  const call = async (base, method, path, init = {}) => {
    const res = await fetch(base + path, { method, redirect: 'manual', ...init });
    await check(method, base + path, res);
    return res;
  };
  const postJson = (base, body) => call(base, 'POST', '/layouts', { headers: { 'Content-Type': 'application/json' }, body });
  try {
    const layout = closedLayout();
    const key = await snapshotKey(layout);
    const sk = await shapeKey(layout.track.shape);
    const missing = 'AAAAAAAAAAAAAAAAAAAAAA';

    await postJson(up.base, JSON.stringify(layout));            // 201
    await postJson(up.base, JSON.stringify(layout));            // 200
    await postJson(up.base, JSON.stringify(openLayout()));
    await call(up.base, 'POST', '/layouts', { headers: { 'Content-Type': 'text/plain' }, body: 'x' });  // 415
    await postJson(up.base, 'x'.repeat(600 * 1024));            // 413
    await postJson(up.base, '{oops');                           // 422
    await postJson(limited.base, JSON.stringify(layout));       // 429
    await postJson(down.base, JSON.stringify(layout));          // 503

    for (const suffix of ['', '.json', '.html']) {
      const res = await call(up.base, 'GET', `/layouts/${key}${suffix}`, { headers: { accept: CHROME } });
      await call(up.base, 'GET', `/layouts/${key}${suffix}`, { headers: { accept: CHROME, 'if-none-match': res.headers.get('etag') } });
      await call(up.base, 'GET', `/layouts/${missing}${suffix}`);
      await call(down.base, 'GET', `/layouts/${key}${suffix}`);
    }
    await call(up.base, 'GET', `/layouts/${key}`);
    await call(up.base, 'GET', `/shapes/${sk}`);
    await call(up.base, 'GET', `/shapes/${sk}`, { headers: { accept: CHROME } });
    await call(up.base, 'GET', `/shapes/${missing}`);
    await call(down.base, 'GET', `/shapes/${sk}`);
    for (const path of ['/openapi.json', '/schemas/layout.json', '/.well-known/api-catalog', '/api', '/problems/too-large', '/problems/nope']) {
      await call(up.base, 'GET', path);
    }
  } finally {
    await Promise.all([up.close(), limited.close(), down.close()]);
  }
});

test('every documented response was produced', () => {
  for (const [path, item] of Object.entries(openapi.paths)) {
    for (const [method, op] of Object.entries(item)) {
      for (const status of Object.keys(op.responses)) {
        assert.ok(seen.has(`${method.toUpperCase()} ${path} ${status}`), `${method.toUpperCase()} ${path} ${status} was never produced`);
      }
    }
  }
});
