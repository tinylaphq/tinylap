# Member streams end at once: sign-out, and membership notices from accounts

Status: reviewed by the owner (issue #45). It follows #39 / PR #44, which made open member streams recheck access every 15 s, and the identity spec (`2026-10-14-identity-design.md`, §3 "How apps learn about workspaces", §7). Paths are relative to the repository root.

Product owner decisions recorded here (binding):
- **Removal reaches timing as a push notice from accounts** (owner, 2026-10-22), not as a shorter token lifetime and not as a polled feed.
- An open tab renewing its session through the stream's checks is accepted (owner, 2026-10-22, on the #44 review).
- Refresh retries and warnings during an issuer outage are accepted as harmless (owner, 2026-10-22).

## 1. Problem

Since #44, a member stream (`/clubs/<id>/board/events`, `/workspaces/<id>/live`) ends:
- within 15 s of a sign-out, by polling the session;
- within one access token lifetime (10 min) plus 15 s of a removal from the club, a club deletion or an account deletion, because membership is read only from the token's `workspaces` claim.

The 15 s poll also re-reads, unseals and re-verifies the same token about 39 times out of 40.

## 2. Goals and non-goals

**Goals**
1. Signing out of timing ends that session's open streams at once.
2. A removal from a club, leaving it, a club deletion, an account deletion or a role change ends the affected streams within seconds, whenever accounts can reach timing.
3. The reconnect that follows sees the new membership: it gets the not-found page, not the stream again.
4. The access check runs about once per token lifetime, not every 15 s.
5. If a notice is lost, nothing gets worse than today: the token refresh still catches the change.

**Non-goals**
- Signing out of accounts, or of the planner, ending timing's streams. That is OIDC back-channel logout, a later spec.
- Notices to the planner. It holds no open streams.
- A durable outbox or retries for notices. The token refresh is the fallback.
- Notices carrying authority. The token stays the only source of truth for membership (§4.2).

## 3. Sign-out ends streams at once

- Every member stream is registered with its viewer's **session id** and **user id** (watcher streams have neither and are untouched).
- The logout route in `apps/timing/server/auth.js` ends every stream registered with the session it ends, before it answers. It uses the same teardown as the access check: unsubscribe and stop the heartbeat first, then end the response.
- An account deletion that reaches timing through the deletions feed already deletes the user's session rows. Their streams end at the next check (§5), or at once through a notice (§4).

The registry is in memory, in the hub or a small module next to it. A restart drops every stream anyway.

## 4. Membership notices from accounts

### 4.1 What accounts sends

After a membership change commits, accounts sends one notice to every client that registered a `noticeUri`:

```
POST <noticeUri>
Authorization: Bearer <that client's noticeToken>
Content-Type: application/json

{ "users": ["<user id>", ...] }
```

- **Changes that send one:**
  - `removeMember`: the removed user.
  - `leaveClub`: the user who left.
  - `setRole` and `transferOwnership`: both users whose role changed.
  - `deleteClub`: every member, read before the delete.
  - `deleteUser`: the user.
- **Delivery is best-effort.** The notice is sent after the response is committed, never inside the database transaction, with a 5 s timeout and no retry. A failure is logged once as a warning. The 10-minute token refresh is the fallback (goal 5).
- **Configuration:** `TINYLAP_CLIENTS` gets an optional `noticeUri` and `noticeToken` per client, both or neither. `noticeUri` is checked the same way as `resource`: https, or http on localhost in dev. `noticeToken` is a dedicated static secret, never the client secret (§8). Only timing sets them.

### 4.2 What timing does with it

`POST /notices/membership` (a new route in `apps/timing/server`):

1. It compares the bearer token with `TINYLAP_NOTICE_TOKEN`, as SHA-256 digests in constant time like accounts' feed tokens, and answers 401 otherwise. Without the setting, the route answers 404. The body is size-limited and must be `{ users: string[] }`; anything else gets 422 `invalid-request`, like every other bad body in timing's API. A good notice gets 204.
2. **It marks each user's tokens as stale.** `@tinylap/auth`'s BFF gets `stale(userId)`: the next `session()` for any of that user's sessions refreshes the token even when it isn't near expiry, if the token was issued before the mark (`claims.iat` < mark). The marks are kept in memory and pruned once they are older than one token lifetime, because by then every older token has expired.
3. **It rechecks each user's open streams now**, through the same check as §5. The refreshed claims decide whether a stream ends. A reconnect refreshes too (step 2), so it gets the not-found page.

The notice only says *these users' memberships changed*. It ends nothing by itself, so a forged or replayed notice costs at most a token refresh per named user. That is why a shared bearer secret is enough, with no signature, timestamp or nonce.

## 5. The access check runs at the token's expiry

- After each check, the stream schedules the next one for just past the point where the BFF refreshes its token: `exp − REFRESH_MARGIN + 1 s`, measured from the claims the check just saw.
- `accessCheckMs` (15 s) stays the retry interval after an outage or an error.
- Sign-out (§3) and membership changes (§4) no longer depend on the timer.
- `@tinylap/auth` exports the refresh margin, or a `refreshAt(claims)` helper, so timing doesn't copy the 60 s constant.

## 6. Testing

- **Timing:**
  - Sign-out ends a board stream and a JSON live stream at once, without waiting for a check.
  - A notice for a removed member ends both stream kinds within a second, and the reconnect gets 404.
  - A notice for a member who is still allowed leaves the stream open.
  - A notice with a wrong or missing secret gets 401 and changes nothing. A bad body gets 422.
  - The access check runs at the token's expiry, not every 15 s, using a short token lifetime and a fake clock where the BFF allows one.
- **`@tinylap/auth`:** `stale()` forces exactly one refresh for that user's sessions with tokens older than the mark, and none for tokens newer than it. Marks are pruned.
- **Accounts:** each change in §4.1 sends one notice with the right users, after the change is stored. A timing that is down or slow does not fail or delay the change beyond the 5 s timeout. A client without `noticeUri` gets nothing.
- **End to end** (`tools/test-env.js`): accounts and timing together. Removing a member in accounts ends their open board stream in timing.

## 7. Deployment

- One new secret: a random notice token. It goes into timing's entry in accounts' `TINYLAP_CLIENTS` (a Fly secret), as `noticeToken` next to `noticeUri: https://<timing>/notices/membership`, and into timing as the Fly secret `TINYLAP_NOTICE_TOKEN`.
- Deploy order doesn't matter. If accounts sends before timing has the route, timing answers 404, accounts logs the warning, and the fallback applies.

## 8. Decisions

1. **A dedicated notice token, not the client secret** (owner, 2026-10-22).
   - A leaked notice token lets someone trigger token refreshes and nothing else. A leaked client secret would let them authenticate as timing at the token endpoint. A bearer value on every request can end up in proxy or error logs.
   - The client secret's OIDC rotation stays separate from the notice path.
   - It is the deletions feed's pattern in the other direction.
2. **Accounts sends without awaiting the notice** (owner, 2026-10-22). Its write handlers are synchronous SQLite calls, so the notice goes out right after the `ws.*` call returns. A slow or unreachable timing never holds up the accounts response.
3. **A role change sends a notice too** (owner, 2026-10-22). Today every role may run timing, so a role change never ends a stream. It is sent anyway, because it is cheap and keeps later role rules correct.
