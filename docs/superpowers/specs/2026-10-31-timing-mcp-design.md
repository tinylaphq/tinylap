# Timing over MCP: design

An assistant should be able to run a club's timing the way a member does: add drivers, assign transponders, set up tracks, pair decoders, start and end sessions, and read the board. It does so as that member, with that member's permissions. This spec offers the whole timing JSON API (`apps/timing/server/openapi.json`) as a remote MCP server inside the timing app, and adds what accounts needs so that MCP clients can sign in. It builds on the identity spec (`2026-10-14-identity-design.md`) and the timing-core spec (`2026-10-15-timing-core-design.md`). Paths are relative to the repository root.

## 1. Why

Timing has a JSON API, but the API takes only the app's own session cookie, and writes must come from the app's own pages. An assistant can't use it. Clubs run timing from a laptop beside the track, often with their hands full. "Start a five-minute qualifying with Anna, Ben and Chris" or "who holds the record on the new layout?" are things a member could ask an assistant, if the assistant could reach timing.

## 2. Goals, non-goals, anti-goals

Goals:

1. **The full suite, not a read-only subset.** Every member operation the JSON API offers is a tool, except the tap (§5.3).
2. **The assistant is the member.** It signs in through accounts and gets the same `timing.run`, `timing.setup` and `timing.delete` checks the pages use. A member who can't delete a track on the pages can't delete it over MCP.
3. **Any MCP client can connect, and the member knows which one did.** Consent names the client and its domain. The account page lists every connected app and revokes any of them.
4. **Nothing is lost without the member saying so.** Every tool that loses data or interrupts a running session asks for an explicit confirmation, like the pages do.

Non-goals:

- A local (stdio) server. Clients that only speak stdio can use a generic remote-to-stdio bridge.
- Subscriptions to the live stream. `get_live` returns the board as it is now; an assistant asks again when it needs to.
- MCP resources and prompts. Tools only.
- Club and membership management (invites, roles, leaving). That belongs to accounts.
- Tokens limited to one club. A connection reaches every club the member belongs to, and nothing else.

Anti-goals (a failure even if it works):

- A token issued to an MCP client that also works against the planner, accounts or the timing pages.
- A client that reaches a club its member isn't in, or does something there the member's role doesn't allow.
- A tool that deletes, unpairs, aborts or replaces on its first call.
- A consent page where a client's own name or logo can pass it off as another client.

## 3. Transport

- **Endpoint:** `POST /mcp` on the timing origin, using Streamable HTTP from the official `@modelcontextprotocol/sdk` (1.x). The SDK's `StreamableHTTPServerTransport` is mounted on timing's own router, like every other route. It is not an Express app.
- **Stateless.** There is no `Mcp-Session-Id`. Each request builds a server and a transport, handles one JSON-RPC message or batch, and answers with JSON (`enableJsonResponse`). `GET /mcp` and `DELETE /mcp` answer 405, because there is no server-to-client stream.
- **The request body** is read with `server/body.js` and its limit, then handed to the transport as the parsed body.
- **No cookies.** `/mcp` ignores the `Cookie` header. A browser holding a timing session gains nothing by sending a request there. Every request needs a bearer token, so there is no ambient authority for another origin to abuse, and any `Origin` is accepted. CORS for `/mcp` allows any origin, with the `Authorization`, `Content-Type`, `Mcp-Protocol-Version` and `Last-Event-ID` request headers, and exposes `WWW-Authenticate`.
- **Rate limit:** each member's calls go through `@tinylap/auth`'s `rateLimiter`, keyed by the token's `sub`. An exceeded limit is a JSON-RPC error with the seconds to wait.

## 4. Sign-in

### 4.1 Timing as a protected resource

- The MCP resource is `${TIMING_PUBLIC_URL}/mcp`. Its metadata (RFC 9728) is served at `/.well-known/oauth-protected-resource/mcp`: `{ resource, authorization_servers: [issuer], bearer_methods_supported: ["header"], scopes_supported: ["openid", "profile", "offline_access"] }`.
- Without a token, or with one that fails, `/mcp` answers 401 with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"`. When the token is expired or invalid, the header also carries `error="invalid_token"`.
- Tokens are checked with `verifyAccessToken` from `@tinylap/auth`, with the audience set to the MCP resource. A token issued for the timing app's BFF (audience: the timing origin) fails the check, and an MCP token can't pass as a BFF session, since the BFF never reads bearer tokens. When the issuer's keys can't be reached, `/mcp` answers 503.
- The token's `workspaces` claim is read live at every issuance (identity spec §3). Access tokens live `TINYLAP_ACCESS_TTL` (600 s), so a role change or removal reaches MCP within ten minutes, exactly as it reaches the pages.

### 4.2 Accounts: Client ID Metadata Documents

- Accounts installs `@better-auth/cimd` (the same version as `better-auth`, 1.7.7). An MCP client identifies itself with an HTTPS URL as its `client_id`. Accounts fetches the metadata document from that URL and checks that it names itself. Dynamic client registration stays disabled.
- The discovery document advertises `client_id_metadata_document_supported: true`. Accounts still offers only `authorization_code` with PKCE (`S256`), plus `refresh_token`.
- **CIMD clients may only ask for the timing MCP resource.** A new configuration value, `TINYLAP_MCP_RESOURCE` (for example `https://timing.tinylap.app/mcp`), adds that resource to the provider's resources. Every CIMD client is linked to that resource and no other, so `enforcePerClientResources` refuses a CIMD client that asks for the planner or the timing BFF. First-party clients from `TINYLAP_CLIENTS` keep their consent-free, preset flow.
- **Fetching metadata is network input from anyone.** The plugin's resolve-once DNS handling, special-use address refusal, connection pinning and redirect refusal stay on. The document has a size limit and a short fetch timeout, and the fetch goes through the existing rate limits. In `TINYLAP_DEV`, loopback `http` client ids are allowed so tests can serve a document locally. That is refused with an `https` issuer, like the other dev settings.
- Redirect URIs come from the metadata document and must match exactly.

### 4.3 Consent

Today `/consent` says no other apps can ask for access. It becomes a real page, server-rendered with palace-ui and `@tinylap/design`:

- **Heading:** "Allow *{client_name}* to run timing as you?"
- **Below it, larger than the name:** the host of the `client_id` URL (for example `claude.ai`). This is the only identity accounts has verified. The client's logo is not shown, and the name is plain text, cut to 60 characters.
- **What it can do, in the member's words:** "Read and change timing in every club you're in, with your role there: drivers, transponders, tracks, decoders, sessions and the watchers link. It can't change your account or your clubs."
- **"Stay connected"** is shown when `offline_access` is asked for: "Until you disconnect it on your account page."
- **Two plain forms:** Allow and Cancel. Each POSTs and answers 303 to the client's redirect URI, the way Better Auth's consent endpoint expects. A failed form comes back as the same page with status 422.
- Consent is remembered per client, so the next sign-in skips the page, until the member revokes it.

### 4.4 Connected apps on the account page

- A new section, "Connected apps", lists each client the member has consented to: its name, its domain, when they allowed it, and when it was last used (the newest token issued to it). When there are none it says so in one line.
- Each row has a **Disconnect** form: a POST, then a 303 back to the account page. Disconnecting deletes the consent and revokes every refresh and access token for that client and member. The client's next call fails with `invalid_token`, and its next sign-in asks for consent again.
- Seeded first-party clients are not listed. They are part of TinyLap, not something the member connected.

## 5. Tools

### 5.1 Shape

- **Written by hand** in `apps/timing/server/mcp/`, one module per area (drivers, transponders, tracks, decoders, sessions, watch, live). Each tool calls the same function in `server/operations.js` that the JSON route calls. Tools never call the HTTP API, and they never duplicate a check `operations.js` already makes.
- **Names are snake_case verbs**, and descriptions are written for an assistant. Each description says what the tool does, what it needs, and what it changes. Inputs are zod schemas (the SDK's), with the limits from `operations.js` (`MAX_NAME`, `COLOURS` and the rest) stated in them.
- **Every tool but `list_workspaces` takes `workspace`**, a workspace id from `list_workspaces`. The check is the one `workspaceRoute` makes, factored out so both use it: not a member gives `not-found`, and a role that may not gives `forbidden`. The same-origin check does not apply, because it protects the cookie, and `/mcp` has none.
- **Results** are `structuredContent`: the same JSON the API answers, with an `outputSchema`. A `text` block holds the same JSON, for clients that don't read structured content.
- **Failures** are tool results with `isError: true`, not JSON-RPC errors, so the assistant can read them and recover. The text is the Problem Details title and detail, with the field named when there is one: "That name is in use (name)". The problem's `name` is in `structuredContent`.
- **Annotations** on every tool: `readOnlyHint` for reads, `destructiveHint` for the tools in §6, `idempotentHint` where repeating changes nothing (assigning a transponder, renaming), and `openWorldHint: false` on all but `attach_layout`, which reaches the planner.
- **`by`**, for layouts attached and sessions started, is `{ userId: sub, name }`. The name is the token's `name` claim if it has one, else the issuer's userinfo, cached per token.

### 5.2 The tools

| Tool | Operation | Action | Notes |
| --- | --- | --- | --- |
| `list_workspaces` | token claims | — | Each club and personal space: `{ id, name, kind, role }` |
| `get_live` | `GET /workspaces/{w}` | `timing.run` | The board now: track, session, standings, recent crossings, drivers, personal bests |
| `list_drivers` | `GET …/drivers` | `timing.run` | |
| `add_driver` | `POST …/drivers` | `timing.setup` | `name`, optional `colour` |
| `update_driver` | `PATCH …/drivers/{d}` | `timing.setup` | `driver`, `name?`, `colour?` |
| `delete_driver` | `DELETE …/drivers/{d}` | `timing.delete` | Confirmed (§6) |
| `list_transponders` | `GET …/transponders` | `timing.run` | |
| `assign_transponder` | `PUT …/transponders/{c}` | `timing.setup` | `code`, `driver` or null to unassign |
| `list_tracks` | `GET …/tracks` | `timing.run` | `include_archived` |
| `add_track` | `POST …/tracks` | `timing.setup` | `name`, optional planner `link` |
| `rename_track` | `PATCH …/tracks/{t}` `{ name }` | `timing.setup` | |
| `attach_layout` | `POST …/tracks/{t}/layouts` | `timing.setup` | Confirmed when it replaces a different layout (§6) |
| `set_current_track` | `PUT …/track` | `timing.setup` | `track`, `direction`; confirmed when it ends a running practice |
| `archive_track` | `PATCH …/tracks/{t}` `{ archived: true }` | `timing.setup` | |
| `restore_track` | `PATCH …/tracks/{t}` `{ archived: false }` | `timing.setup` | |
| `delete_track` | `DELETE …/tracks/{t}` | `timing.delete` | Confirmed |
| `list_decoders` | `GET …/decoders` | `timing.run` | |
| `pair_decoder` | `POST …/decoders` | `timing.setup` | Answers the decoder's token once, as the API does |
| `unpair_decoder` | `DELETE …/decoders/{d}` | `timing.delete` | Confirmed |
| `list_sessions` | `GET …/sessions` | `timing.run` | |
| `get_session` | `GET …/sessions/{s}` | `timing.run` | Standings and crossings: the results |
| `start_session` | `POST …/sessions` | `timing.run` | `kind`, `roster`, `duration_seconds`, `countdown_seconds`; confirmed when it replaces a running session |
| `end_session` | `POST …/sessions/{s}/end` | `timing.run` | A running practice |
| `abort_session` | `POST …/sessions/{s}/abort` | `timing.run` | Confirmed |
| `get_watch_link` | `GET …/watch-token` | `timing.run` | The full watchers URL, not only the token |
| `rotate_watch_link` | `POST …/watch-token` | `timing.setup` | Confirmed when a link exists: the old one stops working |

The Action column is what each route in `server/setup.js`, `server/control.js` and `server/workspace.js` requires today. A test checks that every tool asks for the same action as its route.

### 5.3 Left out, on purpose

- **`POST …/tap`**, the tap entry. A tap's lap time is the moment it arrives, and an assistant's round trip makes that moment meaningless.
- **`POST /decoders/{d}/passings`.** It belongs to a decoder's token, not a member.
- **`GET …/live` (SSE)** is covered by `get_live` (§2).
- **Sign-in, notices, docs and watch routes.** These aren't member operations.

A test walks `openapi.json` and fails when an operation under `/workspaces/` is neither a tool nor on this list. A new route then can't quietly miss MCP.

## 6. Confirmation

The pages put a confirmation between the member and anything that loses data or interrupts a session. Over MCP the same thing happens in two calls:

1. The tool takes `confirm: boolean`, which defaults to false. Without it, nothing changes. The tool answers a normal (non-error) result `{ confirmationRequired: true, message }`, and its text says what would happen in the words of the matching confirmation page. For example: "Deleting Anna removes her from the drivers. Her 3 transponders become unassigned; her laps stay. Ask the member, then call again with confirm: true."
2. Called again with `confirm: true`, it acts.

- **Which tools:** `delete_driver`, `delete_track`, `unpair_decoder` and `abort_session` always ask. `start_session` asks when a session is running, and its message names that session and what happens to it (a practice ends as done; a qualifying or race is aborted). `confirm: true` maps to the API's `replace: true`. `attach_layout` asks when the track has a different layout, as the API's 409 does. `set_current_track` asks when it would end a running practice. `rotate_watch_link` asks when a link already exists.
- **A confirmation is tied to what it was shown.** `start_session` with `confirm: true` replaces only the session its first call named. The result of the first call carries `replaces: sessionId`, and the second call must pass it back. If another session started in between, the second call asks again. This follows `sessions-pages.js`, where a confirmation replaces only the session it named.
- **These tools also carry `destructiveHint: true`**, so a client that asks its user before such calls does so. Tool descriptions tell the assistant to ask the member before passing `confirm: true`. The server can't check that the assistant asked, so the annotation and the client's own approval prompt are the second safeguard.
- MCP elicitation is not used. Not every client supports it, and the two-step result works everywhere.

## 7. Docs

- The API page (`/api`) gets an "MCP" section: the endpoint URL, how to add it in a client ("add a custom connector with this URL"), and a list of the tools.
- `apps/timing/README.md` documents `/mcp` and the new protected-resource route. `apps/accounts/README.md` documents `TINYLAP_MCP_RESOURCE` and CIMD.
- `docs/identity.md` gets a short section for members: connecting an assistant, what it can do, how to disconnect it.

## 8. Tests

- **Tools, unit:** each tool against the in-memory store, as the operations tests do. That covers success, each refusal (`not-found`, `forbidden`, invalid input) and, for confirmed tools, that the first call changes nothing.
- **Permissions:** a `member` token can't call `delete_track` or `delete_driver`. A token without the workspace gets `not-found`. Each tool asks for the same action as its route.
- **Coverage:** the openapi walk from §5.3.
- **Transport:** 401 with `WWW-Authenticate` and no token, a BFF-audience token refused, cookies ignored, 405 on `GET` and `DELETE`, the body limit, the rate limit.
- **End to end:** accounts and timing run together. A test client serves its metadata document on loopback, signs in with a passkey (the existing virtual authenticator), consents, gets a token, lists tools and starts and ends a practice. It then disconnects on the account page and is refused.
- **Accounts:** a CIMD client asking for a resource other than the MCP resource is refused. The consent page (render, Allow, Cancel, 422). Connected apps (list, Disconnect, first-party clients hidden).

## 9. Left to the builder

- Where in `server/app.js` `/mcp` is routed, and how the per-request server is built (one `McpServer` per request, with tools registered from a static list).
- How the userinfo name is cached.
- The exact wording of each tool's description and confirmation message, kept close to the pages' own text.
- Whether `outputSchema` is written per tool or shared per area.

## 10. Decisions

- **A remote endpoint inside timing**, not a local server. It calls `operations.js` in-process, so MCP can't drift from the pages and the API. Members connect with a URL and install nothing.
- **Client ID Metadata Documents, not dynamic registration.** Accounts stores nothing until a member consents, a client's identity is its domain, and this is what the current MCP authorization spec prefers.
- **Any client may connect.** There is no allowlist. Consent names the domain, and the account page disconnects any client.
- **A connection reaches all of the member's clubs.** Membership and role checks still apply in every club.
- **Hand-written tools**, not tools generated from `openapi.json`. The API's descriptions are written for developers, and its bodies have no schemas. A coverage test makes up for not generating them.
- **A two-step `confirm`, plus `destructiveHint`**, instead of elicitation.
- **The official SDK in stateless JSON mode.** It tracks the spec for us. There are no sessions to store, because there is no subscription.
