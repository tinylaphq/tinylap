# Member Streams End at Once: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open member streams in timing end at once on sign-out and within seconds of a membership change in accounts. The access check runs once per token lifetime instead of every 15 s.

**Architecture:**
- `@tinylap/auth`'s BFF learns to treat a user's tokens as stale and reports when it will next refresh.
- Timing keeps an in-memory registry of open member streams, keyed by session and user. Logout and a new notice route end or recheck them, and each stream schedules its own check at the token's refresh.
- Accounts sends a best-effort notice to clients that registered one, after every membership change.

**Tech Stack:** Node 24 ESM, `node:test`, `openid-client`, `jose`, SQLite through `node:sqlite`. There are no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-22-membership-notices-design.md`

## Global Constraints

- The notice is `POST <noticeUri>` with `Authorization: Bearer <noticeToken>` and the body `{ "users": ["<user id>", ...] }`. Accounts never awaits it, times it out after 5 s, never retries it, and logs one warning per failure.
- Timing's route is `POST /notices/membership`:
  - 204 on success.
  - 401 for a wrong or missing bearer.
  - 422 `invalid-request` for a bad body.
  - 404 when `TINYLAP_NOTICE_TOKEN` isn't set.
  - The bearer is compared as SHA-256 digests in constant time.
- A notice ends nothing by itself. Only refreshed claims decide whether a stream ends.
- `noticeUri` and `noticeToken` are optional per client, but both or neither. `noticeUri` is checked like `resource`. `noticeToken` is a non-empty string and is never the client secret.
- The access check runs at `refreshAt + 1 s`, and `accessCheckMs` (15 s) is the retry after an outage or an error.
- Watcher streams are untouched.
- Commits are conventional, signed off (`git commit -s`), with author email `1009814+jostsg@users.noreply.github.com`, and **no AI attribution**.
- Before each commit, run the affected package's `test`, `lint` and `typecheck`.

## Review Focus

1. **Clock skew between accounts and timing:** a stale mark must never make a session refresh again on every check. That's why it is compared with when *this* BFF obtained the tokens, not with `iat` (Task 1, test `a stale mark forces one refresh, not one per call`).
2. **A notice for a user with no open streams, or an unknown user:** it gets 204 and changes nothing (Task 3, test `a notice for a user without streams is 204`).
3. **Logout without a session cookie, or for a session with no streams:** it still answers as today (Task 2, test `logout with no open streams answers as before`).
4. **Club deletion:** the members are read *before* the delete. Reading them after it would give an empty list (Task 4, test `deleting a club notifies every member`).
5. **Timing down when accounts changes a membership:** the accounts response is not delayed, and one warning is logged (Task 4, test `an unreachable notice URI neither fails nor delays the change`).

---

### Task 1: `@tinylap/auth`: `stale(userId)` and `refreshAt`

**Files:**
- Modify: `packages/auth/bff.js`. Change `tokensFrom` (~line 201), `refresh` (~268) and `session` (~457), and add `stale`.
- Modify: `packages/auth/types.d.ts`. Change `BffSession` (~151), add `Bff.stale` (~157), and change `SealedTokens`.
- Modify: `packages/auth/README.md`. Document both under the BFF section.
- Test: `packages/auth/test/bff.test.js`.

**Interfaces:**
- Produces:
  - `BffSession.refreshAt: number`, in ms since the epoch: the moment `session()` will refresh the token, which is `tokens.expiresAt - REFRESH_MARGIN_MS`.
  - `Bff.stale(userId: string): void`. The next `session()` for any session of `userId` whose tokens were obtained before the call refreshes once, even when the token isn't near expiry.
- `SealedTokens.obtainedAt?: number` is set to `Date.now()` in `tokensFrom`. Tokens sealed before this change lack it and count as obtained at 0.
- Marks are a `Map<userId, markedAt>`, pruned on each `stale()` call once they are older than `STALE_KEEP_MS = 3_600_000`. That is a deliberate floor above any access token lifetime. The spec says "one token lifetime", but the BFF doesn't know that lifetime.

- [ ] **Step 1: Write the failing tests** in `bff.test.js`, using the file's existing fake issuer:
  - `session() reports refreshAt as the token's expiry less 60 s`: `assert.equal(s.refreshAt, claims.exp * 1000 - 60_000)`.
  - `a stale mark forces one refresh, not one per call`: log in, `bff.stale(userId)`, call `session()` twice. Then `assert.equal(issuer.refreshCount, 1)`. The second call returns the new token, and `assert.notEqual(second.accessToken, before.accessToken)`.
  - `a mark for another user forces nothing`: `assert.equal(issuer.refreshCount, 0)`.
  - `a mark made before the tokens were obtained forces nothing`: `stale()` first, log in after it, then `session()` makes 0 refreshes.
- [ ] **Step 2:** Run `pnpm --filter @tinylap/auth test`. It should FAIL, because `refreshAt` is undefined and `stale` is not a function.
- [ ] **Step 3: Implement.**
  - `session()`'s fast path also skips to a refresh when the user is marked and `(tokens.obtainedAt ?? 0) < mark`.
  - `refresh(id)` gets the same condition in its own fast path (~line 272), so that the re-read doesn't return the stale tokens.
  - Every return of a `BffSession` includes `refreshAt`.
- [ ] **Step 4:** Run `pnpm --filter @tinylap/auth test lint typecheck`. Everything should PASS.
- [ ] **Step 5:** Commit: `feat(auth): mark a user's tokens stale, and say when a session refreshes`.

### Task 2: Timing: a registry of open member streams; logout ends them, checks follow the token

**Files:**
- Create: `apps/timing/server/member-streams.js`. It replaces `endWhenDenied` and `stillAllowed` in `access.js`.
- Modify: `apps/timing/server/access.js`. Remove `endWhenDenied` and `stillAllowed`, and keep `workspaceRoute`.
- Modify: `apps/timing/server/board-stream.js` and `apps/timing/server/stream.js`. Call `request.streams.watch(...)` where they call `endWhenDenied` today.
- Modify: `apps/timing/server/app.js`. The context gets `streams: options.streams ?? createMemberStreams()`. `accessCheckMs` moves into `createMemberStreams({ retryMs })`, and the `accessCheckMs` option stays as its source.
- Modify: `apps/timing/server/auth.js` `logout`. After the same-origin check, call `request.streams.endSession(request.auth.bff.sessionId(request.req))`, then `bff.logout`.
- Test: `apps/timing/test/server/stream-access.test.js` (extend it).

**Interfaces:**
- Produces, in `member-streams.js`:
  - `createMemberStreams({ retryMs = 15_000 } = {}) → MemberStreams`.
  - `MemberStreams.watch(request, workspaceId, action, watcher, end): () => void`. It returns a no-op stop for a watcher. Otherwise it registers `{ sessionId: request.auth.bff.sessionId(request.req), userId: request.userId, check, end }` and returns the stop that unregisters it and clears its timer. `end` keeps the contract from PR #44: it stops everything that writes, then ends the response.
  - `MemberStreams.endSession(sessionId: string | null): void`. It calls `end()` on every stream registered with that session.
  - `MemberStreams.recheck(userIds: string[]): void`. It runs `check()` now for every stream of those users.
- Consumes from Task 1: `session.refreshAt`.
- Check, per stream:
  1. Call `bff.session(req)`.
  2. If the session is null, or `can(claims, workspaceId, action)` is false, call `end()`.
  3. Otherwise schedule the next check after `max(session.refreshAt + 1000 - Date.now(), retryMs)`.
  4. On an outage (`isOutage`) or any other error, schedule the next check after `retryMs`. Any error other than an outage is logged and calls `end()`, as today.
  5. Only one check runs at a time per stream. A `recheck` during a check is dropped.

- [ ] **Step 1: Write the failing tests**, for both streams in the existing `STREAMS` loop:
  - `the <stream> ends at once on sign-out`: use `startTiming` with `accessCheckMs: 60_000`. Open the stream, `POST /auth/logout`, then `assert.equal(await next(it, 'ended'), null)` within the default test timeout. A 60 s check rules out the poll.
  - `the <stream> checks again only when the token refreshes`: wrap `app.auth.bff.session` in a counter, keep the stream open for 300 ms with `accessCheckMs: 50` and a 600 s token, then `assert.equal(calls, 0)`.
  - `logout with no open streams answers as before`: compare status and `Location` with a logout that has no streams.
  - Keep the #44 removal tests: they use `TINYLAP_ACCESS_TTL: '1'`, so `refreshAt` is in the past and the retry interval applies.
- [ ] **Step 2:** Run `node --test --test-timeout=10000 test/server/stream-access.test.js` in `apps/timing`. It should FAIL: sign-out waits for the poll, and the count is greater than 0.
- [ ] **Step 3: Implement** `member-streams.js` as the interfaces above say, and wire it into `app.js`, both stream files and `logout`.
- [ ] **Step 4:** Run `pnpm --filter @tinylap/timing-app test lint typecheck`. Everything should PASS.
- [ ] **Step 5:** Commit: `feat(timing-app): sign-out ends its streams at once, and streams check access when the token refreshes`.

### Task 3: Timing: `POST /notices/membership`

**Files:**
- Create: `apps/timing/server/notices.js`. It exports `noticeRoutes`.
- Modify: `apps/timing/server/routes.js`. Add `...noticeRoutes`.
- Modify: `apps/timing/server/app.js`. The context gets `noticeDigest`: the SHA-256 of `options.noticeToken`, or `null`.
- Modify: `apps/timing/server/main.js`. Read `TINYLAP_NOTICE_TOKEN`, which is optional, and document it in the header comment.
- Modify: `apps/timing/server/openapi.json`. Add the route.
- Test: `apps/timing/test/server/notices.test.js` (new).

**Interfaces:**
- Consumes: `request.auth.bff.stale(userId)` (Task 1), `request.streams.recheck(userIds)` (Task 2), and `readJson(request, max)` from `body.js`.
- The route is `{ pattern: /^\/notices\/membership$/, methods: { POST: notice } }`, not `credentials`, because it reads no cookie.
- Answers:
  - 404 when there's no `noticeDigest`.
  - 401 with `WWW-Authenticate: Bearer realm="notices"` for a bearer whose digest doesn't match.
  - 422 `invalid-request` unless the body is `{ users: string[] }` with 1 to 1000 non-empty strings, within `MAX_BODY`.
  - Otherwise call `stale(u)` for each user, then `recheck(users)`, then answer 204.
- Problem types come from `openapi.json`'s `x-tinylap-problems`: `not-found` (404), `unauthorized` (401), `invalid-request` (422), `too-large` (413, from `readJson`).

- [ ] **Step 1: Write the failing tests:**
  - `a notice for a removed member ends their board stream and the reconnect gets 404`: use `startTiming({ noticeToken: 'n-test' })` with the default 600 s token. `removeMember` in accounts, `POST` the notice with `{ users: [cy.id] }` and get 204. Then `next(it,'ended') === null`, and a new `GET board/events` gets 404.
  - `a notice for a member still allowed leaves the stream open`: send the notice, then `hub.publish` and get a `board` event.
  - `a notice for a user without streams is 204`.
  - `a wrong or missing bearer is 401 and marks nothing`: wrap `bff.stale`, send the request, then `assert.equal(calls, 0)`.
  - `a bad body is 422`: send `{}`, `{ users: 'x' }`, `{ users: [] }` and 1001 users.
  - `without a notice token the route is 404`.
- [ ] **Step 2:** Run `node --test --test-timeout=10000 test/server/notices.test.js`. It should FAIL with 404 everywhere.
- [ ] **Step 3: Implement** `notices.js`, and wire it into `routes.js`, `app.js`, `main.js` and `openapi.json`.
- [ ] **Step 4:** Run `pnpm --filter @tinylap/timing-app test lint typecheck`. Everything should PASS, including the OpenAPI contract test.
- [ ] **Step 5:** Commit: `feat(timing-app): accounts' membership notices recheck the members' open streams`.

### Task 4: Accounts sends membership notices

**Files:**
- Create: `apps/accounts/server/notices.js`.
- Modify: `apps/accounts/server/config.js` `readClients`. Read and check `noticeUri` and `noticeToken` (both or neither), and update the `ClientConfig` typedef and the header comment.
- Modify: `apps/accounts/server/workspaces.js`. Add `memberIds(db, workspaceId): string[]`.
- Modify: `apps/accounts/server/api.js`. Six handlers call `ctx.notify(...)` after their `ws.*` call; `ApiContext` gets `notify`.
- Modify: `apps/accounts/server/app.js`. Create the notifier and pass `notify` into `handleApi`'s context.
- Modify: `apps/accounts/test/helpers.js`. `startAccounts` takes `notice?: { uri: string, token: string }` and puts it on the client.
- Test: `apps/accounts/test/api.test.js` and `apps/accounts/test/config.test.js`.

**Interfaces:**
- Produces: `createNotifier({ clients, fetch = globalThis.fetch, timeoutMs = 5000, logger = console }) → (users: string[]) => void`.
  - It returns at once. For each client with a `noticeUri`, it starts a `fetch` that is never awaited, catches every rejection and any non-2xx, and logs `accounts: a membership notice to <origin> failed (<status or reason>)`. The log carries no user ids.
  - An empty `users` sends nothing.
- Calls in `api.js`:

  | Handler | `ctx.notify(...)` |
  |---|---|
  | `removeMember` | `[member]` |
  | `leaveClub` | `[user.id]` |
  | `setRole` | `[member]` |
  | `transferOwnership` | `[user.id, userId]` |
  | `deleteClub` | `memberIds(ctx.db, id)`, read **before** `ws.deleteClub` |
  | `DELETE /api/me` | `[user.id]` |

- [ ] **Step 1: Write the failing tests.** `api.test.js` starts a local `http` server that records the requests it gets, and passes `notice: { uri: <that server>, token: 'n-test' }`.
  - `removing a member notifies with the member`: one request, `authorization === 'Bearer n-test'`, and `body.users` deep-equals `[member.id]`.
  - One test each for leave, role change, transfer (both ids) and account deletion.
  - `deleting a club notifies every member`: the owner and two members, compared as sorted ids.
  - `an unreachable notice URI neither fails nor delays the change`: the notice server never answers, and `DELETE` gets 204 in under 1 s.
  - `a client without noticeUri gets nothing`.
  - In `config.test.js`: a `noticeUri` without a `noticeToken`, or the reverse, throws. A non-https `noticeUri` outside dev throws.
- [ ] **Step 2:** Run `pnpm --filter @tinylap/accounts test`. It should FAIL: no requests are recorded.
- [ ] **Step 3: Implement** `notices.js`, `memberIds`, the config reading, and the `api.js` and `app.js` wiring.
- [ ] **Step 4:** Run `pnpm --filter @tinylap/accounts test lint typecheck`. Everything should PASS.
- [ ] **Step 5:** Commit: `feat(accounts): tell registered clients when a membership changes`.

### Task 5: End to end, docs and deployment

**Files:**
- Modify: `tools/test-env.js` `startSuite`. Pass `notice` through to `startAccounts`.
- Modify: `apps/timing/test/server/helpers.js` `startTiming`. With `noticeToken`, pass `notice: { uri: \`${base}/notices/membership\`, token }` to `startSuite` and `noticeToken` to `createHandler`.
- Test: `apps/timing/test/server/notices.test.js`. Add `removing a member in accounts' API ends their open stream in timing`: call the real `DELETE /api/clubs/:id/members/:member` as the owner, through `suite`'s accounts session helpers.
- Docs:
  - `docs/superpowers/specs/2026-10-14-identity-design.md` §3 "How apps learn about workspaces": a membership change is pushed to registered clients, best-effort, and the token stays the source of truth.
  - `docs/identity.md` and `docs/timing.md`: the configuration for `noticeUri`, `noticeToken` and `TINYLAP_NOTICE_TOKEN`.
  - `apps/accounts/README.md` and `apps/timing/README.md` where they list environment variables.

- [ ] **Step 1: Write the failing e2e test.** After the API call, `assert.equal(await next(it, 'ended'), null)` with a 600 s token.
- [ ] **Step 2:** Run `node --test --test-timeout=10000 test/server/notices.test.js`. It should FAIL until the helpers pass `notice` through.
- [ ] **Step 3:** Wire `test-env.js` and `helpers.js`, then update the docs.
- [ ] **Step 4:** Run `pnpm check` (turbo test, lint and typecheck across the repo). Everything should PASS.
- [ ] **Step 5:** Commit: `test: a removal in accounts ends the member's timing stream, end to end` and `docs: membership notices`.
- [ ] **Step 6, deployment (owner, before or after the merge, in either order, §7):**
  1. Generate a token: `openssl rand -base64 32`.
  2. Set it on timing: `fly secrets set TINYLAP_NOTICE_TOKEN=<token> -a <timing app>`.
  3. On accounts, add `noticeUri: "https://<timing>/notices/membership"` and `noticeToken: "<token>"` to timing's entry in `TINYLAP_CLIENTS`.

  The implementer doesn't run these. They are listed in the PR description.
