# Personal best marks

A personal best beats an earlier best. A driver's first time on a track and direction sets none, so a club's first night, or a public race full of guests, shows no PB on every row.

## The rule

- A lap is marked **PB** when it is the driver's best on this track and direction and the driver had a best there before the session it was driven in (any session kind, as personal bests count).
- TR, then FL, then PB stays the order: a lap shows the widest mark that is true.
- The PB moment already follows this rule: it plays only when a lap beats a best from an earlier session.

## Where it applies

- **The live board's standings:** the snapshot gives the board who had a best before the running session (`hadBest`, the board's views only). The API's `bests` stays every driver's personal best.
- **A result** (the session page, and the idle board's last result): PB marks and the practice's personal-best cards come from each driver's best before the session (`bestsBefore`). There is no "First time on this track" card any more.
- **The sessions list:** a session's best lap is PB only when its driver had a best before that session.

## The car on the track

The board's line about a car crossing with no session running ("Transponder 15 is on the track") says whose car it is as soon as its transponder is assigned ("Jo is on the track"), without waiting for the car to cross again.
