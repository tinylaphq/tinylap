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
  files from a deploy that no longer exists. Fonts are the exception: browsers
  fetch them on first use, so after a deploy an open tab may fall back to a
  system font until reload. That's harmless.
- **No fragment links or other `<base>`-sensitive URLs** in app pages: assets
  are served from `/v/<sha>/`.

## Licenses

| Folder | License |
| --- | --- |
| `apps/`, `tools/` | AGPL-3.0-or-later |
| `packages/` | MPL-2.0 |
| docs, Markdown | CC-BY-SA-4.0 |

New files need an SPDX header (`reuse annotate`); `reuse lint` runs in CI.
