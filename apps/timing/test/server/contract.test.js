// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The API description and the routes cannot drift apart: every documented
// operation has a route, and every route is documented.
import test from 'node:test';
import assert from 'node:assert/strict';
import openapi from '../../server/openapi.json' with { type: 'json' };
import { pageRoutes } from '../../server/page-routes.js';
import { routes } from '../../server/routes.js';

// Pages are not part of the JSON API.
const real = routes.filter((r) => !r.unknown && !pageRoutes.includes(r));
const sample = (path) => path.replace(/\{[^}]+\}/g, 'x1');

test('every documented operation has a route', () => {
  for (const [path, item] of Object.entries(openapi.paths)) {
    const route = real.find((r) => r.pattern.test(sample(path)));
    assert.ok(route, `no route for ${path}`);
    for (const method of Object.keys(item)) assert.ok(route.methods[method.toUpperCase()], `${method.toUpperCase()} ${path}`);
  }
});

test('every route is documented', () => {
  const docs = Object.entries(openapi.paths).map(([path, item]) => [sample(path), item]);
  for (const route of real) {
    for (const method of Object.keys(route.methods)) {
      assert.ok(docs.some(([path, item]) => route.pattern.test(path) && item[method.toLowerCase()]), `undocumented ${method} ${route.pattern}`);
    }
  }
});
