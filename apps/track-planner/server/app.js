// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The request handler. Routes return plain { status, headers, body }
// objects and send() writes them, so every rule about headers lives here
// once: security headers on everything, CORS and the service-desc link on
// the API, Problem Details for every API error.
import { problem } from './responses.js';
import { rateLimiter } from '@tinylap/auth';
import { staticFiles } from './static.js';
import { layoutRoutes } from './layouts.js';
import { discoveryRoutes } from './discovery.js';
import { authRoutes } from './auth.js';
import { libraryRoutes } from './library.js';

const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const API_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Location, Link, ETag, Retry-After',
  Link: '</openapi.json>; rel="service-desc"',
};

function send(req, res, { status, headers = {}, body }) {
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end(req.method === 'HEAD' ? undefined : body);
}

// Routes marked `credentials: true` read the session cookie, so they never
// allow other origins (no CORS) and tell caches that the cookie matters.
// A route marked `varyCookie: true` may read it (GET /layouts/<key> does, for
// private snapshots): every response varies on Cookie, and only a response
// marked `credentials: true` drops CORS.
const CREDENTIAL_HEADERS = { Link: API_HEADERS.Link };

/**
 * @param {{ credentials?: boolean, varyCookie?: boolean }} route @param {Record<string, any>} [headers]
 * @param {boolean} [credentials] the response's own mark
 */
function withRouteHeaders(route, headers = {}, credentials = false) {
  const vary = headers.Vary ? `${headers.Vary}, Cookie` : 'Cookie';
  if (route.credentials || credentials) return { ...CREDENTIAL_HEADERS, ...headers, Vary: vary };
  if (route.varyCookie) return { ...API_HEADERS, ...headers, Vary: vary };
  return { ...API_HEADERS, ...headers };
}

async function dispatch(request, routes, serveStatic) {
  const { req, url } = request;
  for (const route of routes) {
    const match = route.pattern.exec(url.pathname);
    if (!match) continue;
    if (route.unknown) {
      const miss = problem(request, 'not-found', 'There is no such route.');
      return { ...miss, headers: withRouteHeaders(route, miss.headers) };
    }
    const names = Object.keys(route.methods);
    const allowed = [...names, ...(names.includes('GET') ? ['HEAD'] : []), 'OPTIONS'].join(', ');
    if (req.method === 'OPTIONS') {
      if (route.credentials) return { status: 204, headers: withRouteHeaders(route, { Allow: allowed }) };
      return {
        status: 204,
        headers: { ...API_HEADERS, 'Access-Control-Allow-Methods': allowed, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' },
      };
    }
    const handler = route.methods[req.method === 'HEAD' ? 'GET' : req.method];
    let response;
    try {
      response = handler
        ? await handler(request, match)
        : problem(request, 'method-not-allowed', `${req.method} is not allowed on ${url.pathname}.`, { Allow: allowed });
    } catch (error) {
      // createHandler's catch would add CORS; a credentials route must not get it.
      if (!route.credentials) throw error;
      console.error(error);
      response = problem(request, 'unavailable', 'The server could not complete the request.');
    }
    const { credentials, ...rest } = response;
    return { ...rest, headers: withRouteHeaders(route, response.headers, credentials) };
  }
  return serveStatic(req, url);
}

/**
 * @param {{ store: ReturnType<typeof import('./store.js').openStore> | null, root?: string, appDir: string,
 *   publicUrl?: string, rateLimit?: number, saveLimit?: number, clientIpHeader?: string, build?: string,
 *   now?: () => number, log?: boolean, routes?: any[], auth?: import('./auth.js').Auth | null }} options
 *   `auth` turns log-in on (see auth.js); without it the planner is anonymous only.
 */
export function createHandler(options) {
  const context = {
    store: options.store ?? null,
    publicUrl: options.publicUrl?.replace(/\/$/, '') ?? null,
    build: options.build ?? 'dev',
    limiter: rateLimiter({ limit: options.rateLimit ?? 30, now: options.now }),
    // Library saves, per user (identity spec §4).
    saves: rateLimiter({ limit: options.saveLimit ?? 60, now: options.now }),
    clientIpHeader: options.clientIpHeader?.toLowerCase() || null,
    auth: options.auth ?? null,
  };
  const routes = options.routes ?? [...layoutRoutes, ...authRoutes, ...libraryRoutes, ...discoveryRoutes];
  const serveStatic = staticFiles({ ...options, formAction: context.auth ? [new URL(context.auth.issuer).origin] : [] });

  return async (req, res) => {
    const started = performance.now();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const origin = context.publicUrl ?? `http://${req.headers.host ?? 'localhost'}`;
    const request = { ...context, req, url, origin };
    let response;
    try {
      response = await dispatch(request, routes, serveStatic);
    } catch (error) {
      console.error(error);
      response = { ...problem(request, 'unavailable', 'The server could not complete the request.'), headers: { ...API_HEADERS, 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' } };
    }
    send(req, res, response);
    // No client addresses in the log, ever.
    if (options.log !== false) console.log(`${req.method} ${url.pathname} ${response.status} ${Math.round(performance.now() - started)}ms`);
  };
}
