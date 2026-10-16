# @tinylap/design

The TinyLap design layer on top of palace-ui: the shared track-surface colour tokens (`--tl-track-*`).
Load palace-ui's `palace.css` first, then `design.css`.
Generic improvements belong upstream in palace-ui, and single-app styling in that app's own CSS.

## Elements

Small custom elements that enhance server-rendered HTML, one per file, imported as `@tinylap/design/elements/<name>.js` or served next to `design.css`. They run only in the browser: server code never imports them.

- `tl-frame`: submits the forms inside it with fetch and swaps in the same frame from the page the server answers with.
- `tl-copy`: shows a server-rendered Copy button where the browser can copy.
