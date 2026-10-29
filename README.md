# TinyLap

TinyLap is a suite of small, framework-free web tools for Kyosho Mini-Z RC
racing, built as plain ES modules on a shared design layer.

- **TinyLap Planner** (`apps/track-planner`): design Kyosho Mini-Z Grand Prix Circuit 30 tracks and
  cost them against the pieces you own.
- **TinyLap Timing** (`apps/timing`): lap timing for a club's track, live on every screen, from a decoder on USB or Wi-Fi. Decoders: [docs/timing.md](docs/timing.md).
- **TinyLap Accounts** (`apps/accounts`): sign-in with passkeys, and workspaces for clubs. Optional for the planner, required for timing.
- **Decoder and transponder firmware** (`firmware/`): a decoder you build yourself on an ESP32, and the program for the ATtiny45 transponders in the cars. See [firmware/tinylap-decoder](firmware/tinylap-decoder/README.md) and [firmware/tinylap-transponder](firmware/tinylap-transponder/README.md).

    pnpm install
    pnpm check                                   # tests, lint and types in every package
    pnpm --filter @tinylap/track-planner dev     # then open http://localhost:8000

ES modules cannot be imported over `file://`, so the apps must be served.
Downloaded track files are standalone and open directly in a browser.

The designs are in `docs/superpowers/specs/`, one dated file per piece of work.

## Self-hosting TinyLap Planner

The planner is one Node 24 process: it serves the app and stores shared layouts in SQLite.

```sh
docker build -f apps/track-planner/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t tinylap-planner .
docker run -p 8080:8080 -v tinylap-data:/data -e TINYLAP_PUBLIC_URL=https://planner.example tinylap-planner
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Port to listen on |
| `TINYLAP_DB` | `/data/tinylap.sqlite` | SQLite file (`:memory:` for none) |
| `TINYLAP_PUBLIC_URL` | `http://<Host>` of the request | Origin used in share links. Without it links are built as `http://<Host>`, so set it (to the `https://` origin) behind TLS |
| `TINYLAP_RATE_LIMIT` | `30` | Posts per hour per client |
| `TINYLAP_CLIENT_IP_HEADER` | none | Header carrying the client IP behind a proxy (`Fly-Client-IP` on Fly). Unset means the socket address; never set it without a proxy that overwrites it. |
| `TINYLAP_ISSUER` | none | The `accounts` origin. Unset, sign-in is off and the planner is anonymous only. Set, every variable below is required, or the planner refuses to start |
| `TINYLAP_CLIENT_ID`, `TINYLAP_CLIENT_SECRET` | none | The planner's client at `accounts` |
| `TINYLAP_TOKEN_KEYS` | none | Keys that seal the stored tokens: `<id>:<base64 of 32 bytes>`, comma-separated, newest first; old keys still open older sessions, so rotation logs nobody out |
| `TINYLAP_FEED_TOKEN` | none | Bearer token for `accounts`' deletions feed, read on start and hourly |

The API is described at `/openapi.json` and `/api`. See [docs/identity.md](docs/identity.md) for snapshots, tracks and shapes. For development, `pnpm dev` serves the source on `http://localhost:8000` with an in-memory database.

Sign-in is off in development unless `TINYLAP_ISSUER` is set. To try it, run accounts, the planner and timing side by side as in [apps/timing/README.md](apps/timing/README.md) (Development).

## Self-hosting TinyLap Accounts

`apps/accounts` is the sign-in service (passkeys, workspaces and an OpenID Connect provider). It is optional: without it the planner is anonymous only. One Node 24 process with a SQLite file:

```sh
docker build -f apps/accounts/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t tinylap-accounts .
docker run -p 4100:4100 -v tinylap-accounts:/data \
  -e TINYLAP_ISSUER=https://accounts.example -e BETTER_AUTH_SECRET=<32+ random characters> \
  -e TINYLAP_CLIENTS='[{"clientId":"track-planner","clientSecret":"<random>","redirectUris":["https://planner.example/auth/callback"],"postLogoutRedirectUris":["https://planner.example/"],"resource":"https://planner.example"}]' \
  -e TINYLAP_FEED_TOKENS=<random> tinylap-accounts
```

Its variables, secrets, key rotation and backups: [apps/accounts/README.md](apps/accounts/README.md).

Then give the planner `TINYLAP_ISSUER`, `TINYLAP_CLIENT_ID`, `TINYLAP_CLIENT_SECRET` (the same as in `TINYLAP_CLIENTS`), `TINYLAP_TOKEN_KEYS`, `TINYLAP_FEED_TOKEN` and `TINYLAP_PUBLIC_URL`, as in the planner table above.

### Another OIDC provider

The planner needs `TINYLAP_ISSUER`, a client id and a secret for a confidential client (`TINYLAP_CLIENT_ID`, `TINYLAP_CLIENT_SECRET`), `TINYLAP_TOKEN_KEYS`, `TINYLAP_PUBLIC_URL` and `TINYLAP_FEED_TOKEN`; it refuses to start with sign-in half configured. The provider must support the authorization code flow with PKCE and refresh tokens, and issue **RS256 JWT access tokens** (`typ` `at+jwt`) with `aud` set to the planner's origin (RFC 8707 `resource`) and a `workspaces` claim, `[{ "id", "role" }]` with roles `owner`, `admin` or `member`, which the planner reads for access. The JWKS must be at `{issuer}/jwks` (the planner does not read `jwks_uri` from discovery), and discovery must name a `userinfo_endpoint` that answers the user's `name`: a save is refused while the name can't be looked up. An `end_session_endpoint` is optional; without one, signing out ends only the planner's session. The deletions feed is TinyLap-specific, an `accounts` feature: another provider has to offer the same `GET /deletions?after=<seq>` (bearer `TINYLAP_FEED_TOKEN`, answering `{ "deletions": [{ "seq", "kind": "user" | "workspace", "id", "deletedAt" }] }`), or deleted workspaces and users stay in the planner. See [packages/auth](packages/auth/README.md).

## Self-hosting TinyLap Timing

`apps/timing` is one Node 24 process with a SQLite file. It needs accounts (or another OIDC provider, as for the planner) and a planner to import tracks from.

```sh
docker build -f apps/timing/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t tinylap-timing .
docker run -p 8080:8080 -v tinylap-timing:/data -e TINYLAP_PUBLIC_URL=https://timing.example \
  -e TINYLAP_ISSUER=https://accounts.example -e TINYLAP_CLIENT_ID=timing -e TINYLAP_CLIENT_SECRET=<random> \
  -e TINYLAP_TOKEN_KEYS=1:$(openssl rand -base64 32) -e TINYLAP_FEED_TOKEN=<random> \
  -e TINYLAP_PLANNER_URL=https://planner.example tinylap-timing
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Port to listen on |
| `TINYLAP_DB` | `/data/timing.sqlite` | SQLite file |
| `TINYLAP_PUBLIC_URL` | required | The `https://` origin timing is served at |
| `TINYLAP_ISSUER`, `TINYLAP_CLIENT_ID`, `TINYLAP_CLIENT_SECRET` | required | Timing's client at accounts |
| `TINYLAP_TOKEN_KEYS` | required | Keys that seal stored tokens, as for the planner |
| `TINYLAP_FEED_TOKEN` | required | Bearer token for accounts' deletions feed |
| `TINYLAP_PLANNER_URL` | required | The planner tracks are imported from; timing fetches nothing else |
| `TINYLAP_CLIENT_IP_HEADER` | none | Header carrying the client IP behind a proxy |

It refuses to start unless all required variables are set. Development: [apps/timing/README.md](apps/timing/README.md). Decoders: [docs/timing.md](docs/timing.md).

## License

TinyLap is free software and stays that way. Apps and tools are
AGPL-3.0-or-later, the shared packages (`packages/`) and the firmware
(`firmware/`) are MPL-2.0, and docs are CC-BY-SA-4.0. See `LICENSES/`, `CONTRIBUTING.md` and `TRADEMARKS.md`.
