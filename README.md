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

## License

TinyLap is free software and stays that way. Apps and tools are
AGPL-3.0-or-later, the shared packages (`packages/`) are MPL-2.0, and docs are
CC-BY-SA-4.0. See `LICENSES/`, `CONTRIBUTING.md` and `TRADEMARKS.md`.
