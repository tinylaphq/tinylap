# Accounts signing-key race: implementation plan

**Goal:** concurrent token issues never create more than one live signing key.

**Cause (confirmed in better-auth 1.7.7, `dist/plugins/jwt/sign.mjs`):**
- `signJWT` looks for a live key. If it finds none, it calls `createJwk`, which generates an RSA-2048 pair (async, tens of ms) and inserts it.
- There is no lock, so N concurrent first issues create N keys and sign with different `kid`s.
- jose's remote JWKS in `@tinylap/auth` refetches at most every 30 s. A verifier that fetched while only some of the keys existed rejects the other tokens with `ERR_JWKS_NO_MATCHING_KEY` for up to 30 s.
- Reproduced earlier: 6 parallel first log-ins gave 3 failures and 6 `jwks` rows.
- When it happens in production: on a fresh accounts database, and after the README's rotation step expires the current key.

**Approach:**
- The JWT plugin accepts a top-level `adapter.createJwk(webKey, ctx)` option (`dist/plugins/jwt/types.d.mts`).
- Ours serialises creation per accounts instance, and inside the lock re-reads the table: if a live key exists by then, it returns that key and drops the freshly generated one.
- Accounts runs one machine (SQLite on one volume), so an in-process lock is enough.
- No startup key creation: the first issue after a fresh start or a rotation now stores exactly one key. Concurrent issues may still each generate a pair (generation runs before the hook); all but the first are dropped.
- The README's rotation section gains one sentence about the 30 s window below.

**Not covered:** a verifier that fetched the JWKS within 30 s before a rotation still rejects new tokens until its cooldown ends. That is jose's behaviour, rare (a manual rotation), and documented in the README.

## Global constraints

- Conventional commits, `git commit -s`, author `1009814+jostsg@users.noreply.github.com`, no AI attribution.
- Before committing: `pnpm turbo run test lint typecheck --filter=@tinylap/accounts --filter=@tinylap/timing-app`.

---

### Task 1: one signing key under concurrency (accounts)

**Files:**
- Modify: `apps/accounts/server/auth.js`: the lock at the top of `authOptions()` (where `jwt()` is built), `adapter: { createJwk }` next to `disableSettingJwtHeader`; `apps/accounts/README.md` (rotation)
- Test: `apps/accounts/test/signing-keys.test.js`

- [ ] **Step 1: failing tests** (append to `signing-keys.test.js`, importing `createRemoteJWKSet` from `jose`; it uses the file's `accessToken` and `expireKey`):

```js
const liveRows = () => accounts.db.prepare('SELECT id FROM jwks WHERE expiresAt IS NULL OR expiresAt > ?').all(new Date().toISOString());

test('concurrent token issues share one signing key', async () => {
  for (const { id } of liveRows()) expireKey(id, Date.now() - DAY);
  const tokens = await Promise.all(Array.from({ length: 6 }, accessToken));
  assert.equal(new Set(tokens.map((t) => decodeProtectedHeader(t).kid)).size, 1);
  assert.equal(liveRows().length, 1, 'one live key in the table');
  // Its own key set: the shared one was fetched within jose's 30 s cooldown.
  const options = { issuer: accounts.issuer, audience: accounts.client.resource, jwks: createRemoteJWKSet(new URL(`${accounts.issuer}/jwks`)) };
  for (const t of tokens) assert.ok(await verifyAccessToken(t, options));
});
```

  Run: `pnpm --filter @tinylap/accounts exec node --test test/signing-keys.test.js`. Expected: FAIL, with more than one `kid` or live row.
  If the race doesn't show reliably, raise the count to 12. If it still doesn't fail, stop and report.

- [ ] **Step 2: implement** at the top of `authOptions()`, importing `getCurrentAdapter` from `better-auth` (transaction-aware, as upstream's default):

```js
  // One live signing key at a time. Better Auth creates a key whenever it
  // finds no live one, without a lock, so concurrent first token issues each
  // made their own, and a verifier that had fetched the JWKS in between met
  // an unknown kid. Creation waits its turn and reuses a key that appeared.
  let storing = Promise.resolve();
  const createJwk = (webKey, ctx) => (storing = storing.catch(() => {}).then(async () => {
    const adapter = await getCurrentAdapter(ctx.context.adapter);
    const now = new Date();
    const live = (await adapter.findMany({ model: 'jwks' }))
      .filter((k) => !k.expiresAt || k.expiresAt > now)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return live ?? adapter.create({ model: 'jwks', data: { ...webKey, createdAt: new Date() } });
  }));
```

  and pass `adapter: { createJwk }` to `jwt({...})`, next to `jwks` and `jwt` (top level, not inside `jwks`). Type the parameters with JSDoc as tsc needs.

- [ ] **Step 3:** run the whole accounts suite, lint and typecheck. All pass, including the existing rotation test, which must still move signing to a new key.
- [ ] **Step 4: commit:** `fix(accounts): create one signing key when token issues race`.

### Task 2: drop the serial log-in workaround (timing tests)

**Files:** `apps/timing/test/server/helpers.js:70-71`, `apps/timing/test/server/setup.test.js:26-27`.

- [ ] **Step 1:** in the `login` JSDoc, remove only the second sentence ("Await one call at a time…"); the first still holds. In `setup.test.js`, replace the comment and the serial line with `[member, admin, stranger] = await Promise.all([ben, cy, zed].map((u) => app.login(u)));`. Other files that log in with consecutive `await`s do so by habit, not as a workaround; leave them.
- [ ] **Step 2:** run `pnpm --filter @tinylap/timing-app test` three times; all green.
- [ ] **Step 3: commit:** `test(timing-app): log in in parallel again`.

Then open one PR for both tasks.
