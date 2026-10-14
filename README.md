# TinyLap

TinyLap is a suite of small, framework-free web tools for Kyosho Mini-Z RC
racing, built as plain ES modules on a shared design layer.

- `apps/track-planner`: design Kyosho Mini-Z Grand Prix Circuit 30 layouts and
  cost them against the pieces you own.

    pnpm install
    pnpm test                                    # every package
    pnpm --filter @tinylap/track-planner dev     # then open http://localhost:8000

The planner lives in `apps/track-planner/`.

ES modules cannot be imported over `file://`, so the app must be served.
Exported layout files are standalone and open directly in a browser.

Design: `docs/superpowers/specs/2026-09-09-circuit30-track-planner-design.md`

## Self-hosting the planner

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
| `TINYLAP_ISSUER` | none | The `accounts` origin. Unset, log-in is off and the planner is anonymous only. Set, every variable below is required, or the planner refuses to start |
| `TINYLAP_CLIENT_ID`, `TINYLAP_CLIENT_SECRET` | none | The planner's client at `accounts` |
| `TINYLAP_TOKEN_KEYS` | none | Keys that seal the stored tokens: `<id>:<base64 of 32 bytes>`, comma-separated, newest first; old keys still open older sessions, so rotation logs nobody out |
| `TINYLAP_FEED_TOKEN` | none | Bearer token for `accounts`' deletions feed, read on start and hourly |

The API is described at `/openapi.json` and `/api`. See [docs/identity.md](docs/identity.md) for snapshots, tracks and shapes. For development, `pnpm dev` serves the source on `http://localhost:8000` with an in-memory database.

Log-in is off in development unless `TINYLAP_ISSUER` is set. To try it, run `accounts` and the planner side by side: `TINYLAP_CLIENTS='[{"clientId":"planner-dev","clientSecret":"dev","redirectUris":["http://localhost:8000/auth/callback"],"postLogoutRedirectUris":["http://localhost:8000/"],"resource":"http://localhost:8000"}]' TINYLAP_FEED_TOKENS=dev pnpm --filter @tinylap/accounts dev` (on `http://localhost:4100`), then `TINYLAP_ISSUER=http://localhost:4100 TINYLAP_CLIENT_ID=planner-dev TINYLAP_CLIENT_SECRET=dev TINYLAP_FEED_TOKEN=dev TINYLAP_TOKEN_KEYS=dev:$(openssl rand -base64 32) pnpm dev`, and open `http://localhost:8000`. The session cookie is `Secure` even here; browsers accept that on `http://localhost`.

## License

TinyLap is free software and stays that way. Apps and tools are
AGPL-3.0-or-later, the shared packages (`packages/`) are MPL-2.0, and docs are
CC-BY-SA-4.0. See `LICENSES/`, `CONTRIBUTING.md` and `TRADEMARKS.md`.
