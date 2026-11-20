# Bridge: the one home for decoders

Everything about a decoder lives on the Bridge page: its state, its Wi-Fi, pairing it, pairing it again and unpairing it. Setup is race setup: track, drivers, transponders and the watchers link. Today the two pages split the decoder between them, and a decoder the server knows but that posts to an old address or with a refused token has no fix on either page except unpairing it in Setup and pairing a new one.

## Goals

1. **Pair again on a known decoder.** While a TinyLap decoder is ready on this tab's cable, its card offers Pair again: the server gives the same decoder a new token, and the page sends it the token and this server's address. The decoder keeps its id, name and laps; its Wi-Fi settings stay.
2. **The card says when Wi-Fi can't deliver, and offers the fix.** The decoder's `stat` line (forwarded over the cable every 10 s) carries `post`: `err` when its posts don't reach a server, `401` when they are refused. The Wi-Fi row says so in words and makes Pair again its action.
3. **Unpair on the card**, for members who may delete (`timing.delete`), with a confirmation, returning to Bridge.
4. **Setup loses its Decoders section**, and "Pair over Wi-Fi only" goes entirely.
5. **Leaving is guarded whenever laps reach TinyLap only through this tab**, including when Wi-Fi is joined but can't deliver.

## Non-goals

- Renaming Setup or Bridge. The navigation keeps both names and addresses.
- A decoder reporting its configured server address (`post` is enough).
- Renaming a decoder.
- Pair again for a ZRound decoder or an EasyLap (they have no pairing).

## Constraints

- AGENTS.md: the server decides state and wording; every sentence below is server-rendered. The client reports what its cable says and shows the server's answer.
- palace-ui and `@tinylap/design` only. Quiet link-style actions follow `.driver-remove` (a link's look, 44 px to tap).
- A decoder's card keeps "one help line, at most one action" per row.
- Builds on the bridge clear-states work (`2026-11-20-bridge-clear-states-design.md`): its leave guard (`onlyThisTab`) and cable notes.

## Approaches

Where the actions go (mockups reviewed with a UX pass):
- **A. In the rows**: Pair again in the Cable row, Unpair as the card's last line. Pair again shows on a healthy card with help that describes a fault it doesn't have, and a red Unpair on every card is loud for a rare action.
- **B. The card's own foot, plus the fix in the row with the problem** (chosen). Rows stay about connections; a quiet foot holds Pair again and Unpair; when the Wi-Fi row shows the problem Pair again fixes, Pair again moves there as the row's primary action. The user finds the fix where the symptom is.
- C. A ⋯ menu by the name. Hides Pair again exactly when it's needed, and is a scripted menu where none is needed.

For Pair again on the server:
- **A new token for the same decoder** (chosen): `POST /workspaces/<ws>/decoders/<id>/token` (JSON, `timing.setup`) answers `{ id, token }`. Id, name, passings and laps stay. The new token is pending: both work until the decoder first posts with the new one, or the page reports the decoder took it (`%TLOK`); then only the new one does. So a Pair again that fails halfway (cable pulled, `%TLERR`) never leaves a working decoder with a dead token. A later Pair again replaces the pending token.
- Unpair plus pair: a new id, the name typed again, the card and its history apart from the new one.

## Design

1. **Pair again.** Shown only while the card's decoder is a TinyLap decoder ready on this tab's cable, and only to members who may pair. It asks the server for a new token, then sends `%TLPAIR <id> <token>` and `%TLSERVER` with `#bridge`'s `data-server` (no `%TLWIFI`). Success and failure are said in the card, as pairing does today; a decoder that took the pairing but refused the address gets the same message as at first pairing. The unknown-decoder Pair again (a decoder no space has) is unchanged.
2. **Delivery in the Wi-Fi row.** The server knows a delivery fault two ways, and keeps the latest per decoder with when it came: a refused Wi-Fi post (401 on the decoder's own ingest route, which names its id), and the `post` of a `stat` line (forwarded by a cable). A fault under 30 s old shows:
   - `post=err`: state **"On <network>, but its laps don't get through"**, help **"It can't reach TinyLap at the address it has. Pair it again to give it this one."**
   - `post=401`: state **"On <network>, but its laps are turned away"**, help **"TinyLap no longer accepts its pairing. Pair it again to fix it."**
   Both with a failing lamp. On this tab's cable Pair again is the row's primary action (it then leaves the foot). On any other card the help's second sentence is instead **"Plug it into this laptop, then pair it again."** (the Cable row's Connect decoder is the way there). A good post, a `post` of 2xx, or a new token clears the fault. Any other `post`, or none, leaves the row as today. With no cable and a decoder that can't reach the server at all, the server hears nothing, and the card keeps today's "Not reporting since…".
   **Firmware:** a new token or server address clears the decoder's last post result (`post` is left out of `stat` until its next attempt) and makes it post a heartbeat at once, so the row shows within seconds whether Pair again worked. Without that, a decoder not in use would repeat the old `post=401` on every `stat` until its next lap. This needs the decoder flashed again.
3. **The status box** of a card whose laps reach TinyLap only through this tab (on this tab's cable, and Wi-Fi absent, not connected or not delivering) says one sentence, as a warning: **"Laps get through only while this page is open and the decoder is plugged in."** The Cable row's `only` and `only-cable` notes go: the status box says it.
4. **The leave guard** asks in exactly that case (3). Submitting one of the page's own forms (Unpair) is not leaving.
5. **The card's foot**, under the rows after a divider: Pair again (small outline button, left) when shown and not in the Wi-Fi row, and **Unpair** (quiet link style, right) for members who may delete. A card with neither has no foot.
6. **Unpair** opens a server-rendered `<dialog>` with native invoker commands (`commandfor`, `command="show-modal"`): "Unpair <name>?", "Its token stops working at once. Its passings stay.", **Unpair** (danger) and **Keep it** (closes). Unpair posts to `<space>/decoders/<id>/unpair`, which answers 303 to `<space>/bridge`. The existing GET confirmation page stays for a direct visit, its Back going to Bridge. A decoder unpaired while on this tab's cable then shows as unknown, with its Pair again.
7. **Setup** drops the Decoders section, the paired-token notice and its cookie, and the `POST <space>/decoders` form route. `GET <space>/decoders` redirects to `<space>/bridge`. The Bridge's unsupported-browser text stops pointing at "Pair over Wi-Fi only": it says the decoder is paired once over the cable from Chrome or Edge, then times over Wi-Fi without it. The JSON API (`POST /workspaces/<ws>/decoders`, `DELETE …/decoders/<id>`) stays.
8. **Docs**: `docs/timing.md` (Bridge, Setup), `apps/timing/README.md` (the dev note: a Wi-Fi decoder without hardware uses `TINYLAP_SIMULATE`, or `decoder-sim.js net` with an id and token from the JSON API).

## Left to the builder

- How the delivery state reaches the cabled card (in the cards the stream sends, or a server-rendered hidden row the page shows), as long as the words are the server's.
- The `post` codes besides `err` and `401` (e.g. `404`, already handled as unknown).
- Tests: the token route (new token, old one refused, other space 404, permission), the row states for `err`/`401`/fresh/stale, the foot with and without permissions and cable, the dialog's POST and redirect, the guard with Wi-Fi joined but not delivering, Setup without Decoders, the redirect.
