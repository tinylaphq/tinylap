# TinyLap Monorepo — Design Specification

Date: 2026-10-13
Extends: `docs/superpowers/specs/2026-09-09-circuit30-track-planner-design.md`

## 1. Purpose

Turn this repository into **TinyLap**: an open-source suite of tools for
small-scale RC racing (Kyosho Mini-Z, 1:28), where every UI speaks one design
language.

The suite will eventually hold:

- the **track planner** (this app),
- a **timing app** that shows lap times from any timing system, ours in
  particular, and imports tracks from the planner, because every layout has its
  own leaderboards,
- **firmware** for the Arduino-based timing system,
- **hardware**: STL files, electronics and parts recommendations.

This spec covers only the first sub-project: **the monorepo itself**, the split
between design and product, and the licensing. It deliberately ships no new
features. The planner comes out the other side behaving exactly as it does
today.

Later sub-projects, each with its own spec:

1. *This one*: monorepo, shared packages, licenses.
2. Track exchange format additions: a stable track identity for
   leaderboards, track length and similar.
3. The timing companion app.
4. Firmware and hardware.

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Name | **TinyLap**: GitHub org `tinylaphq` (`tinylap` is blocked on GitHub), npm scope `@tinylap`, tinylap.com/.dev/.app (all free on 2026-10-12, none registered yet) |
| Repo | This repo, renamed and moved to `tinylaphq/tinylap` (the `tinylap` org name is blocked on GitHub); history kept |
| Workspaces | pnpm workspaces |
| Task runner | Turborepo, from the start |
| Releases | release-please, driven by conventional commits; squash merges; commitlint on pull request titles |
| Build | **None.** Browser-native ES modules and import maps |
| Types | Plain `.js`, checked by `tsc --noEmit --checkJs`; shared types in `.d.ts` files |
| Design | palace-ui becomes its own public project; `@tinylap/design` is a thin layer on top |
| Licenses | Share-alike (see §7) |
| Contributions | DCO sign-off, no CLA |
| Business model | Hosted paid version, free self-hosting (the Plausible model), name protected by a trademark policy |

The guiding principle behind several of these: **use the platform**. Where a web
standard solves a problem (import maps, `<base>`, ES modules, HTTP caching),
we use it instead of a tool that re-solves it.

## 3. Repository layout

```
tinylap/
├─ apps/
│  └─ track-planner/          today's index.html, css/, js/, test/, Dockerfile, Caddyfile, fly.toml
├─ packages/
│  ├─ track-format/           @tinylap/track-format   MPL-2.0, strict types
│  └─ design/                 @tinylap/design         MPL-2.0
├─ docs/                      existing specs and plans
├─ LICENSES/                  one full text per license used
├─ LICENSE                    AGPL-3.0-or-later, unmodified (README.md notes per-folder licenses)
├─ CONTRIBUTING.md            DCO, how to run things
├─ TRADEMARKS.md
├─ pnpm-workspace.yaml
├─ turbo.json
├─ tsconfig.base.json
├─ eslint.config.js
├─ commitlint.config.js
├─ release-please-config.json
└─ .release-please-manifest.json
```

`apps/timing`, `firmware/` and `hardware/` are **not** created by this
sub-project. Folders appear when there is something to put in them.

## 4. Packages

### 4.1 `@tinylap/track-format`

The part of the planner that more than one app needs: pure functions, no DOM,
no editor state.

| From | What moves |
| --- | --- |
| `js/geometry.js` | all of it: the Circuit 30 piece catalogue, rotations, placed cells/ports/walls |
| `js/model.js` | all of it: layout model, ports, closed circuit, barriers, metrics |
| `js/storage.js` | `layoutFromData`, `SUPPORTED_VERSION`: parsing and validating layout data |
| `js/render.js` | `layoutToSvgString` and the pure path/geometry helpers it needs |

What stays in the planner: `drawLayout`, `drawGhost`, `drawMarquee`, the
generator, suggestions, inventory, kits, presets, session and kits storage, and
`exportHtml`/`importHtml`. `exportHtml` stays because it embeds the bill of
materials, which is planner-specific.

The exact cut follows the import graph. If `layoutToSvgString` or
`layoutFromData` pulls in planner-only code, that dependency is inverted
(passed in) rather than dragged into the package. The functions move **without
behavioural change**, and their tests move with them.

The data format itself does **not** change in this sub-project. Additions
needed for leaderboards belong to sub-project 2.

Types: strict from day one. The data model (layout, placed piece, port, metrics)
is described in `.d.ts` files that ship with the package, so consumers get full
types even from TypeScript projects.

### 4.2 `@tinylap/design`

Depends on `palace-ui`. It holds the parts of the planner's `css/app.css` that
are not specific to the planner, such as the full-viewport tool shell (navbar
plus side panels) and the dark canvas surface. Racing-specific pieces
(leaderboard, lap-time display) are added when the timing app needs them, not
before.

Rule for where a change goes:

- **Generic** improvement, useful for anything palace styles → upstream to
  palace-ui, released as a new palace version.
- **Racing or suite-specific** → `@tinylap/design`.
- **One app only** → that app's own CSS.

### 4.3 palace-ui (outside this repo)

palace-ui moves out of `~/repos/projects/packages/palace-ui` into its own public
repo `jostsg/palace-ui`, keeps MIT, and is published to npm as `palace-ui`
(the name is free). Its one commit is re-authored with the noreply address
before publishing. `~/repos/projects` keeps its copy for now; switching the
suspension tracker to the npm package is a separate change.

Self-hosted fonts are a generic improvement and go upstream: palace-ui 0.10.0
ships Space Grotesk and JetBrains Mono (both SIL Open Font License) as files,
and its SPEC stops telling consumers to load Google Fonts. Reason: loading
Google Fonts passes visitors' IP addresses to Google, which a Munich court
(LG München, 2022) held to be a GDPR violation without consent. That matters
for a hosted, paid version.

## 5. Serving without a build step

### 5.1 One URL layout for dev and prod

Each app's `index.html` uses only relative URLs (it already does) and declares
an import map:

```html
<base href="/">
<script type="importmap">
{ "imports": { "@tinylap/track-format": "./pkg/track-format/index.js" } }
</script>
<link rel="stylesheet" href="./pkg/palace-ui/palace.css">
<link rel="stylesheet" href="./pkg/design/design.css">
```

The served layout is the same in dev and prod:

| URL | Source |
| --- | --- |
| `./` | the app folder |
| `./pkg/<name>/` | `packages/<name>/` (workspace package) |
| `./pkg/palace-ui/` | `node_modules/palace-ui/` |

Inside packages, imports between files are relative, so they inherit whatever
base the page uses.

### 5.2 Versioned paths instead of `no-cache`

Today the Caddyfile serves everything with `no-cache`, so that a returning
visitor can never hold a mix of old and new modules. That works, but every load
costs a round of 304s.

Instead, the Docker build copies everything into `/srv/v/<git-sha>/` and
rewrites one line in `index.html`, `<base href="/">` to
`<base href="/v/<git-sha>/">`. Every relative URL, import-map targets included,
then resolves under the version path. Caddy serves:

- `/` (`index.html`): `Cache-Control: no-cache`
- `/v/*`: `Cache-Control: public, max-age=31536000, immutable`

A deploy changes every asset URL at once, so a mix of versions is impossible
by construction. The text substitution is the only "build", and it happens in
the Dockerfile.

Constraint this introduces: an app must not rely on `<base>`-sensitive
behaviour, such as fragment links (`href="#x"`) resolving against the page.
The planner has none; downloads use blob URLs, which `<base>` does not affect.

### 5.3 Dev server

`serve.py` is replaced by a small Node dev server (`node:http`, no dependency)
that maps the routes in §5.1 from source and, like `serve.py`, sends no-cache
headers and no validators. It is started with `pnpm dev` from the app folder.

### 5.4 Keeping the browser and Node in agreement

The browser resolves `@tinylap/*` through the import map; Node (the tests)
resolves it through pnpm's workspace links and each package's `exports`. A test
per app reads the import map from `index.html` and fails if it does not match
the app's `dependencies` and each package's `exports`.

## 6. Types, lint, CI and releases

**Types.** `tsconfig.base.json` with `allowJs`, `checkJs`, `noEmit`, `module`
`nodenext`. `track-format` extends it with `strict: true`. The planner starts
non-strict, so inference catches real mistakes without touching its ~4,400
lines; it tightens later, file by file. Code references shared types with
one-line JSDoc comments (`/** @import { Layout } from '@tinylap/track-format' */`,
`/** @param {Layout} layout */`). The TypeScript 7 checker is used; it no longer
accepts legacy JSDoc patterns like `@enum` and `@constructor`, so they are not
used.

**Lint.** ESLint flat config at the root.

**CI** (`.github/workflows/`):

1. `pnpm install --frozen-lockfile`
2. `turbo run test lint typecheck --affected`
3. `reuse lint` (§7)
4. commitlint on the pull request title
5. Docker smoke test (§8)
6. On `main`: deploy the planner to Fly when it or a package it depends on
   changed: `flyctl deploy --config apps/track-planner/fly.toml` with the repo
   root as build context. The Fly app keeps its name `circuit30-planner` and its
   URL for now.

**Releases.** release-please, manifest mode, one component per published
package. It opens a release pull request with version bumps and changelogs from
the conventional commits. **Nothing is published until that pull request is
merged**, by a person. On merge, CI publishes `@tinylap/track-format` and
`@tinylap/design` to npm with **trusted publishing** (OIDC, no long-lived
token) and provenance. Apps are `"private": true` and are never published.

## 7. Licensing

The goal: open source forever. Anyone may use, change, self-host and even sell
TinyLap, but improvements must be shared back under the same license, and
nobody can take it closed.

| What | License |
| --- | --- |
| `apps/*`, later `firmware/` | AGPL-3.0-or-later |
| `packages/track-format`, `packages/design` | MPL-2.0 |
| later `hardware/` (schematics, PCBs) | CERN-OHL-S-2.0 |
| later STL files, docs | CC-BY-SA-4.0 |
| palace-ui (own repo) | MIT |

Why MPL for the two packages: it is file-level share-alike. Changes to TinyLap's
files must be shared, but other programs, including other timing systems, can
read TinyLap tracks without becoming AGPL themselves. That lets the format
spread while the apps stay fully AGPL.

Mechanics:

<!-- REUSE-IgnoreStart -->
- Every source file carries an SPDX header, e.g.
  `// SPDX-License-Identifier: AGPL-3.0-or-later`.
- Full texts live in `LICENSES/<SPDX-ID>.txt`. Each `package.json` declares its
  `license`.
<!-- REUSE-IgnoreEnd -->
- `reuse lint` (FSFE REUSE) runs in CI and fails on any file without a license.
- The root `LICENSE` is the unmodified AGPL-3.0-or-later text, so GitHub
  detects it. The note naming the folders that use other licenses lives in
  `README.md`.
- `TRADEMARKS.md`: use, modify and self-host freely; a public service run by
  someone else must use its own name.
- `CONTRIBUTING.md` explains the DCO sign-off (`git commit -s`). The DCO GitHub
  app enforces it on pull requests. There is no CLA, so contributed code can
  never be relicensed. That is intended, and it supports "open source
  forever".

## 8. Order of work

Each step leaves a working, deployable planner.

1. **Extract palace-ui** into its own repo, publish 0.9.0, then 0.10.0 with
   self-hosted fonts.
2. **Set up the monorepo**: pnpm, Turborepo, tsconfig, ESLint, commitlint,
   release-please, REUSE, license files, `CONTRIBUTING.md`, `TRADEMARKS.md`.
3. **Move the planner** into `apps/track-planner` with `git mv`. No code
   changes, so `git log --follow` keeps every file's history.
4. **Extract** `@tinylap/track-format` and `@tinylap/design`; the planner imports
   them through its import map.
5. **Serving and caching**: dev server, `<base>` versioning, Dockerfile, Caddy
   rules, CI deploy from the new location.
6. **Type checking**: `track-format` strict, planner non-strict.
7. **Going public**: the user's own actions or explicit approval:
   - create the `tinylaphq` GitHub org and move the repo to `tinylaphq/tinylap`
   - create the `@tinylap` npm org and configure trusted publishing
   - make the repository public

Steps that are public or irreversible (publishing to npm, making a repo public,
moving it, force-pushes) are confirmed with the user each time.

## 9. Testing

- **Existing tests are the safety net.** Steps 3 to 5 move code without
  changing it, so the whole existing suite must pass unchanged in its new
  locations. Tests that move to `track-format` keep their assertions.
- **New automated checks:** the import map vs. `package.json` test (§5.4),
  `tsc --checkJs`, ESLint, `reuse lint`, commitlint.
- **Docker smoke test in CI:** build the image, run it, then assert that
  - `/` answers with `no-cache`,
  - `/v/<sha>/…` answers with `immutable`,
  - every URL in the import map and every stylesheet link resolves to 200.
- **Manual:** open the planner, build and export a layout, and import a layout
  file exported from the **current live version**. The last one proves the
  format did not change.

## 10. Out of scope

- Any new planner feature or behaviour change.
- The timing app, including accounts and multi-tenancy for the hosted version.
- Format additions (track identity, length).
- Firmware and hardware.
- Renaming the Fly app or its URL.
- Switching `~/repos/projects` to the published palace-ui.

## 11. Risks

- **Import-map drift.** Two resolution paths (browser vs. Node). Mitigated by
  the §5.4 test.
- **`<base>` surprises.** Any future fragment link or base-relative assumption
  breaks under `/v/<sha>/`. Mitigated by the smoke test, and called out in
  `CONTRIBUTING.md`.
- **Dependencies without plain ES modules.** Some npm libraries only work through
  a bundler. Rule: such libraries are not used. Vendoring an ESM build is the
  exception and needs a reason.
- **TypeScript 7's stricter JSDoc checking** may flag existing planner code once
  enabled. That is why the planner starts non-strict.
- **Names can be taken** before they are registered. The GitHub org, npm org
  and domains should be claimed early.
