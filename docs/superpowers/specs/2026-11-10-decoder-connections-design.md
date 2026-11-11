# Decoder connections on the Bridge page: design

The Bridge page shows every decoder of the club with the state of its two connections, the cable and Wi-Fi, even when it isn't plugged in. With the cable in, a TinyLap decoder's Wi-Fi can be seen and changed there: the decoder scans for networks, you pick one and enter its password. This builds on `2026-11-09-decoder-wifi-delivery-design.md` (the Wi-Fi spec) and `2026-10-28-bridge-tinylap-decoder-design.md` (the bridge spec). Paths are relative to the repository root.

Marks: **(call)** a choice made here that a builder may revisit if it fights the code; **(guess)** assumed, not measured.

## 1. Why, and what it is not

Wi-Fi settings reach a board only at its first pairing (the bridge's Pair form). A paired board's Wi-Fi can't be changed without erasing its flash, and the page doesn't say whether a decoder that isn't plugged in still reports.

Goals:
- **Every decoder of the club shows on the Bridge page**, plugged in or not, until it is removed (Setup → Unpair).
- **Two connections, two rows:** the cable and Wi-Fi, each with its state, and only actions that can work.
- **The way out is obvious:** without the cable, the page says that connecting it shows and changes everything.
- **With the cable in, the Wi-Fi can be changed** in a dialog: the decoder's own list of networks, a password step, another network by name, the result. A failed try keeps the network that worked.
- **Every live board says whether laps are counted right now** (§6), and keeps saying so while it is on screen.

Non-goals:
- Changing Wi-Fi without the cable (a setup network on the board; Wi-Fi spec §1).
- Storing anything about the Wi-Fi on the server: no network name, no password. The server knows only whether and when a decoder reports (§3).
- Switching access points while the signal fades (roaming).
- A dark theme (palace has none).

Anti-goals:
- A button that can't work in the current state (Change Wi-Fi without the cable).
- Red for a state that isn't a fault: an unplugged cable, an idle decoder, one switched off.
- The password or network name on the server, in a log or in a forwarded `%TLLOG` line.

## 2. The decoder card

The mockup is `decoder-status-ux-v6.html` from the brainstorming session (kept beside this spec's plan, not committed); the rules here bind, the mockup illustrates.

- **One card per decoder**, server-rendered on the Bridge page, above the existing connect flow. Order: the decoder on the cable first, then by name.
- **A status line** on top answers whether laps get through: "Laps get through over the cable", "… over Wi-Fi", "… over the cable and Wi-Fi", or, when neither does, "If it's on, its laps wait on it. Connect the cable to see why."
- **Two rows, Cable and Wi-Fi.** Each starts with a lamp: a fixed square in palace's status colours with a line icon (a plug; the Wi-Fi fan). Each state shows in three ways (colour, icon shape, words), never colour alone.
  - Working: green, icon whole; a weaker Wi-Fi signal fades the outer arcs.
  - Joining: info colour, arcs light in turn (steady under `prefers-reduced-motion`), words end in "…".
  - Failing: red, arcs empty ("no signal"), no strike. Only for a fault.
  - Off or not set up: no colour, dashed edge, faint icon; the plug hangs apart from its socket.
  - Idle: no colour, solid edge, arcs whole. "Last heard …" and "Never heard": no colour, solid edge, arcs empty.
- **Actions:** at most one per row.
  - **Connect decoder** in the Cable row: primary while laps wait (nothing gets through), outline otherwise. Every card's Connect decoder opens the same Web Serial picker, which can't be limited to one decoder: whichever decoder answers becomes Connected on its own card (a TinyLap decoder by its `%TLID`; a plain ZRound or EasyLap through the existing "Which decoder is this?" step). The existing sections of `views/bridge.js` (connecting, listening, pair, unknown, choose, the live preview) stay below the cards as the connection flow; the old `connect` section's buttons and notes move into the cards (Connect EasyLap and the browser notes under the list) (call).
  - **Change Wi-Fi** (or **Set up Wi-Fi**) in the Wi-Fi row, outline, **only while this decoder is on this tab's cable** and only for members who may pair decoders (`timing.setup`, as pairing; the server renders the button only for them). Without the cable the Wi-Fi row says "Connect the cable to see and change its Wi-Fi."
- **Plain ZRound decoders and EasyLaps** have no Wi-Fi: once the cable shows what it is, their card has the Cable row only (call). Without the cable the page can't tell; the Wi-Fi row then shows only what §3 allows.
- Icons are inline SVG with all their parts, CSS showing the ones `data-state` calls for, as `SOUND_ICON` in `apps/timing/server/views/layout.js` does. TinyLap-specific styles go in `apps/timing/public/app.css`.

- **After an unplug** the card is the one place for the cable: there is no section of its own and no Connect again. The page's status region says "Decoder disconnected." once, in words the server renders hidden on the page. The Cable row says the server's "Not connected". For the decoder this tab had, two server-rendered notes, hidden by default, can show under it. "It reconnects when you plug it back in." takes the place of its help line only where reconnecting is known to work (below). For a decoder without Wi-Fi (plain ZRound, EasyLap), "Crossings while it is unplugged are lost, and each car's lap starts over when you connect again." While any decoder is on this tab's cable, neither shows.
- **Reconnecting:** when the serial port this tab last had comes back and nothing else is on the cable, `tl-bridge` opens it again without the picker. Chrome fires `navigator.serial`'s `connect` event at a new `SerialPort` for the device that came back. That port is opened only when it is the one `getPorts()` gives for the port this tab last had: the same object, else the one permitted port with the same USB vendor and product ids, leaving out the ports that were already there at the unplug (another decoder's, perhaps another tab's). A port without USB ids matches only itself. Opening resets the board, as any connect does. A port another tab holds won't open, and is left alone. That decoder's Connect decoder (or the one of an empty list) does the same first, and falls back to the picker when there is no such port or it won't open. Once a port has refused to open, its next click goes to the picker at once; any other card's Connect decoder opens the picker.
- **The limit:** Chrome keeps the permission across an unplug only for USB chips with a serial number. For others, such as the CH340 (1A86:7523), the port comes back unpermitted, and only the picker reaches it. So the card promises a reconnect only for a chip that has come back without the picker once in this browser (remembered in its storage); otherwise its help line stays "Plug the decoder in by USB, then connect it." Two decoders on the same chip can't be told apart by their ports.

### 2.1 Words

Cable: "Connected"; "Connected on another laptop" (§3); "Not connected" with "Plug the decoder in by USB, then connect it." or, while Wi-Fi reports, "Not needed while Wi-Fi works."

Wi-Fi without the cable (§3): "Reporting" / "Last heard 14:31"; "Idle" / "Wakes up with the next lap"; "Not reporting since 14:02" (red); otherwise neutral, "Connect the cable to see its Wi-Fi." The status line adds "Last heard Tuesday, 14:02" or "Never heard" when nothing gets through. Times are rendered in the browser's time zone (`<time datetime>` plus `tl-relative-time` or a small formatter): today the time only, otherwise the weekday or the date.

Wi-Fi with the cable (§4): "Connected to “Clubhaus”" / "Signal strong|fair|weak"; "Joining “Clubhaus”…"; "Can't find “Clubhaus” from here"; "“Clubhaus” refused the password"; "Can't join “Clubhaus”" (other reasons); "Not set up". No SSID, RSSI or reason codes on screen.

## 3. What the server knows (no cable)

Per decoder, in the engine's memory since the server started (no schema change):
- `netAt`: the last batch over Wi-Fi (`via: 'net'`); `quiet`: whether that batch carried `quiet: true`;
- `cableAt`: the last batch from a bridge (`via: 'serial'`). The bridge flushes log lines within 10 s (bridge spec §2.4), so a TinyLap decoder on any laptop's cable keeps it fresh; a plain ZRound decoder only while laps flow.
- The existing expected set (Wi-Fi spec §6) and `last_seen_at` (stored, either path).

**The Cable row** for a decoder not on this tab's cable: **Connected on another laptop** (green) when `cableAt` is within 25 s (`OFFLINE_AFTER_MS`) and no bridge has said since that its cable closed, otherwise **Not connected** (neutral).

**A cable that closes:** when this tab's cable to a decoder closes (unplugged, or the tab closes or leaves the page), `tl-bridge` posts `state=closed` to `<space>/decoders/<id>/cable` (`keepalive`). The engine then counts the decoder as on no cable until its next batch over one, publishes `decoders` if the board header changed (§6), and the answer, a 303 to the Bridge page, gives the bridge the cards to swap in. The address is `#bridge`'s `data-cable-closed` (`<space>/decoders/{id}/cable`). **A cable that opens:** when a decoder on this tab's cable says who it is (the bridge is `ready`: a TinyLap decoder by `%TLID`, a plain ZRound or EasyLap once it is chosen), `tl-bridge` posts `state=open` to the same address, once per connection; the address is `#bridge`'s `data-cable-open`. The engine counts it as on a cable from then (`cableAt` now, any close cleared), as a batch over a cable does, and publishes `decoders` if the board header changed. A quick re-plug never waits for a lap to say so, and the open, sent after the close, wins over it. The answer is the Bridge page, whose cards are swapped in.

After an unplug, or when another device replaces the one on the cable, the post waits for a batch already on its way (3 s at most); on leaving the page it goes at once, and so does any post still waiting. A post whose decoder is on this tab's cable again by then (connected and identified) is not sent. Until the answer comes, the card keeps what it showed, and a 15 s refresh leaves that card as it is; each close counts on its own, so a second close of the same decoder keeps the card until its own answer comes. The bridge writes no words of its own for this.

- Batches the page sends with no port open to their decoder (an earlier tab's outbox, or what still waits after an unplug) carry `cable: false`: the server stores their passings and touches `last_seen_at`, but they are no news of a cable (or of Wi-Fi: they don't keep an expected decoder fresh).
- A post that fails (offline, a 5xx, signed out) leaves the server's old words: "Connected on another laptop" and "reporting" for up to 25 s after the cable's last batch, until the 25 s rule ends them.

**The Wi-Fi row** without this tab's cable, first match:
1. **Reporting** (green): `netAt` within 25 s.
2. **Idle** (neutral): the last Wi-Fi batch said `quiet`.
3. **Not reporting since <netAt>** (red): in the expected set and offline (the same rule as the board banner).
4. Otherwise neutral, no state claimed: "Connect the cable to see its Wi-Fi." This covers a decoder never set up, one switched off, a plain ZRound decoder, and everything after a server restart: the server can't tell them apart and doesn't pretend to.

**The status line:** laps get through over the cable (this tab, or another laptop) and/or Wi-Fi (Reporting or Idle); otherwise "If it's on, its laps wait on it. Connect the cable to see why." with "Last heard <last_seen_at>" or "Never heard".

The cards and the decoder list the bridge fetches (`GET /workspaces/<ws>/decoders`) carry this as `cable: { state: 'other'|'none' }` and `wifi: { state: 'reporting'|'idle'|'offline'|'unknown', at: number|null }`, plus `lastSeenAt`.

**Keeping it current:** the card list is one element, `#bridge-decoders`. `tl-bridge` refreshes it every 15 s (call) by fetching the Bridge page and swapping that element in, as AGENTS.md's partial swap describes; the rows the cable fills in (§4) are re-applied after each swap. No new stream.

## 4. What the decoder says (cable)

Two new cable-only exchanges, in `docs/timing.md`'s table, `packages/timing/zround.js` (`parseMessage`, `commands`), the firmware's `lib/tinylap/zround.*` and `session.*`, and `packages/timing/test/zround-vectors.json`. Like `%TLPAIR`, `%TLSERVER` and `%TLWIFI`, the bridge writes them only to the cable and never forwards them; they are not `%TLLOG` lines.

### 4.1 Its Wi-Fi state: `%TLNET`

- PC → decoder `%TLNET&`; decoder → PC `%TLNET <state> <base64url name> <signal> <cause>&`, on request and unprompted on every change.
- `state`: `off` (no settings), `joining`, `connected`, `failed`. `name`: the stored network's name (empty for `off`). `signal`: dBm when connected, else `0`. `cause`: `none`, `password` (reasons 2, 15, 202, 204), `notfound` (201), `other`.
- The board sends one at every boot (power-up and `%I&`), after `%TLID` and the boot's `%TLLOG boot` line, so a freshly connected bridge has it at once without breaking the bridge's rule that the boot line follows `%TLID` directly.
- The page maps `signal` to strong (≥ −60), fair (≥ −72), weak (call).

### 4.2 The networks it sees: `%TLSCAN`

- PC → decoder `%TLSCAN&`. The board scans all channels (a scan while connected interrupts the link briefly; guess: under 3 s), then sends one `%TLAP <base64url name> <signal> <open|locked>&` per name (the strongest access point of each; hidden names left out), at most 30 (call), strongest first, then `%TLSCANEND <count>&`. A scan that fails answers `%TLERR scan&`.
- One scan at a time; a second `%TLSCAN` while one runs is answered by the running one.

### 4.3 Trying new settings: `%TLJOIN`

A wrong password typed at the track must not cost the network that works.

- PC → decoder `%TLJOIN <base64url name> <base64url password>&`, with `%TLWIFI`'s byte checks and errors. The board leaves its network and tries the new one, once (a full scan, the join, 20 s at most (call)).
- Joined: it stores the new settings (as `%TLWIFI` does) and answers `%TLJOINED ok&`.
- Not joined: it keeps the old settings, rejoins the old network, and answers `%TLJOINED <cause>&` (`password`, `notfound`, `other`, `timeout`). Nothing is stored.
- `%TLWIFI` stays as it is for pairing (store, then join). The dialog uses `%TLJOIN` only. A board without settings (Set up Wi-Fi) has nothing to return to: a failed `%TLJOIN` leaves it without Wi-Fi, as before.
- `%TLNET` during a try reports `joining` with the new name; after it, the state of whatever network the board is on. Through retries of a failing network, `%TLNET` stays `failed` with its cause until it is `connected`: it is sent on a change of state, name or cause only, so the card doesn't flicker.
- Cancel in the dialog during a try waits for `%TLJOINED` (it comes within 20 s) and then closes; the board is never left half-way.

### 4.4 Firmware

- The scan, the try and the state come from `src/net.cpp`'s task; lines reach `Serial` only through `loop()` (decoder spec §2.4), via the existing lines queue. Its entries grow from 64 to 96 bytes (a `%TLNET` line with a 32-byte name is about 80), and a scan's up to 32 lines must not be dropped: a deeper queue or the task pacing them (builder's choice).
- `%TLWIFI` is unchanged: it stores and reconnects at once (Wi-Fi spec §3.2); the `%TLNET` lines that follow (`joining`, then `connected` or `failed`) are its result.
- Host tests: the new messages and the cause mapping through the shared vectors and `test_session`; the scan's dedupe and order in `lib/tinylap` as a pure function (`scanLines(records) -> lines`).

## 5. The Change Wi-Fi dialog

A native `<dialog>` opened by Change Wi-Fi / Set up Wi-Fi, server-rendered and hidden, driven by `tl-bridge`. Steps:

1. **Looking:** it sends `%TLSCAN` on open: "Looking for networks near the decoder…".
2. **List:** "Networks near the decoder" with **Look again** beside the heading. One box, thin rules, no selected style; each row is a button (name, "Current network" muted under the current one, "Open" for open networks, signal as bars plus Strong/Fair/Weak, a chevron). One list, strongest first, weak ones at the bottom; it scrolls inside the dialog, which never exceeds the viewport. Under it, together and muted: "Only 2.4 GHz networks show here." and "TinyLap never sees the password: it goes from this laptop straight to the decoder." The footer, always in view: **Another network…** on the left, **Cancel** on the right.
3. **Password:** the network's name as the heading, its signal, a Password field with a **Show** button inside it at its right end (a real button whose visible text and accessible name change together, Show/"Show password" and Hide/"Hide password", without `aria-pressed`; palace's `.input-action`), **Back to the list**, **Join network**. An open network skips this step.
3b. **Another network:** Network name ("Exactly as it is written, capitals included."), Password ("Leave empty for an open network."), Back, Join network.
4. **Joining:** it sends `%TLJOIN` (§4.3): "Joining “Clubhaus”…" until `%TLJOINED` arrives (30 s at most; then "The decoder didn't answer").
5. **Result:** joined: "Joined “Clubhaus”" and "Signal strong. Laps now also get through over Wi-Fi.", **Done**. Refused or not found: back to step 3 with the error on top ("“Clubhaus” refused the password. The decoder is back on “Altes-WLAN”." when it had one), the password kept and focused. A network typed under Another network goes back to step 3b instead, with the error on top, its name and password kept, and focus on the name. The error is said once, by the step's alert; the dialog's status region says only the steps that aren't errors.

Layout: one spacing scale from palace's tokens; the signal in a fixed right-hand column so bars and chevrons line up; one footer on every step, its buttons one size: the way back or aside on the left (Back to the list, Back, Another network…), the way on on the right (Join network, Done; Cancel where it is the only one), Cancel and Back as palace's outline button. A field with a button inside it is generic: it goes upstream into palace-ui first (AGENTS.md), and this page uses it from there.

The byte checks of the existing pairing form (`wifiError`, bridge spec §5) apply to both fields.

## 6. One status on every live board

At the track the question is "are laps counted right now?". Every live board (the member's board, the big board, the watchers link) answers it in its header, in a row under the track name (apart from the navbar's Live state): one item per decoder that reported in the last 30 minutes, by either path:
- **Reporting** (green): a batch within 25 s over the cable or Wi-Fi.
- **Idle** (neutral): its last Wi-Fi batch said `quiet`: "wakes up with the next lap".
- **Not reporting** (red): in the expected set and offline; the existing banner (Wi-Fi spec §6) says the rest.
- **Not reporting** (red) also for a decoder whose last batch came over the cable and carried log lines (a TinyLap decoder: the bridge flushes its log lines within 10 s), silent for 25 s and not quiet: its cable path is gone. A decoder that only ever sent passings over the cable (a plain ZRound decoder or an EasyLap) can't be told apart from one between laps, so it shows nothing once silent for 25 s.

Decoders silent for longer show nothing; a tap-only club shows nothing. The words are "<name>: reporting|idle|not reporting", short enough for a phone. The item is part of `#board-live`, so the board stream keeps it current; the engine publishes `decoders` (Wi-Fi spec §6) on any change of these states, not only of the offline set.

**Staying awake while someone watches.** A board that went quiet looks the same as a switched-off one, so the beamer could only say "idle" between sessions. To keep "reporting" true while a board is on screen:
- The ingest answer gains `"watched": true|false`: whether any live board stream (member or watcher, `board-stream.js`) is open for the decoder's club.
- The board's uplink treats `watched: true` like a passing: it restarts the 15-minute in-use window, so it keeps its 10 s heartbeat while anyone watches, and goes quiet 15 minutes after the last viewer leaves.
- The server is awake anyway while a stream is open, so this costs no sleep time.
- A board that is already quiet when the screen opens shows **Idle** until its next batch, normally the next lap (the blind spot stays for that case).
- `docs/timing.md` and `openapi.json` describe `watched`; `readBatch` is unchanged; `lib/tinylap/uplink` gets the rule and a host test.

## 7. Tests

- Shared vectors: `%TLNET` (each state and cause, a name with `&`, `%` and non-ASCII), `%TLSCAN`/`%TLAP`/`%TLSCANEND`, through `zround.test.js`, the simulator and `test_session`.
- The simulator's TinyLap model (`packages/timing/simulator.js`, `apps/timing/public/sim/models/tinylap.js`) answers both, with a scripted network list and a password it accepts, so the browser tests cover the dialog.
- Engine: the cable and Wi-Fi states and their order (§3), the board header states (§6), `watched` in the answer, with the rig's clock.
- Firmware host tests: `%TLJOIN` validation and results, `%TLNET` sent only on a change, the uplink's `watched` rule.
- Pages: the cards for each server state; `#bridge-decoders` swap keeps the cable rows.
- Browser: connect → card shows Connected and the board's state; Change Wi-Fi → list (25 networks, scrolls) → password → joined; refused → back with the password kept; another network; no Change Wi-Fi without the cable.
- On the board (owner): the scan lists the site's networks; a wrong password shows "refused" and the board is back on its old network; the right one "Joined"; `%TLNET` arrives after a power cycle; with the board page open the decoder stays Reporting past 15 minutes without laps.

## 8. Open guesses

- A scan while connected takes under 3 s and doesn't drop the link for longer than the outbox can hold (§4.2).
- The signal thresholds (§4.1) match what people call strong/fair/weak.
- Polling `#bridge-decoders` every 15 s is light enough for the server; a stream would be the next step.
