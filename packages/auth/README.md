# @tinylap/auth

Access token verification, permission checks and a backend-for-frontend login for apps and MCP servers in the TinyLap suite.

## `verifyAccessToken(token, options)`

Verifies an OAuth 2.0 access token against the issuer's published JWKS. Always uses RS256; throws `AuthError` with one of two codes:

- `code: 'invalid_token'` — the token is missing, malformed, lacks required claims (`exp`, `sub`), signed with a different algorithm, not typed `at+jwt` (RFC 9068; an ID token is refused), expired, issued by the wrong issuer, or not meant for this audience.
- `code: 'unavailable'` — the authorization server (JWKS endpoint) is unreachable or timed out.

```js
import { verifyAccessToken } from '@tinylap/auth';

const claims = await verifyAccessToken(token, {
  issuer: 'https://accounts.tinylap.club',
  audience: 'https://planner.tinylap.club',
  // jwks: optional, defaults to a cached JWKS set fetched from issuer/jwks
  // clockTolerance: optional, defaults to 5 seconds
});

console.log(claims.sub); // user ID
console.log(claims.workspaces); // [{ id, role }]
```

## `can(claims, workspaceId, action)`

Checks whether the user identified by `claims` has permission to perform `action` in `workspaceId`. Returns `false` if the user is not a member of the workspace, if the action is unknown, or if their role does not allow the action.

```js
import { can } from '@tinylap/auth';

if (can(claims, workspaceId, 'track.save')) {
  // User may read, save, share, and copy tracks
}
if (can(claims, workspaceId, 'admin.manage')) {
  // User is an owner; they can change admin membership
}
```

## Permission matrix

| Action | owner | admin | member |
| --- | --- | --- | --- |
| `track.read` | ✓ | ✓ | ✓ |
| `track.save` (save, new version, rename) | ✓ | ✓ | ✓ |
| `track.share` | ✓ | ✓ | ✓ |
| `track.copy` | ✓ | ✓ | ✓ |
| `track.delete` (track or version) | ✓ | ✓ | |
| `invite.manage` | ✓ | ✓ | |
| `member.remove` | ✓ | ✓ | |
| `admin.manage` | ✓ | | |
| `owner.transfer` | ✓ | | |
| `club.manage` (rename, delete) | ✓ | | |
| `club.leave` | | ✓ | ✓ |

## `createBff(options)`

A backend-for-frontend for an app server: the server runs the OIDC authorization code flow (PKCE `S256`, `state`, `nonce`, `resource`), keeps the tokens itself, sealed with AES-256-GCM, and gives the browser only an opaque cookie, `__Host-tinylap-session` (`HttpOnly; Secure; SameSite=Lax; Path=/`). The pending login lives for 10 minutes in a sealed, single-use cookie `__Host-tinylap-login`.

```js
import { createServer } from 'node:http';
import { AuthError, createBff, parseKeys } from '@tinylap/auth';

const origin = 'https://planner.tinylap.club';
const sessions = new Map(); // use a table; see SessionStore below
const bff = createBff({
  issuer: 'https://accounts.tinylap.club',
  clientId: process.env.TINYLAP_CLIENT_ID,
  clientSecret: process.env.TINYLAP_CLIENT_SECRET,
  redirectUri: `${origin}/auth/callback`,
  postLogoutRedirectUri: `${origin}/`,
  resource: origin,
  keys: parseKeys(process.env.TINYLAP_TOKEN_KEYS), // "<id>:<base64 32 bytes>,…", newest first
  store: {
    get: async (id) => sessions.get(id) ?? null,
    set: async (id, session) => void sessions.set(id, session),
    delete: async (id) => void sessions.delete(id),
    deleteUser: async (userId) => { for (const [id, s] of sessions) if (s.userId === userId) sessions.delete(id); },
  },
});

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, origin);
  try {
    let out;
    if (req.method === 'GET' && pathname === '/auth/login') out = await bff.login(req); // ?returnTo=/path
    else if (req.method === 'GET' && pathname === '/auth/callback') out = await bff.callback(req);
    else if (req.method === 'POST' && pathname === '/auth/logout') {
      out = bff.requireSameOrigin(req) ? await bff.logout(req) : { status: 403 };
    } else {
      const session = await bff.session(req); // { userId, accessToken, claims } or null
      out = { status: 200, headers: { 'Content-Type': 'text/plain' }, body: session ? `Hello ${session.userId}` : 'Hello stranger' };
    }
    res.writeHead(out.status, out.headers).end(out.body);
  } catch (error) {
    const down = error instanceof AuthError && error.code === 'unavailable';
    res.writeHead(down ? 503 : 500).end(down ? 'Log-in is unavailable right now.' : undefined);
  }
}).listen(8080);
```

Each handler returns `{ status, headers, body? }`; `Set-Cookie` is an array, as `res.writeHead` takes it.

- `login(req)`: 302 to the issuer. `returnTo` must be a same-origin path starting with a single `/` (no `//`, no backslash, no control characters), checked again after normalising dot segments (`/..//evil.test` would become `//evil.test`); anything else becomes `/`.
- `callback(req)`: exchanges the code, stores the session under a new id, sets the cookie and returns to `returnTo`. Without the login cookie, or with a failed check (`state`, PKCE, `nonce`, an error from the issuer), it answers 400 and asks to log in again.
- `logout(req)`: forgets the session, revokes its refresh token, and answers 302 to the issuer's `end_session_endpoint` with `id_token_hint` and `post_logout_redirect_uri` (RP-initiated logout). It always clears the cookie and redirects: when the issuer is down, revocation is logged and skipped and the redirect goes straight to `postLogoutRedirectUri`; it waits at most 3 s for the issuer. Check `requireSameOrigin(req)` first, and call it from a `POST`.
- `session(req)`: the session, or `null`. When the access token has under 60 s left, it refreshes. Only `invalid_grant`, or a refresh answer that can't be used (its access token doesn't verify), ends the session (the row is deleted, `null` is returned). A session deleted while its refresh ran (logout, user deletion) stays deleted, and the newly issued refresh token is revoked.
- `sessionId(req)`: the store id of the request's session cookie (its SHA-256, hex), or `null` without a well-formed cookie. It doesn't load the session; call `session(req)` for that. Apps use it to keep their own data next to a session (the planner caches the display name).
- `requireSameOrigin(req)`: `Sec-Fetch-Site: same-origin`, or, without that header, an `Origin` equal to the app origin (the origin of `redirectUri`). Use it on every state-changing request.

Errors: when the issuer is unreachable, answers 5xx, or takes longer than `fetchTimeoutMs` (default 15 s, for discovery, token and revocation calls alike), `login`, `callback` and `session` throw `AuthError` with `code: 'unavailable'`; map it to 503. The session is kept. Discovery runs on first use and is cached; a failed discovery is retried on the next call.

Lifetimes: a session lasts 30 days after its last refresh, and at most 90 days after login. The cookie's `Max-Age` is the 90-day cap; the store's `expiresAt` enforces the rest.

**Single-flight refresh is per process.** Two requests for one session never refresh at the same time, so a rotated refresh token is never spent twice — but the lock is a `Map` in memory. Run the app on one machine, or route a session's requests to one process.

Options: `issuer`, `clientId`, `clientSecret`, `redirectUri`, `postLogoutRedirectUri`, `resource`, `store`, `keys` (required); `scope` (`'openid profile offline_access'`), `cookieName` (`'__Host-tinylap-session'`), `secureCookies` (`true`; `false` drops `Secure` and the `__Host-` prefix, for plain-http hosts other than `localhost`), `fetchTimeoutMs` (`15000`), `fetch` (the fetch used for the issuer; for tests), `logger` (`console`; gets `warn(message)` for skipped failures, with no tokens or user data). `http://` issuers are allowed, for development and tests only.

### `SessionStore`

```ts
interface SessionStore {
  get(id: string): Promise<StoredSession | null>; // id: SHA-256 (hex) of the cookie value
  set(id: string, session: StoredSession): Promise<void>;
  delete(id: string): Promise<void>;
  deleteUser(userId: string): Promise<void>; // for the deletions feed
}
interface StoredSession { userId: string; sealedTokens: string; createdAt: number; expiresAt: number }
```

The cookie value never reaches the store, only its hash, and the tokens only sealed.

### Token keys: `parseKeys`, `seal`, `open`

`seal(keys, text)` encrypts with the first key, as `<kid>.<iv>.<ciphertext+tag>` (base64url); `open(keys, sealed)` decrypts with whichever key the id names and throws for an unknown id or a tampered value. An optional third argument, a purpose label, is authenticated too and must match on `open`: the BFF seals the login cookie as `login` and stored tokens as `tokens`, so neither opens as the other. To rotate, put a new key first and keep the old one until every session sealed with it has expired or refreshed: nobody is logged out. A session whose key was removed reads as logged out.

## Joining the suite

A new app or MCP server becomes a client of `apps/accounts` in four steps:

1. Register a trusted client in the `TINYLAP_CLIENTS` secret of `accounts`: a `clientId`, a random `clientSecret`, the app's `redirectUris` (`<origin>/auth/callback`), `postLogoutRedirectUris` and `resource` (the app's origin, which becomes the access token's `aud`).
2. In the app, `createBff` with that client for browser log-in, and `verifyAccessToken(token, { issuer, audience: <origin> })` plus `can(claims, workspaceId, action)` for every request that needs a role. Keep nothing of a user keyed on the provider's subject: `sub` is TinyLap's own user id.
3. Give the app its own token key list and, if it stores user data, a token for `accounts`' deletions feed (add it to `TINYLAP_FEED_TOKENS`) so it can remove what it holds when an account or workspace is deleted.
4. Read `apps/accounts/README.md` for the secrets and their rotation.

## Provider independence

This package never depends on a specific identity provider: `createBff` speaks standard OIDC through `openid-client`, and `verifyAccessToken` accepts any OAuth 2.0 access token issued by any provider, provided the issuer publishes an RS256 JWKS at `{issuer}/jwks`.
