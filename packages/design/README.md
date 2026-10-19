# @tinylap/design

The TinyLap design layer on top of palace-ui: the shared track-surface colour tokens (`--tl-track-*`).
Load palace-ui's `palace.css` first, then `design.css`.
Generic improvements belong upstream in palace-ui, and single-app styling in that app's own CSS.

## Elements

Small custom elements that enhance server-rendered HTML, one per file, imported as `@tinylap/design/elements/<name>.js` or served next to `design.css`. They run only in the browser (`class extends HTMLElement` throws in Node): server code never imports them.

- `tl-frame`: submits the forms inside it with fetch and swaps in the same frame from the page the server answers with.
- `tl-copy`: shows a server-rendered Copy button where the browser can copy.
- `tl-menu`: makes the `<details>` inside it a disclosure menu that closes on Escape, a press or focus outside, an in-page item, and leaving the page.
- `tl-relative-time`: keeps the "N min ago" text of the `<time datetime>` inside it current on server time (`now` attribute; without it, the device clock), hidden while younger than `min` ms; one shared timer, paused while the page is hidden.

## Markup

DOM-free helpers for servers, under `@tinylap/design/html/`, returning plain strings to mark as safe HTML:

- `brand.js`: the navbar's brand link and the larger lockup, with `mark.svg` (served as `/pkg/design/mark.svg`).
- `account.js`: the account menu (`accountMenu`) and `signInLink`, the same in every app. Parts are found by class; the menu has no ids of its own.
- `speculation.js`: the speculation rules every page carries, and their CSP hash.
- `escape.js`: `escapeHtml`, and `safeHref` for every URL the helpers write.
- `format-ago.js`: `formatAgo(ms, now)`, "3 min ago" for a time in the past; DOM-free, used by servers and by `tl-relative-time`.
