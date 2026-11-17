# The strip: the fill is the mark: design

The strip at the top of every board, as one system: every cell has the same anatomy in every state, the fill names the kind of time, and a driver's colour always sits on white. Last laps opens with the standings' header. It refines the strip of the board hub design (§3).

## The cell

**One anatomy.** Every cell, in every state, has three rows of fixed height:

```
| LABEL                 |  Track record · New track record · Fastest lap
| 7.070                 |  the time, or "None yet" / "No laps yet" on the time's line
| [■ Ana]  17 Nov       |  one driver on a nameplate, then one piece of context
```

The context is the record's date, "Beat 7.070" while a record has just fallen, or "The first lap sets it." with no record yet; the fastest lap has none. A change of state swaps the content in place and adds no row, so the strip is the same height idle, running and while a record falls.

**The fill is the mark.** The record cell is filled `--tl-record` and the fastest lap cell `--tl-fastest`, with their ink on the fill. The fill already says what the time is, so the cell carries no crown and no TR or FL mark. The crown stays a mark a name wears in a list (the standings, the results).

**The nameplate.** The driver sits on a small white plate with a thin ink border and `--p-shadow-xs`, inset in the fill. A driver's square is always on white with its ink outline, as in every table. On the fill sit only the label, the time and the context.

**One driver per cell.** A fallen record's context is "Beat 7.070", without the holder it beat: that is history, on the session's page.

**Reading order.** The time is the largest thing (mono 700, `--p-text-3xl`; `1.9em` of the strip on the TV), then who, then the label, then the context.

## Layout

- Every cell is one right column wide (`--strip-cell`, worked out from the board's own width as a container), and the record cell always sits over the right column: the Start panel when idle, Last laps while a session runs.
- While a session runs, the fastest lap cell joins on the record's left at the same width, taking its room from where you are. Neither figure shrinks when a session starts.
- On the TV the cell is 27% of the board, idle and live, so it stays put when a race starts.
- On a phone the strip has two rows: where you are, then the cells side by side, so it is as tall live as idle. A long name is cut with an ellipsis before the context is.
- No record yet: the cell keeps its place, unfilled ("None yet", "The first lap sets it.").

## A record falls

For the 30 seconds the server shows a new record the cell's words change: the label reads "New track record" and the context "Beat 7.070" where the date was. The nameplate stays. The new time bounces once as it lands (scale 1, 1.2, 0.95, 1.06, 1 over about 0.9 s, after 0.8 s); with reduced motion it doesn't. Nothing else plays on the cell: no tag, sweep, burst or edge. After 30 seconds the server's swap brings back "Track record" and the date.

Elsewhere the moment is unchanged: the standings row lights for TR, FL and PB with its rainbow head, and the crown jumps from the old holder's row to the new one's.

## Last laps gets the standings' header

On the live board Last laps opens with the standings' black head bar in place of its grey title row: the same height (the head's line, `--cell-y` above and below, a thin rule), so both panels open on one line. It holds "Last laps" in the head's type (0.7 of the board's type, caps) and no column labels. On a phone, where Last laps sits under the table, it takes the same bar. On the TV the bar is taller than the old title row; the feed gives back its bottom padding.

## Tests

- `strip.test.js`: the strip keeps its height across idle, running and a record falling, at every size; no crown and no mark in a cell; every driver square in the strip sits on white; the record cell over the right column, the fastest lap on its left at the same width; on a phone the cells side by side.
- `record-moment.test.js`: a falling record bounces the new time and adds nothing to the cell; the crown still jumps.
- `big-fits.test.js`: the TV still fits eight drivers.
- Last laps' head bar is as tall as the standings' head, at every size.
