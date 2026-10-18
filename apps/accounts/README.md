# TinyLap Accounts

The suite's sign-in service: passkey sign-in, recovery codes, workspaces and an
OpenID Connect provider for the planner and later apps. One Node 24 process
on `node:http`, SQLite through `node:sqlite`, Better Auth used only as the
OIDC engine. Design: `docs/superpowers/specs/2026-10-14-identity-design.md`;
what it means for users: [docs/identity.md](../../docs/identity.md).

    pnpm --filter @tinylap/accounts dev     # http://localhost:4100, in-memory database
    pnpm --filter @tinylap/accounts test
    pnpm --filter @tinylap/accounts test:browser   # passkeys in Chrome

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `TINYLAP_ISSUER` | required | The public origin, which is the OIDC issuer. `https` and no path, unless `TINYLAP_DEV=1` |
| `BETTER_AUTH_SECRET` | required | At least 32 characters. Encrypts the signing keys and signs cookies |
| `TINYLAP_CLIENTS` | `[]` | JSON array of trusted clients: `{ clientId, clientSecret, redirectUris, postLogoutRedirectUris, resource }` |
| `TINYLAP_FEED_TOKENS` | none | Comma-separated bearer tokens for `GET /deletions`, one per consumer |
| `TINYLAP_DB` | `/data/accounts.sqlite` | SQLite file (`:memory:` in dev) |
| `PORT` | `4100` | Port to listen on |
| `TINYLAP_CLIENT_IP_HEADER` | none | Header carrying the client IP behind a proxy (`Fly-Client-IP` on Fly), for rate limits |
| `TINYLAP_DEV` | off | `1` for local development and CI: http issuer, loopback redirect URIs, listens on `127.0.0.1` only. Refused with an https issuer |
| `TINYLAP_ACCESS_TTL` | `600` | Access token seconds. Tests only: needs `TINYLAP_DEV=1` |

```sh
docker build -f apps/accounts/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t tinylap-accounts .
```

`fly.toml` sets the non-secret variables. The secrets are Fly secrets and are
never written to a file in this repository.

## First deploy (maintainer, once)

CI deploys accounts only after step 9, so `main` keeps deploying the planner
alone until then. The planner's `fly.toml` carries its two sign-in variables as
comments for the same reason: with `TINYLAP_ISSUER` set the planner refuses to
start unless every sign-in secret exists (step 8 turns them on). Fly cannot show a
secret again after it is set, so keep each generated value in your password
manager.

1. Create the app:

   ```sh
   fly apps create tinylap-accounts
   ```

2. Create the volume (1 GB, one machine; Fly snapshots it daily):

   ```sh
   fly volumes create tinylap_accounts_data --app tinylap-accounts --region fra --size 1
   ```

3. Generate the values in your shell. Each is random; run these in one session
   and store the outputs:

   ```sh
   rand() { node -e "console.log(require('node:crypto').randomBytes(32).toString('$1'))"; }
   AUTH_SECRET=$(rand hex)                  # BETTER_AUTH_SECRET
   PLANNER_SECRET=$(rand base64url)         # the planner's client secret, in both apps
   FEED_TOKEN=$(rand base64url)             # the planner's deletions feed token
   TOKEN_KEY="1:$(rand base64)"             # the planner's token encryption key, id 1
   ```

4. Set the accounts secrets. `TINYLAP_CLIENTS` is built with `node` so the JSON
   is valid; `--stage` keeps Fly from restarting anything before the first deploy:

   ```sh
   CLIENTS=$(PLANNER_SECRET=$PLANNER_SECRET node -e '
     const origin = "https://circuit30-planner.fly.dev";
     console.log(JSON.stringify([{
       clientId: "track-planner", clientSecret: process.env.PLANNER_SECRET,
       redirectUris: [`${origin}/auth/callback`], postLogoutRedirectUris: [`${origin}/`], resource: origin,
     }]));')
   fly secrets set --stage --app tinylap-accounts \
     BETTER_AUTH_SECRET="$AUTH_SECRET" TINYLAP_CLIENTS="$CLIENTS" TINYLAP_FEED_TOKENS="$FEED_TOKEN"
   ```

5. Deploy once by hand from the repository root. (Separately, CI's
   `FLY_API_TOKEN` is probably a deploy token for the planner app alone, which
   cannot deploy another app: replace the repository secret with an org token,
   `fly tokens create org`, before step 9.)

   ```sh
   fly deploy . --remote-only --config apps/accounts/fly.toml \
     --dockerfile apps/accounts/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD)
   ```

6. Check it: `node apps/accounts/test/smoke.js https://tinylap-accounts.fly.dev/`
   (the first request may take a few seconds while the machine wakes).

7. Set the planner's sign-in secrets (the planner restarts, still without sign-in,
   because `TINYLAP_ISSUER` is not set yet):

   ```sh
   fly secrets set --app circuit30-planner \
     TINYLAP_CLIENT_SECRET="$PLANNER_SECRET" TINYLAP_TOKEN_KEYS="$TOKEN_KEY" TINYLAP_FEED_TOKEN="$FEED_TOKEN"
   ```

8. Turn sign-in on: in `apps/track-planner/fly.toml` uncomment `TINYLAP_ISSUER`
   and `TINYLAP_CLIENT_ID` under `[env]`, commit and merge. The planner deploy
   then starts with sign-in. Try it in a browser.

9. Last, let CI deploy accounts from now on:

   ```sh
   gh variable set ACCOUNTS_DEPLOY_ENABLED --body true
   ```

## Operations

Fly's daily volume snapshots are the only backup during the proof of concept
(off-site backups are a production-release requirement, spec §13). List them
with `fly volumes snapshots list <volume id>`; a restore makes a new volume
from a snapshot: `fly volumes create tinylap_accounts_data --snapshot-id <id>`.
Take one by hand before upgrading Better Auth: `fly volumes snapshots create <volume id>`.

`fly ssh console --app tinylap-accounts` opens a shell on the machine (it wakes it).

### Taking ownership of a club (`admin.js transfer-ownership`)

A club whose owner has lost every passkey and every recovery code has no owner
who can act. After verifying the request out of band (someone the club knows is
the person asking, and the new owner is a member):

```sh
fly ssh console --app tinylap-accounts -C \
  "node apps/accounts/admin.js transfer-ownership <workspaceId> <userId>"
```

The user becomes the owner, the previous owner (if any) an admin. It works on
`TINYLAP_DB`, default `/data/accounts.sqlite`, and says `Nothing changed` if the
user already owns the club.

### Rotation

Rotate any secret you suspect leaked at once; otherwise there is no schedule.

**The planner's token keys** (`TINYLAP_TOKEN_KEYS`) rotate without signing anyone out:

1. Generate a key with a new id: `node -e "console.log('2:'+require('node:crypto').randomBytes(32).toString('base64'))"`.
2. Set the list with the new key first and every old key after it, using the old values from your password manager: `fly secrets set --app circuit30-planner TINYLAP_TOKEN_KEYS="2:<new>,1:<old>"`.
3. New sessions use key 2; sessions sealed with key 1 still open.
4. After 90 days (the longest a session lives) set the list to `2:<new>` alone.

**The planner's client secret** is one secret per client, so there is a short
gap rather than an overlap: the planner cannot sign in or refresh between the
two steps (its sessions are kept, and sign-in answers "unavailable"):

1. Generate: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.
2. Set it in `TINYLAP_CLIENTS` (rebuild the JSON as in first-deploy step 4) and as `TINYLAP_CLIENT_SECRET`, back to back, with `--stage` on the first and a plain `set` on the second so both machines restart once: `fly secrets set --stage --app tinylap-accounts TINYLAP_CLIENTS="$CLIENTS"`, then `fly secrets set --app circuit30-planner TINYLAP_CLIENT_SECRET="<new>"`, then `fly secrets deploy --app tinylap-accounts`.
3. Check that signing in to the planner works.

**A feed token** (`TINYLAP_FEED_TOKENS` here, `TINYLAP_FEED_TOKEN` in the planner):
`TINYLAP_FEED_TOKENS` takes several tokens, so it does overlap: set `old,new` on
accounts, set the planner's to `new`, then set accounts' to `new` alone.

**The signing keys** live in the `jwks` table. Better Auth signs with the newest
key that has not expired and still publishes an expired key for 30 days (the
JWT plugin's `gracePeriod`, pinned as `JWKS_GRACE_SECONDS` in `server/auth.js`), so
expiring the current key switches signing to a fresh key and keeps the old one
verifiable. Planners refetch the JWKS when they meet an unknown `kid`, and
access tokens last 10 minutes, so no waiting is needed. One exception: an app
that fetched the JWKS in the 30 seconds before the rotation refetches only once
those 30 seconds are over, so a sign-in in that window can fail; one after it
works:

1. Expire the current key (a new one is generated at the next token issue):

   ```sh
   fly ssh console --app tinylap-accounts -C "node --disable-warning=ExperimentalWarning -e \"new (require('node:sqlite').DatabaseSync)('/data/accounts.sqlite').prepare('UPDATE jwks SET expiresAt = ? WHERE expiresAt IS NULL').run(new Date().toISOString())\""
   ```

2. Sign in to the planner once; `GET /jwks` now lists two keys.
3. The old key leaves the JWKS 30 days later (`JWKS_GRACE_SECONDS`) by itself.
   Nothing to retire.

**`BETTER_AUTH_SECRET`** encrypts the signing keys' private halves in the
`jwks` table and signs `accounts` cookies. Changing it signs everyone out of
`accounts` (sessions and cookies), so passkeys ask again; planner sessions and
refresh tokens are unaffected. Do the re-encryption before the secret changes,
or the signing keys cannot be read and every token fails:

1. Take a snapshot: `fly volumes snapshots create <volume id>`.
2. Generate the new secret: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
3. Re-encrypt the keys on the machine, with both secrets in the environment of that command only:

   ```sh
   fly ssh console --app tinylap-accounts
   cd /repo/apps/accounts && OLD_SECRET='<old>' NEW_SECRET='<new>' node --disable-warning=ExperimentalWarning --input-type=module -e '
     import { DatabaseSync } from "node:sqlite";
     import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
     const db = new DatabaseSync("/data/accounts.sqlite");
     for (const { id, privateKey } of db.prepare("SELECT id, privateKey FROM jwks").all()) {
       const plain = await symmetricDecrypt({ key: process.env.OLD_SECRET, data: JSON.parse(privateKey) });
       db.prepare("UPDATE jwks SET privateKey = ? WHERE id = ?").run(JSON.stringify(await symmetricEncrypt({ key: process.env.NEW_SECRET, data: plain })), id);
       console.log("re-encrypted", id);
     }'
   ```

4. Right away, `fly secrets set --app tinylap-accounts BETTER_AUTH_SECRET="<new>"` (the restart picks it up).
5. Check `node apps/accounts/test/smoke.js https://tinylap-accounts.fly.dev/` and a planner sign-in.

If step 3 or 4 fails, restore the snapshot and keep the old secret.
