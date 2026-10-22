// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The request handler: TinyLap's pages, styles and scripts first, then the
// Better Auth routes TinyLap uses (an allow-list) at the root, so the issuer
// is the origin. Anything else is a 404.
// Security headers go on every response, whoever writes it.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAPIError } from 'better-auth/api';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { can, clientBucket, rateLimiter } from '@tinylap/auth';
import { SPECULATION_HASH } from '@tinylap/design/html/speculation.js';
import { packageRoots, within } from '../../../tools/serve-map.js';
import { createAuth, authOptions, seedClients } from './auth.js';
import { openDb } from './db.js';
import { createRecoveryCodes, lookupIdOf } from './recovery.js';
import { handleApi } from './api.js';
import { readDeletions } from './deletions.js';
import { claimsOf, inspectInvite, listInvites, listMembers, listMemberships, WorkspaceError } from './workspaces.js';
import { escapeHtml, layout } from './pages/layout.js';
import { signInPage } from './pages/sign-in.js';
import { signUpPage } from './pages/sign-up.js';
import { recoverPage } from './pages/recover.js';
import { clubsPage } from './pages/clubs.js';
import { clubPage } from './pages/club.js';
import { invitePage } from './pages/invite.js';
import { accountPage } from './pages/account.js';
import { privacyPage } from './pages/privacy.js';
import { signedOutPage } from './pages/signed-out.js';
import { listPasskeys, ownedClubs, recoveryCodesLeft } from './account.js';
import { createNotifier } from './notices.js';

const APP_DIR = fileURLToPath(new URL('..', import.meta.url));

const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
export const PAGE_CSP = [
  "default-src 'self'",
  // Our own scripts, and the speculation rules inlined in every page's head.
  `script-src 'self' '${SPECULATION_HASH}'`,
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
const LIMITS = { signUp: 10, signIn: 30, recovery: 10, recoveryLookup: 5, invite: 20 };

// What a recovery session may still do (spec §6): add a passkey, manage its
// recovery codes, see the recovery page, or sign out. Everything else,
// Better Auth's routes included, is refused until a passkey is registered.
// The privacy and signed-out pages show nothing of the account.
const RECOVERY_ALLOWED = new Set([
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/recovery-codes',
  '/recover',
  '/sign-out',
  '/error',
  '/privacy',
  '/signed-out',
]);

// The only Better Auth routes reachable over HTTP: passkey ceremonies,
// sign-out, and the OAuth/OIDC provider's protocol endpoints. Everything
// else it ships (session and user self-service such as /update-user or
// /list-sessions, consent and client management) bypasses TinyLap's own
// rules and is a 404. Server-side calls (auth.api) are not affected.
const BETTER_AUTH_ROUTES = new Set([
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/generate-authenticate-options',
  '/passkey/verify-authentication',
  '/sign-out',
  '/oauth2/authorize',
  '/oauth2/token',
  '/oauth2/revoke',
  '/oauth2/userinfo',
  '/oauth2/end-session',
  '/jwks',
  '/.well-known/openid-configuration',
  '/.well-known/oauth-authorization-server',
]);

// A session counts as fresh for this long after the passkey sign-in (or
// sign-up) that created it. Adding a passkey, new recovery codes, removing
// a passkey and deleting the account need a fresh session, so a stolen
// 30-day cookie cannot plant a lasting passkey or take the account away.
// Better Auth's own freshSessionMiddleware is not reachable here: the
// passkey plugin applies it only with registration.requireSession, which
// sign-up must leave off. A recovery session is exempt: its only way on is
// to add a passkey.
export const FRESH_SECONDS = 10 * 60;
const FRESH_PATHS = new Set(['/passkey/generate-register-options', '/passkey/verify-registration', '/recovery-codes']);

/** @param {{ session: { createdAt: Date | string, recovery?: boolean } } | null} session */
const isFresh = (session) => Boolean(session) && Date.now() - new Date(session.session.createdAt).getTime() <= FRESH_SECONDS * 1000;

const PROBLEMS = {
  'bad-request': { status: 400, title: 'Bad request' },
  unauthorized: { status: 401, title: 'Sign in first' },
  'recovery-only': { status: 403, title: 'Add a passkey first' },
  'cross-site': { status: 403, title: 'Cross-site request refused' },
  reauthenticate: { status: 403, title: 'Confirm it is you' },
  'not-found': { status: 404, title: 'Not found' },
  'method-not-allowed': { status: 405, title: 'Method not allowed' },
  'rate-limited': { status: 429, title: 'Too many requests' },
};

const consentPage = () => layout({ title: 'Allow access', lede: 'No other apps can ask for access to your account yet.', body: '' });

/** Better Auth sends its errors here (onAPIError.errorURL). */
const errorPage = (url) => layout({
  title: 'That request did not work',
  lede: 'The app that sent you here asked for something TinyLap Accounts does not allow. Go back to that app and try again.',
  body: `
<div class="card-static stack-md">
  <p class="status status-error" role="alert"><code>${escapeHtml(url.searchParams.get('error') ?? 'unknown_error')}</code></p>
  <p>${escapeHtml(url.searchParams.get('error_description') ?? '')}</p>
  <p><a href="/sign-in">Back to sign-in</a></p>
</div>`,
});

/** A signed-in page's 404: a club that does not exist, or not for you. */
const notFoundPage = () => layout({
  title: 'Not found',
  body: `
<div class="card-static stack-md">
  <p>There is no such club, or you are not a member of it.</p>
  <p><a href="/clubs">Your clubs</a></p>
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

const json = (req, res, status, value, headers = {}) => (status === 204
  ? send(req, res, 204, { 'Cache-Control': 'no-store', ...headers }, undefined)
  : send(req, res, status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }, JSON.stringify(value)));

/** RFC 9457 Problem Details, as the planner sends them. */
function problem(req, res, issuer, name, detail, headers = {}) {
  const { status, title } = PROBLEMS[name];
  problemBody(req, res, { type: `${issuer}/problems/${name}`, title, status, detail }, headers);
}

/** @param {{ type: string, title: string, status: number, detail: string }} body */
function problemBody(req, res, body, headers = {}) {
  send(req, res, body.status, { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store', ...headers }, JSON.stringify(body));
}

/** Where a signed-out visitor to a signed-in page goes: sign-in, then back. */
const toSignIn = (req, res, pathname) =>
  send(req, res, 303, { Location: `/sign-in?next=${encodeURIComponent(pathname)}`, 'Cache-Control': 'no-store' }, '');

const sha256 = (text) => createHash('sha256').update(text).digest();

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

  // What clearing this browser's session cookie looks like, after signing
  // out everywhere or deleting the account.
  const { sessionToken } = (await auth.$context).authCookies;
  const clearCookie = [[
    `${sessionToken.name}=`, 'Max-Age=0', `Path=${sessionToken.attributes.path ?? '/'}`, 'HttpOnly',
    `SameSite=${sessionToken.attributes.sameSite ?? 'lax'}`, ...(sessionToken.attributes.secure ? ['Secure'] : []),
  ].join('; ')];
  // The planner, whose /library/export holds the user's tracks.
  const planner = config.clients.find((c) => c.trusted)?.resource ?? null;

  const notify = createNotifier({ clients: config.clients });

  const limiters = Object.fromEntries(Object.entries(LIMITS).map(([name, limit]) => [name, rateLimiter({ limit })]));
  const { issuer } = config;

  /** Only a configured header names the client: an unconfigured one is just a forgery. */
  const clientOf = (req) => {
    const value = config.clientIpHeader && req.headers[config.clientIpHeader];
    return clientBucket(typeof value === 'string' && value ? value : req.socket.remoteAddress ?? 'unknown');
  };

  // The deletions feed's consumers (spec §7), compared as SHA-256 digests in
  // constant time: neither a token's content nor its length leaks.
  const feedDigests = config.feedTokens.map(sha256);
  const feedAllowed = (req) => {
    const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization ?? '');
    if (!match) return false;
    const given = sha256(match[1]);
    let ok = false;
    for (const digest of feedDigests) ok = timingSafeEqual(given, digest) || ok;
    return ok;
  };

  /** GET /deletions?after=<seq>, bearer-token authenticated. */
  function deletions(req, res, url) {
    if (!feedAllowed(req)) return problem(req, res, issuer, 'unauthorized', 'Send a feed token as Authorization: Bearer <token>.', { 'WWW-Authenticate': 'Bearer realm="deletions"' });
    const after = url.searchParams.get('after') ?? '0';
    if (!/^\d{1,15}$/.test(after)) return problem(req, res, issuer, 'bad-request', 'after must be a whole number, the last seq you processed.');
    return json(req, res, 200, readDeletions(db, Number(after)));
  }

  /** The signed-in pages: /, /clubs, /clubs/:id, /invite/:token, /account. Null if none of them. */
  function page(req, res, pathname, session) {
    // The site's address is the account page, as account sites do: there
    // when signed in, else through sign-in. It depends on the session, so
    // it is a 303 nothing may keep.
    if (pathname === '/') {
      if (!session) return toSignIn(req, res, '/account');
      return send(req, res, 303, { Location: '/account', 'Cache-Control': 'no-store' }, '');
    }
    if (pathname === '/account') {
      if (!session) return toSignIn(req, res, pathname);
      const { id } = session.user;
      const user = db.prepare('SELECT id, name, createdAt FROM "user" WHERE id = ?').get(id);
      return html(req, res, accountPage({
        user: { id, name: String(user?.name ?? session.user.name), createdAt: new Date(/** @type {any} */ (user?.createdAt ?? Date.now())).toISOString() },
        passkeys: listPasskeys(db, id),
        codesLeft: recoveryCodesLeft(db, id),
        owned: ownedClubs(db, id),
        plannerExport: planner && `${planner}/library/export`,
      }));
    }
    const invite = /^\/invite\/([^/]+)$/.exec(pathname);
    if (invite) {
      const found = inspectInvite(db, invite[1]);
      const member = Boolean(session && found && listMemberships(db, session.user.id).some((w) => w.id === found.workspace.id));
      const status = !found ? 404 : found.problem ? 410 : 200;
      return html(req, res, invitePage({ token: invite[1], found, user: session && { name: session.user.name }, member }), status);
    }
    if (pathname === '/clubs') {
      if (!session) return toSignIn(req, res, pathname);
      return html(req, res, clubsPage({ user: session.user, workspaces: listMemberships(db, session.user.id) }));
    }
    const club = /^\/clubs\/([A-Za-z0-9_-]+)$/.exec(pathname);
    if (club) {
      if (!session) return toSignIn(req, res, pathname);
      const userId = session.user.id;
      const workspace = listMemberships(db, userId).find((w) => w.id === club[1] && w.kind === 'club');
      if (!workspace) return html(req, res, notFoundPage(), 404);
      const claims = claimsOf(db, userId);
      try {
        const invites = can(claims, workspace.id, 'invite.manage') ? listInvites(db, userId, workspace.id) : null;
        return html(req, res, clubPage({ user: session.user, claims, workspace, members: listMembers(db, userId, workspace.id), invites }));
      } catch (error) {
        if (error instanceof WorkspaceError) return html(req, res, notFoundPage(), 404);
        throw error;
      }
    }
    return null;
  }

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
   * @returns {Promise<{ user: { id: string, name: string }, session: { createdAt: Date | string, recovery?: boolean } } | null>}
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

  /**
   * RP-initiated logout (spec §6). Better Auth's end-session endpoint does
   * the protocol: a valid id_token_hint for this browser's session ends it
   * and redirects to a registered post_logout_redirect_uri only. Every page
   * it would render itself (its confirmation for a missing or invalid hint,
   * "logged out" without a redirect, its errors) is replaced by
   * /signed-out, which asks a still signed-in person to sign out there.
   * Its confirmation cookie is dropped: the confirm route is disabled.
   */
  async function endSession(req, res) {
    let body;
    if (req.method === 'POST') {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384) return problem(req, res, issuer, 'bad-request', 'The request is too big.');
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }
    const response = await auth.handler(new Request(new URL(req.url ?? '/', issuer), { method: req.method, headers: fromNodeHeaders(req.headers), body }));
    const cookies = response.headers.getSetCookie().filter((c) => !c.includes('.oauth_logout_confirmation='));
    if ((response.headers.get('content-type') ?? '').startsWith('text/html')) {
      return send(req, res, 303, { Location: '/signed-out', 'Cache-Control': 'no-store', 'Set-Cookie': cookies }, '');
    }
    /** @type {Record<string, string | string[]>} */
    const headers = {};
    response.headers.forEach((value, name) => {
      if (name !== 'set-cookie') headers[name] = value;
    });
    if (cookies.length) headers['set-cookie'] = cookies;
    return send(req, res, response.status, headers, Buffer.from(await response.arrayBuffer()));
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
    if (FRESH_PATHS.has(pathname) && session && !session.session.recovery && !isFresh(session)) {
      req.resume();
      return problem(req, res, issuer, 'reauthenticate', 'Confirm it is you with your passkey first, then try again.');
    }
    if (pathname === '/oauth2/end-session') return endSession(req, res);

    if (pathname.startsWith('/api/')) {
      return handleApi(req, pathname, {
        db,
        issuer,
        session,
        json: (status, value, headers) => json(req, res, status, value, headers),
        problem: (name, detail, headers) => problem(req, res, issuer, name, detail, headers),
        problemBody: (body) => problemBody(req, res, body),
        readJson: () => readJson(req),
        sameOrigin: sameOrigin(req),
        allowRedeem: () => allow(req, res, 'invite', clientOf(req)),
        fresh: isFresh(session),
        notify,
        clearCookie,
      });
    }

    if (readOnly) {
      if (pathname === '/deletions') return deletions(req, res, url);
      if (page(req, res, pathname, session) !== null) return;
      if (pathname === '/sign-in') return html(req, res, signInPage(url));
      if (pathname === '/sign-up') return html(req, res, signUpPage(url, session && { name: session.user.name }));
      if (pathname === '/recover') return html(req, res, recoverPage(url, session?.session.recovery ? { name: session.user.name } : null));
      if (pathname === '/consent') return html(req, res, consentPage());
      if (pathname === '/privacy') return html(req, res, privacyPage({ plannerExport: planner && `${planner}/library/export` }));
      if (pathname === '/signed-out') return html(req, res, signedOutPage({ user: session && { name: session.user.name }, deleted: url.searchParams.has('deleted') }));
      if (pathname === '/error') return html(req, res, errorPage(url));
      if (pathname === '/passkey/generate-register-options' && !allow(req, res, 'signUp', clientOf(req))) return;
      if (pathname === '/passkey/generate-authenticate-options' && !allow(req, res, 'signIn', clientOf(req))) return;
    } else if (req.method === 'POST') {
      if (pathname === '/recover') return redeem(req, res);
      if (pathname === '/recovery-codes') return newCodes(req, res, session);
    }

    if (!BETTER_AUTH_ROUTES.has(pathname)) {
      req.resume();
      return problem(req, res, issuer, 'not-found', 'There is nothing here.');
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
