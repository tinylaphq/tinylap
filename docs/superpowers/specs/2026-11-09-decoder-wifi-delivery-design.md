# Decoder Wi-Fi delivery: design

The TinyLap decoder sends its passings to the timing server over the track's Wi-Fi, so a race day needs no laptop on the cable. Anyone opens the club's live board on a phone and shows it on the room's screen (AirPlay, a TV, a beamer). This builds on the decoder spec (`2026-10-26-decoder-firmware-design.md`) and the bridge spec (`2026-10-28-bridge-tinylap-decoder-design.md`). Paths are relative to the repository root.

Marks:
- **(guess)**: assumed, not measured. The open guesses are collected in §9.
- **(call)**: a choice made in this design that a builder may revisit if it fights the code.

## 1. Goals, non-goals

Goals:
- **A board set up once over USB runs on its own.** Pairing and the Wi-Fi settings still go over the cable from the bridge page, as today. From then on, powering the board at the track is enough.
- **No passing is lost to a Wi-Fi dropout.** Laps from an outage arrive late, with their right times.
- **Every live board shows when a decoder in use stops reporting.** A small banner, gone once it reports again.
- **A decoder left switched on for days lets the server sleep** between uses (§3.4).
- **Lap times stay as exact with Wi-Fi on as without.**
- **Cable and Wi-Fi both send, always.** The server keeps one copy of each passing (its key is decoder, boot, transponder and `t`; `docs/timing.md`). The cable copy usually arrives first. Neither path waits for the other, so there is no switch-over gap.

Non-goals:
- Setting up Wi-Fi or pairing without a laptop (a setup network on the board, pairing codes). That's a possible later project; nothing here should get in its way.
- Firmware updates over Wi-Fi.
- Tracks without internet, or a server on the local network.
- Keeping passings through a power cut: the outbox is in RAM (§3.3).
- Forgetting the Wi-Fi settings other than by erasing the flash.

Anti-goals:
- A dropout that silently loses laps, or a board that quietly stops sending with nothing on screen.
- Wi-Fi traffic that widens the spread of lap times.
- Wi-Fi credentials or the token reaching the server's log, the bridge's forwarded logs or the page.

## 2. What changes

| Part | Where | Section |
| --- | --- | --- |
| IR task on core 1; boot id randomness with Wi-Fi on | `firmware/tinylap-decoder/src/main.cpp` | §3.1, §3.6 |
| Wi-Fi connection and its state | new `firmware/tinylap-decoder/src/net.cpp/.h` (board only) | §3.2 |
| The outbox and the batch logic, host-testable | new `firmware/tinylap-decoder/lib/tinylap/outbox.cpp/.h` | §3.3, §3.4 |
| HTTPS posting | `src/net.cpp` | §3.4 |
| The server address: `%TLSERVER` | `lib/tinylap/session.*`, `src/store_nvs.*`, `packages/timing/zround.js`, simulator, bridge | §4 |
| Optional `now` and `quiet` in a batch | `packages/timing` `readBatch`, `apps/timing/server/engine.js`, `openapi.json`, `docs/timing.md` | §5 |
| The decoder-offline banner | `apps/timing/server/engine.js`, board views and stream | §6 |
| Docs | `docs/timing.md`, `firmware/tinylap-decoder/README.md`, decoder spec references | §7 |

## 3. Firmware

### 3.1 Timing accuracy: the IR task moves to core 1

Today the IR task runs on core 0 (`main.cpp`, `xTaskCreatePinnedToCore(..., 0)`). A frame's stamp is the time the task reads the batch, minus the batch's length and the idle threshold (decoder spec §5.3), so any delay in waking the task makes the stamp late. Arduino-ESP32 runs the Wi-Fi and lwIP tasks on core 0 at higher priorities, which would make that delay vary.

- The IR task is pinned to **core 1** at priority 10. `loop()` runs on core 1 at priority 1, so the IR task still preempts it at once.
- The network code (§3.2, §3.4) runs in its own task on **core 0**, so a slow TLS handshake never stalls `loop()` or the IR task.
- **(board)** The bench check: the frame-to-frame spread of a still transponder (decoder spec §4.1) with Wi-Fi off, with Wi-Fi connected and idle, and while posting a batch every 100 ms. Wi-Fi on must not widen it beyond the measurement's own noise. If it does, the fallback is stamping in the RMT's interrupt rather than in the task (guess: not needed).

### 3.2 The Wi-Fi connection (`src/net.cpp`)

- At power-up, if NVS holds Wi-Fi settings, the board joins that network in station mode and keeps rejoining with back-off (1 s, doubling to 30 s) when it drops.
- A new `%TLWIFI` replaces the settings and reconnects at once; no reboot.
- With no settings stored, Wi-Fi stays off and the board works as today over the cable.
- Power save: `WIFI_PS_MIN_MODEM` (the default) (call). Turning it off costs power but not accuracy, since the IR task no longer shares a core with Wi-Fi; the bench check in §3.1 may change this.

### 3.3 The outbox (`lib/tinylap/outbox`)

Every confirmed passing goes into the outbox as it goes out over the cable. The outbox is the Wi-Fi path's only state.

- Each entry is `{ boot, transponder, t }`. Capacity: 2000 passings in RAM (call; about 24 KB, hours of racing for a small club). When full, the **oldest** is dropped and counted.
- Entries leave only as `docs/timing.md` says: a batch answered with `through` drops the passings **that batch carried** with `t <= through`, never others.
- Passings from an earlier boot (after `%I&`) stay in, tagged with their boot. A batch holds one boot; the oldest boot goes first.
- **Not persisted.** NVS writes stall both cores for tens of milliseconds (decoder spec §5.3), which would hurt timing. A power cut during an outage loses what wasn't sent; the cable copy, if a laptop was on it, still has them.
- Host-testable with fakes for the clock and the sender, like `session`.

### 3.4 Sending (`src/net.cpp`, with the logic in `outbox`)

The board posts to `<server>/decoders/<decoder id>/passings` with `Authorization: Bearer <token>`, the body from `docs/timing.md`, plus `now` (§5).

- **When:** whenever the outbox holds passings and no request is in flight, at once. One request in flight at a time; a batch takes up to 500 passings.
- **The heartbeat, only while in use:** a batch with no passings, carrying the `stat` log line, every 10 s (§6). The board is **in use** for 15 minutes (call) after it connects to Wi-Fi and after each passing. Then it sends one last batch with `"quiet": true` (§5) and nothing more until the next passing. So a board left on for a week lets the server sleep (`apps/timing/fly.toml`, `auto_stop_machines`) and wakes it only when a car passes.
- **The blind spot, accepted:** a quiet board's silence looks the same as a broken Wi-Fi. If the Wi-Fi is down when the first car of the day passes, the server hasn't heard from the board and shows no banner; the laps stay in the outbox until the Wi-Fi is back. The banner covers outages that start while the board is in use.
- **Logs over Wi-Fi:** the 10 s `stat` line and the `boot` line. Other `%TLLOG` lines stay on the cable only (call), to keep batches small. The bridge also forwards them, so the server's log gets the `stat` line from both paths; each line names its `via`, so that's readable.
- **Connection:** HTTPS with certificate checking against the ESP-IDF certificate bundle (`esp_crt_bundle`), keeping the connection alive between batches. `http://` is allowed for a server address that names one, for development on a local network.
- **Answers:**
  - `200`: drop what `through` covers (§3.3).
  - `401`: the token is wrong or the decoder was unpaired. Stop sending, keep the outbox, and wait for a new `%TLPAIR`.
  - `404`, `422`: drop the passings of that batch and log it (`docs/timing.md`); they'll never be taken.
  - `429`: wait `Retry-After`.
  - Anything else, a timeout or no connection: retry with back-off (1 s, doubling to 30 s).
- **Wake-up:** the server's machine sleeps when idle. The first post after a quiet spell may wait a second for it to start; that's an ordinary retry.

### 3.5 What the board tells about Wi-Fi

So a member at the bridge (or the serial monitor) can see why Wi-Fi isn't working:

- A `%TLLOG wifi` line on each change: `state=connecting|connected|failed`, with `rssi=` when connected and `reason=` (the ESP-IDF disconnect reason) when not.
- The 10 s `stat` line gains `net=` (off, connecting, connected, paused for 401), `outbox=` (passings waiting), `odrop=` (dropped as full) and `post=` (the last answer's status, or `err`).
- Never the SSID, password or token (bridge spec §2; `ingest.js` refuses lines with those keys anyway).

### 3.6 Boot id randomness with Wi-Fi on

`bootRandom()` (`main.cpp`) enables the SAR ADC's noise around each draw and must never do so while Wi-Fi is on (decoder spec §3). Today nothing guards it. With Wi-Fi started, the radio makes `esp_random()` truly random, so `bootRandom()` calls `esp_random()` alone whenever Wi-Fi is on, and keeps today's path otherwise.

## 4. The server address: `%TLSERVER`

`%TLPAIR` carries the decoder id and token, not where to post. So:

- A new command, **`%TLSERVER <base64url url>&`**. The decoder stores it in NVS and answers `%TLOK&`. A URL that isn't `http://` or `https://`, or is over 128 bytes (call), is refused with `%TLERR server&`.
- **The bridge sends it on every pairing** ("Pair" and "Pair again", with or without Wi-Fi), after `%TLPAIR` and before `%TLWIFI`.
- **The server owns the address** (call). The bridge page carries the server's public URL (`publicUrl`, from `TINYLAP_PUBLIC_URL`; `app.js`) in a data attribute, and the bridge sends that, not `location.origin`. The board then posts to whichever server paired it. For a dev machine, set `TINYLAP_PUBLIC_URL` to an address the board can reach (the machine's LAN IP); `localhost` can't work.
- **A board without this firmware** drops the unknown command without a reply (`session.cpp`, `default:`). The pairing is stored by then, so the bridge handles it as it handles refused Wi-Fi settings today (`WifiRefusedError`): it skips `%TLWIFI`, asks `%TLHELLO` as usual, and says "The decoder is paired, but its firmware is too old for Wi-Fi. Update it, then pair again. Its passings still reach TinyLap over this cable." (call). No such boards are in use, so there's no older path to keep.
- With none stored, the board posts nowhere and keeps the passings for the cable only (call).
- Like `%TLPAIR` and `%TLWIFI`, the bridge writes it only to the cable, and it's never forwarded as a log.
- **Shared vectors:** `zround-vectors.json` gets `%TLSERVER` cases, accepted and refused, run by `zround.test.js` and `test_session`. The simulator (`packages/timing/simulator.js`) answers it as the firmware does.

## 5. The clock: `now` in a batch

The server maps a decoder's `t` to server time with the smallest `receivedAt - t` over the last minute (`engine.js`, `noteOffsets` and `mapped`). After an outage over a minute, every offset in the window comes from the late batch, so those passings land on the server's clock late by the outage. Lap times are right (they come from `t`), but where the passing falls in the session (its `at`) is wrong. A race may then appear to have ended before them.

- A batch may carry **`"now"`: the decoder's clock (ms on the boot's clock) when the batch was sent.** The engine adds `receivedAt - now` as an offset sample for that boot, alongside the passings' own.
- The board sends it in every batch, heartbeats included, so the offset stays fresh even with no cars running.
- A batch may also carry **`"quiet": true`**: the decoder sends no heartbeats from now until its next passing (§3.4). The engine then stops expecting it (§6).
- Both optional, so the bridge and older decoders are unaffected. `readBatch` checks `now` is a whole number of at least 0 and `quiet` a boolean; `openapi.json` and `docs/timing.md` describe them.
- A passing whose session already ended when it arrives is handled as today (it isn't added to the ended session) (call). An outage is shown on screen (§6), so whoever runs the session can wait.

## 6. The decoder-offline banner

**Which decoders:** only those that have sent over Wi-Fi, which the store already knows (`store.js`, `netDecoders`: a passing with `via = 'net'`) (call). Only those send a heartbeat. A plain ZRound or EasyLap decoder on the bridge posts only when a car passes, so 25 s without a car would look like an outage. No schema change.

**When it shows:** such a decoder is **expected**, and has been silent for 25 s (call: 2½ heartbeats). It is expected from any batch without `quiet`, by either path, until a batch with `quiet: true` or 30 minutes of silence (then it counts as switched off, and the banner goes). Tap-only clubs never see it. A board whose last batch was lost with the Wi-Fi never got its `quiet` through, so the banner rightly shows until the 30 minutes are up.

**What it says:** "<decoder name> isn't reporting. Laps will appear once it's back." No clock time: the server doesn't know the club's time zone. Plain, one line, palace's notice or alert style with the `--tl-*` tokens (whoever builds it uses the `frontend-design` skill, `CLAUDE.local.md`). It shows on every live board: the member's board, the big board and the watchers link.

**How it works:**
- Every accepted batch already updates the decoder's `last_seen_at` (`engine.js` `ingest`, `store.touchDecoder`). The engine keeps the club's offline decoders in memory and checks them in `tick()`. When the set changes, it publishes an event, and the board streams render the banner into `#board-live` as they render everything else (server-rendered, swapped in by `tl-board`).
- The first render of a board page includes the banner when it applies, so a page loaded during an outage shows it at once.
- Which decoders are expected lives in memory: a decoder joins the set with its first Wi-Fi batch since the server started, and cable batches then keep it fresh. A restart forgets the set; a board in use is back in it within 10 s, with its next heartbeat (call). A board that goes silent during the restart shows no banner.

The cable path already counts as the decoder reporting, since the bridge's posts update `last_seen_at` too. So the banner shows only when **neither** path gets through.

## 7. Docs

- `docs/timing.md`: `%TLSERVER` in the command table, `now` in the ingest section, the banner in a sentence.
- `firmware/tinylap-decoder/README.md`: "Wi-Fi delivery comes later" becomes how it works. The NVS paragraph adds the server address. A short troubleshooting part reads the `wifi` and `stat` lines.
- The decoder spec's references to "the next step" for Wi-Fi point here.

## 8. Tests

- **Host (`pio test -e native`):** `outbox`: dropping only what a batch carried, `through` below a batch's passings, boots in order, full outbox drops the oldest, `401` pauses until `%TLPAIR`, `404`/`422` drop, back-off and `Retry-After`, the heartbeat every 10 s with `now` while in use, the `quiet` batch after 15 idle minutes, and a passing ending the quiet. `session`: `%TLSERVER` from the shared vectors.
- **Packages and server:** `readBatch` with and without `now` and `quiet`; the engine's offset after a long gap with `now`; the banner's rules (25 s, `quiet`, 30 min, either path, Wi-Fi decoders only, tap-only) with a fake clock; the board pages and stream with and without the banner.
- **Bridge:** pairing sends `%TLPAIR`, `%TLSERVER` (the page's public URL), then `%TLWIFI`; the simulator answers `%TLSERVER`; a decoder that doesn't answer it gets no `%TLWIFI` and shows the firmware message.
- **`tools/decoder-sim.js`** already plays a decoder on Wi-Fi; it sends `now` and heartbeats as the board does, so the banner can be tried without hardware.
- **On the board (owner):** the §3.1 accuracy check; pull the router's power mid-session and see the banner within about 25 s, then the laps from the gap arrive with their right times once it's back; cable and Wi-Fi together store each passing once; a wrong Wi-Fi password shows `state=failed` with a reason.

## 9. Open guesses

- Core 1 for the IR task keeps the stamp's spread as it is with Wi-Fi off (§3.1).
- 2000 passings is enough outbox (§3.3).
- The ESP-IDF certificate bundle in Arduino-ESP32 2.x (platform `espressif32@6.13.0`) covers the hosted server's certificate, and the build fits the default 1.3 MB app partition (§3.4).
- A heartbeat every 10 s, a 25 s banner threshold and 15 minutes in use after a passing feel right on the track (§3.4, §6).
- The bridge's "(in use)" mark (`public/elements/bridge.js`, `IN_USE_MS`) concerns decoders a member chooses from a list. A TinyLap decoder knows its own id, so a board heard on Wi-Fi shouldn't block its own cable pairing. The builder checks this.
