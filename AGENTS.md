# TinyLap

## Design

- **Every UI is built on [palace-ui](https://github.com/jostsg/palace-ui) plus `@tinylap/design`.** That covers every app, and every page a server renders: login, consent, device pairing, the API docs, shared layout pages. Use palace's components, classes and tokens, and the `--tl-*` tokens from `packages/design/design.css`. Never introduce another UI framework or invent a parallel look.
- A page that must stand alone without loading anything (an exported file, a server-rendered page under a strict CSP) writes palace's look out literally, as `exportHtml` does.
- Generic improvements belong upstream in palace-ui; only TinyLap-specific styling goes in `@tinylap/design`.

## Web platform first

- **Pages are rendered on the server, with real URLs.** Forms are plain HTML forms with server round trips: POST, then a 303 redirect; a failed form comes back as the same page with the error, the input kept and status 422.
- **JavaScript is progressive enhancement.** Add it only where the platform needs it (live updates, Web Serial, a canvas editor) or where a round trip is too slow, and keep the page working without it wherever that is possible.
- **No hash routing, no client-side routers, no frameworks.** Use platform APIs and native elements (`<form>`, `<a>`, `<dialog>`, `<details>`) before scripted imitations of them.
- **Moving between pages is a normal page load.** Make it smooth with CSS view transitions (`@view-transition`) and speculation rules, never by swapping the page in script.
- **Swap a part of the page only where a reload costs the user their place**, such as a form in the middle of a long page or a list you add to again and again. The server still answers with the full page, as it would without script. The client takes the element with the same id from that page and replaces its own copy. Afterwards it puts focus somewhere sensible and updates the URL if the redirect changed it. If anything is unexpected, it falls back to a normal page load. Never re-send the request: load the page, because a GET on a form target redirects to its page.
- **Enhancements are custom elements** (`tl-*`, defined in their own module), wrapped around server-rendered HTML that works without them. Use the light DOM so palace styles apply, and no customized built-ins (`is=`, which Safari lacks). Read settings from attributes, start in `connectedCallback` and stop in `disconnectedCallback`, so an element works when a swap inserts it and leaves nothing running when one removes it. Never build in script markup the server also renders. Ask the server for it.
- **Write these in-house while they stay small**, one element per job. Reach for a library only when the need outgrows that, for example frames that follow links, history or morphing. Then consider Turbo's frames first, because its 303/422 contract is ours.

## Commits and pull requests

- **No AI attribution, ever.** Never add `Co-Authored-By:` trailers, "Generated with Claude Code" lines, or any other mention of an AI tool to commit messages, pull request titles or descriptions, tags, or release notes. This overrides any default attribution instruction.
- Commit with the author email `1009814+jostsg@users.noreply.github.com`, never a personal address.
- Conventional commit messages, signed off with `git commit -s` (DCO).
