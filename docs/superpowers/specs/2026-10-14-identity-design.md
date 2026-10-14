# TinyLap Identity and Workspaces — Design Specification

Date: 2026-10-14
Extends: `docs/superpowers/specs/2026-10-14-planner-server-design.md`

## 1. Purpose

One TinyLap login for the whole suite: the track planner, the timing app,
future apps and, later, MCP servers. Logging in is optional. It gives people
a durable home for what they build (a library of tracks) and gives clubs a
home for what they run (drivers, transponders, leaderboards), so nothing
depends on keeping a link from years ago.

This sub-project builds the login service, the workspace model and the
planner library as the first real use. The timing app, MCP servers and online
races build on it later.

## 2. Decisions

| Question | Decision |
| --- | --- |
| Login for the whole suite? | **Yes, one identity.** Every app is a client of one TinyLap authorization server. |
| Required? | **No.** The planner works fully without an account, as today. |
| Who has accounts? | **People.** Drivers are records in a club workspace, not accounts. A shared club laptop is a **paired device**, not someone's login. |
| Who owns data? | **Workspaces:** a personal one per user, and shared club workspaces with roles. |
| Identity provider | **Our own service, `apps/accounts`, built on Better Auth**, used only as a standards OAuth 2.1 / OpenID Connect provider. No Java, no vendor, $0. A spike (2026-10-14) confirmed every needed flow against `openid-client`. |
| Lock-in | Better Auth exists only inside `apps/accounts`. Every other component speaks plain OIDC/OAuth (`openid-client`, `jose`). Self-hosters may use any OIDC provider. |
| User identifiers | TinyLap's own user ids. Data never keys on a provider's subject id. |
| How people log in | **Passkeys only**, with recovery codes. No passwords, no third parties. GitHub, Google and email are later additions, as further linked logins. |
| Email | In the model (optional, verified), **switched off** until there is a domain, because sending needs SPF/DKIM on a domain we own. |
| Browser apps | **Backend-for-frontend.** The app's server is the OIDC client and holds the tokens; the browser gets only an `HttpOnly` session cookie. |
| Saved tracks | **Private until shared.** Saving is not publishing. |
| Joining a club | **Invite links**, not email. |
| Domain | None yet. Services run on `*.fly.dev`; the design keeps the issuer replaceable (§10). |
| UI | palace-ui plus `@tinylap/design`, as everywhere (`AGENTS.md`). |

## 3. Architecture

```
apps/accounts      the suite's login service: Better Auth + TinyLap tables + pages
packages/auth      what every app shares: BFF login, token checks, role checks
apps/track-planner the first client: login, library, private snapshots
```

### `apps/accounts` (AGPL-3.0-or-later)

A Node 24 server on `node:http` with SQLite through `node:sqlite`, deployed as
its own Fly app with its own volume. Better Auth (exact version pinned) is
mounted with `toNodeHandler` at the root, so the issuer is the service's
origin.

Better Auth plugins used:
- OAuth 2.1 / OIDC provider, signing ID tokens with **RS256** (and EdDSA)
- passkey, with passkey-first sign-up (`requireSession: false`)
- device authorization grant (RFC 8628)
- JWT access tokens bound to one resource via `resource` (RFC 8707)
- Client ID Metadata Documents, Dynamic Client Registration and protected
  resource metadata (RFC 9728) for later MCP servers: installed and
  configured, but **switched off** until the first MCP server exists, so no
  open registration endpoint sits unused. CIMD will use the hardened network
  fetcher.

TinyLap's own tables and pages live next to it (§4, §6). Better Auth ships no
UI, so every page is ours, built with palace-ui and `@tinylap/design`.

### `packages/auth` (MPL-2.0)

Only standard OIDC/OAuth, via `openid-client` and `jose`. It never imports
Better Auth.

| Export | Purpose |
| --- | --- |
| `createBff({ issuer, clientId, clientSecret, redirectUri, resource, sessionStore, encryptionKey })` | `login`, `callback`, `logout` handlers and `session(req)` for an app server |
| `verifyAccessToken(token, { issuer, audience })` | checks signature against the issuer's JWKS, `iss`, `aud`, `exp`; returns the claims |
| `requireRole(claims, workspaceId, role)` | `owner` > `admin` > `member` |
| types | `AccessClaims`, `WorkspaceClaim`, `Role` |

### How apps learn about workspaces

Access tokens carry `workspaces: [{ id, role }]` and live **10 minutes**. A
role change takes effect at the latest with the next token. Apps make no call
to `accounts` per request.

## 4. Data

### `apps/accounts`

- **User:** TinyLap `id` (the `sub` in every token), `displayName`, one or
  more passkeys. Better Auth requires an email field: it holds the placeholder
  `<id>@users.invalid`, never shown and never used, until real email is
  switched on (`email`, `emailVerified`).
- **`recovery_code`:** user, hash, `usedAt`. Ten codes per set; generating a
  new set invalidates the old one.
- **`workspace`:** `id`, `kind` (`personal` | `club`), `name`, `createdAt`.
  A personal workspace is created at sign-up and cannot have other members.
- **`membership`:** workspace, user, `role` (`owner` | `admin` | `member`).
  A club has exactly one owner; the owner cannot leave without handing over
  ownership.
- **`invite`:** workspace, token hash, `expiresAt` (default 7 days),
  `singleUse`, `createdBy`, `usedBy`.
- **Devices:** a paired device is a device-grant client tied to one
  workspace, with a name. Admins list and revoke them.
- **`deletion`:** `kind` (`user` | `workspace`), `id`, `deletedAt`: the feed
  other services read (§6).

### `apps/track-planner`

- **Public snapshots** stay as they are (`layouts`, `/shapes`, immutable).
- **`private_layouts(key, workspace_id, json, created_at)`**: the same
  content-addressed keys, readable only by members of that workspace.
  `GET /layouts/<key>` serves a public snapshot first, otherwise a private one
  in one of the caller's workspaces, otherwise **404**: a stranger does not
  learn that it exists. Private responses are `Cache-Control: private,
  no-store`. Private snapshots never appear in `/shapes`. Identical content
  published by someone else is public under the same key; that reveals
  nothing about the workspace, because the key is only content.
- **`library_track(id, workspace_id, name, current_key, created_at,
  updated_at, updated_by)`** and **`library_version(track_id, key, saved_at,
  saved_by)`**: a named track with its history. Saving adds a private snapshot
  and a version; nothing is overwritten.
- **`bff_session`:** session id hash, user id, encrypted access and refresh
  tokens (AES-GCM, key from a Fly secret), `expiresAt`.

## 5. Flows

- **Sign up:** display name → register a passkey → ten recovery codes shown
  once, confirmed with "I've saved them" → account and personal workspace
  exist.
- **Sign in:** passkey. "Lost your passkey?" takes a recovery code, signs in,
  asks for a new passkey, and spends the code.
- **Account page:** manage passkeys (adding a second is prominent), new
  recovery codes, export all account data as JSON, delete the account.
- **Planner login (BFF):** "Log in" → `/auth/login` → `accounts` with PKCE,
  `state`, `nonce`, `resource=<planner origin>` → passkey → consent the first
  time → `/auth/callback` exchanges the code, stores the tokens, sets the
  session cookie and returns to where the user was. What was open
  anonymously stays open.
- **Library:** "Save to library" (choose a workspace the first time) adds a
  version; "Open from library" lists the tracks of the user's workspaces with
  their history; "Share" publishes the current version and copies the link,
  as today. The planner's undo still works on the canvas only.
- **Clubs:** create a club (you become owner); admins create invite links and
  change roles; opening an invite link while logged out goes through sign-in
  or sign-up first; an expired or used link says so and suggests asking the
  club for a new one.
- **Device pairing:** the device shows a code and the pairing URL; an admin,
  logged in on their own phone, enters the code, picks the club workspace and
  names the device; the device receives a token tied to that workspace. The
  timing app is the first real user; this sub-project builds the grant and the
  page and tests them with `openid-client`.
- **Logout:** clears the planner session and revokes its refresh token.

## 6. Account and workspace deletion

- Deleting an account removes the user, their passkeys, recovery codes and
  personal workspace. It is refused while the user owns a club: hand the club
  over or delete it first.
- Deleting a club workspace removes its memberships, invites and devices.
- Each deletion is recorded in `deletion`. Services read
  `GET /deletions?since=<timestamp>` on `accounts` with a client-credentials
  token for their own service client, and remove what they hold: the planner
  deletes private snapshots, library tracks and versions of deleted
  workspaces, and the sessions of deleted users. The planner polls on start
  and every 15 minutes.
- Public snapshots stay: they contain no personal data.

## 7. Errors

- **`accounts` unreachable:** the planner keeps working anonymously; "Log in"
  and the library say "Log-in is unavailable right now". Nothing else breaks.
- **Expired access token:** the planner refreshes it server-side, invisibly.
  A failed refresh ends the session; the library asks to log in again;
  unsaved work stays in the browser.
- **Missing access:** 404 for private things that are not yours; 403 when
  you are a member without the role needed (e.g. a member changing roles).
- Every API error is RFC 9457 Problem Details, as in the planner server.

## 8. Security

- Session cookie: `HttpOnly; Secure; SameSite=Lax`, a 30-day sliding
  lifetime. Every state-changing request also checks `Origin`.
- PKCE, `state` and `nonce` on every login. Refresh tokens rotate.
- Access tokens: JWT, 10 minutes, `aud` = the one service they were issued
  for; any other service rejects them.
- `accounts` pages: a strict CSP like the planner's, no third-party anything.
- Rate limits on sign-up, sign-in and recovery per client, IPv6 per /64, as
  in the planner server.
- Tokens at rest are encrypted; the signing keys, the encryption key and the
  planner's client secret are Fly secrets.
- Exact version pins for Better Auth and its plugins; upgrades only with the
  full test suite (§9) green.

## 9. Testing

- **`apps/accounts`** (real server, random port, in-memory database):
  - OIDC through `openid-client` only: discovery, code + PKCE, ID token
    checks (signature RS256, `iss`, `aud`, `nonce`), userinfo, refresh,
    logout, device grant end to end;
  - passkeys with a virtual WebAuthn authenticator (Playwright, Chrome's
    virtual authenticator): sign-up, sign-in, recovery, adding a passkey;
  - workspaces: roles, exactly one owner, invites expired / used /
    single-use, deletion and the deletions feed;
  - tokens: a planner token is rejected for another `resource`; the
    `workspaces` claim matches the memberships.
- **`packages/auth`:** token checks (issuer, audience, expiry, signature)
  against a local key pair; the BFF handlers (cookie flags, `Origin`,
  `state`/`nonce`, refresh, logout); `requireRole`.
- **Planner:** private vs public snapshots (404 for strangers, `no-store`,
  absent from `/shapes`), library versions and Share, login against a test
  `accounts`; the OpenAPI description gains the new routes and the contract
  test covers them.
- **Conformance:** the OpenID Foundation conformance suite (prebuilt Docker
  images) runs once against `accounts` before going live, as its own step;
  results are committed. Not in CI.
- **Browser:** Playwright with Chrome: sign up, log in to the planner, save,
  open from the library, share, join a club, pair a device.

## 10. Deployment and the later domain

- `apps/accounts` becomes the Fly app `tinylap-accounts`: one smallest
  machine that stops when idle, a 1 GB volume at `/data`. CI deploys it like
  the planner, only when it changed, with its own smoke test.
- Configuration by environment: issuer URL, allowed redirect URIs, client
  registrations for the planner (confidential, with secret) and its
  service client.
- **Replacing the issuer later** (the domain): data keys on TinyLap user ids,
  so a new issuer URL is a configuration change. Passkeys are bound to the
  host they were created on (the WebAuthn RP ID): the old host serves
  `/.well-known/webauthn` naming the new origin (Related Origin Requests;
  Chrome, Edge and Safari support it, Firefox does not yet), and the account
  page prompts everyone to add a passkey on the new host. The move is planned
  when the domain is bought.

## 11. Documentation

- `docs/identity.md` gains a section on accounts and workspaces: who owns
  what, roles, devices, private and public snapshots, deletion and the feed,
  data protection.
- README: self-hosting `accounts`, or plugging in another OIDC provider.
- `packages/auth/README.md`: how a new app or MCP server joins the suite.
- A privacy page in `accounts`: what is stored (display name, passkeys,
  memberships, private tracks in the planner), how to export it, how to
  delete it.

## 12. Out of scope

- Email (modelled, switched off), GitHub and Google login.
- The timing app, MCP servers, online races.
- Buying a domain.
- Social features of any kind.
