// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Better Auth instance: used only as a standards OAuth 2.1 / OpenID
// Connect provider. Nothing outside apps/accounts imports Better Auth; every
// client talks to the endpoints this configures. Option names are those of
// better-auth and @better-auth/oauth-provider 1.7.7 (read from their types).
import { createHash } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { jwt } from 'better-auth/plugins';
import { oauthProvider } from '@better-auth/oauth-provider';

const DAY = 24 * 60 * 60;

/** Client secrets are stored as SHA-256 (base64url), so seeding can hash them the same way. */
export const hashClientSecret = (secret) => createHash('sha256').update(secret).digest('base64url');

/**
 * Everything but the database, so openDb can migrate with the same schema.
 * @param {import('./config.js').Config} config
 */
export function authOptions(config) {
  return {
    appName: 'TinyLap',
    baseURL: config.issuer,
    basePath: '/',
    secret: config.secret,
    telemetry: { enabled: false },
    emailAndPassword: { enabled: false },
    session: { expiresIn: 30 * DAY },
    trustedOrigins: [config.issuer],
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
        // Task 4 fills this from the user's memberships.
        customAccessTokenClaims: () => ({ workspaces: [] }),
      }),
    ],
  };
}

/**
 * @param {import('./config.js').Config} config
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function createAuth(config, db) {
  return betterAuth({ ...authOptions(config), database: db });
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
