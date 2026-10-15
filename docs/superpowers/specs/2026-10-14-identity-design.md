# TinyLap Identity and Workspaces — Design Specification

Date: 2026-10-14
Extends: `docs/superpowers/specs/2026-10-14-planner-server-design.md`
Status: proof-of-concept phase (see §13)

## 1. Purpose

One TinyLap login for the whole suite: the track planner, the timing app,
future apps and, later, MCP servers. Logging in is optional. It gives people
a durable home for what they build (a library of tracks) and gives clubs a
shared workspace, so nothing depends on keeping a link from years ago.

This sub-project builds the login service, the workspace model and the
planner library as the first real use. Device pairing for club laptops, the
timing app, MCP servers and online races build on it later (§14).

## 2. Decisions

| Question | Decision |
| --- | --- |
| Login for the whole suite? | **Yes, one identity.** Every app is a client of one TinyLap authorization server. |
| Required? | **No.** The planner works fully without an account, as today. |
| Who has accounts? | **People.** Drivers will be records in a club workspace, not accounts. Shared club laptops will be paired devices with their own identity (a later spec). |
| Who owns data? | **Workspaces:** a personal one per user, and shared club workspaces with roles. |
| Identity provider | **Our own service, `apps/accounts`, built on Better Auth**, used only as a standards OAuth 2.1 / OpenID Connect provider. No Java, no vendor, $0. A spike (2026-10-14) confirmed the needed flows against `openid-client`. |
| Lock-in | Better Auth exists only inside `apps/accounts`. Every other component speaks plain OIDC/OAuth (`openid-client`, `jose`). Self-hosters may use any OIDC provider. |
| User identifiers | TinyLap's own user ids. Data never keys on a provider's subject id. |
| How people log in | **Passkeys only**, with recovery codes. No passwords, no third parties. GitHub, Google and email are later additions, as further linked logins. |
| Email | In the model (optional, verified), **switched off** until there is a domain, because sending needs SPF/DKIM on a domain we own. |
| Browser apps | **Backend-for-frontend.** The app's server is the OIDC client and holds the tokens; the browser gets only an `HttpOnly` session cookie. |
| Saved tracks | **Private until shared.** Saving is not publishing. |
| Joining a club | **Invite links**, not email. |
| Domain | None during the proof of concept. Everything runs on `*.fly.dev`; moving to a domain later is a planned migration (§13). |
| UI | palace-ui plus `@tinylap/design`, as everywhere (`AGENTS.md`). |

## 3. Architecture

```
apps/accounts      the suite's login service: Better Auth + TinyLap tables + pages
packages/auth      what every app shares: BFF login, token checks, role checks
apps/track-planner the first client: login, library, private snapshots
```

### `apps/accounts` (AGPL-3.0-or-later)

A Node 24 server on `node:http` with SQLite through `node:sqlite`, deployed as
its own Fly app with its own volume. Better Auth and its plugins are pinned to
exact versions and mounted with `toNodeHandler` at the root, so the issuer is
the service's origin. Only the Better Auth routes TinyLap uses are reachable
over HTTP (an allow-list: the passkey ceremonies, `/sign-out`, the OAuth/OIDC
protocol endpoints, `/jwks` and discovery); every other route it ships, such
as `/update-user` or `/list-sessions`, is a 404.

Used from Better Auth:
- `@better-auth/oauth-provider` (the OAuth 2.1 / OIDC provider, not the older
  `oidcProvider` plugin): authorization code + PKCE, refresh token rotation,
  RP-initiated logout, JWT access tokens bound to one resource via `resource`
  (RFC 8707). ID tokens and access tokens are signed with **RS256**.
- The JWT plugin's key store: signing keys live in Better Auth's `jwks` table,
  encrypted with `BETTER_AUTH_SECRET` (§9).
- `@better-auth/passkey` with passkey-first sign-up (`requireSession: false`).

The planner is registered as a **trusted first-party client**: no consent
screen for it. Consent screens appear only for third-party clients, which do
not exist yet.

TinyLap's own tables and pages live next to it (§4, §5). Better Auth ships no
UI, so every page is ours, built with palace-ui and `@tinylap/design`.

Not in this sub-project: the device authorization grant, Client ID Metadata
Documents, Dynamic Client Registration and protected resource metadata. They
come with their first consumer (§14).

### `packages/auth` (MPL-2.0)

Only standard OIDC/OAuth, via `openid-client` and `jose`. It never imports
Better Auth.

| Export | Purpose |
| --- | --- |
| `createBff({ issuer, clientId, clientSecret, redirectUri, resource, sessionStore, encryptionKeys })` | `login`, `callback`, `logout` handlers and `session(req)` for an app server (§6) |
| `verifyAccessToken(token, { issuer, audience })` | checks the signature against the issuer's JWKS (algorithms pinned to `RS256`), `iss`, `aud`, `exp`; returns the claims. JWKS cached in memory, refetched on an unknown `kid`. |
| `can(claims, workspaceId, action)` | the permission matrix (§5) |
| types | `AccessClaims`, `WorkspaceClaim`, `Role`, `Action` |

### How apps learn about workspaces

Access tokens carry `workspaces: [{ id, role }]` and live **10 minutes**. A
role change or removal takes effect at the latest with the next token; that
window is accepted. Removing a member revokes nothing: claims are read live
at every issuance, so the club drops out with the member's next token, and
they stay logged in. Account deletion and "sign out everywhere" revoke the
user's refresh tokens. Apps make no call to `accounts` per request.

## 4. Data

### `apps/accounts`

- **User:** TinyLap `id` (the `sub` in every token), `displayName`, one or
  more passkeys. Better Auth requires an email field: it holds the placeholder
  `<id>@users.invalid`, never shown and never used, until real email is
  switched on (`email`, `emailVerified`).
- **`recovery_code`:** user, `lookup_id` (random, unique, indexed),
  `secret_hash` (SHA-256 of a secret with at least 80 bits of entropy),
  `used_at`. Shown to the user as `<lookup_id>.<secret>`. Ten codes per set;
  a new set invalidates the old one.
- **`workspace`:** `id`, `kind` (`personal` | `club`), `name`, `created_at`.
  A personal workspace is created at sign-up and never has other members.
- **`membership`:** workspace, user, `role` (`owner` | `admin` | `member`).
  A club has exactly one owner at all times.
- **`invite`:** workspace, `role` (always `member` for now), `token_hash`,
  `expires_at` (default 7 days), `single_use`, `created_by`, `used_by`,
  `revoked_at`. The link is shown once.
- **`deletion`:** `seq` (monotonically increasing integer), `kind`
  (`user` | `workspace`), `id`, `deleted_at`. Kept forever; rows are tiny
  ids, and a new or self-hosted consumer can start from 0.

### `apps/track-planner`

- **Public snapshots** stay as they are (`layouts`, `/shapes`, immutable).
- **`private_layouts(key, workspace_id, json, created_at)`, primary key
  `(key, workspace_id)`.** The same content-addressed keys, readable only by
  members of that workspace. Two workspaces with identical content get two
  rows; deleting one never touches the other or `layouts`. Saving always
  writes a private row, even when the same content is public, so a share
  never has to be undone.
- **`library_track(id, workspace_id, name, current_key, created_at,
  updated_at, updated_by)`** and **`library_version(seq, track_id, key,
  saved_at, saved_by)`**: a named track with its history, ordered by `seq`
  (an `INTEGER PRIMARY KEY`, never the implicit rowid); a version's snapshot is the
  private row `(key, track.workspace_id)`. Nothing is overwritten. A track
  keeps its 50 newest versions; older ones drop off, and the history view
  says so. Private rows no longer referenced by any version are removed.
- **`bff_session`:** session id hash, user id, encrypted access and refresh
  tokens, `created_at`, `expires_at`. Ciphertexts are AES-GCM and tagged with
  a key id (§9).
- **`feed_cursor`:** the last deletion `seq` processed.

### Quotas

| Limit | Value |
| --- | --- |
| Tracks per workspace | 200 |
| Versions kept per track | 50 newest |
| Canonical size per snapshot | 64 KiB (as for public snapshots) |
| Saves per user | 60 per hour |
| Club workspaces a user can create | 5 |
| Active invites per workspace | 20 |

Exceeding a limit is a Problem Details `422` (`quota-exceeded`) with the
limit in `detail`.

## 5. Roles and permissions

| Action | owner | admin | member |
| --- | --- | --- | --- |
| See the workspace's tracks and history | ✓ | ✓ | ✓ |
| Save, save a new version, rename a track | ✓ | ✓ | ✓ |
| Share a track (publish) | ✓ | ✓ | ✓ |
| Copy a track to another workspace you belong to | ✓ | ✓ | ✓ |
| Delete a track or a version | ✓ | ✓ | |
| Create, list and revoke invites | ✓ | ✓ | |
| Remove a member | ✓ | ✓ | |
| Promote a member to admin, demote or remove an admin | ✓ | | |
| Transfer ownership | ✓ | | |
| Rename or delete the club | ✓ | | |
| Leave the club | (transfer first) | ✓ | ✓ |

In a personal workspace the user is the owner and the only member.

A club whose owner has lost every passkey and every recovery code has no
owner who can act. The maintainer can transfer ownership with an `accounts`
admin command (`node apps/accounts/admin.js transfer-ownership <workspace>
<user>`), after verifying the request out of band. This is documented.

## 6. Flows

- **Sign up:** display name → register a passkey → ten recovery codes shown
  once, confirmed with "I've saved them" → account and personal workspace
  exist. WebAuthn options: `residentKey: required` (there is no username),
  `userVerification: required`, `attestation: none`; challenges are
  single-use and expire after 5 minutes.
- **Sign in:** passkey (discoverable credential, no username field).
- **Recovery:** "Lost your passkey?" asks for one recovery code. The
  `lookup_id` finds it, the secret is compared in constant time, and the code
  is spent with one atomic `UPDATE … WHERE used_at IS NULL`. The resulting
  session can only add a passkey and manage recovery codes until a passkey is
  registered. Losing every passkey and every code loses the account; the
  sign-up page says so plainly.
- **Account page:** manage passkeys (adding a second is prominent), new
  recovery codes, "sign out everywhere" (revokes all sessions and refresh
  tokens), export, delete the account. Export downloads the account data from
  `accounts` and links to the planner's export of every track and version in
  the user's workspaces (JSON).
- **Planner login (BFF):** "Log in" → `/auth/login?returnTo=<path>` (a
  same-origin relative path; anything else is replaced by `/`) → `accounts`
  with PKCE, `state`, `nonce`, `response_mode=query`,
  `resource=<planner origin>` → passkey → `/auth/callback` exchanges the
  code, stores the tokens, sets the session cookie, returns to `returnTo`.
  The canvas survives the round trip because the planner already keeps it in
  `sessionStorage` (`session-store.js`).
- **Session refresh:** at most one refresh in flight per session (an
  in-process lock; there is one machine). Only `invalid_grant` ends the
  session; a network error, a 5xx or a timeout keeps it and answers 503
  "Log-in is unavailable right now".
- **Logout:** clears the planner session, revokes its refresh token, and
  performs RP-initiated logout at `accounts` (`id_token_hint`,
  `post_logout_redirect_uri`), so the next "Log in" on a shared computer asks
  for a passkey again.
- **Library:** "Save to library" (choose a workspace the first time) adds a
  version; "Open from library" lists the tracks of the user's workspaces with
  their history; rename, copy to another workspace (the copy starts with the
  current version only), delete a track or a version per §5. "Share"
  publishes the current version and copies the link as today, after a
  confirmation that publishing cannot be undone.
- **Clubs:** create a club (you become owner); manage invites (create, list,
  revoke) and members per §5; opening an invite link while logged out goes
  through sign-in or sign-up first; an expired, used or revoked link says so
  and suggests asking the club for a new one.
- **Leaving or removal:** the club keeps its tracks. Saves keep the
  name they were stored with. A stored name is cleared only by the deletions
  feed (a deleted user), and only then does the save show as "former member"; a save
  whose name lookup at `accounts` fails is refused with 503 and writes
  nothing. There is
  no "take my tracks with me"; a member can copy tracks to their personal
  workspace before leaving.

## 7. Deletion and the deletions feed

- Deleting an account removes the user, their passkeys, recovery codes,
  sessions and personal workspace, and revokes their refresh tokens. It is
  refused while the user owns a club: transfer ownership or delete the club
  first.
- Deleting a club removes its memberships and invites.
- Each deletion appends a `deletion` row. Consumers read
  `GET /deletions?after=<seq>` with a static bearer token (`TINYLAP_FEED_TOKEN`,
  one per consumer, a Fly secret), store the highest `seq` they processed,
  and remove what they hold. The planner deletes private snapshots, library
  tracks and versions of deleted workspaces and the sessions of deleted
  users. It reads the feed when it starts and hourly while it runs. A row is
  processed only once it is older than one access token lifetime plus 60 s
  of clock skew (a member's token may name a deleted club until then, and a
  save with it would leave rows behind); the read stops at the first younger
  row and a later poll takes it. A page whose rows do not move past the
  cursor, or cannot be read, stops the read with an error instead of looping.
- Until the planner has read the feed, a deleted workspace's data still sits
  in the planner but cannot be reached: no token names that workspace any
  more. That window is accepted.
- Public snapshots stay: they contain no personal data.

## 8. Errors

- **`accounts` unreachable:** the planner keeps working anonymously; "Log in"
  and the library say "Log-in is unavailable right now". If the planner
  starts while `accounts` is down, it cannot fetch the JWKS, so logged-in
  requests answer 503 until it can; anonymous use is unaffected. Accepted.
- **Cold starts:** both machines stop when idle, so a first login may wake
  two machines. Login waits up to 15 seconds before calling `accounts`
  unavailable. Accepted.
- **Expired access token:** refreshed server-side, invisibly (§6).
- **Missing access:** 404 for private things that are not yours; 403 when
  you are a member without the permission (§5).
- Every API error is RFC 9457 Problem Details, as in the planner server; new
  types: `quota-exceeded`, `forbidden`, `unauthorized`.

## 9. Security

- **Cookie:** `__Host-tinylap-session`, `HttpOnly; Secure; SameSite=Lax;
  Path=/`. Lifetime 30 days, sliding, capped at 90 days after login.
  State-changing requests require `Sec-Fetch-Site: same-origin` or a
  same-origin `Origin`; anything else is refused.
- **Lifetimes:** access tokens 10 minutes; refresh tokens 30 days, rotated on
  use; the `accounts` browser session 30 days.
- **PKCE, `state` and `nonce`** on every login.
- **Private responses:** the authorization check runs before any
  `If-None-Match`/304 handling; private snapshot responses are `private,
  no-store`, HTML ones add `frame-ancestors 'none'`; `/layouts/<key>` answers
  `Vary: Cookie` once it depends on the session. Library and auth routes do
  **not** send `Access-Control-Allow-Origin: *`; only the public, cookie-free
  API keeps it. The planner-server spec's sentence "No route uses cookies or
  credentials" is updated accordingly.
- **`accounts` pages:** a strict CSP like the planner's, nothing third-party.
- **Rate limits** per client (IPv6 per /64), as in the planner server: sign-up
  10/hour, sign-in 30/hour, recovery 10/hour per client and 5/hour per
  `lookup_id`, invite redemption 20/hour. Better Auth's own limiter (on in
  production) keys on the trusted proxy's header (`Fly-Client-IP`), never on
  `X-Forwarded-For`, and does not limit the client-authenticated endpoints
  (`/oauth2/token`, `/oauth2/revoke`, `/oauth2/userinfo`): every planner call
  comes from one server. A 429 from the issuer counts as unavailable in the
  BFF.
- **Keys and secrets** (all Fly secrets; rotation procedures in the
  `apps/accounts` README):
  - `BETTER_AUTH_SECRET` encrypts the signing keys and signs `accounts`
    cookies. Rotating it signs everyone out of `accounts` and needs the
    signing keys re-encrypted; the procedure says how.
  - Signing keys rotate by adding a new key to the JWKS, waiting longer than
    the longest token lifetime plus the JWKS cache time, switching signing,
    then retiring the old key.
  - The planner's token encryption keys are a list with ids; new tokens use
    the newest, old ones still decrypt, so rotation logs nobody out.
  - The planner's client secret rotates by registering a second secret,
    switching the planner, removing the first.
- **Dependencies:** exact pins for Better Auth and its plugins; upgrades only
  with the full test suite (§10) green; GitHub security alerts (Dependabot)
  enabled for the repo.

## 10. Testing

- **`apps/accounts`** (real server, random port, in-memory database):
  - OIDC through `openid-client` only: discovery, code + PKCE, ID token
    checks (RS256, `iss`, `aud`, `nonce`), userinfo, refresh with rotation,
    RP-initiated logout;
  - passkeys with a virtual WebAuthn authenticator (Playwright, Chrome's
    virtual authenticator): sign-up, sign-in, adding a passkey, recovery
    (lookup, spending, the restricted session, a spent code refused);
  - workspaces: every row of the §5 matrix, exactly one owner, invites
    (expired, used, single-use, revoked), quotas, deletion and the feed
    (`after=<seq>`, the bearer token);
  - tokens: a planner token is rejected by another `resource`; the
    `workspaces` claim matches the memberships; after a removal the next
    refresh succeeds without the club.
- **`packages/auth`:** token checks (issuer, audience, expiry, signature,
  pinned algorithm) against a local key pair; the BFF handlers (cookie
  attributes, `Sec-Fetch-Site`/`Origin`, `returnTo`, `state`/`nonce`,
  single-flight refresh, transient vs `invalid_grant` failures, logout);
  `can`.
- **Planner:** private vs public snapshots (404 for strangers, `no-store`,
  absent from `/shapes`, two workspaces with identical content), library
  versions, the 50-version window, copy, delete, Share; login against a test
  `accounts`; the OpenAPI description gains the new routes and the contract
  test covers them.
- **Local development and tests** run over `http://localhost`. Better Auth
  refuses non-https, loopback redirect URIs for web clients, so `accounts`
  accepts loopback redirect URIs only when `TINYLAP_DEV=1`, and refuses to
  start with `TINYLAP_DEV=1` when its issuer is https. How tests drive
  `/oauth2/authorize` (a 302 or a JSON redirect, depending on `Accept`) is
  settled in the first implementation task and used everywhere after.
- **Browser:** Playwright with Chrome: sign up, log in to the planner, save,
  open from the library, share, join a club, log out on a "shared" browser.
- **Conformance:** the OpenID Foundation conformance suite runs before a
  production release (§13), not in CI.

## 11. Deployment

- `apps/accounts` becomes the Fly app `tinylap-accounts`: one smallest
  machine that stops when idle, a 1 GB volume at `/data`, daily Fly volume
  snapshots. CI deploys it like the planner, only when it changed, with its
  own smoke test. The plan first checks that the Fly organisation's free
  allowance covers the second app and volume.
- Configuration by environment: issuer URL, allowed redirect URIs, the
  planner's client registration (confidential, trusted), feed tokens.

## 12. Documentation

- `docs/identity.md` gains a section on accounts and workspaces: who owns
  what, roles and the permission matrix, private and public snapshots,
  deletion and the feed, data protection.
- README: self-hosting `accounts`, or plugging in another OIDC provider.
- `apps/accounts/README.md`: operations (secrets, key rotation, the
  ownership-transfer command, backups).
- `packages/auth/README.md`: how a new app or MCP server joins the suite.
- A privacy page in `accounts`: what is stored (display name, passkeys,
  memberships; private tracks in the planner), how to export it, how to
  delete it.

## 13. Proof-of-concept phase and production release

This sub-project ships as a proof of concept on `*.fly.dev`. When it proves
itself and a domain makes sense, everything moves:
- TinyLap controls both data stores, so the move is a migration, not a loss:
  databases are copied, issuer, resource origins and redirect URIs are
  reconfigured, and all sessions end once.
- Passkeys are bound to the host they were created on (`fly.dev` is on the
  Public Suffix List, so no shared parent can be chosen now). While signed in
  on the old host, the account page offers "move to the new host": a
  one-time, short-lived transfer token signs the user in on the new host,
  which registers a new passkey right away. Recovery codes are not bound to a
  host, so they work as the fallback for everyone who misses the move. The
  old host is shut down after an announced deadline.

Before a **production release**, these are required (tracked as GitHub
issues):
- the domain and the move above;
- off-site backups of both databases (e.g. Litestream to an object store's
  free tier), a backup before every Better Auth migration, a documented
  restore drill, and a reconciliation rule for restoring one database without
  the other;
- the OpenID conformance run, with the acceptable failures decided up front;
- a legal check of the privacy page and whether an imprint (Impressum) is
  required;
- email (verification, login links as a recovery route), now that a domain
  exists.

## 14. Out of scope (later specs)

- **Device pairing** for club laptops, in the timing-app spec: a device is its
  own principal (`sub = device:<id>`, a `device` role in one workspace, its
  own refresh-token family), never the approving admin's identity. Needs its
  own spike of custom token claims in Better Auth.
- **MCP:** Client ID Metadata Documents, Dynamic Client Registration and
  protected resource metadata, with the first MCP server.
- GitHub and Google login; email (see §13).
- The timing app, online races, social features.
