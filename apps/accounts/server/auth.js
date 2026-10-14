// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Better Auth instance: used only as a standards OAuth 2.1 / OpenID
// Connect provider. Nothing outside apps/accounts imports Better Auth; every
// client talks to the endpoints this configures. Option names are those of
// better-auth and @better-auth/oauth-provider 1.7.7 (read from their types).
import { createHash, randomBytes } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { APIError, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { jwt } from 'better-auth/plugins';
import { oauthProvider } from '@better-auth/oauth-provider';
import { passkey } from '@better-auth/passkey';
import { spendRecoveryCode } from './recovery.js';
import { createPersonalWorkspace, listMemberships } from './workspaces.js';

const DAY = 24 * 60 * 60;

/** Client secrets are stored as SHA-256 (base64url), so seeding can hash them the same way. */
export const hashClientSecret = (secret) => createHash('sha256').update(secret).digest('base64url');

/** A display name: trimmed, 1–40 characters, no control characters. Null otherwise. */
export function displayNameOf(value) {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  // eslint-disable-next-line no-control-regex
  return name.length >= 1 && [...name].length <= 40 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
}

const refuse = (message) => new APIError('BAD_REQUEST', { message });

/**
 * Passkeys only (spec §6): discoverable credentials with user verification,
 * no attestation. Sign-up is passkey-first: generate-register-options without
 * a session takes the display name as `context` and names a new user id;
 * the user and their personal workspace are created only once the passkey
 * has verified, so an abandoned sign-up leaves nothing behind.
 * @param {import('./config.js').Config} config
 * @param {import('node:sqlite').DatabaseSync | null} db
 */
function passkeyPlugin(config, db) {
  return passkey({
    rpID: new URL(config.issuer).hostname,
    rpName: 'TinyLap',
    origin: config.issuer,
    // attestation is always 'none' in @better-auth/passkey 1.7.7 (no option).
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    registration: {
      requireSession: false,
      resolveUser: ({ context }) => {
        const name = displayNameOf(context);
        if (!name) throw refuse('Choose a display name of 1 to 40 characters.');
        // Lower-case hex: Better Auth lower-cases the email, and the
        // placeholder email <id>@users.invalid must stay unique per id.
        return { id: randomBytes(16).toString('hex'), name, displayName: name };
      },
      // The plugin verifies with requireUserVerification: false; the spec
      // requires it, so it is checked here.
      afterVerification: async ({ ctx, verification, user, context }) => {
        if (!verification.registrationInfo?.userVerified) throw refuse('This passkey did not verify you (no PIN, fingerprint or face check).');
        if (await ctx.context.internalAdapter.findUserById(user.id)) return;
        // A new account: only with createSession, which is when the plugin
        // runs this hook and the passkey insert in one transaction.
        if (ctx.body?.createSession !== true) throw refuse('Sign-up must ask for a session (createSession: true).');
        const name = displayNameOf(context);
        if (!name) throw refuse('Choose a display name of 1 to 40 characters.');
        await ctx.context.internalAdapter.createUser({ id: user.id, name, email: `${user.id}@users.invalid`, emailVerified: false }, { method: 'passkey' });
        createPersonalWorkspace(db, user.id, name);
      },
    },
    authentication: {
      afterVerification: async ({ verification }) => {
        if (!verification.authenticationInfo?.userVerified) throw new APIError('UNAUTHORIZED', { message: 'This passkey did not verify you (no PIN, fingerprint or face check).' });
      },
    },
  });
}

/**
 * TinyLap's own piece of Better Auth: recovery sessions (spec §6).
 * - `auth.api.redeemRecoveryCode({ body: { code } })` is server-only (never
 *   on the HTTP router; app.js calls it after its rate limits). It spends the
 *   code and signs the user in with a session flagged `recovery: true`,
 *   through Better Auth's own session creation and cookie.
 * - Registering a passkey clears the flag on the session that registered it.
 * app.js refuses every other request from a flagged session.
 * @param {import('node:sqlite').DatabaseSync | null} db
 */
function recoveryPlugin(db) {
  return {
    id: 'tinylap-recovery',
    endpoints: {
      redeemRecoveryCode: createAuthEndpoint.serverOnly({ method: 'POST' }, async (ctx) => {
        const userId = spendRecoveryCode(db, ctx.body?.code);
        const user = userId && await ctx.context.internalAdapter.findUserById(userId);
        if (!user) throw new APIError('UNAUTHORIZED', { message: 'This recovery code is wrong or has been used.' });
        // overrideAll (the 4th argument): otherwise the field's default
        // (false) is spread over the override.
        const session = await ctx.context.internalAdapter.createSession(user.id, false, { recovery: true }, true);
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ user: { name: user.name } });
      }),
    },
    hooks: {
      after: [{
        matcher: (ctx) => ctx.path === '/passkey/verify-registration',
        handler: createAuthMiddleware(async (ctx) => {
          if (ctx.context.returned instanceof APIError || ctx.context.returned instanceof Error) return;
          const current = await getSessionFromCtx(ctx);
          if (current?.session?.recovery) {
            await ctx.context.internalAdapter.updateSession(current.session.token, { recovery: false });
          }
        }),
      }],
    },
  };
}

/**
 * Everything but the database, so openDb can migrate with the same schema.
 * The plugins that write TinyLap's tables get `db` from createAuth; openDb
 * only migrates with these options and passes none.
 * @param {import('./config.js').Config} config
 * @param {import('node:sqlite').DatabaseSync | null} [db]
 */
export function authOptions(config, db = null) {
  return {
    appName: 'TinyLap',
    baseURL: config.issuer,
    basePath: '/',
    secret: config.secret,
    telemetry: { enabled: false },
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: 30 * DAY,
      // Set by a recovery code, cleared by registering a passkey (spec §6).
      additionalFields: { recovery: { type: /** @type {const} */ ('boolean'), required: false, defaultValue: false, input: false } },
    },
    trustedOrigins: [config.issuer],
    // Errors go to TinyLap's own /error page (app.js), never Better Auth's,
    // which brings inline styles and third-party links.
    onAPIError: { errorURL: `${config.issuer}/error` },
    // Endpoints TinyLap does not use (exact paths; Better Auth matches them
    // literally). No passwords, no email, no third-party logins, no session
    // JWTs from the JWT plugin's /token (access tokens come from
    // /oauth2/token only), no dynamic client registration or client
    // self-service. The device grant and client metadata documents are not
    // installed at all.
    disabledPaths: [
      '/sign-in/email',
      '/sign-up/email',
      '/change-password',
      '/set-password',
      '/request-password-reset',
      '/reset-password',
      '/verify-password',
      '/verify-email',
      '/send-verification-email',
      '/change-email',
      '/sign-in/social',
      '/link-social',
      '/refresh-token',
      '/get-access-token',
      '/account-info',
      '/token',
      '/oauth2/register',
      '/oauth2/create-client',
      '/oauth2/update-client',
      '/oauth2/delete-client',
      '/oauth2/client/rotate-secret',
      '/oauth2/public-client-prelogin',
    ],
    plugins: [
      jwt({
        jwks: { keyPairConfig: { alg: 'RS256', modulusLength: 2048 } },
        jwt: { issuer: config.issuer },
        disableSettingJwtHeader: true,
      }),
      oauthProvider({
        loginPage: '/sign-in',
        consentPage: '/consent',
        scopes: ['openid', 'profile', 'offline_access'],
        grantTypes: ['authorization_code', 'refresh_token'],
        accessTokenExpiresIn: config.accessTtlSeconds,
        refreshTokenExpiresIn: 30 * DAY,
        refreshTokenReuseInterval: 0,
        resources: config.clients.map((c) => ({ identifier: c.resource, name: c.clientId })),
        resourceSeedMode: 'overwrite',
        enforcePerClientResources: true,
        storeClientSecret: { hash: hashClientSecret },
        // Every workspace the user is in, read live at each issuance, so
        // a refresh picks up role changes (spec §3).
        customAccessTokenClaims: ({ user }) => ({
          workspaces: user && db ? listMemberships(db, user.id).map(({ id, role, name }) => ({ id, role, name })) : [],
        }),
      }),
      passkeyPlugin(config, db),
      recoveryPlugin(db),
    ],
  };
}

/**
 * @param {import('./config.js').Config} config
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function createAuth(config, db) {
  return betterAuth({ ...authOptions(config, db), database: db });
}

/**
 * Registers the configured first-party clients, or brings them in line with
 * the configuration: confidential, code + refresh, PKCE, no consent screen,
 * RP-initiated logout allowed, linked to their one resource. Better Auth's
 * registration endpoints generate client ids and refuse loopback web
 * redirect URIs, so the rows are written through its adapter instead;
 * readConfig has already checked the URIs.
 * @param {ReturnType<typeof createAuth>} auth
 * @param {import('./config.js').ClientConfig[]} clients
 */
export async function seedClients(auth, clients) {
  const { adapter } = await auth.$context;
  for (const c of clients) {
    const now = new Date();
    const data = {
      clientId: c.clientId,
      clientSecret: hashClientSecret(c.clientSecret),
      name: c.clientId,
      redirectUris: c.redirectUris,
      postLogoutRedirectUris: c.postLogoutRedirectUris,
      tokenEndpointAuthMethod: 'client_secret_basic',
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      applicationType: 'web',
      scopes: ['openid', 'profile', 'offline_access'],
      requirePKCE: true,
      skipConsent: c.trusted,
      enableEndSession: true,
      disabled: false,
      updatedAt: now,
    };
    const where = [{ field: 'clientId', value: c.clientId }];
    if (await adapter.findOne({ model: 'oauthClient', where })) {
      await adapter.update({ model: 'oauthClient', where, update: data });
    } else {
      await adapter.create({ model: 'oauthClient', data: { ...data, createdAt: now } });
    }
    // One resource per client: drop any other links, keep or add this one.
    const links = await adapter.findMany({ model: 'oauthClientResource', where });
    for (const link of links) {
      if (link.resourceId !== c.resource) {
        await adapter.delete({ model: 'oauthClientResource', where: [...where, { field: 'resourceId', value: link.resourceId }] });
      }
    }
    if (!links.some((link) => link.resourceId === c.resource)) {
      await adapter.create({ model: 'oauthClientResource', data: { clientId: c.clientId, resourceId: c.resource, createdAt: now } });
    }
  }
}
