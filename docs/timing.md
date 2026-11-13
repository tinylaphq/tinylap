# Timing: passings, the ingest API and the ZRound extension

This is what a decoder needs to talk to TinyLap Timing. The design is in `docs/superpowers/specs/2026-10-15-timing-core-design.md`.

## A passing

`{ decoder, boot, transponder, t }`: the decoder's id (from pairing); a boot id, 8 to 32 base64url characters, chosen at random at every power-up **and** whenever the clock is reset (ZRound's `%I&`); the transponder code, upper-case hex; and `t`, whole milliseconds on the decoder's clock since that boot. The decoder stamps the time itself, so network delay never changes a lap.

The four together are the passing's key. Send the same passing over USB and over Wi-Fi and the server keeps one.

## Over USB: ZRound, plus TinyLap's commands

19200 baud, 8N1. The decoder speaks the ZRound Free LapCounter protocol (zround.com wiki, CC BY-SA), so it also works with ZRound:

| Direction | Message | Meaning |
| --- | --- | --- |
| PC → decoder | `%C&` | startup; answer `%A&` within 500 ms |
| PC → decoder | `%I&` | race start: clock to zero (start a new boot) |
| PC → decoder | `%F&` | race stop |
| decoder → PC | `%T<hex ms>&` | clock |
| decoder → PC | `%L<transponder hex>,<hex ms>&` | a passing |

TinyLap's own commands, which ZRound never sends (fields separated by one space):

| Direction | Message | Meaning |
| --- | --- | --- |
| PC → decoder | `%TLHELLO&` | who are you? |
| decoder → PC | `%TLID <decoder id or -> <boot>&` | `-` while unpaired; also sent unprompted whenever the boot changes |
| PC → decoder | `%TLPAIR <decoder id> <token>&` | store the id and the 43-character token; answer `%TLOK&` |
| PC → decoder | `%TLWIFI <base64url ssid> <base64url password>&` | store Wi-Fi; answer `%TLOK&` |
| PC → decoder | `%TLSERVER <base64url url>&` | store where to post; answer `%TLOK&`, or `%TLERR server&` unless it starts `http://` or `https://` and is at most 128 bytes |
| PC → decoder | `%TLNET&` | what is your Wi-Fi state? Cable only: the bridge never forwards it |
| decoder → PC | `%TLNET <state> <base64url name> <signal> <cause>&` | the Wi-Fi state, on request, at every boot (after `%TLID` and the boot's `%TLLOG boot` line), and on a change. `state` is `off`, `joining`, `connected` or `failed`; `signal` is dBm (`0` when not connected); `cause` is `none`, `password`, `notfound` or `other`. Cable only |
| PC → decoder | `%TLSCAN&` | scan for networks. Cable only |
| decoder → PC | `%TLAP <base64url name> <signal> <open\|locked>&` | one network seen, strongest first; ends with `%TLSCANEND <count>&`, or `%TLERR scan&`. Cable only |
| PC → decoder | `%TLJOIN <base64url name> <base64url password>&` | try new Wi-Fi settings, with `%TLWIFI`'s checks; stored only if the join works. Cable only |
| decoder → PC | `%TLJOINED <cause>&` | the result: `ok`, `password`, `notfound`, `other` or `timeout`; `%TLERR store&` instead of `ok` when it joined but could not save. Cable only |
| decoder → PC | `%TLOK&`, `%TLERR <text>&` | done, or why not |
| decoder → PC | `%TLLOG <kind> <key=value>…&` | the decoder's own diagnostics; see Diagnostics |

A TinyLap decoder sends `%TLID` on its own whenever its boot changes (power-up, a reset, `%I&`), so a connected bridge never stamps passings with an old boot. If a `%T…&` clock comes in lower than the one before, the bridge sends `%TLHELLO&` again until the decoder answers, in case that `%TLID` got lost.

### Diagnostics

`%TLLOG` lines are for logs, not for the app: every field is `key=value`, values hold no space, `%` or `&`, times are upper-case hex ms on the boot's clock (as in `%L`), counts are decimal. ZRound software ignores them, as it does `%TLID`. Four kinds:

- `boot`: after every `%TLID` that starts a boot. `reason=` (`poweron`, `reset`, `brownout`, `panic`, `wdt`, `sw`, `ext`, `other`), `fw=` the build, and after a crash the last counters as `prev.<key>=`.
- `stat`: every 10 s. `up=` seconds since power-up, the counters (`batches`, `frames`, `rej.start`, `rej.bit`, `rej.stop`, `rej.short`, `rej.burst`, `rej.long`, `rej.parity`, `overflow`, `ringlow`, `qdrop`, `pass`, `single`, `quiet`, `minlap`, `rxdrop`, `suppressed`) and `heap=`. Counters run from power-up and never reset.
- `pass`: a crossing that made a passing. `id=`, `t=` (its stamp), `first=`, `last=`, `frames=`.
- `event`: a crossing that made none, or an overflow, at most 20 per 10 s (the rest only count in `suppressed=`). `what=single`, `quiet` or `minlap` with `id=` and `t=`; `what=overflow` with `t=`.

The line rules, the same in the bridge and on the server (`parseLog`):

- The kind is 1 to 16 lower-case letters.
- A key is a lower-case letter, then up to 31 lower-case letters, digits or dots.
- A value is 0 to 32 printable ASCII characters, none of `%`, `&`, `=`, `"` or `\`.
- A line has at most 48 fields, no key twice, and at most 512 bytes from `%` to `&`.
- A line that breaks a rule is not a log line.

Values stay strings: the server does not know what a key means, so a new counter needs no change there.

The bridge forwards each log line to the server with the next batch of passings for its boot, as the `logs` of the ingest body (see below). With no passings to send, the first queued line starts a timer of 10 s, and then a batch of logs alone goes. The bridge holds at most 256 lines and drops the oldest first. It forwards only lines that parse; it never forwards what it wrote to the decoder. It does not forward the lines of a decoder it makes the boots for, or of an unpaired one.

The server writes one JSON line to its log for each log line, and stores none:

    {"type":"decoder-log","decoder":"dec_1","boot":"x7Qm2LbV0aE","via":"serial","kind":"pass","fields":{"id":"1F","t":"1E0A","first":"1DE2","last":"1E32","frames":"8"}}

`via` is `serial` for the bridge and `net` for a decoder with its token. `fields` keeps the line's order. A line with the key `token`, `password`, `psk` or `ssid` is skipped. So is a line that does not parse, and any line past 600 per decoder per minute. When a batch had skipped lines, one more line follows with the counts only: `{"type":"decoder-log-skipped","decoder":…,"boot":…,"unreadable":…,"limited":…,"denied":…}`.

A `boot` line follows its `%TLID` directly. The bridge relies on it: a `boot` line after anything else means that `%TLID` was lost, so the bridge sends `%TLHELLO&` again.

### The handshake

The bridge opens the port, waits 1.5 s (opening it resets many Arduino-based decoders; the TinyLap decoder on an ESP32 does not reset), and sends `%C&` every 500 ms until something in ZRound comes back, for up to 6 s. With no answer by then it is listening: it sends `%C&`, then `%TLHELLO&`, every 2 s, until 60 s after opening. Once something in ZRound comes back, it sends `%TLHELLO&`, 300 ms after its last write, up to three times 700 ms apart. A `%TLID` makes it a TinyLap decoder for the rest of the connection. Every command is a multiple of 3 bytes, so firmware that reads 3 bytes at a time (RiCino) still sees each one whole.

After a read error that leaves the port a stream to read (a break, framing, parity or overrun error), the bridge reads on, and drops the message the error cut. An error after which the port has no stream to read (a lost device, or another fatal error) ends the connection, whatever its name, and so does the 21st error in a row with no data between them: the bridge reads past 20.

### Plain ZRound decoders

A decoder that speaks ZRound but doesn't answer `%TLHELLO&` within 2.5 s is a plain ZRound decoder. It works fully over USB:

- The member says which decoder it is on the Bridge page, on every connect. The browser remembers the last choice for that USB chip and asks to confirm it.
- The bridge makes its boots: one at every connect, and a new one when its clock goes back, when it reports `%I&`, or when a passing comes more than 1.5 s before the latest one.
- If it sends nothing after the handshake, the bridge sends `%I&` (race start), up to three times 6 s apart, each after a new boot. Once the decoder sends a clock or a passing, the bridge writes nothing more to it.

A replug costs every car its current lap, and crossings while it is unplugged are lost.

## Over WebHID: an EasyLap (preview)

An EasyLap is a Silicon Labs CP2110 HID-to-UART bridge (`10C4:86B9`) in front of a decoder that speaks Robitronic binary at 38400 8N1:

- The bridge sets the UART with feature report `0x50` (`00 00 96 00 00 00 03 00`) and enables it with `0x41 01`.
- Frames are `[length, checksum, type, payload…]`, little-endian:
  - `0x84` is a passing: id u32, time in ms u32, hits, strength;
  - `0x83` is a heartbeat: time in ms u32 and four bytes.
- The transponder code is the id in upper-case hex.
- A frame whose CRC-8 (poly `0x07`, init `0xDE`, byte 1 read as 0) is wrong is skipped.
- The choice and the boots work as for a plain ZRound decoder. The bridge sends `03 B9 01` (start) only if no good frame comes within 6 s, up to three times 500 ms apart; with still nothing, it is listening.

Only one tab at a time can connect an EasyLap: WebHID, unlike Web Serial, would let a second tab open it too, so the bridge holds a lock on it for as long as it is connected, and a second tab says "This decoder is connected in another tab." WebHID exposes no serial number, so the lock is per vendor and product id: two EasyLaps on one laptop can't be connected in two tabs either.

Until a capture from a real device confirms the checksum and the id bytes, this support is a preview.

On Linux, WebHID needs a udev rule that lets your user open the device's hidraw node, and Web Serial needs the `dialout` group.

## Over Wi-Fi: the ingest API

    POST /decoders/<decoder id>/passings
    Authorization: Bearer <token>
    Content-Type: application/json

    { "boot": "x7Qm2LbV0aE", "passings": [{ "transponder": "4A1F", "t": 81234 }] }

A batch may also carry `"logs": ["pass id=1F t=1E0A first=1DE2 last=1E32 frames=8"]`: decoder log lines, each the text after `%TLLOG ` and before `&`. `passings` may then be empty; a body with neither is refused.

- **`now`** (optional) is the decoder's clock in the same milliseconds as `t`, when it sent the batch: with it the server places passings sent late at their real time. **`quiet`** (optional) is `true` when the decoder sends no heartbeats from now until its next passing: the server stops expecting it.
- **Limits:** at most 500 passings and 64 log lines per batch, the lines together at most 32 KiB and each at most 510 bytes. All of one boot.
- **The answer** is `{ "stored", "duplicates", "through", "watched" }`: `through` is the highest `t` of this boot the server holds. `watched` is `true` while a live board of the decoder's club is open (a member's, the big board or the watchers link); a Wi-Fi decoder treats it like a passing and keeps its heartbeat going, so the board can say it is reporting.
- **The outbox:** keep every passing until a batch that carried it is answered with a `through` that covers it. Drop only the passings you sent, since a passing of the same boot you never sent can lie below `through` too (the cable and Wi-Fi copies race). Resending is always safe.
- **`401`** means the token is wrong or the decoder was unpaired: keep the outbox and stop sending until it is paired again. **`429`** comes with `Retry-After`.

From the bridge, the same route takes the member's session instead of a token, from the app's own pages. There `401` means signed out and `403` means no access to the decoder's club (or a request from another site): keep those passings, since a new sign-in or another member can send them, and go on with the other decoders after a `403`. `404` means the decoder was removed or never paired, and `422` a batch the server cannot read: drop those passings, they will never be taken. When the `404` is for the TinyLap decoder on the cable itself, the bridge also stops forwarding from it and offers **Pair again**, which makes a new decoder and sends its pairing to the board; what the decoder reports until then is not recorded.

The server writes the log lines to its log and stores none. A bad line is skipped, not refused, so a log line never costs a passing; a `422` for `logs` comes only when it is not an array of strings or breaks the limits above. A batch of logs alone stores nothing, but it counts as the decoder being in use.

A decoder that has sent over Wi-Fi is expected to keep reporting: when it has sent nothing, over Wi-Fi or through a bridge that holds its cable, for 25 s, every live board shows "<name> isn't reporting. Laps will appear once it's back." It stops being expected after a batch with `quiet: true`, or after 30 minutes of silence. A decoder that only ever posts through the bridge never shows it.

Every live board (a member's, the big board, the watchers link) also says in its track header, in a row under the track name and apart from the navbar's Live state, whether each decoder heard in the last 30 minutes is counted: "<name>: reporting" (on a Bridge tab's cable, or a Wi-Fi batch within 25 s), "<name>: idle" (its last Wi-Fi batch said `quiet`) or "<name>: not reporting" (expected and silent; also a decoder whose cable was let go within the last 30 minutes and that isn't reporting over Wi-Fi). A decoder silent for longer shows nothing. The row is part of `#board-live`, so the board stream keeps it current.

**Staying awake while a board is open:** a Wi-Fi decoder goes quiet 15 minutes after its last passing, which would read as "idle" in front of a screen. So `watched: true` in an answer restarts that 15-minute window like a passing does: the decoder keeps its 10 s heartbeat while anyone watches, and goes quiet 15 minutes after the last viewer left. A board that was already quiet when the screen opened shows "idle" until its next batch, normally the next lap.

### The Bridge page

The page lists each decoder of the workspace as a card with a Cable row and a Wi-Fi row. Without this tab's cable the Wi-Fi row says what the server knows: "Reporting", "Idle" or "Not reporting since <time>", otherwise nothing is claimed. With a TinyLap decoder on this tab's cable the row comes from `%TLNET` instead: connected (with the signal as strong, fair or weak), joining, can't find the network, password refused, or not set up. **Change Wi-Fi** (for members who may pair decoders) works with three exchanges, all over the cable and none forwarded: `%TLSCAN&` fills the list of networks from `%TLAP` lines up to `%TLSCANEND`; `%TLJOIN` tries the chosen network for up to 20 s and answers `%TLJOINED`, keeping the settings only if the join worked (`%TLERR store&` instead of `%TLJOINED ok&` when it joined but could not save them); a failed try leaves the decoder on its old network. The password goes from the laptop straight to the decoder.

A decoder is on a cable for exactly as long as a Bridge tab holds its cable stream: `GET /<space>/decoders/<id>/cable` with `Accept: text/event-stream`, from the app's own pages, for members who may run timing (the address is `#bridge`'s `data-cable-stream`, with `{id}`). The bridge opens it once the decoder on its cable is ready (a TinyLap decoder said who it is; a plain ZRound decoder or an EasyLap was chosen), and closes it when the port closes, another device replaces it, or the page goes; a closed tab, a crash, a sleeping laptop or a lost network end it too, when the server notices the connection is gone (immediately for a closed tab or an unplug; a laptop that sleeps or loses its network takes about 20 s, as long as Fly's edge needs to drop it). A stream the server refuses (a restart) is opened again after 1 s, doubling up to 30 s. Both streams carry `?page=` with `#bridge`'s `data-page`, an id per render: the server counts one page's connections as one holder, and renders a page's cards without its own cable. Other pages then read "Connected on another laptop", and the live boards "reporting", at once and with no lap needed; when the last stream for it closes, both change at once. A decoder of another club, or none, is not found (404); a request from another site is forbidden (403); a page load on the address goes to the Bridge page. A page without a decoder on its cable holds `GET /<space>/bridge/events` instead, which holds no cable. Either stream sends `bridge` events whose data is `#bridge-decoders` as the server renders it for that page, whenever it changes, and the page swaps it in.

The whole API is described at `/openapi.json` and `/api` on any timing server.

## Drivers and transponders

A transponder is the number a decoder reports; a driver is a person who may have several. Laps count for a driver, so a transponder nobody has assigned gets none. Pages say "transponder 41" or "the number", never "code".

### Setup

- **Drivers** lists each driver with their transponders. One transponder sits beside the name; from two on, each is listed with its label. Every transponder has a quiet **Remove**, which sets it back to "Not assigned yet" and clears its label. **Edit** opens the driver's page; **Delete** is for those who may delete.
- **Add a transponder** (**Add another transponder** once the driver has one) opens a list of one row per number: first the ones "Not assigned yet", newest first, then "Someone else's", then "Not in the list? Enter its number". A row opens a small form, one row at a time: "Add 41 to Simon". From the driver's second transponder on it has an optional label, whose hint says what it tells apart ("Tells it apart from Simon's 17."). A row shows "Crossing now" for 10 seconds after the number crossed, and then "crossed 2 min ago". With no number in the club yet, the list says to run its car over the line.
- **Transponders** lists every number the club has seen: "Not assigned yet" first, newest first, with **Assign** (and **Assign all N** from two on); then "Assigned", with the driver and the label, and **Move**. **Forget**, for those who may delete, asks first, then takes a number off the list; its laps stay, and it shows up as new if it crosses again. Numbers show up here when a car first crosses the line.

### Assigning

**Assign** and **Move** open "Whose transponder is 41?": a button per driver ("Assign it to", each with their numbers), and "Or a new driver" with a name field and **Assign to a new driver**. While that number crosses the line the page says "It's on the track now." **Not now** goes back to where the form was opened from (`returnTo`, a path on the same site).

If the number is someone else's, the server asks before it moves it: "Transponder 17 is Simon's. Giving it to Mia takes it off Simon." with **Give it to Mia** and **Keep it with Simon**. The answer sends the same choice again with `confirm=1`. A refused form comes back as the same page, 422, with the input kept.

**New transponders** (`<space>/transponders/new`) collects every unassigned number on one page, newest first. Its subtitle counts the unassigned ones that have crossed the line, not those only typed in ("3 crossed the line and aren't assigned yet."). Each row shows the number, "Crossing now" while it crosses and "Crossed 2 min ago", then two forms: **Assign** to a driver chosen from the list, or **Add and assign** with a new driver's name. An assignment swaps the list in place and says "Transponder 41 is Lena's now. Change"; the move question is the row itself. Both pages keep "Crossing now" current from the club's live stream; an event older than 10 seconds, as a reconnect replays them, lights nothing.

### The driver's page

A driver's name, colour and, for each transponder, its label (up to 24 characters) and **Remove**. Under it, **Best laps here**: the driver's best on this track and direction, and, once two or more of their transponders have labels, the best of each labelled transponder with its label. A label counts only while the transponder is the driver's.

### On the board

While a session runs, a number that crossed in it and is not assigned gets a warning above the standings: "Transponder 41 isn't assigned yet, so its laps aren't counted." with **Assign it**; for several, "Transponders 41, 52 and 66 aren't assigned yet, so their laps aren't counted." with **Assign them**. One goes to its form and back to the board; several go to New transponders. The line lists numbers in numeric order, so it doesn't change while the same cars keep crossing, and it goes when the last one is assigned. Watchers and the big board never show it. Without a session, the idle board's start button is followed by a quiet line about the numbers that crossed in the last hour, with the same links.

**One mark per lap time**, the widest that is true: **TR** (the track record), then **FL** (the fastest lap of the session, in every kind of session, P1's in practice and qualifying), then **PB** (the driver's own best here). FL is the fastest of the laps the standings count (a tapped lap included, a lap marked "Not counted" not); on a tie the lap set first keeps it. A mark always follows its time. Last laps marks only TR and FL, FL only on the current fastest lap, in a column every row keeps so the times stay aligned. A session's page ends its facts with **Fastest lap**, the time and the driver, and marks that lap FL in its table and its driver's laps. TR and PB show only on the track and direction the record belongs to. The record holder's **crown** follows their name in the standings (not in a session's history); it keeps its place when the name is cut short.

**The record moment:** when a new track record comes in while a board is open, the record card plays a burst and its time bounces, and the crown flies from the old holder's name to the new one's. It plays once, on boards open at that moment, never on load and never with reduced motion; nothing it adds stays on the page.

**A row's moment:** when a lap sets a mark that plays (a new fastest lap of the session, a track record, or a personal best for a driver who already had one here from an earlier session), that driver's row in the standings lights up in the mark's colour: a rainbow head sweeps across it, the colour holds, then slides out. A record row's text turns white wherever the purple is under it. A newer fastest lap slides the older row out; while three rows are lit, a further PB doesn't light. It plays once, on boards open at that moment (the watchers' board too), never on load; with reduced motion the row takes the colour, holds and fades. Only a record rings the bell.

## Without hardware

Start the timing server (`apps/timing/README.md`, Development) with `TINYLAP_SIMULATE=<model>[,fast]`, where `<model>` is `tinylap`, `zround` or `easylap` (`,fast` makes a lap 2 s). The bridge's Connect buttons then open a simulated decoder of that kind, in place of the browser's picker. Never set it in production. The `tinylap` one behaves as the board does: four cars (codes `20` to `23`), already running when the port opens (no reset), and paired for good once paired, in this browser's storage. `tools/decoder-sim.js` plays a decoder on Wi-Fi, or on a serial pty; on Wi-Fi it sends `now`, a `stat` line every 10 s and a `quiet` batch as the board does, keeps beating while the answers say `watched`, and `--silent-after <s>` makes it stop posting, to see the banner.

To try a real decoder on the bench, `pnpm --filter @tinylap/timing-app bench` starts accounts and timing in one process, in memory, and opens Chrome signed in on the Bridge page; the server's log, `decoder-log` lines included, goes to stdout.
