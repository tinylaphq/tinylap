# TinyLap Timing

Lap timing for a club's track: decoders post passings over USB (through the bridge tab) and Wi-Fi, the server turns them into practice, qualifying and race results, and every screen shows them live. Design: `docs/superpowers/specs/2026-10-15-timing-core-design.md`. Decoder builders: `docs/timing.md`.

## Development

Timing always needs log-in. Run accounts, the planner and timing side by side. Accounts gets both dev clients and both feed tokens, so log-in keeps working in the planner too:

    TINYLAP_CLIENTS='[{"clientId":"planner-dev","clientSecret":"dev","redirectUris":["http://localhost:8000/auth/callback"],"postLogoutRedirectUris":["http://localhost:8000/"],"resource":"http://localhost:8000"},{"clientId":"timing-dev","clientSecret":"dev","redirectUris":["http://localhost:8100/auth/callback"],"postLogoutRedirectUris":["http://localhost:8100/"],"resource":"http://localhost:8100"}]' \
      TINYLAP_FEED_TOKENS=dev,timing-dev pnpm --filter @tinylap/accounts dev
    TINYLAP_ISSUER=http://localhost:4100 TINYLAP_CLIENT_ID=planner-dev TINYLAP_CLIENT_SECRET=dev \
      TINYLAP_FEED_TOKEN=dev TINYLAP_TOKEN_KEYS=dev:$(openssl rand -base64 32) pnpm dev   # the planner, on http://localhost:8000
    TINYLAP_ISSUER=http://localhost:4100 TINYLAP_CLIENT_ID=timing-dev TINYLAP_CLIENT_SECRET=dev \
      TINYLAP_FEED_TOKEN=timing-dev TINYLAP_TOKEN_KEYS=dev:$(openssl rand -base64 32) \
      TINYLAP_PLANNER_URL=http://localhost:8000 pnpm dev:timing

Open http://localhost:8100 and sign in. Without hardware: Setup → "Pair over Wi-Fi only", then `node tools/decoder-sim.js net --url http://localhost:8100 --decoder <id> --token <token>`, or the bridge with a simulated decoder at http://localhost:8100/personal/bridge?simulate=fast.

Tests: `pnpm --filter @tinylap/timing-app test`; in Chrome, `pnpm --filter @tinylap/timing-app test:browser`.

## First deploy (maintainer)

1. Create the app and its volume: `fly apps create tinylap-timing`, then `fly volumes create timing_data --app tinylap-timing --region fra --size 1`.
2. Add timing as a client of accounts: rebuild `TINYLAP_CLIENTS` as in `apps/accounts/README.md` (first-deploy step 4), **keeping the planner's existing entry unchanged** (same `clientId` and `clientSecret`), with a new entry `{ "clientId": "timing", "clientSecret": "<random>", "redirectUris": ["https://tinylap-timing.fly.dev/auth/callback"], "postLogoutRedirectUris": ["https://tinylap-timing.fly.dev/"], "resource": "https://tinylap-timing.fly.dev" }`, and add a new feed token to `TINYLAP_FEED_TOKENS` after the planner's, which stays. Both secrets are replaced whole: an entry or token left out locks the planner out of log-in or of the deletions feed. Stage them: `fly secrets set --stage --app tinylap-accounts TINYLAP_CLIENTS="$CLIENTS" TINYLAP_FEED_TOKENS="$FEED_TOKENS"`.
3. Set timing's secrets: `fly secrets set --stage --app tinylap-timing TINYLAP_CLIENT_SECRET="<the same random>" TINYLAP_TOKEN_KEYS="1:$(openssl rand -base64 32)" TINYLAP_FEED_TOKEN="<the new feed token>"`. Keep all three in the password manager.
4. `fly secrets deploy --app tinylap-accounts`, then the first timing deploy from your machine: `flyctl deploy . --config apps/timing/fly.toml --dockerfile apps/timing/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD)`.
5. Log in at https://tinylap-timing.fly.dev and check the board loads.
6. Let CI deploy from now on: `gh variable set TIMING_DEPLOY_ENABLED --body true`.

Key rotation and backups work as for the planner (`apps/accounts/README.md`): `TINYLAP_TOKEN_KEYS` takes the new key first and the old ones after it; Fly snapshots the volume daily.
