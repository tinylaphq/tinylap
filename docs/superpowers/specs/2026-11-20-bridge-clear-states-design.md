# Bridge: clear states on the cable

The Bridge page and the board's start card say things that aren't true, or say nothing, in five cases met on the bench with a TinyLap decoder. This makes each one say what is going on, in the server's words. Wi-Fi is the normal way a decoder reports; the cable is for pairing, Wi-Fi setup and the bench.

## Goals

1. **A decoder this server doesn't know shows at once.** Today the page finds out only when a POST of passings or log lines answers 404, about 10 s after connecting with no car crossing. The cable stream is asked for within a second and already knows.
2. **A port that won't open says why.** Today the page shows the browser's own text ("Failed to execute 'open' on 'SerialPort': Failed to open serial port."). The usual cause is the port being open in another tab, another browser or another app.
3. **The empty card doesn't contradict the cable.** While this tab has a device on its cable that has no card yet (connecting, listening, unpaired, unknown, choose), the "No decoder yet" card with a disabled Connect decoder stays on screen above the state that explains it.
4. **The leave prompt asks only when leaving stops timing, and the page says so first.** Today it asks whenever a decoder is ready on the cable, Wi-Fi or not, and nothing on the page explains the browser's prompt.
5. **The start card offers Connect the decoder only when no decoder reports.** Today it offers it whenever there are no drivers.

## Non-goals

- A second Bridge tab mirroring the tab that holds the cable.
- Keeping the cable across page loads in one tab (reconnecting on every page).
- Opening the Bridge page's links in a new tab.
- Changing the browser's leave dialog; its words are the browser's.

## Constraints

- The server decides state and wording (AGENTS.md): every sentence below is rendered by the server, hidden until the client shows it. The client only reports what its cable says.
- Palace-ui and `@tinylap/design` classes only: `.status-*`, `.card-static`, the decoder card's rows.
- EventSource can't read a status code, so the cable stream can't signal "unknown" with a 404 the page can see.

## Approaches

For goal 1:
- **A. The cable stream answers an unknown decoder with an event, not a 404** (chosen). For a decoder that isn't in this space, `GET <space>/decoders/<id>/cable` with `Accept: text/event-stream` answers 200 with one `event: unknown`, `data:` empty and a long `retry:`, as signed-out does today. The page sets the bridge to `unknown` and closes the stream. The server stays the one that knows, and the page knows within a round trip.
- B. The page asks `GET <space>/decoders` on every `%TLID` and compares. One more request per connect, and the page decides from a list, which is the client deciding.
- C. Shorten the log flush. Still late, and still depends on a POST failing.

For goals 2–5 there is one sensible way each: hidden server-rendered text that the page shows on a fact only it has (the open failed; the cable has a device; the decoder's `%TLNET` state), and the server's own snapshot for the start card.

## Design

1. **Unknown at once.** As approach A. A page with a 404 from a POST keeps going to `unknown` too (the logs-only 404 fix stays). The unknown section is unchanged: "This decoder's pairing isn't known here…" with Pair again.
2. **Port busy.** `#bridge` gets a hidden `p.status.status-error[data-bridge-busy]`: "The decoder is open somewhere else: another tab, another browser or another app. Close it there, then connect again." When `port.open()` rejects (a `NetworkError` or `InvalidStateError`), the page shows it instead of the raw message, in the error slot's place, announced the same way. Connect decoder is enabled again at once.
3. **Empty card.** While this tab's cable has a device and no card for it, `#decoder-none` is hidden; the state section below it (Talking to the decoder…, Pair this decoder, pairing isn't known here, Which decoder is this?) is the one thing on screen. It shows again when the cable has no device.
4. **Leave prompt.** The page guards leaving only while the decoder on its cable is ready and its last `%TLNET` isn't `connected`, or it isn't a TinyLap decoder (a ZRound or EasyLap has no Wi-Fi). Then the Cable row's help says, server-rendered and hidden otherwise: "Laps reach TinyLap only through this tab. Leaving this page stops them; set up Wi-Fi to time without it." With Wi-Fi connected the row says nothing new and leaving isn't guarded. "Keep this tab open while racing" under the cards goes: the row says it where it's true.
5. **Start card.** `firstSteps` shows Connect the decoder only when the snapshot's decoders (the board header's list) has none `reporting` or `idle`. Add drivers stays. The start region is re-rendered by the board stream as today, so the button comes and goes with the decoder.

## Left to the builder

- The exact errors `port.open()` rejects with for a busy port in Chrome and Arc on macOS; any other rejection keeps showing its message.
- Where the leave note sits in the Cable row's markup, within the row's one-help-line rule.
- Tests: the cable stream's unknown event (server), the busy message and enabled button, the hidden empty card, the guard with and without `connected`, the start card with and without a reporting decoder.
