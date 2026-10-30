# Header switches: Sound as an icon, Notifications in the account menu

How TinyLap Timing's two record alerts are switched on. It refines the bell and
the browser notification of the sessions-and-records design (2026-10-29), whose
"Sound on" and "Notify me" header buttons this replaces.

## Sound

- An icon button in the navbar on the board, the big board and the watch link
  (`#sound-switch`). Its accessible name is "Sound" (`aria-label`), and a
  `title` shows on hover.
- The server draws the icon as inline SVG with all of its parts: the speaker,
  its waves and a strike. CSS shows the parts each state calls for:
  - off (`aria-pressed="false"`): the speaker in outline, struck through;
  - on (`aria-pressed="true"`): the speaker filled, with its waves, on the
    pressed button's light fill;
  - on but waiting for a gesture (`data-state="wanted"`): the speaker still
    struck through, since nothing plays yet, the amber border, and the amber
    lamp the live status uses, at the corner. The lamp blinks three times and
    then stays lit; with reduced motion it doesn't blink.
- The server renders both titles: `data-title` ("Sound") and
  `data-title-wanted` ("Tap to turn sound on"). `tl-board` only switches
  attributes, copying the one that fits into `title`.
- Everything else is unchanged: `localStorage['tinylap-sound']`, the
  AudioContext made from a gesture, and one ring per new `data-record-new`.

## Notifications

- A setting in a signed-in member's account menu, on every page but the big
  board: palace's menu setting, "Notifications" with a switch that shows on or
  off. The watch link has no
  account menu, so no setting; the big board leaves it out.
- The layout hands the markup to the shared `accountMenu` as `settings`, after
  Account and before Sign out. It is a `<tl-notify-setting>`, a
  `.navbar-menu-group` of its own under a rule, with a
  `button.navbar-menu-setting` (`aria-pressed`, accessible name
  "Notifications"; palace draws the switch from `aria-pressed`) and the text for a blocked browser: "Notifications blocked by the
  browser", with the hint "Allow them in this site's settings in the address
  bar, then reload." Both are server-rendered; CSS shows one by `data-state`.
- `tl-notify-setting` (`public/elements/notify-setting.js`) owns the setting:
  - in `connectedCallback`, where the browser has `Notification`, it reads
    `localStorage['tinylap-notify']`, shows its state and reveals itself; in
    `disconnectedCallback` it stops listening;
  - a click turns it on, calling `Notification.requestPermission()` from that
    click unless already granted, or off;
  - it is On only while wanted and granted; once the browser denies it, it
    shows `data-state="blocked"`, and the button gives way to the text. Denied
    from the click, focus moves to that text (`tabindex="-1"`), so it is read
    out and stays in the open menu;
  - it reads the permission and the remembered choice again on
    `visibilitychange`, and the choice on `storage`, so open tabs agree;
  - its `on` property tells whether notifications can show.
- `tl-board` keeps the trigger: a swap that brings a `data-record-new` it has
  not seen. It asks the setting its `notify` attribute names (by id) whether
  it is `on`, and raises "New track record" with the tag
  `tinylap-record-<seq>`, inside the same try/catch. Without the setting (big
  board, watch link) it never notifies. Pages without `tl-board` (Setup,
  Sessions) show the setting, so it can be turned on anywhere; only a board
  notifies.
- A setting toggles in place: `tl-menu` closes the menu after an in-page
  button, except one with `aria-pressed`, so the new state stays in view.
- The navbar is positioned above the page (`position: relative; z-index: 10`
  in `@tinylap/design`), so the menu opens over the board's own positioned
  content.
