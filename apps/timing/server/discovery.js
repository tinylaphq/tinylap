// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// How a client finds out what this server is: the OpenAPI description
// (linked from every API response by rel="service-desc"), the RFC 9727
// catalog, the problem types and the docs page.
import openapi from './openapi.json' with { type: 'json' };
import { PROBLEMS } from './problems.js';
import { html, problem } from './responses.js';
import { apiPage } from './pages.js';

const DESCRIPTION = JSON.stringify(openapi);
const DOCS = apiPage(openapi);
const fresh = { 'Cache-Control': 'no-cache' };

const catalog = (request) => ({
  status: 200,
  headers: { 'Content-Type': 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"', ...fresh },
  body: JSON.stringify({
    linkset: [{
      anchor: `${request.origin}/workspaces`,
      'service-desc': [{ href: `${request.origin}/openapi.json`, type: 'application/vnd.oai.openapi+json' }],
      'service-doc': [{ href: `${request.origin}/api`, type: 'text/html' }],
    }],
  }),
});

export const discoveryRoutes = [
  { pattern: /^\/openapi\.json$/, methods: { GET: () => ({ status: 200, headers: { 'Content-Type': 'application/vnd.oai.openapi+json;version=3.1', ...fresh }, body: DESCRIPTION }) } },
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
