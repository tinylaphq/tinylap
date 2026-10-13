# Circuit 30 Track Planner

Design Kyosho Mini-Z Grand Prix Circuit 30 layouts and cost them against the
pieces you own.

    pnpm install
    pnpm test                                    # every package
    pnpm --filter @tinylap/track-planner serve   # then open http://localhost:8000

The planner lives in `apps/track-planner/`.

ES modules cannot be imported over `file://`, so the app must be served.
Exported layout files are standalone and open directly in a browser.

Design: `docs/superpowers/specs/2026-09-09-circuit30-track-planner-design.md`
