# Bridge: reconnect on load

Leaving the Bridge page closes the decoder's serial port: the browser ties a port to the page. Coming back (the board and back again, a reload, the back button) the page shows the decoder as not connected until Connect decoder is clicked, although the browser would open the port without one. This makes the page open it on its own.

## Goals

1. **On load, the one permitted port opens by itself.** When this browser has exactly one serial port it may open without the picker (`navigator.serial.getPorts()`), with USB ids, and nothing is connecting, the page opens it as Connect decoder does after a reload, without a click.
2. **A busy port says so.** When that open fails because the port is open elsewhere (`NetworkError` or `InvalidStateError`, the port still listed), the page shows the server's busy message ("The decoder is open somewhere else: another tab, another browser or another app. Close it there, then connect again."), as for a click. Connect decoder stays.
3. **Anything else stays quiet**: no port, two or more ports, a port gone while it opened, any other error. Connect decoder is there as now.

## Non-goals

- Keeping the port open across page loads (the browser closes it).
- EasyLap (WebHID): its device lock differs; it stays click only.
- A port picked in another browser profile or by another site.

## Approaches

- **Open on load** (chosen): the trigger is new, the open, the states and the words are today's.
- Keep the page alive between Bridge and board (a frame or a popup): against "moving between pages is a normal page load", and the board would lose its own URL.

## Design

- `tl-bridge`'s start, after its first paint: when Web Serial is there and the page isn't connecting, `connect(run, 'load')`. `'load'` takes the one permitted port with USB ids, like `'again'` after a reload; with none, it returns quietly. It never opens the picker.
- On failure: busy (as above) goes through `fail()`, which shows `[data-bridge-busy]`; every other failure is dropped.
- The simulated Web Serial keeps its permitted ports across page loads, as Chrome does (in the page's `localStorage`), so tests can load the page with a permitted port.

## Left to the builder

- Tests: back from the board reconnects with no click; a busy port on load shows the busy message and Connect decoder; two permitted ports open nothing; no permitted port opens nothing and shows nothing.
