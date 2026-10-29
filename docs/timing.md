# Timing: passings, the ingest API and the ZRound extension

This is what a decoder needs to talk to TinyLap Timing. The design is in `docs/superpowers/specs/2026-10-15-timing-core-design.md`.

## A passing

`{ decoder, boot, transponder, t }`: the decoder's id (from pairing); a boot id, 8 to 32 base64url characters, chosen at random at every power-up **and** whenever the clock is reset (ZRound's `%I&`); the transponder code, upper-case hex; and `t`, whole milliseconds on the decoder's clock since that boot. The decoder stamps the time itself, so network delay never changes a lap.

The four together are the passing's key. Send the same passing over USB and over Wi-Fi and the server keeps one.

## Over USB: ZRound, plus four TinyLap commands

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

The bridge opens the port, waits 1.5 s (opening it resets Arduino-based decoders), and sends `%C&` every 500 ms until something in ZRound comes back, for up to 6 s. With no answer by then it is listening: it sends `%C&`, then `%TLHELLO&`, every 2 s, until 60 s after opening. Once something in ZRound comes back, it sends `%TLHELLO&`, 300 ms after its last write, up to three times 700 ms apart. A `%TLID` makes it a TinyLap decoder for the rest of the connection. Every command is a multiple of 3 bytes, so firmware that reads 3 bytes at a time (RiCino) still sees each one whole.

After a break, framing, parity or overrun error on the port, the bridge reads on, and drops the message the error cut. Any other error, a lost device, or 20 errors in a row with no data between them, ends the connection.

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

## Membership notices

Timing takes membership notices from accounts at `POST /notices/membership`,
so a removed member's open streams end at once rather than with their next
token. Set `TINYLAP_NOTICE_TOKEN` on timing and the same value as `noticeToken`
(with `noticeUri`: `https://<timing>/notices/membership`) in timing's entry
in accounts' `TINYLAP_CLIENTS`; see `docs/identity.md`. The route answers 204,
401 for a wrong or missing bearer, 422 for a bad body, and 404 while
`TINYLAP_NOTICE_TOKEN` is unset. A notice ends nothing by itself: timing
re-reads the users' claims and ends only the streams they no longer allow.

## Without hardware

Start the timing server with `TINYLAP_SIMULATE=<model>[,fast]`, where `<model>` is `tinylap`, `zround` or `easylap` (`,fast` makes a lap 2 s). The bridge's Connect buttons then open a simulated decoder of that kind, in place of the browser's picker. Never set it in production.

## Over Wi-Fi: the ingest API

    POST /decoders/<decoder id>/passings
    Authorization: Bearer <token>
    Content-Type: application/json

    { "boot": "x7Qm2LbV0aE", "passings": [{ "transponder": "4A1F", "t": 81234 }] }

A batch may also carry `"logs": ["pass id=1F t=1E0A first=1DE2 last=1E32 frames=8"]`: decoder log lines, each the text after `%TLLOG ` and before `&`. `passings` may then be empty; a body with neither is refused. At most 500 passings and 64 log lines per batch, the lines together at most 32 KiB and each at most 510 bytes. All of one boot. The answer is `{ "stored", "duplicates", "through" }`: `through` is the highest `t` of this boot the server holds. Keep every passing in an outbox until a batch that carried it is answered with a `through` that covers it; drop only the passings you sent, since a passing of the same boot you never sent can lie below `through` too (the cable and Wi-Fi copies race). Resending is always safe. `401` means the token is wrong or the decoder was unpaired: keep the outbox and stop sending until it is paired again. `429` comes with `Retry-After`.

From the bridge, the same route takes the member's session instead of a token, from the app's own pages. There `401` means signed out and `403` means no access to the decoder's club (or a request from another site): keep those passings, since a new sign-in or another member can send them, and go on with the other decoders after a `403`. `404` means the decoder was removed or never paired, and `422` a batch the server cannot read: drop those passings, they will never be taken.

The server writes the log lines to its log and stores none. A bad line is skipped, not refused, so a log line never costs a passing; a `422` for `logs` comes only when it is not an array of strings or breaks the limits above. A batch of logs alone stores nothing, but it counts as the decoder being in use.

The whole API is described at `/openapi.json` and `/api` on any timing server.
