# A decoder's Wi-Fi in development

A decoder paired with a dev timing server posts its passings over Wi-Fi to the address the server gave it. Dev timing used to give it `http://localhost:8100` unless `TINYLAP_DECODER_URL` was set, and on the decoder `localhost` is the decoder itself: its Wi-Fi posts failed, the board said "Not reporting" as soon as the bridge tab closed, and the Bridge's advice ("Pair it again to give it this one") couldn't help. Paths are relative to the repository root.

## Goals

- In dev, a paired decoder's Wi-Fi reaches timing without any extra setting.
- Wherever a decoder can't reach the server over Wi-Fi because the server's address is loopback, the Bridge says so, and doesn't offer a fix that can't work.

## Non-goals

- Production: it keeps `TINYLAP_PUBLIC_URL`, or `TINYLAP_DECODER_URL` when set, as today.
- A fixed port for the bench (`pnpm --filter @tinylap/timing-app bench`): it stays on `127.0.0.1` with a random port and works over the cable only. Part 2 explains that on the Bridge.
- `.local` hostnames as the default. The decoder resolves them (its lwIP build sends mDNS queries for `.local`), and `TINYLAP_DECODER_URL=http://<name>.local:<port>` works, but as a default they'd need a lookup at start-up with a fallback for machines without an mDNS responder, to save only the occasional pairing again after a network change.
- The Mac's address changing between networks: the decoder then reports the existing `unreachable` fault, and pairing again gives it the new address.

## Approaches

- **Dev defaults to the network address (chosen).** Nothing to remember; the cost is that dev timing is reachable from the local network, behind sign-in.
- **A flag or a `dev:timing:wifi` script.** Keeps dev on this machine, but a setting you have to remember is the problem being fixed.
- **Only a Bridge warning.** Explains the failure without removing it.

## 1. Dev timing gives decoders this machine's network address

- With `--dev` and no `TINYLAP_DECODER_URL`, `apps/timing/server/main.js` takes the first IPv4 address from `os.networkInterfaces()` that isn't internal, and passes `http://<address>:<port>` to `createHandler` as `decoderUrl`. The server listens on `0.0.0.0`.
- The start-up line names it: `decoders post to http://<address>:<port>`.
- With no such address (no network), dev stays on `127.0.0.1` with no `decoderUrl`, and the start-up line says Wi-Fi decoders can't reach it.
- `TINYLAP_DECODER_URL` still overrides the chosen address, in dev and in production.
- `apps/timing/README.md` (Development) drops the step of setting `TINYLAP_DECODER_URL` by hand, and says that dev timing listens on the local network.

## 2. The Bridge says when the address is loopback

The address a decoder gets on the Bridge is `request.decoderUrl ?? request.origin` (`apps/timing/server/views/bridge.js`). When its host is `localhost`, `127.0.0.0/8` or `[::1]`:

- The `unreachable` fault keeps its words ("Its laps don't get through"), but its explanation names the address: it has "localhost" as TinyLap's address, which on a decoder means the decoder itself, and for Wi-Fi TinyLap needs this computer's address on the network. It doesn't offer Pair again as the fix, since pairing again would give it the same address.
- The final wording goes through the UX review before it is built.

## Left to the builder

- Where the address picking lives (a small function next to `main.js`, unit-tested with a fake interface list).
- The exact log wording.
- Tests: the address picking (an address found, only internal ones, none); the Bridge with a loopback address and with a network one.
