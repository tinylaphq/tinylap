# TinyLap Monorepo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Circuit 30 planner repo into the TinyLap monorepo, with palace-ui as its own published project, `@tinylap/track-format` and `@tinylap/design` as shared packages, share-alike licensing, and a planner that behaves exactly as before.

**Architecture:** pnpm workspaces and Turborepo orchestrate plain-JS packages with no bundler. Browsers resolve packages through a native import map, and Node tests resolve them through pnpm workspace links. A small assemble script copies each deploy into `/v/<git-sha>/` and rewrites `<base href>`, so Caddy can cache every asset as immutable.

**Tech Stack:** Node 24, pnpm 12, Turborepo 2, TypeScript 7 (`tsc --checkJs`, no emit), ESLint 10 flat config, commitlint, release-please, FSFE REUSE, Caddy 2, Fly.io, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-13-tinylap-monorepo-design.md`

## Global Constraints

- **No bundler and no transpiler.** Shipped code is the source. The only build-time transformations are copying files and rewriting `<base href>` (Task 5), plus emitting `.d.ts` for npm consumers (Task 11).
- **No behaviour change to the planner.** The 153 existing tests must pass, in their new locations, with unchanged assertions.
- **Licenses:**
  - `apps/*` and `tools/`: `AGPL-3.0-or-later`
  - `packages/*`: `MPL-2.0`
  - docs and Markdown: `CC-BY-SA-4.0`
  - palace-ui: `MIT`
- **Copyright line:** `SPDX-FileCopyrightText: 2026 The TinyLap contributors` (palace-ui: `jostsg`).
- **Commits:**
  - Conventional commit messages, made with `git commit -s` (DCO sign-off).
  - Author email `1009814+jostsg@users.noreply.github.com`. Never the gmail address: check `git config user.email` in every repo you commit to.
  - No AI attribution: never add `Co-Authored-By` trailers or "Generated with" lines to commits or pull requests.
- **Branch:** all monorepo work happens on `feat/tinylap-monorepo`, created from `docs/tinylap-monorepo-spec`. Never commit to or push `main`.
- **USER GATE steps** are public or irreversible: creating repos, publishing to npm, Fly deploys, making things public. Stop and ask the user. Do not run them yourself.
- **Dependencies:** browser code may only use plain ES modules. Never add a dependency that needs a bundler.
- **Versions as of 2026-10-13:**
  - pnpm 12.11.2, turbo ^2.11.7, typescript ^7.0.2, eslint ^10.12.0, @eslint/js ^10.0.1, globals ^17.13.0
  - @commitlint/cli and @commitlint/config-conventional ^21.2.3, @types/node ^26.6.5

## Review Focus

1. **A tab opened before a deploy keeps working until reload.** Old `/v/<sha>/` paths vanish on deploy, so an app must load all its modules at startup, never lazily. Pinned by Task 5's "no dynamic import" test.
2. **Dev-server path traversal** (`/pkg/../../etc/passwd`, `%2e%2e`, `/..%2f`) must answer 404, never a file outside the mapped roots. Pinned by Task 5's `resolveUrl` tests.
3. **Layout files exported by the current live version must still import** after the extraction. Pinned by Task 6's golden export fixture, captured *before* any code moves.
4. **A missing or malformed `GIT_SHA` must fail the build**, not serve `/v//`. Pinned by Task 5's `assemble` tests.
5. **An `index.html` without exactly one `<base href="/">`** must fail assembly loudly. A silent no-op would serve broken relative URLs. Pinned by Task 5's `assemble` tests.

---

## File Structure (end state)

```
apps/track-planner/
  index.html  css/app.css  js/*.js (editor only)  test/*.test.js  test/fixtures.js
  test/fixtures/live-export.html     golden file (Task 6)
  package.json  Dockerfile  Caddyfile  fly.toml  tsconfig.json
packages/track-format/
  index.js            barrel
  geometry.js         moved from planner js/geometry.js (unchanged)
  model.js            moved from planner js/model.js (unchanged)
  data.js             layoutFromData + SUPPORTED_VERSION (cut from planner js/storage.js)
  svg.js              pure part of planner js/render.js
  reference-layouts.js  rectangularRing, stockL (cut from planner js/presets.js)
  types.d.ts          data model types
  test/{geometry,model,svg,data}.test.js  test/fixtures.js
  package.json  tsconfig.json  tsconfig.build.json
packages/design/
  design.css  package.json
tools/
  serve-map.js        URL → file resolution shared by dev server and assemble
  dev-server.js       node:http dev server
  assemble.js         builds /out/index.html + /out/v/<sha>/…
  smoke.js            crawls a running server and checks headers and every referenced URL
  test/*.test.js      package.json
LICENSES/  LICENSE  REUSE.toml  README.md  CONTRIBUTING.md  TRADEMARKS.md
package.json  pnpm-workspace.yaml  pnpm-lock.yaml  turbo.json  tsconfig.base.json
eslint.config.js  commitlint.config.js  release-please-config.json  .release-please-manifest.json
.github/workflows/{ci.yml,release.yml}  .dockerignore  .gitignore
```

---

### Task 1: palace-ui gets its own repository (local only)

**Files (new repo `~/repos/palace-ui`):**
- Create: `palace.css`, `SPEC.md`, `catalog.html`, `CLAUDE.md`, `package.json` (copied from `~/repos/projects/packages/palace-ui/`)
- Create: `LICENSE`, `README.md`, `.gitignore`

**Interfaces:**
- Produces: a git repo whose first commit is palace-ui 0.9.0 exactly as it exists today, authored with the noreply address.

- [ ] **Step 1: Create the repo and copy the files**

```bash
mkdir ~/repos/palace-ui && cd ~/repos/palace-ui && git init -b main
git config user.email 1009814+jostsg@users.noreply.github.com
git config user.name jostsg
cp ~/repos/projects/packages/palace-ui/{palace.css,SPEC.md,catalog.html,CLAUDE.md,package.json} .
```

- [ ] **Step 2: Add LICENSE, README and .gitignore**

`LICENSE`: the standard MIT text, with the copyright line `Copyright (c) 2026 jostsg`.

`.gitignore`:
```
node_modules/
*.tgz
```

`README.md`:
```markdown
# palace-ui

A retro-technical, CSS-only design system. Hard edges, a three-colour accent
rotation, chunky offset shadows. One stylesheet, no build step, no JavaScript.

    npm install palace-ui

```html
<link rel="stylesheet" href="node_modules/palace-ui/palace.css">
```

- `palace.css`: tokens, reset and every component class
- `SPEC.md`: the design specification, written to be followed exactly by people and AI agents alike
- `catalog.html`: every component on one page; open it in a browser

MIT licensed.
```

- [ ] **Step 3: Verify nothing differs from the source copy**

Run: `diff -r ~/repos/projects/packages/palace-ui ~/repos/palace-ui -x .git -x LICENSE -x README.md -x .gitignore`
Expected: no output.

- [ ] **Step 4: Commit with the original date**

```bash
cd ~/repos/palace-ui && git add -A
GIT_AUTHOR_DATE=2026-03-06T16:52:44+01:00 GIT_COMMITTER_DATE=2026-03-06T16:52:44+01:00 \
  git commit -s -m "chore: initial commit"
git tag v0.9.0
git log --format='%ae %ce %ad %s'
```
Expected: one commit, both emails `1009814+jostsg@users.noreply.github.com`.

---

### Task 2: palace-ui 0.10.0, self-hosted fonts and the generic patterns the planner had to add

The planner's `css/app.css` adds three things palace should own, because they're useful for anything palace styles: `color-scheme: light`, a `<dialog>` pattern, and `<kbd>`. Per spec §4.2 they go upstream. Google Fonts are replaced by bundled woff2 files (spec §4.3).

**Files (`~/repos/palace-ui`):**
- Create: `fonts/space-grotesk-latin-{400,600,700}-normal.woff2`, `fonts/jetbrains-mono-latin-{400,600}-normal.woff2`, `fonts/OFL-SpaceGrotesk.txt`, `fonts/OFL-JetBrainsMono.txt`
- Modify: `palace.css` (header, `@font-face`, `:root color-scheme`, dialog, kbd), `SPEC.md` (Fonts section), `catalog.html` (fonts and samples), `package.json` (version and files)

**Interfaces:**
- Produces: `palace-ui@0.10.0` with:
  - `palace.css` loading fonts from `./fonts/` with relative `url()`s
  - `color-scheme: light`
  - `dialog` and `kbd` styling identical to the planner's current rules
  - `files: ["palace.css", "fonts", "catalog.html", "SPEC.md"]`

- [ ] **Step 1: Fetch the font files**

```bash
cd ~/repos/palace-ui && mkdir -p fonts && T=$(mktemp -d)
(cd $T && npm pack @fontsource/space-grotesk@5.3.0 @fontsource/jetbrains-mono@5.3.0 >/dev/null && for f in *.tgz; do mkdir "${f%.tgz}" && tar -xzf "$f" -C "${f%.tgz}"; done)
cp $T/fontsource-space-grotesk-5.3.0/package/files/space-grotesk-latin-{400,600,700}-normal.woff2 fonts/
cp $T/fontsource-jetbrains-mono-5.3.0/package/files/jetbrains-mono-latin-{400,600}-normal.woff2 fonts/
cp $T/fontsource-space-grotesk-5.3.0/package/LICENSE fonts/OFL-SpaceGrotesk.txt
cp $T/fontsource-jetbrains-mono-5.3.0/package/LICENSE fonts/OFL-JetBrainsMono.txt
ls fonts && grep -l "SIL Open Font License" fonts/*.txt
```
Expected: 5 woff2 files and both OFL texts listed.

- [ ] **Step 2: Add `@font-face`, color-scheme, dialog and kbd to `palace.css`**

Change the first line to `/*! palace-ui v0.10.0 | MIT License | fonts: SIL OFL 1.1, see fonts/ */`.

Insert directly before the `:root {` token block:

```css
/* ══════════════════════════════════════════
   FONTS (self-hosted; no third-party requests)
   ══════════════════════════════════════════ */

@font-face { font-family: 'Space Grotesk'; font-style: normal; font-weight: 400; font-display: swap; src: url('fonts/space-grotesk-latin-400-normal.woff2') format('woff2'); }
@font-face { font-family: 'Space Grotesk'; font-style: normal; font-weight: 600; font-display: swap; src: url('fonts/space-grotesk-latin-600-normal.woff2') format('woff2'); }
@font-face { font-family: 'Space Grotesk'; font-style: normal; font-weight: 700; font-display: swap; src: url('fonts/space-grotesk-latin-700-normal.woff2') format('woff2'); }
@font-face { font-family: 'JetBrains Mono'; font-style: normal; font-weight: 400; font-display: swap; src: url('fonts/jetbrains-mono-latin-400-normal.woff2') format('woff2'); }
@font-face { font-family: 'JetBrains Mono'; font-style: normal; font-weight: 600; font-display: swap; src: url('fonts/jetbrains-mono-latin-600-normal.woff2') format('woff2'); }
```

Inside the `:root {` token block, add as its first line:

```css
  /* palace is a light system. Without this, a browser set to dark renders
     UA widgets (number inputs, scrollbars) dark against white surfaces. */
  color-scheme: light;
```

Append a new section at the end of `palace.css`. These are the planner's current rules from `css/app.css:183-192` and `:211-241`, verbatim apart from the comments:

```css
/* ══════════════════════════════════════════
   DIALOG
   ══════════════════════════════════════════ */

dialog {
  padding: var(--p-space-lg);
  max-width: var(--p-container-narrow);
  width: 100%;
  background: var(--p-surface);
  border: var(--p-border-width) solid var(--p-text);
  box-shadow: var(--p-shadow-lg) var(--p-accent-2);
  /* The reset's `margin: 0` wipes the UA's `dialog { margin: auto }`,
     which is what centres a modal dialog. Restored here. */
  margin: auto;
}

dialog::backdrop { background: var(--p-overlay); }
dialog h2 { margin-bottom: var(--p-space-xs); }
dialog .subtitle { margin-bottom: var(--p-space-lg); }
dialog p { margin-bottom: var(--p-space-sm); }

dialog menu {
  display: flex;
  gap: var(--p-space-sm);
  padding: 0;
  margin: var(--p-space-lg) 0 0;
  list-style: none;
}

dialog menu .btn { flex: 1; }

/* ══════════════════════════════════════════
   KBD
   ══════════════════════════════════════════ */

kbd {
  display: inline-block;
  padding: 1px 5px;
  border: var(--p-border-thin) solid var(--p-text);
  box-shadow: 1px 1px 0 var(--p-accent-1);
  background: var(--p-surface-inset);
  font: 600 11px/1.5 var(--p-font-mono);
  text-transform: uppercase;
}
```

- [ ] **Step 3: Update SPEC.md, catalog.html and package.json**

In `SPEC.md`, replace the whole `### Fonts` subsection (both Google Fonts snippets) with:

```markdown
### Fonts

palace-ui ships Space Grotesk and JetBrains Mono as woff2 files in `fonts/`
(SIL Open Font License 1.1) and loads them from `palace.css` itself. Do not add
Google Fonts links: they send every visitor's IP address to Google, which German
courts have held to violate the GDPR without consent. Keep `fonts/` next to
`palace.css` when serving.
```

Then add `dialog` and `kbd` to SPEC.md's component reference. Document the markup each one expects:
- `dialog`: `<dialog><h2>…</h2><p class="subtitle">…</p>…<menu><li><button class="btn">…</button></li></menu></dialog>`
- `kbd`: inline `<kbd>`

In `catalog.html`:
- Delete the three Google Fonts `<link>` lines.
- Add a "Dialog" section with a `<dialog open>` sample using the markup above.
- Add a "Kbd" section with `<kbd>Ctrl</kbd> + <kbd>Z</kbd>`.

In `package.json`, set `"version": "0.10.0"` and `"files": ["palace.css", "fonts", "catalog.html", "SPEC.md"]`.

- [ ] **Step 4: Verify**

Run:
```bash
cd ~/repos/palace-ui && grep -c "fonts.googleapis" palace.css SPEC.md catalog.html; npm pack --dry-run 2>&1 | grep -E "woff2|OFL|palace.css"
```
Expected: `0` for all three files. The pack lists 5 woff2 files, 2 OFL texts and `palace.css`.

Then run `python3 -m http.server 8123` in `~/repos/palace-ui`, open `http://localhost:8123/catalog.html`, and check in DevTools → Network:
- no request leaves localhost
- the fonts load from `/fonts/`
- the dialog sample is centred and has the purple offset shadow

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -s -m "feat: self-host fonts, add dialog and kbd, set color-scheme" \
  -m "Google Fonts sent visitors' IP addresses to Google. The dialog, kbd and color-scheme rules were written in an app because palace lacked them; they are generic, so they live here now."
git tag v0.10.0
```

---

### Task 3: USER GATE: publish palace-ui

Everything here is public. **Ask the user before each command.** The user runs the commands, or explicitly approves them first.

- [ ] **Step 1:** Create the public GitHub repo and push:
  `gh repo create jostsg/palace-ui --public --source ~/repos/palace-ui --push && git -C ~/repos/palace-ui push --tags`
- [ ] **Step 2:** The user publishes to npm from `~/repos/palace-ui`: `npm login` (if needed), then `npm publish --access public`.
- [ ] **Step 3: Verify**
  Run: `npm view palace-ui@0.10.0 version dist.tarball`
  Expected: `0.10.0` and a tarball URL.

Tasks 4 and later depend on `palace-ui@0.10.0` being on npm from Task 5 on.

---

### Task 3b: palace-ui releases through CI from now on

The hand publish in Task 3 is the only one. Every later palace-ui release goes through release-please and trusted publishing, exactly like the TinyLap packages (Task 11).

**Files (`~/repos/palace-ui`):**
- Create: `release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/release.yml`
- Modify: `package.json` (`repository` field: npm provenance checks it against the publishing repo)

- [ ] **Step 1: Config**

`release-please-config.json`:
```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "node",
  "packages": { ".": {} }
}
```

`.release-please-manifest.json`:
```json
{ ".": "0.10.0" }
```

In `package.json`, add:
```json
"repository": { "type": "git", "url": "git+https://github.com/jostsg/palace-ui.git" },
```

- [ ] **Step 2: Workflow**

`.github/workflows/release.yml`:
```yaml
name: release

# release-please keeps a release pull request open with the next version and
# changelog, computed from conventional commits. Nothing is published until a
# person merges it.
on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write
  id-token: write   # npm trusted publishing and provenance, no stored token

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - id: rp
        uses: googleapis/release-please-action@v4
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
      - if: steps.rp.outputs.release_created == 'true'
        uses: actions/checkout@v4
      - if: steps.rp.outputs.release_created == 'true'
        uses: actions/setup-node@v4
        with:
          node-version: '24'
          registry-url: https://registry.npmjs.org
      - if: steps.rp.outputs.release_created == 'true'
        run: npm install -g npm@latest && npm publish --provenance --access public
```

- [ ] **Step 3: Verify and commit**

Run: `for f in .github/workflows/release.yml; do npx --yes yaml@2 valid < "$f" || echo "INVALID $f"; done; node -e "JSON.parse(require('fs').readFileSync('release-please-config.json'));JSON.parse(require('fs').readFileSync('.release-please-manifest.json'));console.log('json ok')"; npm pack --dry-run 2>&1 | grep -cE "release|\.github"`
Expected: no `INVALID` lines, then `json ok`, then `0`: the release files are not shipped, because `files` limits the package.

```bash
git add -A && git commit -s -m "build: release with release-please and npm trusted publishing"
```

- [ ] **Step 4: USER GATE**

1. Push to `jostsg/palace-ui` `main`; ask first.
2. On npmjs.com, the user configures trusted publishing for `palace-ui`: repository `jostsg/palace-ui`, workflow `release.yml`.

---

### Task 4: Monorepo skeleton and the planner moved into `apps/track-planner`

Pure move plus workspace wiring. No source file content changes.

**Files:**
- Move (`git mv`): `index.html css js test Dockerfile Caddyfile fly.toml serve.py vendor .dockerignore` → `apps/track-planner/`
- Create: `apps/track-planner/package.json` (replaces the root one)
- Create: root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.gitignore`
- Replace: `.github/workflows/deploy.yml` → `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Produces:
  - workspace package `@tinylap/track-planner` (private), with scripts `test` and `serve`
  - root scripts `test`, `lint`, `typecheck`, `check`, all running through turbo
  - `ci.yml` with jobs `check` and `deploy`

- [ ] **Step 1: Branch and record the baseline**

```bash
cd /Users/simon/repos/track-layout && git switch docs/tinylap-monorepo-spec && git switch -c feat/tinylap-monorepo
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Expected: `tests 153`, `pass 153`, `fail 0`. Write the number down: it is the invariant for every later task.

- [ ] **Step 2: Move the planner**

```bash
mkdir -p apps/track-planner
git mv index.html css js test Dockerfile Caddyfile fly.toml serve.py vendor .dockerignore apps/track-planner/
git rm -q package.json
```

- [ ] **Step 3: Write the workspace files**

`package.json` (root):
```json
{
  "name": "tinylap",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.11.2",
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "check": "turbo run test lint typecheck"
  },
  "devDependencies": {
    "turbo": "^2.11.7"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*
  - tools
```

`turbo.json`:
```json
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "test": {},
    "lint": {},
    "typecheck": {}
  }
}
```

`.gitignore`:
```
node_modules/
.turbo/
packages/*/dist/
*.tgz
```

`apps/track-planner/package.json`:
```json
{
  "name": "@tinylap/track-planner",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "license": "AGPL-3.0-or-later",
  "files": ["index.html", "css", "js"],
  "scripts": {
    "test": "node --test 'test/**/*.test.js'",
    "serve": "python3 serve.py 8000"
  }
}
```

- [ ] **Step 4: Install and run the suite through turbo**

```bash
corepack enable && pnpm install && pnpm test 2>&1 | tail -15
```
Expected: turbo runs `@tinylap/track-planner:test`, and it reports `tests 153`, `pass 153`. This commits `pnpm-lock.yaml`.

- [ ] **Step 5: Replace the workflow**

`git rm .github/workflows/deploy.yml` and create `.github/workflows/ci.yml`:

```yaml
name: ci

# Pull requests run the checks but never deploy. A push to main runs the same
# checks and then deploys the planner, but only if the push touched it.
on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          # --affected compares against the base branch, which needs history.
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - if: github.event_name == 'pull_request'
        run: pnpm turbo run test lint typecheck --affected
      - if: github.event_name == 'push'
        run: pnpm turbo run test lint typecheck

  deploy:
    needs: [check]
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    concurrency:
      # Two pushes in quick succession would otherwise race, and the loser
      # could overwrite the newer image with an older one.
      group: deploy-track-planner
      cancel-in-progress: true
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - id: changed
        run: |
          if git diff --name-only "${{ github.event.before }}" "${{ github.sha }}" \
              | grep -qE '^(apps/track-planner|packages|tools)/|^pnpm-lock\.yaml$'; then
            echo "planner=true" >> "$GITHUB_OUTPUT"
          fi
      - if: steps.changed.outputs.planner == 'true'
        uses: superfly/flyctl-actions/setup-flyctl@master
      # Until Task 5 the image is built from the app folder alone.
      - if: steps.changed.outputs.planner == 'true'
        working-directory: apps/track-planner
        run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

- [ ] **Step 6: Update the README and the serve script**

In `README.md`, replace the code block with:
```
    pnpm install
    pnpm test                                    # every package
    pnpm --filter @tinylap/track-planner serve   # then open http://localhost:8000
```
Then add a line saying the planner lives in `apps/track-planner/`.

Run `pnpm --filter @tinylap/track-planner serve` and open http://localhost:8000. The planner loads, a piece can be placed.

- [ ] **Step 7: Verify history survives the move, then commit**

Run: `git log --follow --oneline apps/track-planner/js/model.js | wc -l`
Expected: more than 1.

```bash
git add -A && git commit -s -m "build: move the planner into an apps/ workspace" \
  -m "pnpm workspaces and Turborepo; the planner's files are moved, not changed."
```

---

### Task 5: Serving through `/pkg/`, versioned paths, palace-ui from npm

**Files:**
- Create: `tools/package.json`, `tools/serve-map.js`, `tools/dev-server.js`, `tools/assemble.js`, `tools/smoke.js`
- Create: `tools/test/serve-map.test.js`, `tools/test/assemble.test.js`, `tools/test/import-map.test.js`
- Modify: `apps/track-planner/index.html:4-11` (base, import map, palace link, no Google Fonts)
- Modify: `apps/track-planner/package.json` (dependency, `dev` script)
- Modify: `apps/track-planner/css/app.css` (remove the rules that moved to palace in Task 2, and fix the SPEC path in the header comment)
- Modify: `apps/track-planner/Dockerfile`, `apps/track-planner/Caddyfile`, `.github/workflows/ci.yml`
- Move: `apps/track-planner/.dockerignore` → `.dockerignore` (the build context is now the repo root)
- Delete: `apps/track-planner/vendor/`, `apps/track-planner/serve.py`

**Interfaces:**
- Produces (`tools/serve-map.js`):
  - `packageSegment(name: string): string`: `'@tinylap/track-format'` → `'track-format'`, `'palace-ui'` → `'palace-ui'`
  - `packageRoots(appDir: string): Map<string, string>`: segment → absolute real directory, one per `dependencies` entry in `appDir/package.json`
  - `resolveUrl(appDir: string, roots: Map<string,string>, pathname: string): string | null`: `/pkg/<seg>/<rest>` → file under that package root; anything else → file under `appDir`. `null` for traversal or unknown segment. `/` → `index.html`.
  - `jsEntry(pkgDir: string): string | null`: the package's JS entry relative to its root (`'index.js'`), or `null` if it has no JS entry (CSS-only packages)
- Produces (`tools/assemble.js`):
  - `assemble(appDir: string, outDir: string, sha: string): void`, which writes:
    - `outDir/index.html` with `<base href="/v/<sha>/">`
    - `outDir/v/<sha>/<app files>`
    - `outDir/v/<sha>/pkg/<seg>/…`
  - CLI: `node tools/assemble.js <appDir> <outDir> <sha>`
- Produces (`tools/smoke.js`): CLI `node tools/smoke.js <baseUrl>`, exits non-zero on any failed check.

- [ ] **Step 1: Write the failing serve-map tests**

`tools/package.json`:
```json
{
  "name": "@tinylap/tools",
  "private": true,
  "type": "module",
  "license": "AGPL-3.0-or-later",
  "scripts": { "test": "node --test 'test/**/*.test.js'" }
}
```

`tools/test/serve-map.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageSegment, packageRoots, resolveUrl, jsEntry } from '../serve-map.js';

// A throwaway app with one JS package and one CSS-only package, linked the
// way pnpm links workspace and registry dependencies.
function fixture() {
  // realpath: on macOS tmpdir() is under /var, a symlink to /private/var,
  // and packageRoots returns real paths.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'serve-map-')));
  const app = join(root, 'app');
  const fmt = join(root, 'fmt');
  const css = join(root, 'css');
  for (const d of [app, fmt, css, join(app, 'node_modules', '@tinylap')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(app, 'package.json'), JSON.stringify({ dependencies: { '@tinylap/track-format': 'workspace:*', 'palace-ui': '^0.10.0' } }));
  writeFileSync(join(app, 'index.html'), '<base href="/">');
  writeFileSync(join(fmt, 'package.json'), JSON.stringify({ exports: { '.': './index.js' } }));
  writeFileSync(join(fmt, 'index.js'), 'export {};');
  writeFileSync(join(css, 'package.json'), JSON.stringify({ main: 'palace.css' }));
  writeFileSync(join(css, 'palace.css'), '');
  symlinkSync(fmt, join(app, 'node_modules', '@tinylap', 'track-format'));
  symlinkSync(css, join(app, 'node_modules', 'palace-ui'));
  return { app, fmt, css };
}

test('scoped TinyLap packages drop their scope, others keep their name', () => {
  assert.equal(packageSegment('@tinylap/track-format'), 'track-format');
  assert.equal(packageSegment('palace-ui'), 'palace-ui');
});

test('every dependency gets a root, resolved through its symlink', () => {
  const { app, fmt, css } = fixture();
  const roots = packageRoots(app);
  assert.deepEqual([...roots.keys()].sort(), ['palace-ui', 'track-format']);
  assert.equal(roots.get('track-format'), fmt);
  assert.equal(roots.get('palace-ui'), css);
});

test('urls map to app files and package files', () => {
  const { app, fmt } = fixture();
  const roots = packageRoots(app);
  assert.equal(resolveUrl(app, roots, '/'), join(app, 'index.html'));
  assert.equal(resolveUrl(app, roots, '/pkg/track-format/index.js'), join(fmt, 'index.js'));
});

test('traversal and unknown packages resolve to nothing', () => {
  const { app } = fixture();
  const roots = packageRoots(app);
  for (const p of ['/../secret', '/pkg/track-format/../../secret', '/%2e%2e/secret', '/..%2fsecret', '/pkg/nope/x.js', '/pkg/']) {
    assert.equal(resolveUrl(app, roots, p), null, p);
  }
});

test('the js entry comes from exports or main, and css-only packages have none', () => {
  const { fmt, css } = fixture();
  assert.equal(jsEntry(fmt), 'index.js');
  assert.equal(jsEntry(css), null);
});
```

Add `tools` to the workspace with `pnpm install`, then run:
`pnpm --filter @tinylap/tools test`
Expected: FAIL, `Cannot find module '../serve-map.js'`.

- [ ] **Step 2: Implement `tools/serve-map.js`**

```js
// The URL space every TinyLap app is served under, in dev and in prod:
//   /                 the app folder
//   /pkg/<segment>/   one of the app's dependencies, by name without scope
// Shared by the dev server and the assemble step so the two cannot disagree.
import { readFileSync, realpathSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

const SCOPE = '@tinylap/';

export const packageSegment = (name) => (name.startsWith(SCOPE) ? name.slice(SCOPE.length) : name);

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

export function packageRoots(appDir) {
  const { dependencies = {} } = readJson(join(appDir, 'package.json'));
  const roots = new Map();
  for (const name of Object.keys(dependencies)) {
    roots.set(packageSegment(name), realpathSync(join(appDir, 'node_modules', ...name.split('/'))));
  }
  return roots;
}

// Joins `rest` under `root`, or returns null if the result would escape it.
// Decoding happens first, so %2e%2e and %2f cannot smuggle a `..` past the
// check.
function within(root, rest) {
  let decoded;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const target = normalize(join(root, decoded));
  return target === root || target.startsWith(root + sep) ? target : null;
}

export function resolveUrl(appDir, roots, pathname) {
  if (pathname === '/' || pathname === '') return join(appDir, 'index.html');
  const pkg = pathname.match(/^\/pkg\/([^/]+)\/(.+)$/);
  if (pkg) {
    const root = roots.get(pkg[1]);
    return root ? within(root, pkg[2]) : null;
  }
  if (pathname.startsWith('/pkg/')) return null;
  return within(appDir, pathname.slice(1));
}

export function jsEntry(pkgDir) {
  const { exports, main } = readJson(join(pkgDir, 'package.json'));
  const dot = typeof exports === 'string' ? exports : exports?.['.'];
  const entry = typeof dot === 'string' ? dot : dot?.default ?? (typeof main === 'string' ? main : null);
  return typeof entry === 'string' && entry.endsWith('.js') ? entry.replace(/^\.\//, '') : null;
}
```

Run: `pnpm --filter @tinylap/tools test`
Expected: PASS, 5 tests.

- [ ] **Step 3: Write the failing assemble tests**

`tools/test/assemble.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../assemble.js';

const SHA = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';

function fixture(indexHtml = '<head><base href="/"><link href="./css/a.css"></head>') {
  const root = mkdtempSync(join(tmpdir(), 'assemble-'));
  const app = join(root, 'app');
  const pkg = join(root, 'pkg');
  mkdirSync(join(app, 'css'), { recursive: true });
  mkdirSync(join(app, 'test'), { recursive: true });
  mkdirSync(join(app, 'node_modules', '@tinylap'), { recursive: true });
  mkdirSync(join(pkg, 'test'), { recursive: true });
  writeFileSync(join(app, 'package.json'), JSON.stringify({ files: ['index.html', 'css'], dependencies: { '@tinylap/fmt': 'workspace:*' } }));
  writeFileSync(join(app, 'index.html'), indexHtml);
  writeFileSync(join(app, 'css', 'a.css'), 'a{}');
  writeFileSync(join(app, 'test', 'x.test.js'), '');
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ exports: { '.': './index.js' } }));
  writeFileSync(join(pkg, 'index.js'), 'export {};');
  writeFileSync(join(pkg, 'test', 'y.test.js'), '');
  symlinkSync(pkg, join(app, 'node_modules', '@tinylap', 'fmt'));
  return { app, out: join(root, 'out') };
}

test('the page points at the versioned tree and everything is copied under it', () => {
  const { app, out } = fixture();
  assemble(app, out, SHA);
  assert.match(readFileSync(join(out, 'index.html'), 'utf8'), new RegExp(`<base href="/v/${SHA}/">`));
  assert.ok(existsSync(join(out, 'v', SHA, 'css', 'a.css')));
  assert.ok(existsSync(join(out, 'v', SHA, 'pkg', 'fmt', 'index.js')));
});

test('tests and node_modules are not shipped', () => {
  const { app, out } = fixture();
  assemble(app, out, SHA);
  assert.ok(!existsSync(join(out, 'v', SHA, 'test')));
  assert.ok(!existsSync(join(out, 'v', SHA, 'pkg', 'fmt', 'test')));
});

test('a missing or malformed sha fails instead of serving /v//', () => {
  for (const sha of ['', undefined, 'main', '../x', 'A1B2C3D']) {
    const { app, out } = fixture();
    assert.throws(() => assemble(app, out, sha), /sha/i, String(sha));
  }
});

test('an index without exactly one <base href="/"> fails loudly', () => {
  for (const html of ['<head></head>', '<base href="/"><base href="/">', '<base href="/app/">']) {
    const { app, out } = fixture(html);
    assert.throws(() => assemble(app, out, SHA), /base/i, html);
  }
});
```

Run: `pnpm --filter @tinylap/tools test`
Expected: FAIL, `Cannot find module '../assemble.js'`.

- [ ] **Step 4: Implement `tools/assemble.js`**

```js
// Lays an app out for production: /index.html points its <base> at
// /v/<sha>/, and everything it loads lives under that path. A deploy changes
// every asset URL at once, so assets can be cached forever and a visitor can
// never mix files from two deploys.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageRoots } from './serve-map.js';

const BASE = '<base href="/">';
const skip = (src) => !['node_modules', 'test', '.turbo'].includes(basename(src));

export function assemble(appDir, outDir, sha) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/.test(sha)) {
    throw new Error(`assemble: expected a git sha (7-40 lowercase hex), got ${JSON.stringify(sha)}`);
  }
  const html = readFileSync(join(appDir, 'index.html'), 'utf8');
  const count = html.split(BASE).length - 1;
  if (count !== 1) throw new Error(`assemble: index.html must contain exactly one ${BASE}, found ${count}`);

  const tree = join(outDir, 'v', sha);
  mkdirSync(tree, { recursive: true });
  const { files = [] } = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
  for (const entry of files) {
    if (entry !== 'index.html') cpSync(join(appDir, entry), join(tree, entry), { recursive: true, filter: skip });
  }
  for (const [segment, root] of packageRoots(appDir)) {
    cpSync(root, join(tree, 'pkg', segment), { recursive: true, dereference: true, filter: skip });
  }
  writeFileSync(join(outDir, 'index.html'), html.replace(BASE, `<base href="/v/${sha}/">`));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [appDir, outDir, sha] = process.argv.slice(2);
  assemble(resolve(appDir), resolve(outDir), sha);
}
```

Run: `pnpm --filter @tinylap/tools test`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the failing import map test**

`tools/test/import-map.test.js`:
```js
// The browser resolves @tinylap/* through each app's import map; Node (the
// tests) resolves it through pnpm links and package exports. This keeps the
// two in agreement, and checks the rules the versioned deploy depends on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageRoots, jsEntry } from '../serve-map.js';

const APPS = fileURLToPath(new URL('../../apps/', import.meta.url));
const apps = readdirSync(APPS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(APPS, d.name));

const importMap = (html) => {
  const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]).imports : null;
};

const jsFiles = (dir) => readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => join(dir, f));

for (const app of apps) {
  const html = readFileSync(join(app, 'index.html'), 'utf8');

  test(`${app}: exactly one <base href="/">, before any other URL`, () => {
    assert.equal(html.split('<base href="/">').length - 1, 1);
    assert.ok(html.indexOf('<base href="/">') < html.search(/<(link|script)\b/));
  });

  test(`${app}: the import map lists exactly the JS dependencies, at their entries`, () => {
    const imports = importMap(html);
    assert.ok(imports, 'no import map');
    const expected = {};
    for (const [segment, root] of packageRoots(app)) {
      const entry = jsEntry(root);
      const { name } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      if (entry) expected[name ?? segment] = `./pkg/${segment}/${entry}`;
    }
    assert.deepEqual(imports, expected);
  });

  test(`${app}: no third-party URLs in the page`, () => {
    assert.doesNotMatch(html, /(href|src)="https?:\/\//);
  });

  // An open tab keeps the old /v/<sha>/ base after a deploy; that tree is
  // gone, so any module fetched later would 404. Everything loads up front.
  test(`${app}: no dynamic import()`, () => {
    for (const file of jsFiles(join(app, 'js'))) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /\bimport\s*\(/, file);
    }
  });
}
```

Run: `pnpm --filter @tinylap/tools test`
Expected: FAIL. The planner's `index.html` has no `<base>`, no import map, and Google Fonts links.

- [ ] **Step 6: Switch the planner to the new URL layout and palace from npm**

```bash
cd apps/track-planner && pnpm add palace-ui@^0.10.0 && cd ../..
git rm -rq apps/track-planner/vendor apps/track-planner/serve.py
git mv apps/track-planner/.dockerignore .dockerignore
```

In `apps/track-planner/package.json`, replace the `serve` script with `"dev": "node ../../tools/dev-server.js . 8000"`.

In `apps/track-planner/index.html`, replace everything from the `<meta charset>` line through the `css/app.css` link, i.e. the three Google Fonts lines and the vendor link, with the block below. Keep the `<link rel="icon">` line after it.

```html
  <meta charset="utf-8">
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Circuit 30 Planner</title>
  <script type="importmap">
  { "imports": {} }
  </script>
  <link rel="stylesheet" href="./pkg/palace-ui/palace.css">
  <link rel="stylesheet" href="./css/app.css">
```

Change `<script type="module" src="js/app.js"></script>` near the end of the body to `<script type="module" src="./js/app.js"></script>`.

In `apps/track-planner/css/app.css`, delete the rules that palace 0.10.0 now provides:
- The `:root { … color-scheme: light; }` block, including the comment inside it.
- The `kbd { … }` block.
- The whole Dialogs section, from its `/* ── Dialogs ── */` header through `dialog menu .btn { flex: 1; }`. Keep the `#inventory-form` rules that follow it.
- In the file's header comment, change `(vendor/palace-ui/SPEC.md)` to `(palace-ui's SPEC.md)`.

`.dockerignore` (root):
```
**/node_modules
.git
.github
.superpowers
.claude
docs
```

Run: `pnpm --filter @tinylap/tools test`
Expected: PASS. The import map is `{}`, since the planner has no JS dependencies yet.

- [ ] **Step 7: Implement the dev server**

`tools/dev-server.js`:
```js
// Serves an app from source under the same URL layout as production
// (see serve-map.js), and refuses to let the browser cache anything:
// Chrome happily reuses a cached ES module across reloads, which silently
// hides every edit.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { packageRoots, resolveUrl } from './serve-map.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const appDir = resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? 8000);
const roots = packageRoots(appDir);

createServer(async (req, res) => {
  const file = resolveUrl(appDir, roots, new URL(req.url, 'http://x').pathname);
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  try {
    if (!file) throw new Error('not mapped');
    const body = await readFile(file);
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, headers);
    res.end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`serving ${appDir} on http://localhost:${port} (no-store)`));
```

Run: `pnpm --filter @tinylap/track-planner dev`, then open http://localhost:8000. Check:
- the planner looks as before, with Space Grotesk loaded from `/pkg/palace-ui/fonts/`
- DevTools → Network shows no requests to Google
- the "Inventory" dialog is centred
- a `<kbd>` in the shortcuts panel has its pink offset shadow

- [ ] **Step 8: Write the smoke checker**

`tools/smoke.js`:
```js
// Crawls a running deployment the way a browser would and fails on any
// broken promise the versioned layout makes: the page revalidates, every
// asset is immutable, and every URL the page can reach (stylesheets, fonts,
// the module graph through the import map) answers 200.
const base = new URL(process.argv[2] ?? 'http://localhost:8080/');
const failures = [];
const fail = (msg) => failures.push(msg);

async function get(url) {
  const res = await fetch(url);
  if (res.status !== 200) fail(`${url} -> ${res.status}`);
  return res;
}

const page = await get(base);
if (!/no-cache/.test(page.headers.get('cache-control') ?? '')) fail(`/ is not no-cache: ${page.headers.get('cache-control')}`);
const html = await page.text();
const baseHref = html.match(/<base href="([^"]+)">/)?.[1];
if (!baseHref?.startsWith('/v/')) fail(`base href is not versioned: ${baseHref}`);
const root = new URL(baseHref ?? '/', base);
const imports = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1] ?? '{"imports":{}}').imports;

const seen = new Set();
const queue = [...html.matchAll(/<(?:link[^>]+href|script[^>]+src)="(\.\/[^"]+)"/g)].map((m) => new URL(m[1], root));

while (queue.length) {
  const url = queue.shift();
  if (seen.has(url.href)) continue;
  seen.add(url.href);
  const res = await get(url);
  if (!/immutable/.test(res.headers.get('cache-control') ?? '')) fail(`${url.pathname} is not immutable`);
  const text = url.pathname.endsWith('.js') || url.pathname.endsWith('.css') ? await res.text() : '';
  if (url.pathname.endsWith('.css')) {
    for (const m of text.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) if (!m[1].startsWith('data:')) queue.push(new URL(m[1], url));
  }
  if (url.pathname.endsWith('.js')) {
    for (const m of text.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (spec.startsWith('.')) queue.push(new URL(spec, url));
      else if (imports[spec]) queue.push(new URL(imports[spec], root));
      else fail(`${url.pathname} imports unmapped "${spec}"`);
    }
  }
}

console.log(`checked ${seen.size + 1} urls`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
```

- [ ] **Step 9: Dockerfile and Caddyfile for the repo-root build context**

`apps/track-planner/Dockerfile`:
```dockerfile
# Built from the repository root: docker build -f apps/track-planner/Dockerfile .
# The first stage only lays files out (tools/assemble.js); nothing is compiled.
FROM node:24-alpine AS assemble
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@tinylap/track-planner..."
ARG GIT_SHA
RUN node tools/assemble.js apps/track-planner /out "$GIT_SHA"

FROM caddy:2-alpine
COPY apps/track-planner/Caddyfile /etc/caddy/Caddyfile
COPY --from=assemble /out /srv
```

`apps/track-planner/Caddyfile`:
```
# Serves the planner as static files.
#
# tools/assemble.js puts every asset under /v/<git-sha>/ and points
# index.html's <base> there. A deploy changes every asset URL at once, so
# assets are cached forever and a visitor can never hold a mix of files from
# two deploys, which used to fail as a blank page. Only the page itself
# revalidates.
:8080 {
	root * /srv
	encode gzip

	@versioned path /v/*
	@page not path /v/*
	header @versioned Cache-Control "public, max-age=31536000, immutable"
	header @page Cache-Control "no-cache"

	header {
		# The planner is self-contained: no third-party scripts, fonts,
		# frames or plugins. Say so.
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		-Server
	}

	file_server
}
```

- [ ] **Step 10: Run the smoke test locally**

```bash
docker build -f apps/track-planner/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t tinylap-planner .
docker run -d --rm -p 8080:8080 --name tl-smoke tinylap-planner && sleep 2
node tools/smoke.js http://localhost:8080/; echo "exit $?"
docker build -f apps/track-planner/Dockerfile -t tinylap-planner-nosha . ; echo "exit $?"
docker stop tl-smoke
```
Expected:
- the smoke run prints `checked N urls` with N > 15, then `exit 0`
- the build without `GIT_SHA` fails at the assemble step with `expected a git sha`, then a non-zero exit

Also open http://localhost:8080 and check the planner works. DevTools shows the assets under `/v/<sha>/` served from cache on reload.

- [ ] **Step 11: CI: smoke job, and deploy from the repo root**

In `.github/workflows/ci.yml`, add a job after `check`:

```yaml
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -f apps/track-planner/Dockerfile --build-arg GIT_SHA=${{ github.sha }} -t planner .
      - run: docker run -d -p 8080:8080 planner && sleep 2
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: node tools/smoke.js http://localhost:8080/
```

Change `deploy` to `needs: [check, smoke]`. Replace its last step with:

```yaml
      # Build context is the repo root (the image needs packages and tools);
      # the positional "." makes that explicit rather than relying on
      # flyctl's default of the config file's folder.
      - if: steps.changed.outputs.planner == 'true'
        run: >
          flyctl deploy . --remote-only
          --config apps/track-planner/fly.toml
          --dockerfile apps/track-planner/Dockerfile
          --build-arg GIT_SHA=${{ github.sha }}
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

Update the README's dev command to `pnpm --filter @tinylap/track-planner dev`.

- [ ] **Step 12: Full suite, then commit**

Run: `pnpm test`
Expected: the planner reports `tests 153`, `pass 153`. Tools: all pass.

```bash
git add -A && git commit -s -m "build: serve versioned paths through an import map, palace-ui from npm" \
  -m "Assets live under /v/<git-sha>/ and are immutable; only index.html revalidates. Fonts are self-hosted by palace-ui 0.10.0, so the page makes no third-party requests."
```

- [ ] **Step 13: USER GATE: confirm the Fly build context**

Ask the user to run, or approve:
`flyctl deploy . --build-only --remote-only --config apps/track-planner/fly.toml --dockerfile apps/track-planner/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD)`
Expected: the image builds on Fly's builder without deploying. If flyctl ignores the positional context, report it; do not work around it silently.

---

### Task 6: Extract `@tinylap/track-format`

**Files:**
- Create first: `apps/track-planner/test/fixtures/live-export.html` (golden file) and `apps/track-planner/test/live-export.test.js`
- Move (`git mv`): `apps/track-planner/js/geometry.js` → `packages/track-format/geometry.js`; `js/model.js` → `packages/track-format/model.js`; `js/render.js` → `packages/track-format/svg.js`
- Move (`git mv`): `apps/track-planner/test/{geometry,model,render}.test.js` → `packages/track-format/test/{geometry,model,svg}.test.js`
- Create: `packages/track-format/{package.json,index.js,data.js,reference-layouts.js}`, `packages/track-format/test/{fixtures.js,data.test.js}`
- Create: `apps/track-planner/js/render.js` (the DOM part, cut from the moved `svg.js`)
- Modify:
  - `apps/track-planner/js/{app,generate,inventory,storage,presets}.js` (imports)
  - `apps/track-planner/test/{generate,inventory,presets,session-store,storage,stock-l}.test.js` (imports)
  - `apps/track-planner/test/fixtures.js`, `apps/track-planner/index.html` (import map), `apps/track-planner/package.json`

**Interfaces:**
- Consumes: Task 5's import map test, which forces the import map entry.
- Produces: `@tinylap/track-format`, exporting exactly the union of:
  - `geometry.js`: `MAT_MM, rotateDir, rotateCorner, rotateVertex, rotateCell, PIECES, PIECE_TYPES, ROTATIONS, rotatedDef, placedCells, placedPorts, placedWalls`
  - `model.js`: every current export, unchanged
  - `data.js`: `SUPPORTED_VERSION, layoutFromData`
  - `svg.js`: `MAT_PX, cutPath, arcPath, layoutGeometry, layoutToSvgString`
  - `reference-layouts.js`: `rectangularRing, stockL`
- The planner keeps these exports: `render.js` exports `MIN_VIEW, drawGhost, drawMarquee, drawLayout`, and re-exports `layoutToSvgString, MAT_MM`. `storage.js` keeps `LAYOUT_SCRIPT_ID, exportHtml, extractLayoutJson, importHtml` and re-exports `layoutFromData, SUPPORTED_VERSION`. `presets.js` keeps `PRESETS`, `stockL` and `rectangularRing` (re-exported).

- [ ] **Step 1: Capture the golden export BEFORE moving anything**

This pins Review Focus #3: a file exported by the current live code must still import after the move.

```bash
cd apps/track-planner && mkdir -p test/fixtures && node --input-type=module -e "
import { writeFileSync } from 'node:fs';
import { createLayout } from './js/model.js';
import { exportHtml } from './js/storage.js';
import { stockL } from './js/presets.js';
writeFileSync('test/fixtures/live-export.html', exportHtml(createLayout({ room: { w: 10, h: 12 }, pieces: stockL() })));
" && cd ../..
```

`apps/track-planner/test/live-export.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importHtml } from '../js/storage.js';
import { stockL } from '../js/presets.js';

// Exported by the planner as it was before the monorepo split. Files people
// already saved must keep opening.
const html = readFileSync(new URL('./fixtures/live-export.html', import.meta.url), 'utf8');

test('a layout exported before the package split still imports', () => {
  const layout = importHtml(html);
  assert.deepEqual(layout.room, { w: 10, h: 12 });
  assert.deepEqual(layout.pieces, stockL());
  assert.equal(layout.version, 1);
});
```

Run: `pnpm --filter @tinylap/track-planner test`
Expected: `tests 154`, `pass 154`. Commit this alone:

```bash
git add apps/track-planner/test && git commit -s -m "test(storage): pin a pre-split export as a golden file"
```

- [ ] **Step 2: Move the files**

```bash
mkdir -p packages/track-format/test
git mv apps/track-planner/js/geometry.js packages/track-format/geometry.js
git mv apps/track-planner/js/model.js packages/track-format/model.js
git mv apps/track-planner/js/render.js packages/track-format/svg.js
git mv apps/track-planner/test/geometry.test.js packages/track-format/test/geometry.test.js
git mv apps/track-planner/test/model.test.js packages/track-format/test/model.test.js
git mv apps/track-planner/test/render.test.js packages/track-format/test/svg.test.js
```

- [ ] **Step 3: Split `svg.js`: the DOM half goes back to the planner**

In `packages/track-format/svg.js`, everything from `const SVG_NS = 'http://www.w3.org/2000/svg';` to the end of the file is DOM code: `el`, the long viewBox comment, `MIN_VIEW`, `drawGhost`, `drawMarquee`, `drawLayout`, and `export { MAT_MM };`. Cut it.

Create `apps/track-planner/js/render.js` with this header, followed by the cut block pasted unchanged except for its final line:

```js
import {
  placedCells, computeMetrics, openPorts, portKey, layoutGeometry,
} from '@tinylap/track-format';

export { layoutToSvgString, MAT_MM } from '@tinylap/track-format';
```

Delete the cut block's last line, `export { MAT_MM };`, because the re-export above replaces it. Then run `grep -oE "\b(placedCells|computeMetrics|computeBarriers|findOverlaps|openPorts|portKey|layoutGeometry|MAT_PX|MAT_MM|arcPath|cutPath)\b" apps/track-planner/js/render.js | sort -u` and make sure the import list names exactly the identifiers the DOM code uses. Add any missing ones; `MAT_MM` and `layoutToSvgString` come through the re-export only if the DOM code doesn't use them directly. If the DOM code uses `MAT_MM`, add it to the import as well.

In `packages/track-format/svg.js`, the remaining imports stay `./geometry.js` and `./model.js`. Remove any imported name that's now unused, e.g. `openPorts` and `portKey`, which only the DOM part used.

- [ ] **Step 4: Create `data.js` and `reference-layouts.js` by cutting**

`packages/track-format/data.js`:

```js
import { createLayout } from './model.js';
import { PIECES } from './geometry.js';

export const SUPPORTED_VERSION = 1;
```

Below that, paste the `layoutFromData` function with its leading comment block, cut verbatim from `apps/track-planner/js/storage.js`.

`packages/track-format/reference-layouts.js`: cut `rectangularRing` and `stockL`, each with its leading comment block, verbatim from `apps/track-planner/js/presets.js`. Precede them with:

```js
// Reference layouts: hand-derived, verified against the model, and shared by
// every app's tests. stockL is the layout printed in the 87033 manual.
```

`packages/track-format/index.js`:
```js
export * from './geometry.js';
export * from './model.js';
export * from './data.js';
export * from './svg.js';
export * from './reference-layouts.js';
```

`packages/track-format/package.json`:
```json
{
  "name": "@tinylap/track-format",
  "version": "0.1.0",
  "description": "Read, validate and draw Kyosho Mini-Z Grand Prix Circuit 30 track layouts.",
  "license": "MPL-2.0",
  "type": "module",
  "exports": { ".": "./index.js" },
  "files": ["*.js", "types.d.ts"],
  "scripts": { "test": "node --test 'test/**/*.test.js'" }
}
```

- [ ] **Step 5: Rewire the planner**

```bash
cd apps/track-planner
sed -i '' -E "s#'\./(model|geometry)\.js'#'@tinylap/track-format'#" js/app.js js/generate.js js/inventory.js
sed -i '' -E "s#'\.\./js/(model|geometry)\.js'#'@tinylap/track-format'#" test/*.test.js
cd ../.. && pnpm --filter @tinylap/track-planner add @tinylap/track-format@workspace:*
```

Then edit by hand:
- `js/app.js` imports from `@tinylap/track-format` twice now (lines 1 and 3). Merge them into one import statement. The `./render.js` import stays.
- `js/storage.js`: delete `SUPPORTED_VERSION` and `layoutFromData` (already moved). Change its imports to:
  ```js
  import { layoutToSvgString } from './render.js';
  import { computeMetrics, layoutFromData, SUPPORTED_VERSION, PIECES, MAT_MM } from '@tinylap/track-format';
  import { billOfMaterials, PART_LABELS } from './inventory.js';

  export { layoutFromData, SUPPORTED_VERSION };
  ```
  Keep only the names the remaining code uses. Check with `grep -n "PIECES\|MAT_MM\|computeMetrics\|SUPPORTED_VERSION" js/storage.js`; if `SUPPORTED_VERSION` isn't used, it stays in the re-export only.
- `js/presets.js`: delete `rectangularRing` and `stockL` (already moved). Add at the top:
  ```js
  import { rectangularRing, stockL } from '@tinylap/track-format';

  // Re-exported: the planner's tests and the gallery reach them through here.
  export { rectangularRing, stockL };
  ```
- `test/fixtures.js`: delete `fourCornerLoop` (only `model.test.js` used it). Keep the `rectangularRing` re-export.
- `index.html`: set the import map to `{ "imports": { "@tinylap/track-format": "./pkg/track-format/index.js" } }`.

- [ ] **Step 6: Fix the moved tests' imports**

```bash
cd packages/track-format/test
sed -i '' -E "s#'\.\./js/model\.js'#'../model.js'#; s#'\.\./js/geometry\.js'#'../geometry.js'#; s#'\.\./js/render\.js'#'../svg.js'#; s#'\.\./js/presets\.js'#'../reference-layouts.js'#" *.test.js
cd ../../..
```

`packages/track-format/test/fixtures.js`:
```js
// Four R30 corners packed into a 4x4 block. rot 0 exits N and E, so each
// corner is turned to face the two neighbours it must meet.
export function fourCornerLoop() {
  return [
    { type: 'cornerR30', x: 0, y: 0, rot: 90 },   // top-left,  ports E + S
    { type: 'cornerR30', x: 2, y: 0, rot: 180 },  // top-right, ports S + W
    { type: 'cornerR30', x: 2, y: 2, rot: 270 },  // bot-right, ports W + N
    { type: 'cornerR30', x: 0, y: 2, rot: 0 },    // bot-left,  ports N + E
  ];
}

export { rectangularRing } from '../reference-layouts.js';
```

- [ ] **Step 7: Add the package's own `layoutFromData` tests**

`packages/track-format/test/data.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutFromData, SUPPORTED_VERSION, stockL } from '../index.js';

const valid = () => ({ version: 1, unit: 'mat', room: { w: 10, h: 12 }, pieces: stockL() });

test('valid data rebuilds the same layout', () => {
  const layout = layoutFromData(valid());
  assert.deepEqual(layout, { version: 1, unit: 'mat', room: { w: 10, h: 12 }, pieces: stockL() });
});

test('only the known piece fields survive', () => {
  const data = valid();
  data.pieces[0].extra = 'x';
  assert.equal('extra' in layoutFromData(data).pieces[0], false);
});

test('a newer format version is refused with a readable message', () => {
  assert.throws(() => layoutFromData({ ...valid(), version: SUPPORTED_VERSION + 1 }), /newer planner/);
});

test('inherited object keys are not piece types', () => {
  for (const type of ['__proto__', 'constructor', 'toString']) {
    const data = valid();
    data.pieces[0].type = type;
    assert.throws(() => layoutFromData(data), /Unknown piece type/, type);
  }
});

test('rotations other than quarter turns are refused', () => {
  const data = valid();
  data.pieces[0].rot = 45;
  assert.throws(() => layoutFromData(data), /Unknown rotation/);
});

test('non-finite coordinates and rooms are refused', () => {
  const data = valid();
  data.pieces[0].x = Number.NaN;
  assert.throws(() => layoutFromData(data), /Invalid piece x/);
  assert.throws(() => layoutFromData({ ...valid(), room: { w: Infinity, h: 1 } }), /Invalid room/);
});

test('a missing pieces array is refused', () => {
  assert.throws(() => layoutFromData({ version: 1 }), /no pieces array/);
});
```

- [ ] **Step 8: Run everything and count**

Run: `pnpm install && pnpm test 2>&1 | grep -E "track-(format|planner):test.*ℹ (tests|fail)"`
Expected:
- **track-planner: 97 tests.** That's the 153 originals minus the 57 moved ones (geometry 13, model 37, render 7), plus the golden test.
- **track-format: 64 tests.** The 57 moved ones plus the 7 data tests.
- 0 failures.

If a count is off, a test was lost or duplicated in the move. Find it before going on.

Run: `pnpm --filter @tinylap/tools test`
Expected: PASS. The import map test now expects exactly the `@tinylap/track-format` entry.

- [ ] **Step 9: Browser and smoke check**

Run `pnpm --filter @tinylap/track-planner dev` and do the following:
- place pieces
- open the Layouts gallery: thumbnails render
- open Suggestions
- save (export) a layout and re-open the file

Then rebuild the Docker image and run `node tools/smoke.js` as in Task 5 Step 10. Expected: `exit 0`, now crawling `pkg/track-format/*.js`.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -s -m "refactor: extract @tinylap/track-format from the planner" \
  -m "Geometry, model, data validation and SVG export move unchanged; the editor-only DOM drawing stays in the planner."
```

---

### Task 7: `@tinylap/design`, the shared track surface

The generic rules went upstream to palace in Task 2. What's shared by TinyLap apps and not by palace is the look of the track itself: every app that draws a track (the planner's editor now, the timing app's track map later) uses the same surface colours.

**Files:**
- Create: `packages/design/design.css`, `packages/design/package.json`, `packages/design/README.md`
- Modify: `apps/track-planner/css/app.css` (track colour literals → tokens), `apps/track-planner/index.html` (link), `apps/track-planner/package.json` (dependency)
- Modify: `packages/track-format/svg.js` (one comment on `THEMES`)

**Interfaces:**
- Produces: tokens `--tl-track-bg`, `--tl-track-mat`, `--tl-track-mat-edge`, `--tl-track-grid`, `--tl-track-wall`, served at `./pkg/design/design.css`, to be loaded after palace.

- [ ] **Step 1: Create the package**

`packages/design/design.css`:
```css
/* TinyLap design layer. Load after palace-ui's palace.css.
 *
 * palace-ui is the design system; this file only adds what TinyLap apps
 * share and palace has no business knowing: the look of a race track.
 * Generic improvements belong upstream in palace-ui, and single-app styling
 * in that app's own CSS.
 */

:root {
  /* The track surface: the dark canvas every TinyLap track is drawn on.
     packages/track-format/svg.js repeats the mat and edge values for
     standalone SVG exports, which cannot read CSS custom properties. */
  --tl-track-bg: var(--p-dark);
  --tl-track-mat: #262626;
  --tl-track-mat-edge: #3a3a3a;
  --tl-track-grid: #1f1f1f;
  --tl-track-wall: var(--p-surface);
}
```

`packages/design/package.json`:
```json
{
  "name": "@tinylap/design",
  "version": "0.1.0",
  "description": "The TinyLap design layer on top of palace-ui.",
  "license": "MPL-2.0",
  "style": "design.css",
  "exports": { "./design.css": "./design.css" },
  "files": ["design.css"],
  "dependencies": { "palace-ui": "^0.10.0" },
  "scripts": { "test": "node -e \"process.exit(/--tl-track-mat:/.test(require('fs').readFileSync('design.css','utf8'))?0:1)\"" }
}
```

`packages/design/README.md`: three lines saying what the package is, to load `palace.css` first, and where a change belongs (the rule from the CSS header).

- [ ] **Step 2: Use the tokens in the planner**

```bash
pnpm --filter @tinylap/track-planner add @tinylap/design@workspace:*
```

In `apps/track-planner/index.html`, add `<link rel="stylesheet" href="./pkg/design/design.css">` between the palace link and the `app.css` link.

In `apps/track-planner/css/app.css`:
- `.gridline { stroke: #1f1f1f; …` → `stroke: var(--tl-track-grid);`
- `.mat { fill: #262626; stroke: #3a3a3a; …` → `fill: var(--tl-track-mat); stroke: var(--tl-track-mat-edge);`
- `.cut { fill: var(--p-dark); }` → `fill: var(--tl-track-bg);`
- `.wall { stroke: var(--p-surface); …` → `stroke: var(--tl-track-wall);`
- `#canvas { … background: var(--p-dark); …` → `background: var(--tl-track-bg);`

In `packages/track-format/svg.js`, above `const THEMES`, add one comment line: `// dark repeats @tinylap/design's --tl-track-* values; SVG exports cannot read CSS variables.`

- [ ] **Step 3: Verify**

Run: `pnpm test && pnpm --filter @tinylap/tools test`
Expected: all pass. The import map test still expects only `@tinylap/track-format`, because design is CSS-only.

Run `pnpm --filter @tinylap/track-planner dev` and compare against the live site (`https://circuit30-planner.fly.dev`) side by side. The canvas, mats, walls and cuts look identical.

Rebuild the image and run the smoke test. Expected: `exit 0`, including `pkg/design/design.css`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -s -m "feat(design): add @tinylap/design with the shared track surface tokens"
```

---

### Task 8: Type checking: track-format strict, planner non-strict

**Files:**
- Create: `tsconfig.base.json`, `packages/track-format/tsconfig.json`, `packages/track-format/types.d.ts`, `apps/track-planner/tsconfig.json`, `tools/tsconfig.json`
- Modify:
  - `packages/track-format/*.js`: JSDoc only, no runtime change
  - `apps/track-planner/js/*.js`: JSDoc only, where needed
  - the three `package.json` files: `typecheck` script
  - root `package.json`: devDependencies

**Interfaces:**
- Produces: `types.d.ts` exporting the types `Dir, Corner, Rotation, Cell, PieceType, Port, Wall, ArcWall, CapWall, MatCounts, PieceDef, PlacedPiece, Room, Layout, BBox, Metrics, BarrierCounts, Barriers`.
- The code references them with `/** @import { Layout } from './types.js' */` in the package, or `from '@tinylap/track-format/types'` in the planner (see Step 1's `exports` entry).

- [ ] **Step 1: Shared config, and the data model types**

```bash
pnpm add -Dw typescript@^7.0.2 @types/node@^26.6.5
```

pnpm puts the workspace root's `node_modules/.bin` on `PATH` for package scripts, so `tsc` in a package script finds the root install. If a package's `typecheck` fails with `tsc: command not found`, add TypeScript to that package instead: `pnpm --filter <pkg> add -D typescript@^7.0.2`. The same applies to `eslint` in Task 10.

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024", "dom", "dom.iterable"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  }
}
```

`packages/track-format/types.d.ts`:
```ts
// The TinyLap track data model. Cells are [col, row], with rows increasing
// downward like SVG; one cell is one 300 mm Circuit 30 mat.

export type Dir = 'N' | 'E' | 'S' | 'W';
export type Corner = 'NE' | 'SE' | 'SW' | 'NW';
/** Clockwise on screen. layoutFromData refuses anything else. */
export type Rotation = 0 | 90 | 180 | 270;
export type Cell = [number, number];
export type PieceType = 'straight' | 'cornerR30' | 'cornerR60';

export interface Port { cells: Cell[]; dir: Dir }

export interface CapWall { kind: 'cap'; vertex: Cell }
export interface ArcWall { kind: 'arc' | 'arcLarge'; r: number; cell: Cell; corner: Corner; concave?: boolean }
export type Wall = CapWall | ArcWall;

export interface MatCounts { square?: number; quarterRound?: number; arcLarge?: number }

export interface PieceDef {
  label: string;
  cells: Cell[];
  ports: Port[];
  walls: Wall[];
  mats: MatCounts;
  centrelineMm: number;
}

export interface PlacedPiece { type: PieceType; x: number; y: number; rot: Rotation }
export interface Room { w: number; h: number }

/** The persisted layout, format version 1. */
export interface Layout {
  version: 1;
  unit: 'mat';
  room: Room | null;
  pieces: PlacedPiece[];
}

export interface BBox { x: number; y: number; w: number; h: number }

export interface Metrics {
  bbox: BBox | null;
  matCount: number;
  mats: Record<string, number>;
  lapMm: number;
}

export interface BarrierCounts { straight: number; curve: number; curveLarge: number; cornerCap: number }
export interface Barriers { counts: BarrierCounts; straightEdgeIds: string[]; arcs: ArcWall[] }
```

In `packages/track-format/package.json`, set:
- `"exports": { ".": "./index.js", "./types": { "types": "./types.d.ts" } }`
- `"scripts": { "test": "node --test 'test/**/*.test.js'", "typecheck": "tsc -p tsconfig.json" }`

`packages/track-format/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "strict": true }, "include": ["*.js", "types.d.ts"] }
```

- [ ] **Step 2: Run the checker to get the failing baseline**

Run: `pnpm --filter @tinylap/track-format typecheck 2>&1 | tail -5`
Expected: FAIL, with errors, mostly implicit-`any` parameters. Note the count.

- [ ] **Step 3: Annotate track-format until it passes**

Rules:
- **JSDoc only.** Use `@param`, `@returns`, `@type`, `@typedef` and `/** @import { … } from './types.js' */`. Don't use the legacy `@enum` or `@constructor` tags; TypeScript 7 no longer reads them.
- **No runtime change.** No executable line may change. If a fix seems to need one, stop and report it instead.
- Annotate every exported function with the `types.d.ts` types, e.g. `/** @param {Layout} layout @returns {Metrics} */` on `computeMetrics`. Internal helpers get annotations only where inference fails.
- `PIECES` gets `/** @type {Record<PieceType, PieceDef>} */`.
- For narrowing the checker can't follow, use a cast comment: `/** @type {ArcWall} */ (wall)`.

Run: `pnpm --filter @tinylap/track-format typecheck && pnpm --filter @tinylap/track-format test`
Expected: no type errors, and every test passes with the same count as Task 6.

- [ ] **Step 4: Planner and tools, non-strict**

`apps/track-planner/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["js/**/*.js"] }
```

`tools/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "include": ["*.js"] }
```

Add `"typecheck": "tsc -p tsconfig.json"` to both packages' scripts.

Run: `pnpm --filter @tinylap/track-planner typecheck 2>&1 | grep -c "error TS"` and list the errors per file.

How to fix them:
- With JSDoc only, and no runtime change.
- DOM lookups typically need `/** @type {HTMLInputElement} */ (document.getElementById('x'))`.
- **If a file has more than 30 errors** (expect `js/app.js`, the DOM glue), add as its first line `// @ts-nocheck: DOM glue; typed incrementally later, see docs/superpowers/specs/2026-10-13-tinylap-monorepo-design.md §6`. Don't annotate it now.
- Report which files got `@ts-nocheck`.

Run: `pnpm typecheck && pnpm test`
Expected: all clean, and the test counts are unchanged.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -s -m "build: type-check every package with tsc --checkJs" \
  -m "track-format is strict, with its data model in types.d.ts; the planner starts non-strict. JSDoc only, no runtime change."
```

---

### Task 9: Licensing: SPDX headers, REUSE, license texts, contributor and trademark docs

**Files:**
- Create: `LICENSES/AGPL-3.0-or-later.txt`, `LICENSES/MPL-2.0.txt`, `LICENSES/CC-BY-SA-4.0.txt`, `LICENSE`, `REUSE.toml`, `CONTRIBUTING.md`, `TRADEMARKS.md`
- Modify: every `.js` and `.css` file under `apps/`, `packages/` and `tools/` (header comment), `README.md`, `packages/*/package.json` (`license` already set; verify)
- Modify: `.github/workflows/ci.yml` (reuse job)

- [ ] **Step 1: Run the failing check**

Run: `pipx run reuse lint` (or `uvx reuse lint`)
Expected: FAIL. No licensing information on any file.

- [ ] **Step 2: License texts**

```bash
pipx run reuse download AGPL-3.0-or-later MPL-2.0 CC-BY-SA-4.0
cp LICENSES/AGPL-3.0-or-later.txt LICENSE
```

`LICENSE` stays the pristine AGPL text, so GitHub detects it. The per-folder note goes in the README instead.

- [ ] **Step 3: Headers in source files**

```bash
pipx run reuse annotate --copyright="The TinyLap contributors" --year=2026 --license=AGPL-3.0-or-later --style=c --recursive --skip-unrecognised apps tools
pipx run reuse annotate --copyright="The TinyLap contributors" --year=2026 --license=MPL-2.0 --style=c --recursive --skip-unrecognised packages
git diff --stat | tail -3
```

Check one `.js` and one `.css` file: each starts with

```
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later
```

(`/* … */` style in CSS). Make sure `apps/track-planner/index.html` was **not** annotated: if a comment was inserted before `<!doctype html>`, revert that file. HTML is covered by `REUSE.toml`.

Make sure no file under `node_modules` or `test/fixtures/` was touched; revert any that were.

- [ ] **Step 4: `REUSE.toml` for everything that can't carry a comment**

```toml
version = 1

[[annotations]]
path = ["apps/**", "tools/**"]
precedence = "aggregate"
SPDX-FileCopyrightText = "2026 The TinyLap contributors"
SPDX-License-Identifier = "AGPL-3.0-or-later"

[[annotations]]
path = ["packages/**"]
precedence = "aggregate"
SPDX-FileCopyrightText = "2026 The TinyLap contributors"
SPDX-License-Identifier = "MPL-2.0"

[[annotations]]
path = ["docs/**", "*.md"]
precedence = "aggregate"
SPDX-FileCopyrightText = "2026 The TinyLap contributors"
SPDX-License-Identifier = "CC-BY-SA-4.0"

[[annotations]]
path = [
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "turbo.json",
  "tsconfig.base.json", "eslint.config.js", "commitlint.config.js",
  "release-please-config.json", ".release-please-manifest.json",
  ".github/**", ".gitignore", ".dockerignore", "REUSE.toml",
]
precedence = "aggregate"
SPDX-FileCopyrightText = "2026 The TinyLap contributors"
SPDX-License-Identifier = "AGPL-3.0-or-later"
```

Run: `pipx run reuse lint`
Expected: `Congratulations! Your project is compliant with version 3.3 of the REUSE Specification :-)`. If a file is still listed, add it to the matching `path` list. Never add a blanket `**` entry.

- [ ] **Step 5: CONTRIBUTING, TRADEMARKS, README**

`CONTRIBUTING.md`:
````markdown
# Contributing to TinyLap

## Setup

    corepack enable
    pnpm install
    pnpm check                                   # tests, lint, types in every package
    pnpm --filter @tinylap/track-planner dev     # http://localhost:8000

## Sign your commits (DCO)

Every commit must carry a `Signed-off-by:` line, which `git commit -s` adds.
By signing off you certify the [Developer Certificate of Origin](https://developercertificate.org/):
that you wrote the change, or otherwise have the right to submit it under the
license of the folder it touches. There is no CLA: you keep your copyright,
and your contribution stays under that license for good.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/). Pull requests are
squash-merged, so the pull request title is the commit that counts, and CI
checks it. Releases and changelogs are generated from these messages.

## Ground rules

- **Use the platform.** No bundlers, no transpilers, no framework. Code is plain
  ES modules that run in the browser as written. Dependencies must ship plain ES
  modules.
- **Types are JSDoc**, checked by `tsc --checkJs`. Shared types live in `.d.ts` files.
- **Apps must not load modules lazily** (`import()`): an open tab would request
  files from a deploy that no longer exists.
- **No fragment links or other `<base>`-sensitive URLs** in app pages: assets
  are served from `/v/<sha>/`.

## Licenses

| Folder | License |
| --- | --- |
| `apps/`, `tools/` | AGPL-3.0-or-later |
| `packages/` | MPL-2.0 |
| docs, Markdown | CC-BY-SA-4.0 |

New files need an SPDX header (`reuse annotate`); `reuse lint` runs in CI.
````

`TRADEMARKS.md`:
```markdown
# The TinyLap name

The code is free software; the name is not part of the license.

You may use, modify and self-host TinyLap, for yourself, your club or your
track, and you may say that your software is "based on TinyLap" or "compatible
with TinyLap".

A public or commercial service run by someone other than the TinyLap project
must use its own name and logo, so that people know whom they are dealing with.

Questions: open an issue.
```

In `README.md`, rename the title to `# TinyLap` and describe the suite in two sentences. List `apps/track-planner` as the first product, then add:

```markdown
## License

TinyLap is free software and stays that way. Apps and tools are
AGPL-3.0-or-later, the shared packages (`packages/`) are MPL-2.0, and docs are
CC-BY-SA-4.0. See `LICENSES/`, `CONTRIBUTING.md` and `TRADEMARKS.md`.
```

- [ ] **Step 6: CI job, tests, commit**

Add to `ci.yml`:

```yaml
  reuse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: fsfe/reuse-action@v5
```

Run: `pnpm check && pipx run reuse lint`
Expected: all green, compliant.

```bash
git add -A && git commit -s -m "docs: license TinyLap share-alike and document how to contribute" \
  -m "AGPL-3.0-or-later for apps and tools, MPL-2.0 for packages, CC-BY-SA-4.0 for docs; REUSE-compliant, DCO, trademark policy."
```

---

### Task 10: ESLint and commitlint

**Files:**
- Create: `eslint.config.js`, `commitlint.config.js` (both with SPDX headers)
- Modify: root `package.json` (devDependencies), the four workspace `package.json` files (`lint` script), `.github/workflows/ci.yml`

- [ ] **Step 1: Install and configure**

```bash
pnpm add -Dw eslint@^10.12.0 @eslint/js@^10.0.1 globals@^17.13.0 @commitlint/cli@^21.2.3 @commitlint/config-conventional@^21.2.3
```

`eslint.config.js`:
```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**'] },
  js.configs.recommended,
  { languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.browser } },
  { files: ['**/test/**/*.js', 'tools/**/*.js', '*.config.js'], languageOptions: { globals: globals.node } },
];
```

`commitlint.config.js`:
```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

export default { extends: ['@commitlint/config-conventional'] };
```

Add `"lint": "eslint ."` to the scripts of `apps/track-planner`, `packages/track-format`, `packages/design` (no JS: use `"lint": "true"`), and `tools`.

- [ ] **Step 2: Run lint and handle existing findings**

Run: `pnpm lint`

How to handle findings in existing code:
- **Fix only unused variables and imports**, by deleting them, and only after `grep` confirms they're unused.
- **Any other finding:** stop and report it with file and line. Don't change behaviour to satisfy a lint rule.

Re-run until clean, then run `pnpm test`: counts unchanged.

- [ ] **Step 3: Check commitlint against real messages**

Run: `echo "feat(app): filter and sort the suggestions" | pnpm commitlint && echo "Update stuff" | pnpm commitlint; echo "exit $?"`
Expected: the first passes; the second reports `subject may not be empty` / `type may not be empty`, then a non-zero exit.

- [ ] **Step 4: CI**

Add to `ci.yml`:

```yaml
  commit-title:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      # Squash merges make the pull request title the commit message.
      - run: echo "$TITLE" | pnpm commitlint
        env:
          TITLE: ${{ github.event.pull_request.title }}
```

The title goes through `env`, never interpolated into the script, so a crafted title can't inject shell.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -s -m "build: lint code with ESLint and pull request titles with commitlint"
```

---

### Task 11: release-please and npm publishing

**Files:**
- Create: `release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/release.yml`, `packages/track-format/tsconfig.build.json`
- Modify: `packages/track-format/package.json` (types for consumers, `prepack`)

**Interfaces:**
- Produces: on merge of the release pull request, `@tinylap/track-format` and `@tinylap/design` are published with provenance. track-format ships generated `dist/*.d.ts`.

- [ ] **Step 1: Declarations for npm consumers, and the failing check**

Run: `cd packages/track-format && npm pack --dry-run 2>&1 | grep -c "\.d\.ts"`
Expected: `1` (only `types.d.ts`). Consumers would get no function types.

`packages/track-format/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "declaration": true, "emitDeclarationOnly": true, "outDir": "dist" },
  "include": ["index.js", "types.d.ts"]
}
```

In `packages/track-format/package.json`:

```json
"exports": {
  ".": { "source": "./index.js", "types": "./dist/index.d.ts", "default": "./index.js" },
  "./types": { "types": "./types.d.ts" }
},
"files": ["*.js", "types.d.ts", "dist"],
"repository": { "type": "git", "url": "git+https://github.com/tinylap/tinylap.git", "directory": "packages/track-format" },
```

Add the matching `repository` field to `packages/design/package.json`, with `"directory": "packages/design"`. npm provenance checks `repository` against the repo that publishes.

Add the script `"prepack": "tsc -p tsconfig.build.json"`.

The `source` condition is for TypeScript inside the monorepo, where `dist/` doesn't exist. Add `"customConditions": ["source"]` to `tsconfig.base.json`'s `compilerOptions`. Node and browsers ignore unknown conditions and fall through to `default`.

Run:
```bash
npm pack --dry-run 2>&1 | grep "\.d\.ts"; cd ../.. && pnpm typecheck && pnpm test && pnpm --filter @tinylap/tools test
```
Expected:
- the pack lists `dist/index.d.ts`, `dist/model.d.ts` etc. plus `types.d.ts`
- typecheck and tests are green
- the import map test still passes: `jsEntry` reads `exports['.'].default`, which is `index.js`

Also check `head -20 dist/model.d.ts`: `computeMetrics` is typed `(layout: Layout) => Metrics`. If TypeScript 7 can't emit declarations from JS, stop and report it. Don't swap in a different tool.

- [ ] **Step 2: release-please config**

`release-please-config.json`:
```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "node",
  "include-component-in-tag": true,
  "packages": {
    "packages/track-format": { "component": "track-format" },
    "packages/design": { "component": "design" }
  }
}
```

`.release-please-manifest.json`:
```json
{ "packages/track-format": "0.1.0", "packages/design": "0.1.0" }
```

- [ ] **Step 3: Release workflow**

`.github/workflows/release.yml`:
```yaml
name: release

# release-please keeps a "release" pull request open with the next versions
# and changelogs, computed from conventional commits. Nothing is published
# until a person merges that pull request.
on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write
  id-token: write   # npm trusted publishing and provenance, no stored token

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - id: rp
        uses: googleapis/release-please-action@v4
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
      - if: steps.rp.outputs.releases_created == 'true'
        uses: actions/checkout@v4
      - if: steps.rp.outputs.releases_created == 'true'
        uses: pnpm/action-setup@v4
      - if: steps.rp.outputs.releases_created == 'true'
        uses: actions/setup-node@v4
        with:
          node-version: '24'
          registry-url: https://registry.npmjs.org
      - if: steps.rp.outputs.releases_created == 'true'
        run: npm install -g npm@latest && pnpm install --frozen-lockfile
      - if: steps.rp.outputs['packages/track-format--release_created'] == 'true'
        working-directory: packages/track-format
        run: npm publish --provenance --access public
      - if: steps.rp.outputs['packages/design--release_created'] == 'true'
        working-directory: packages/design
        run: npm publish --provenance --access public
```

Verify the workflow files are valid YAML:
`for f in .github/workflows/*.yml; do npx --yes yaml@2 valid < "$f" || echo "INVALID $f"; done`
Expected: no `INVALID` lines.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -s -m "build: release the shared packages with release-please" \
  -m "A merged release pull request publishes to npm with trusted publishing and provenance; track-format ships generated declarations."
```

- [ ] **Step 5: Final verification of the whole branch**

Run:
```bash
pnpm install --frozen-lockfile && pnpm check && pnpm --filter @tinylap/tools test && pipx run reuse lint
docker build -f apps/track-planner/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t tinylap-planner . \
  && docker run -d --rm -p 8080:8080 --name tl-final tinylap-planner && sleep 2 && node tools/smoke.js http://localhost:8080/; docker stop tl-final
git log --format='%ae' main..HEAD | sort -u
```
Expected:
- everything green, and the smoke test exits 0
- the only author email is the noreply address

Manual (spec §9): in the image at http://localhost:8080:
- build a layout and export it
- import a file exported from the **live** site (https://circuit30-planner.fly.dev)
- both work

---

### Task 12: USER GATE: going public

None of this is done by the agent without the user's explicit go-ahead for each item.

- [ ] **Step 1:** The user creates the GitHub org `tinylap` and the npm org `tinylap`, and registers tinylap.dev (and .com/.app if wanted).
- [ ] **Step 2:** Push `feat/tinylap-monorepo` and open a pull request against `main`. CI must be green: check, smoke, reuse, commit-title. The user reviews and squash-merges it.
- [ ] **Step 3:** The user transfers the repo to the org and renames it: `gh repo transfer jostsg/track-layout tinylap` (or via Settings), then rename it to `tinylap`. Run `git remote set-url origin https://github.com/tinylap/tinylap.git` locally.
- [ ] **Step 4:** On npmjs.com, the user configures trusted publishing for `@tinylap/track-format` and `@tinylap/design`: repo `tinylap/tinylap`, workflow `release.yml`. A package that doesn't exist yet may need a first manual `npm publish` from its folder; do that only with approval.
- [ ] **Step 5:** The user installs the DCO GitHub app on the org, then makes the repo public.
