# The live TV fits eight drivers: design

The live board on the wall screen (`?big`, 1920×1080) fits a session with eight drivers: the strip, the title and clock, the standings with all eight rows, and Last laps' eleven newest, all inside 1080. Eight is as many cars as a club night runs at once; a larger field still works, with the page scrolling.

## How it fits

- **The type keeps its size.** Every size on the TV follows `--board-font` (about 39px at 1080), and the standings' names, positions and times stay at it, so they read from across a room.
- **The rows give up their air.** On the live board the standings' cells take `0.2` of the board's font above and below (it was `0.6`), and their lines are `1.15` tall. A row is about 72px, the table's head about 57px. The idle TV (the result) keeps its own spacing.
- **A driver who has stopped keeps one line.** "last lap 3 min ago" follows the name on the same line, in its quieter type, instead of taking a second line under it. The name comes first: what it leaves goes to the line, which fades out where the column ends. A row is the same height whether its driver is lapping or not, so a practice where half the field has pulled in still fits.

## Tests

`big-fits.test.js` checks a practice, a race and a qualifying with eight drivers at 1920×1080: the board, the standings and Last laps end inside 1080, Last laps shows eleven whole rows, every standings row is one line, and all of it still holds while a record falls and while six of the eight have stopped.
