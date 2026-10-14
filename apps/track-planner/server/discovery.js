// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// How a client finds out what this server is: the OpenAPI description
// (linked from every API response by rel="service-desc"), the layout schema
// it references, the RFC 9727 catalog, the problem types and the docs page.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import openapi from './openapi.json' with { type: 'json' };
import { PROBLEMS } from './problems.js';
import { problem, html } from './app.js';
import { apiPage } from './pages.js';

const DESCRIPTION = JSON.stringify(openapi);
const SCHEMA = readFileSync(fileURLToPath(import.meta.resolve('@tinylap/track-format/layout.schema.json')), 'utf8');
const DOCS = apiPage(openapi);
const fresh = { 'Cache-Control': 'no-cache' };

const catalog = (request) => ({
  status: 200,
  headers: { 'Content-Type': 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"', ...fresh },
  body: JSON.stringify({
    linkset: [{
      anchor: `${request.origin}/layouts`,
      'service-desc': [{ href: `${request.origin}/openapi.json`, type: 'application/vnd.oai.openapi+json' }],
      'service-doc': [{ href: `${request.origin}/api`, type: 'text/html' }],
    }],
  }),
});

export const discoveryRoutes = [
  { pattern: /^\/openapi\.json$/, methods: { GET: () => ({ status: 200, headers: { 'Content-Type': 'application/vnd.oai.openapi+json;version=3.1', ...fresh }, body: DESCRIPTION }) } },
  { pattern: /^\/schemas\/layout\.json$/, methods: { GET: () => ({ status: 200, headers: { 'Content-Type': 'application/schema+json', ...fresh }, body: SCHEMA }) } },
  { pattern: /^\/\.well-known\/api-catalog$/, methods: { GET: catalog } },
  {
    pattern: /^\/problems\/([^/]+)$/,
    methods: {
      GET: (request, [, name]) => (Object.hasOwn(PROBLEMS, name)
        ? { status: 302, headers: { Location: `/api#problem-${name}`, ...fresh } }
        : problem(request, 'not-found', 'There is no such problem type.')),
    },
  },
  { pattern: /^\/api$/, methods: { GET: () => html(200, DOCS, fresh) } },
];
