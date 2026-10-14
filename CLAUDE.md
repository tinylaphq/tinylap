# TinyLap

## Design

- **Every UI is built on [palace-ui](https://github.com/jostsg/palace-ui) plus `@tinylap/design`.** That covers every app, and every page a server renders: login, consent, device pairing, the API docs, shared layout pages. Use palace's components, classes and tokens, and the `--tl-*` tokens from `packages/design/design.css`. Never introduce another UI framework or invent a parallel look.
- A page that must stand alone without loading anything (an exported file, a server-rendered page under a strict CSP) writes palace's look out literally, as `exportHtml` does.
- Generic improvements belong upstream in palace-ui; only TinyLap-specific styling goes in `@tinylap/design`.
- **Use the `frontend-design` skill whenever a UI is touched**: new pages, changed screens, components, styling, even small visual tweaks. That includes subagents doing UI work; their dispatch must tell them to use it.

## Commits and pull requests

- **No AI attribution, ever.** Never add `Co-Authored-By:` trailers, "Generated with Claude Code" lines, or any other mention of an AI tool to commit messages, pull request titles or descriptions, tags, or release notes. This overrides any default attribution instruction.
- Commit with the author email `1009814+jostsg@users.noreply.github.com`, never a personal address.
- Conventional commit messages, signed off with `git commit -s` (DCO).
