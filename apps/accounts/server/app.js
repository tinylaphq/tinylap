// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The request handler: TinyLap's pages, styles and scripts first, then
// everything else to Better Auth at the root, so the issuer is the origin.
// Security headers go on every response, whoever writes it.
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAPIError } from 'better-auth/api';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { clientBucket, rateLimiter } from '@tinylap/auth';
import { packageRoots, within } from '../../../tools/serve-map.js';
import { createAuth, authOptions, seedClients } from './auth.js';
import { openDb } from './db.js';
import { createRecoveryCodes, lookupIdOf } from './recovery.js';
import { escapeHtml, layout } from './pages/layout.js';
import { signInPage } from './pages/sign-in.js';
import { signUpPage } from './pages/sign-up.js';
import { recoverPage } from './pages/recover.js';

const APP_DIR = fileURLToPath(new URL('..', import.meta.url));

const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

const isFile = (path) => stat(path).then((s) => s.isFile(), () => false);

// Spec §9: per client (IPv6 per /64), an hour each.
const LIMITS = { signUp: 10, signIn: 30, recovery: 10, recoveryLookup: 5 };

// What a recovery session may still do (spec §6): add a passkey, manage its
// recovery codes, see the recovery page, or sign out. Everything else,
// Better Auth's routes included, is refused until a passkey is registered.
const RECOVERY_ALLOWED = new Set([
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/recovery-codes',
  '/recover',
  '/sign-out',
  '/error',
]);

const PROBLEMS = {
  'bad-request': { status: 400, title: 'Bad request' },
  unauthorized: { status: 401, title: 'Sign in first' },
  'recovery-only': { status: 403, title: 'Add a passkey first' },
  'cross-site': { status: 403, title: 'Cross-site request refused' },
  'rate-limited': { status: 429, title: 'Too many requests' },
};

const consentPage = () => layout({ title: 'Allow access', lede: 'No other apps can ask for access to your account yet.', body: '' });

/** Better Auth sends its errors here (onAPIError.errorURL). */
const errorPage = (url) => layout({
  title: 'Something went wrong',
  lede: 'The app that sent you here asked for something TinyLap could not do.',
  body: `
<div class="card-static stack-md">
  <p class="status status-error" role="alert"><code>${escapeHtml(url.searchParams.get('error') ?? 'unknown_error')}</code></p>
  <p>${escapeHtml(url.searchParams.get('error_description') ?? '')}</p>
  <p><a href="/sign-in">Back to sign-in</a></p>
</div>`,
});

/** The page a recovery session gets for anything but the recovery flow. */
const recoveryOnlyPage = () => layout({
  title: 'Add a passkey first',
  lede: 'You signed in with a recovery code.',
  body: `
<div class="card-static stack-md">
  <p>Until you add a new passkey, your account can do nothing else.</p>
  <a href="/recover" class="btn btn-primary btn-block">Add a passkey</a>
</div>`,
});

function send(req, res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

const html = (req, res, body, status = 200) =>
  send(req, res, status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_CSP, 'Cache-Control': 'no-store' }, body);

const json = (req, res, status, value, headers = {}) =>
  send(req, res, status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }, JSON.stringify(value));

/** RFC 9457 Problem Details, as the planner sends them. */
function problem(req, res, issuer, name, detail, headers = {}) {
  const { status, title } = PROBLEMS[name];
  send(req, res, status, { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store', ...headers },
    JSON.stringify({ type: `${issuer}/problems/${name}`, title, status, detail }));
}

/** A small JSON body, or undefined if it is missing, too big or not JSON. */
async function readJson(req, max = 4096) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

const wantsHtml = (req) => req.headers['sec-fetch-mode'] === 'navigate' || /text\/html/.test(req.headers.accept ?? '');

/**
 * Static assets: /pkg/<name>/… from the app's dependencies (palace-ui,
 * @tinylap/design), /public/… from apps/accounts/public. Null if the path is
 * none of ours.
 */
function assetPath(roots, pathname) {
  const pkg = /^\/pkg\/([^/]+)\/(.+)$/.exec(pathname);
  if (pkg) {
    const root = roots.get(pkg[1]);
    return root ? within(root, pkg[2]) ?? false : false;
  }
  if (pathname.startsWith('/pkg/')) return false;
  if (pathname.startsWith('/public/')) return within(join(APP_DIR, 'public'), pathname.slice('/public/'.length)) ?? false;
  return null;
}

// The only dependencies whose files the pages load. Everything else in
// package.json (Better Auth and its plugins, @tinylap/auth) is server code.
const SERVED = ['palace-ui', 'design'];

/** The /pkg/<segment>/ roots accounts serves: palace-ui and @tinylap/design only. */
export function servedPackages() {
  const all = packageRoots(APP_DIR);
  return new Map(SERVED.flatMap((segment) => (all.has(segment) ? [[segment, all.get(segment)]] : [])));
}

/**
 * @param {import('./config.js').Config} config
 */
export async function createAccounts(config) {
  const db = await openDb(config.dbPath, authOptions(config));
  const auth = createAuth(config, db);
  await seedClients(auth, config.clients);
  const betterAuth = toNodeHandler(auth);
  const roots = servedPackages();
  const cache = config.dev ? 'no-store' : 'public, max-age=3600';

  const limiters = Object.fromEntries(Object.entries(LIMITS).map(([name, limit]) => [name, rateLimiter({ limit })]));
  const { issuer } = config;

  /** Only a configured header names the client: an unconfigured one is just a forgery. */
  const clientOf = (req) => {
    const value = config.clientIpHeader && req.headers[config.clientIpHeader];
    return clientBucket(typeof value === 'string' && value ? value : req.socket.remoteAddress ?? 'unknown');
  };

  /** True if the limiter let it through; otherwise the 429 has been sent. */
  const allow = (req, res, limiter, key) => {
    const wait = limiters[limiter].take(key);
    if (!wait) return true;
    problem(req, res, issuer, 'rate-limited', `Try again in ${wait} seconds.`, { 'Retry-After': String(wait) });
    return false;
  };

  /** State-changing requests must come from our own pages (spec §9). */
  const sameOrigin = (req) => req.headers['sec-fetch-site'] === 'same-origin' || req.headers.origin === issuer;

  /**
   * The Better Auth session of this request, or null. Never refreshes it.
   * @returns {Promise<{ user: { id: string, name: string }, session: { recovery?: boolean } } | null>}
   */
  const sessionOf = async (req) => {
    if (!req.headers.cookie) return null;
    return auth.api.getSession({ headers: fromNodeHeaders(req.headers), query: { disableRefresh: true } });
  };

  /** POST /recover: spend a code, sign in with a recovery session. */
  async function redeem(req, res) {
    if (!sameOrigin(req)) return problem(req, res, issuer, 'cross-site', 'Use the recovery page.');
    if (!allow(req, res, 'recovery', clientOf(req))) return;
    const body = await readJson(req);
    if (!body || typeof body !== 'object') return problem(req, res, issuer, 'bad-request', 'Send { "code": "<recovery code>" } as JSON.');
    const lookup = lookupIdOf(body.code);
    if (lookup && !allow(req, res, 'recoveryLookup', lookup)) return;
    try {
      const { headers, response } = await /** @type {any} */ (auth.api).redeemRecoveryCode({ body: { code: body.code }, headers: fromNodeHeaders(req.headers), returnHeaders: true });
      return json(req, res, 200, response, { 'Set-Cookie': headers.getSetCookie() });
    } catch (error) {
      if (isAPIError(error) && error.statusCode === 401) return problem(req, res, issuer, 'unauthorized', error.message);
      throw error;
    }
  }

  /** POST /recovery-codes: a new set for the signed-in user, shown once. */
  async function newCodes(req, res, session) {
    if (!sameOrigin(req)) return problem(req, res, issuer, 'cross-site', 'Make new codes from your account page.');
    req.resume();
    if (!session) return problem(req, res, issuer, 'unauthorized', 'Sign in to make new recovery codes.');
    return json(req, res, 200, { codes: createRecoveryCodes(db, session.user.id) });
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  async function route(req, res) {
    // One plain origin-form target ("/path"), so the recovery gate and
    // Better Auth read the same path: no "//host/…", no absolute-form.
    if (!/^\/(?!\/)/.test(req.url ?? '')) return problem(req, res, issuer, 'bad-request', 'The request target must be a path starting with one "/".');
    const url = new URL(req.url ?? '/', 'http://localhost');
    const { pathname } = url;
    const readOnly = req.method === 'GET' || req.method === 'HEAD';

    const asset = assetPath(roots, pathname);
    if (asset !== null) {
      const type = asset && TYPES[extname(asset)];
      if (!readOnly || !type || !(await isFile(asset))) {
        return send(req, res, 404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, 'not found');
      }
      return send(req, res, 200, { 'Content-Type': type, 'Cache-Control': cache }, await readFile(asset));
    }

    const session = await sessionOf(req);
    if (session?.session.recovery && !RECOVERY_ALLOWED.has(pathname)) {
      if (readOnly && wantsHtml(req)) return html(req, res, recoveryOnlyPage(), 403);
      return problem(req, res, issuer, 'recovery-only', 'You signed in with a recovery code. Add a passkey at /recover first.');
    }

    if (readOnly) {
      if (pathname === '/sign-in') return html(req, res, signInPage(url));
      if (pathname === '/sign-up') return html(req, res, signUpPage(url, session && { name: session.user.name }));
      if (pathname === '/recover') return html(req, res, recoverPage(url, session?.session.recovery ? { name: session.user.name } : null));
      if (pathname === '/consent') return html(req, res, consentPage());
      if (pathname === '/error') return html(req, res, errorPage(url));
      // A stub of the account API (Task 5), to show the recovery restriction.
      if (pathname === '/api/me') {
        if (!session) return problem(req, res, issuer, 'unauthorized', 'Sign in first.');
        return json(req, res, 200, { id: session.user.id, name: session.user.name });
      }
      if (pathname === '/passkey/generate-register-options' && !allow(req, res, 'signUp', clientOf(req))) return;
      if (pathname === '/passkey/generate-authenticate-options' && !allow(req, res, 'signIn', clientOf(req))) return;
    } else if (req.method === 'POST') {
      if (pathname === '/recover') return redeem(req, res);
      if (pathname === '/recovery-codes') return newCodes(req, res, session);
    }

    return betterAuth(req, res);
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  async function handler(req, res) {
    for (const [name, value] of Object.entries(BASE_HEADERS)) res.setHeader(name, value);
    // The default for everything, Better Auth's responses included; a
    // response that sets its own (its end-session pages, stricter) keeps it.
    res.setHeader('Content-Security-Policy', PAGE_CSP);
    res.removeHeader('Server');
    try {
      await route(req, res);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(req, res, 500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, 'server error');
      else res.destroy();
    }
  }

  const close = () => {
    for (const limiter of Object.values(limiters)) limiter.stop();
    db.close();
  };
  return { handler, auth, db, close };
}
