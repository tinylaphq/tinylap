// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The request handler, as in the planner: routes return plain
// { status, headers, body } objects and send() writes them, so every rule
// about headers lives here once. A route may instead return
// { status, headers, stream(req, res) } and write the body itself (SSE).
import { rateLimiter } from '@tinylap/auth';
import { createMemberStreams } from './member-streams.js';
import { noticeDigest } from './notices.js';
import { problem } from './responses.js';
import { isInstallPath } from './simulate.js';
import { staticFiles } from './static.js';
import { routes as defaultRoutes } from './routes.js';

const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const API_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Location, Link, ETag, Retry-After',
  Link: '</openapi.json>; rel="service-desc"',
};
const WATCH_PATH = /^\/watch\/[^/]+/;
const CREDENTIAL_HEADERS = { Link: API_HEADERS.Link };

function send(req, res, { status, headers = {}, body, stream }) {
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  if (stream && req.method !== 'HEAD') return stream(req, res);
  res.end(req.method === 'HEAD' ? undefined : body);
}

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
        headers: { ...API_HEADERS, 'Access-Control-Allow-Methods': allowed, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, Last-Event-ID', 'Access-Control-Max-Age': '86400' },
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
  if (!request.settings.simulate && isInstallPath(url.pathname)) {
    return { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: 'not found' };
  }
  return serveStatic(req, url);
}

/** Per-minute and per-hour budgets (spec §9). */
const LIMITS = { ingest: 600, tap: 120, pair: 10 };
/** When an open member stream checks its viewer's access again after an outage or error (#39). */
const ACCESS_CHECK_MS = 15_000;

/**
 * @param {{ store?: any, engine?: any, hub?: any, auth?: any, keys?: any[], root?: string, appDir: string, publicUrl?: string,
 *   plannerUrl?: string, clientIpHeader?: string, build?: string, now?: () => number, log?: boolean | ((line: string) => void),
 *   routes?: any[], settings?: { simulate: string | null }, fetch?: typeof fetch, limits?: { ingest?: number, tap?: number, pair?: number }, accessCheckMs?: number, noticeToken?: string,
 *   streams?: import('./member-streams.js').MemberStreams }} options
 */
export function createHandler(options) {
  const log = typeof options.log === 'function' ? options.log : options.log === false ? null : (line) => console.log(line);
  const now = options.now ?? Date.now;
  const limits = { ...LIMITS, ...options.limits };
  const context = {
    store: options.store ?? null,
    engine: options.engine ?? null,
    hub: options.hub ?? null,
    auth: options.auth ?? null,
    keys: options.keys ?? null,
    publicUrl: options.publicUrl?.replace(/\/$/, '') ?? null,
    plannerUrl: options.plannerUrl?.replace(/\/$/, '') ?? null,
    build: options.build ?? 'dev',
    settings: options.settings ?? { simulate: null },
    clientIpHeader: options.clientIpHeader?.toLowerCase() || null,
    fetch: options.fetch ?? globalThis.fetch,
    now,
    noticeDigest: options.noticeToken ? noticeDigest(options.noticeToken) : null,
    streams: options.streams ?? createMemberStreams({ retryMs: options.accessCheckMs ?? ACCESS_CHECK_MS }),
    limiters: {
      // Batches per decoder per minute; a race of 8 cars is a few passings a second.
      ingest: rateLimiter({ limit: limits.ingest, windowMs: 60_000, now }),
      // Taps per member per minute.
      tap: rateLimiter({ limit: limits.tap, windowMs: 60_000, now }),
      // New decoders per member per hour.
      pair: rateLimiter({ limit: limits.pair, windowMs: 3_600_000, now }),
    },
  };
  const routes = options.routes ?? defaultRoutes;
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
    // No client addresses in the log, ever, and no watchers tokens (spec §7): the token is the whole secret.
    log?.(`${req.method} ${url.pathname.replace(WATCH_PATH, '/watch/…')} ${response.status} ${Math.round(performance.now() - started)}ms`);
  };
}
