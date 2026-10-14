// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// TEST-ONLY. The suite for app tests: a real accounts server (in-memory
// database, dev mode, a random port) with the planner registered as its
// trusted client on `plannerPort`, and a way to sign a user in to accounts
// without a browser. Nothing here is used by server code.
import { createTestUser, driveAuthorize, Jar, navigate, startAccounts, testSession } from '../apps/accounts/test/helpers.js';

export { driveAuthorize, Jar, navigate };

/**
 * Starts accounts for an app listening on `http://127.0.0.1:<plannerPort>`:
 * the app's redirect URI is `/auth/callback`, its post-logout redirect URI
 * `/`, its resource its origin. Start the app's server first (port 0) and
 * pass the port it got.
 * @param {{ plannerPort: number, env?: Record<string, string> }} options
 */
export async function startSuite({ plannerPort, env = {} }) {
  const accounts = await startAccounts({ plannerPort, env });
  const { client } = accounts;
  /** @type {Promise<void> | undefined} */
  let closing;
  return {
    issuer: accounts.issuer,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    redirectUri: client.redirectUri,
    postLogoutRedirectUri: client.postLogoutRedirectUri,
    resource: client.resource,
    /** The app origin registered for `port` (the client's resource). */
    plannerOrigin: (/** @type {number} */ port = plannerPort) => `http://127.0.0.1:${port}`,
    /** The raw accounts handle (`auth`, `db`, `config`) for tests that need it. */
    accounts,
    /**
     * Creates a user and puts an accounts session cookie for them in `jar`,
     * standing in for a passkey sign-in.
     * @param {Jar} [jar]
     * @param {string} [name]
     */
    signInUser: async (jar = new Jar(), name = 'Ayrton') => {
      const user = await createTestUser(accounts.auth, name);
      await testSession(accounts.auth, user.id, jar);
      return { user, jar };
    },
    /** Stops accounts; safe to call twice (a test may stop it early). */
    close: () => (closing ??= accounts.close()),
  };
}
