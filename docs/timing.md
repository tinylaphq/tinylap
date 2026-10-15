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
| decoder → PC | `%TLID <decoder id or -> <boot>&` | `-` while unpaired |
| PC → decoder | `%TLPAIR <decoder id> <token>&` | store the id and the 43-character token; answer `%TLOK&` |
| PC → decoder | `%TLWIFI <base64url ssid> <base64url password>&` | store Wi-Fi; answer `%TLOK&` |
| decoder → PC | `%TLOK&`, `%TLERR <text>&` | done, or why not |

## Over Wi-Fi: the ingest API

    POST /decoders/<decoder id>/passings
    Authorization: Bearer <token>
    Content-Type: application/json

    { "boot": "x7Qm2LbV0aE", "passings": [{ "transponder": "4A1F", "t": 81234 }] }

At most 500 passings per batch, all of one boot. The answer is `{ "stored", "duplicates", "through" }`: `through` is the highest `t` of this boot the server holds. Keep every passing in an outbox until a `through` covers it; resending is always safe. `401` means the token is wrong or the decoder was unpaired: keep the outbox and stop sending until it is paired again. `429` comes with `Retry-After`. The whole API is described at `/openapi.json` and `/api` on any timing server.
