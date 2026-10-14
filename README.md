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
| `TINYLAP_PUBLIC_URL` | the request's `Host` | Origin used in share links |
| `TINYLAP_RATE_LIMIT` | `30` | Posts per hour per client |
| `TINYLAP_CLIENT_IP_HEADER` | none | Header carrying the client IP behind a proxy (`Fly-Client-IP` on Fly). Unset means the socket address; never set it without a proxy that overwrites it. |

The API is described at `/openapi.json` and `/api`. See [docs/identity.md](docs/identity.md) for snapshots, tracks and shapes. For development, `pnpm dev` serves the source on `http://localhost:8000` with an in-memory database.

## License

TinyLap is free software and stays that way. Apps and tools are
AGPL-3.0-or-later, the shared packages (`packages/`) are MPL-2.0, and docs are
CC-BY-SA-4.0. See `LICENSES/`, `CONTRIBUTING.md` and `TRADEMARKS.md`.
