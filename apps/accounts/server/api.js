// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// TinyLap's JSON API for its own pages (spec §5, §6): the signed-in user,
// their workspaces, clubs, members and invites. Session cookie only, never
// CORS; every state-changing request must come from our own origin. Errors
// are RFC 9457 Problem Details.
import * as ws from './workspaces.js';

/** How a WorkspaceError reads as Problem Details. */
const STATUS = {
  forbidden: { status: 403, title: 'Not allowed' },
  'not-found': { status: 404, title: 'Not found' },
  'quota-exceeded': { status: 422, title: 'Limit reached' },
  invalid: { status: 400, title: 'Cannot do that' },
  conflict: { status: 409, title: 'Not yet' },
};

/**
 * The Problem Details body for a WorkspaceError.
 * @param {string} issuer
 * @param {ws.WorkspaceError} error
 */
export function problemOf(issuer, error) {
  const { status, title } = STATUS[error.code];
  return { type: `${issuer}/problems/${error.code}`, title, status, detail: error.message };
}

/**
 * @typedef {object} ApiContext
 * @property {import('node:sqlite').DatabaseSync} db
 * @property {string} issuer
 * @property {{ user: { id: string, name: string } } | null} session
 * @property {(status: number, value: unknown, headers?: Record<string, string>) => void} json
 * @property {(name: string, detail: string, headers?: Record<string, string>) => void} problem
 * @property {(body: { type: string, title: string, status: number, detail: string }) => void} problemBody
 * @property {() => Promise<unknown>} readJson
 * @property {boolean} sameOrigin
 * @property {() => boolean} allowRedeem true if the invite rate limit lets it through (else the 429 is sent)
 */

/** A JSON object body, or a WorkspaceError. */
async function body(ctx) {
  const value = await ctx.readJson();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ws.WorkspaceError('invalid', 'Send a JSON object.');
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * The routes, as [method, pattern, handler(ctx, user, params)]. A handler
 * returns [status, value] (value undefined for 204).
 * @type {[string, RegExp, (ctx: ApiContext, user: { id: string, name: string }, p: string[]) => Promise<[number, unknown?]> | [number, unknown?]][]}
 */
const ROUTES = [
  ['GET', /^\/api\/me$/, (_ctx, user) => [200, { id: user.id, name: user.name }]],
  ['GET', /^\/api\/workspaces$/, (ctx, user) => [200, { workspaces: ws.listMemberships(ctx.db, user.id) }]],
  ['POST', /^\/api\/clubs$/, async (ctx, user) => [201, ws.createClub(ctx.db, user.id, (await body(ctx)).name)]],
  ['GET', /^\/api\/clubs\/([^/]+)$/, (ctx, user, [id]) => [200, ws.getWorkspace(ctx.db, user.id, id)]],
  ['PATCH', /^\/api\/clubs\/([^/]+)$/, async (ctx, user, [id]) => [200, ws.renameClub(ctx.db, user.id, id, (await body(ctx)).name)]],
  ['DELETE', /^\/api\/clubs\/([^/]+)$/, (ctx, user, [id]) => (ws.deleteClub(ctx.db, user.id, id), [204])],
  ['GET', /^\/api\/clubs\/([^/]+)\/members$/, (ctx, user, [id]) => [200, { members: ws.listMembers(ctx.db, user.id, id) }]],
  ['PATCH', /^\/api\/clubs\/([^/]+)\/members\/([^/]+)$/, async (ctx, user, [id, member]) => {
    ws.setRole(ctx.db, user.id, id, member, (await body(ctx)).role);
    return [200, { members: ws.listMembers(ctx.db, user.id, id) }];
  }],
  ['DELETE', /^\/api\/clubs\/([^/]+)\/members\/([^/]+)$/, (ctx, user, [id, member]) => (ws.removeMember(ctx.db, user.id, id, member), [204])],
  ['POST', /^\/api\/clubs\/([^/]+)\/transfer$/, async (ctx, user, [id]) => {
    const { userId } = await body(ctx);
    if (typeof userId !== 'string') throw new ws.WorkspaceError('invalid', 'Send { "userId": "<member>" }.');
    ws.transferOwnership(ctx.db, user.id, id, userId);
    return [200, { members: ws.listMembers(ctx.db, user.id, id) }];
  }],
  ['POST', /^\/api\/clubs\/([^/]+)\/leave$/, (ctx, user, [id]) => (ws.leaveClub(ctx.db, user.id, id), [204])],
  ['GET', /^\/api\/clubs\/([^/]+)\/invites$/, (ctx, user, [id]) => [200, { invites: ws.listInvites(ctx.db, user.id, id) }]],
  ['POST', /^\/api\/clubs\/([^/]+)\/invites$/, async (ctx, user, [id]) => {
    const { singleUse, ttlDays } = await body(ctx);
    const { link, invite } = ws.createInvite(ctx.db, user.id, id, { singleUse: singleUse ?? true, ttlDays: ttlDays ?? 7 });
    return [201, { link: `${ctx.issuer}${link}`, invite }];
  }],
  ['DELETE', /^\/api\/clubs\/([^/]+)\/invites\/([^/]+)$/, (ctx, user, [id, invite]) => (ws.revokeInvite(ctx.db, user.id, id, invite), [204])],
  ['POST', /^\/api\/invites\/redeem$/, async (ctx, user) => {
    const { token } = await body(ctx);
    return [200, ws.redeemInvite(ctx.db, user.id, token)];
  }],
];

const decode = (segment) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

/**
 * Answers a request under /api/. Returns nothing; the response has been sent.
 * @param {import('node:http').IncomingMessage} req
 * @param {string} pathname
 * @param {ApiContext} ctx
 */
export async function handleApi(req, pathname, ctx) {
  const matches = ROUTES.map(([method, pattern, handler]) => ({ method, handler, m: pattern.exec(pathname) })).filter((r) => r.m);
  if (!matches.length) {
    req.resume();
    return ctx.problem('not-found', 'There is no such API route.');
  }
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const route = matches.find((r) => r.method === method);
  if (!route) {
    req.resume();
    return ctx.problem('method-not-allowed', `Use ${matches.map((r) => r.method).join(' or ')}.`, { Allow: matches.map((r) => r.method).join(', ') });
  }
  if (method !== 'GET' && !ctx.sameOrigin) {
    req.resume();
    return ctx.problem('cross-site', 'Use TinyLap’s own pages.');
  }
  if (!ctx.session) {
    req.resume();
    return ctx.problem('unauthorized', 'Sign in first.');
  }
  if (pathname === '/api/invites/redeem' && !ctx.allowRedeem()) {
    req.resume();
    return undefined;
  }
  const params = route.m.slice(1).map(decode);
  if (params.some((p) => p === null)) return ctx.problem('bad-request', 'The path is not valid.');
  try {
    const [status, value] = await route.handler(ctx, ctx.session.user, /** @type {string[]} */ (params));
    if (status === 204) return ctx.json(204, undefined);
    return ctx.json(status, value);
  } catch (error) {
    if (error instanceof ws.WorkspaceError) return ctx.problemBody(problemOf(ctx.issuer, error));
    throw error;
  }
}
