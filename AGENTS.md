# TinyLap

## Design

- **Every UI is built on [palace-ui](https://github.com/jostsg/palace-ui) plus `@tinylap/design`.** That covers every app, and every page a server renders: login, consent, device pairing, the API docs, shared layout pages. Use palace's components, classes and tokens, and the `--tl-*` tokens from `packages/design/design.css`. Never introduce another UI framework or invent a parallel look.
- A page that must stand alone without loading anything (an exported file, a server-rendered page under a strict CSP) writes palace's look out literally, as `exportHtml` does.
- Generic improvements belong upstream in palace-ui; only TinyLap-specific styling goes in `@tinylap/design`.

## Web platform first

- **Pages are rendered on the server, with real URLs.** Forms are plain HTML forms with server round trips: POST, then a 303 redirect; a failed form comes back as the same page with the error, the input kept and status 422.
- **JavaScript is progressive enhancement.** Add it only where the platform needs it (live updates, Web Serial, a canvas editor) or where a round trip is too slow, and keep the page working without it wherever that is possible.
- **No hash routing, no client-side routers, no frameworks.** Use platform APIs and native elements (`<form>`, `<a>`, `<dialog>`, `<details>`) before scripted imitations of them.

## Commits and pull requests

- **No AI attribution, ever.** Never add `Co-Authored-By:` trailers, "Generated with Claude Code" lines, or any other mention of an AI tool to commit messages, pull request titles or descriptions, tags, or release notes. This overrides any default attribution instruction.
- Commit with the author email `1009814+jostsg@users.noreply.github.com`, never a personal address.
- Conventional commit messages, signed off with `git commit -s` (DCO).
