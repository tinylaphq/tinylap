// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The request handler. Routes return plain { status, headers, body }
// objects and send() writes them, so every rule about headers lives here
// once: security headers on everything, CORS and the service-desc link on
// the API, Problem Details for every API error.
import { PROBLEMS } from './problems.js';
import { rateLimiter } from './rate-limit.js';
import { staticFiles } from './static.js';

/** @typedef {{ status: number, headers?: Record<string, string>, body?: string | Buffer }} Response */

const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const API_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Location, Link, ETag, Retry-After',
  Link: '</openapi.json>; rel="service-desc"',
};

/** Pages the server renders have no scripts at all. */
export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** @returns {Response} */
export const json = (status, value, headers = {}) => ({
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof value === 'string' ? value : JSON.stringify(value),
});

/** @returns {Response} */
export const html = (status, text, headers = {}) => ({
  status,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_CSP, ...headers },
  body: text,
});

/** RFC 9457. @param {{ origin: string }} request @param {string} name @param {string} detail @returns {Response} */
export function problem(request, name, detail, headers = {}) {
  const { status, title } = PROBLEMS[name];
  return {
    status,
    headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store', ...headers },
    body: JSON.stringify({ type: `${request.origin}/problems/${name}`, title, status, detail }),
  };
}

function send(req, res, { status, headers = {}, body }) {
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end(req.method === 'HEAD' ? undefined : body);
}

async function dispatch(request, routes, serveStatic) {
  const { req, url } = request;
  for (const route of routes) {
    const match = route.pattern.exec(url.pathname);
    if (!match) continue;
    const allowed = Object.keys(route.methods).join(', ');
    if (req.method === 'OPTIONS') {
      return {
        status: 204,
        headers: { ...API_HEADERS, 'Access-Control-Allow-Methods': allowed, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' },
      };
    }
    const handler = route.methods[req.method === 'HEAD' ? 'GET' : req.method];
    const response = handler
      ? await handler(request, match)
      : problem(request, 'method-not-allowed', `${req.method} is not allowed on ${url.pathname}.`, { Allow: allowed });
    return { ...response, headers: { ...API_HEADERS, ...response.headers } };
  }
  return serveStatic(req, url);
}

/**
 * @param {{ store: ReturnType<typeof import('./store.js').openStore> | null, root?: string, appDir: string,
 *   publicUrl?: string, rateLimit?: number, clientIpHeader?: string, build?: string,
 *   now?: () => number, log?: boolean, routes?: any[] }} options
 */
export function createHandler(options) {
  const context = {
    store: options.store ?? null,
    publicUrl: options.publicUrl?.replace(/\/$/, '') ?? null,
    build: options.build ?? 'dev',
    limiter: rateLimiter({ limit: options.rateLimit ?? 30, now: options.now }),
    clientIpHeader: options.clientIpHeader?.toLowerCase() || null,
  };
  const routes = options.routes ?? [];
  const serveStatic = staticFiles(options);

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
