# The TV's decoder warning lives in the strip: design

When a Wi-Fi decoder stops reporting, a laptop board shows its line in the strip ("Start line: not reporting") and, under the strip, a yellow banner: "Start line isn't reporting. Laps will appear once it's back." On the wall screen (`?big`, 1920×1080) that banner was in laptop type, hard to read across a room, and its extra row pushed the idle board with eight drivers past 1080.

## How it works

- **On the TV the strip says it, and there is no banner.** The decoder's own line in the strip's where-cell becomes the warning: the full sentence on a plate in palace's warning yellow, with the thin ink border and small shadow of the strip's nameplates. Like the strip's cells, the fill is the mark, so the plate has no square before it. It is a polite live region, as the banner was.
- **It reads at TV size and costs no row.** The plate is in the strip's type, which follows `--board-font`, and it takes the place of the decoder line it replaces. The strip keeps its height, so the idle and the live TV fit 1080 with the warning shown.
- **It stays on one line.** On the TV the decoders don't wrap. A second warning, or a long decoder name, is cut with an ellipsis, so each decoder's name is the part that shows.
- **Everything else is unchanged.** Laptops and the watchers' board keep the banner and the red "not reporting" line. A decoder whose cable went, which has no banner on a laptop, keeps its plain line on the TV too.

## Tests

`big-fits.test.js` checks the idle TV with eight drivers, a live practice, and a practice with two quiet decoders. In each it checks that the warning shows only in the strip, at 22px or more, on one line, that the strip is no taller, and that the board ends inside 1080. `board-pages.test.js` checks that the TV's markup has the plate and no banner, and that the laptop and watchers' boards keep the banner.
