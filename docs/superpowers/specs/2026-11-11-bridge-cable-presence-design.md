# Bridge cable presence: design

The server knows a decoder is on a Bridge tab's cable for exactly as long as that tab holds an event stream for it. This replaces inferring the cable from batch freshness, and the open and close posts, heartbeat and windows that grew around it. It changes §3 of `2026-11-10-decoder-connections-design.md` (the decoder connections spec); everything else there stands. Paths are relative to the repository root.

Mark: **(call)** a choice made here that a builder may revisit if it fights the code.

## 1. Why

The decoder connections spec read the cable from how recently batches came over it (25 s). A TinyLap decoder sends log lines at least every 10 s, so that worked for it. A plain ZRound decoder sends only when a car passes, so it looked gone between laps. Open and close posts patched the edges and a 10 s repeated open patched the gaps, and each patch brought new edges: requests piling up, Chrome running a hidden tab's timers once a minute, an open overtaking a close.

What the pages need is not when the last batch came, but whether a Bridge tab is alive and holds this decoder on its cable. That is presence, and a held connection says it without guessing: the server already counts open board streams for `watched` the same way.

Goals:
- **Cable present = a stream open.** No timers, windows or posts decide it.
- **It ends by itself** when the cable goes: an unplug, a closed tab, a crash, a sleeping laptop, a lost network.
- **The cards update live** over the same stream, so the 15 s refresh goes.

Non-goals:
- Wi-Fi presence. The decoder keeps its check-ins while in use or watched and its `quiet` batch (Wi-Fi spec §3.4): a connection held by the board would keep the server awake for as long as the board is switched on.
- Proving a decoder works. An open stream proves the tab is alive and the port is open; a frozen TinyLap decoder still shows by its missing log lines, a plain ZRound decoder can't be checked without laps.

## 2. How it works

**The stream.** `GET <space>/decoders/<id>/cable` with `Accept: text/event-stream`, `timing.run`, same origin, as the board stream (`apps/timing/server/board-stream.js`). While it is open, the decoder is on a cable (call: the path keeps the address the cable posts used).
- The server counts open cable streams per decoder (`cableHolders`, as `boardViewers`), by the Bridge page that holds them: each render of the page has its own id (`#bridge`'s `data-page`), sent as `?page=` on both streams, so one page's dead connection and its reconnect count once, and a page's own cards leave out its own holders. A decoder is on a cable while any page holds it. A holder goes when the server notices its connection is gone: at once for a closed tab or an unplug; a laptop that sleeps or loses its network takes about 20 s (measured on the board: as long as Fly's edge needs to drop it), which is accepted: laps keep coming over the decoder's own Wi-Fi meanwhile. The keep-alive (`HEARTBEAT_MS`, 15 s) writes into the connection, but a write succeeds into the kernel's buffer until TCP gives up, and on Fly the peer is the edge proxy.
- On every change of the count between zero and one, the engine publishes `decoders`, so live boards and other Bridge pages update at once.
- The stream sends the Bridge page's `#bridge-decoders`, rendered by the server, whenever the club's decoder states change (as the board stream sends `#board-live`), plus its keep-alive.

**The page.** `tl-bridge` opens the stream (an `EventSource`) when a decoder on this tab's cable reaches `ready` (a TinyLap decoder identified; a plain ZRound or EasyLap after the choose step), and closes it when the port closes, the bridge is replaced or the element goes. Each message is swapped in for `#bridge-decoders`; the cable rows the tab fills in are re-applied (decoder connections spec §2.1, "with the cable"). The stream's URL comes from a server-rendered attribute on `#bridge` (`data-cable-stream`, with `{id}`).
- A stream the server refuses (a 503 while it restarts, a sign-in redirect), which `EventSource` gives up on, is opened again after 1 s, doubling up to 30 s.
- A page without a decoder on its cable opens no cable stream, so it needs another way to stay current: it opens the same stream without an id, `GET <space>/bridge/events`, which only sends `#bridge-decoders` and holds no cable (call). With a decoder on the cable, the page holds the decoder's stream instead; one stream per page at a time.
- If a stream drops while the port is still open (server restart, network), `EventSource` reconnects by itself and the count comes back.

**The engine.** The cable state is the count, nothing else.
- `connectionsOf`: cable `other` when the decoder has a holder that isn't this page (the page knows its own cable and paints "Connected"); otherwise `none`.
- `headerOf` (decoder connections spec §6): **reporting** while a holder exists or a Wi-Fi batch came within 25 s; **idle** for a quiet Wi-Fi decoder (a quiet sent before the cable was last held doesn't count once that cable goes); **not reporting** for an expected Wi-Fi decoder gone silent, or for a decoder whose last holder went within the last 30 minutes while it isn't reporting over Wi-Fi (call: the cable path just ended, so laps aren't being counted).
- Batches no longer set any cable state. Passings from the cable are stored as before.

## 3. What goes

The `state=open|closed` posts and their route, `keepalive`, the settle wait, the repeated open, `OPEN_FOR_MS`, `cable: false` on batches (and `readBatch`'s `cable` field), `cableAt`, `cableClosed`, `cableLogs`, `lastVia`, the per-close bookkeeping and the 15 s card refresh. The "TinyLap decoder silent on the cable reads not reporting" rule becomes the holder rule above.

What stays: one place for the cable on the card and its help lines, automatic reconnect with the port guard (the stream follows the bridge), the dialog fixes and layout, the board checks in the firmware README.

## 4. Tests

- Engine: a holder makes the decoder `other` for other pages and `reporting` in the header; the last holder going makes it `none` and `not reporting` at once; two holders (two tabs) count once; a Wi-Fi decoder without a holder keeps its Wi-Fi states; batches over the cable change no cable state.
- Route: the stream needs `timing.run` and same origin; another club's decoder is a 404; the count drops when the client disconnects; a stream that throws while starting counts nothing (as the board stream).
- Browser: connect → another page reads "Connected on another laptop" and the board "reporting"; unplug → both change at once without waiting; a plain ZRound decoder with no laps stays connected past a minute; closing the tab ends it; a hidden tab keeps it (no timers involved); the cards update over the stream without the 15 s refresh.

## 5. Open guesses

- Fly's proxy keeps an idle event stream open between keep-alives (the board stream already relies on it).
- One stream per Bridge page is light enough; clubs have one or two decoders.
