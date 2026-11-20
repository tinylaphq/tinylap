# Landing page

A public page for TinyLap as an open-source project, served by GitHub Pages
from the repository. It says what TinyLap Timing is, what hardware it needs,
and that the Planner exists, and sends people to the repository's own docs to
set things up.

## Who it is for

Mini-Z drivers who time laps on a track at home, and clubs that look for a
timing system or think about swapping theirs. Some will build their own
decoder and transponders; others already own a decoder.

## Goals

- Timing is the product. The Planner gets one smaller block at the end.
- A visitor learns in one screen what Timing does: every lap on the laptop,
  the phones in the pits and the TV on the wall, with personal bests and track
  records as they happen.
- The hardware question gets a plain answer: build a decoder and transponders
  and run our firmware, or bring a decoder you already have.
- The tone is good, easy, modern, and it just works.

## Non-goals and anti-goals

- No link to, or promotion of, the hosted instances on Fly. Those are one
  club's installation, not the project.
- No sales tone, no comparisons with other systems, no pricing.
- EasyLap is named, never linked or promoted: it is one decoder you can bring.
- No build instructions at soldering level; the steps stay at "build a
  decoder, mount the receivers, install transponders, flash the firmware".
- No selling points that are true of every web app ("runs in the browser"),
  and no self-hosting detail on the page itself.
- GitHub appears once, in the header.

## The page

One page, `index.html`, on palace-ui plus `@tinylap/design`: palace's 2px
lines, hard offset shadows and accents, Space Grotesk and JetBrains Mono. The
content column is 1120 px on a 12-column grid and folds to one column on a
phone, with a 16 px gutter and no horizontal scroll.

1. **Header:** the TinyLap mark and name; a GitHub button
   (https://github.com/tinylaphq/tinylap).
2. **Hero, split:**
   - Left, columns 1–5: the headline "Live lap timing for Mini-Z" in palace's
     pink-to-cyan display treatment; "Every lap shows up on the laptop, the
     phones in the pits and the TV on the wall, with personal bests and track
     records as they happen."; "On a track at home, or as your club's timing
     system."; a primary "Set up Timing" button.
   - Right, columns 6–12: the Timing walkthrough video in a palace frame with
     a pink offset shadow (see Motion).
3. **Build it, or bring yours:** "Timing reads a transponder in each car as it
   passes a decoder at the finish line. Build both yourself, or bring the
   decoder you already have: an EasyLap, or any decoder that speaks ZRound."
   Beside it, an inline SVG of the finish-line bridge: the ESP32 decoder at the
   left post, four receivers in funnels about 30 cm up, a car with its
   transponder underneath, labelled "Decoder / ESP32", "Receivers / 4, in
   funnels", "Transponder / in each car".
4. **The two ways**, two rows of one static card:
   - **Build your own:** "A decoder at the finish line and a transponder in
     each car, running our firmware." A `<details>` with the summary "How it
     goes" opens, animated in CSS, to four numbered steps:
     1. **Build the decoder.** An ESP32 board with four infrared receivers.
     2. **Mount the receivers** on a bridge over the finish line, about 30 cm
        up.
     3. **Install a transponder** in each car.
     4. **Flash our firmware** onto the decoder and the transponders. The
        decoder then sends laps over Wi-Fi.

     Then links to the decoder firmware and the transponder firmware.
   - **Bring your system:** "An EasyLap, or any decoder that speaks ZRound,
     plugs into the laptop over USB and keeps its own transponders." A
     "Connecting a decoder" link.
5. **Planner:** the Planner video on the left (columns 1–7, cyan offset
   shadow); on the right "Planner", "Design a Grand Prix Circuit 30 track on its
   300 mm mats, from straights and R30 and R60 corners.", "It counts the pieces
   as you go, says what your boxes are short of, and downloads the track as one
   file.", and an outline "Set up Planner" button.
6. **Footer:** "Apps under AGPL-3.0, libraries under MPL-2.0. Contributions
   welcome."

### Links

Every link goes into the repository on GitHub, at its default branch:

| On the page | Goes to |
|---|---|
| GitHub | the repository |
| Set up Timing | `README.md#timing` (under Self-hosting) |
| Connecting a decoder | `docs/timing.md` |
| Decoder firmware | `firmware/tinylap-decoder/README.md` |
| Transponder firmware | `firmware/tinylap-transponder/README.md` |
| Set up Planner | `README.md#planner` (under Self-hosting) |

### Motion

Only one thing moves on its own, so a big screen stays calm.

- **Hero:** the Timing walkthrough as an mp4, silent and looping, with the race
  board still as its poster. `tl-autoplay`, a custom element in its own module,
  wraps the server-written `<video controls>`. It removes the native controls,
  adds one square pause/play button in the frame's bottom-right corner (palace's
  small control size, `aria-pressed`, "Play animation" as its label), and starts
  the video unless `prefers-reduced-motion: reduce`. Without script the video
  keeps the browser's controls and starts on click. Anything that moves for
  more than 5 seconds can be paused (WCAG 2.2.2).
- **Planner:** an mp4 with the finished track as its poster, the browser's own
  controls, `preload="none"`. It plays only when asked.
- The `<details>` opening uses `::details-content` with
  `interpolate-size: allow-keywords`, and is instant under reduced motion.

## Recordings

Both films are recorded from the real apps by scripts in their test folders,
so a UI change can be filmed again:

- Timing: `apps/timing/test/layout/record-walkthrough.js` (exists).
- Planner: `apps/track-planner/test/layout/record-walkthrough.js` (new, same
  shape): lays a closed circuit, the materials panel runs short of large
  corners, a Large Corner box is added under Edit kits, and the panel says
  everything is in stock.

`make-walkthrough-gif.sh` also writes an mp4 (H.264, `+faststart`) next to the
GIF from the same cuts. The README keeps the GIF, because GitHub doesn't play
a video from the repository inside a README. The landing page uses the mp4s,
which are about a fifth of the GIF's size. The posters are single frames: the
race board for Timing, the finished track for the Planner.

The recordings are made by hand, like the README's GIF today, and committed
beside it in `docs/`: `walkthrough.gif`, `walkthrough.mp4`,
`walkthrough-poster.png`, `planner.mp4`, `planner-poster.png`. They fall
under `docs/**`'s CC-BY-SA-4.0 in `REUSE.toml`. CI never records; the site
build only copies them.

## Build and deploy

- A workspace package `apps/site` holds `index.html`, the `tl-autoplay` module,
  a build script and its tests. The build writes `dist/`: the page, palace's
  CSS and fonts, `design.css`, `mark.svg`, the two mp4s and the two posters,
  all relative paths, so the page works under `/<repo>/`.
- Tests: every repository link names a file that exists (and the README
  anchors exist), no link points at `*.fly.dev`, every asset the page loads is
  in `dist/`, and nothing is loaded from another origin.
- It has the repository's `test`, `lint` and `typecheck` scripts, so `pnpm
  check` covers it.
- CI gets a `pages` job after `check` on pushes to main, using
  `actions/upload-pages-artifact` and `actions/deploy-pages`, with the
  `pages: write` and `id-token: write` permissions. It rebuilds the site on
  every green push to main; it is cheap.
- The URL is GitHub's default, `tinylaphq.github.io/tinylap`. Pages must be
  switched on once, with "GitHub Actions" as its source.

## Approaches

- **A static package built by CI (chosen).** The page lives in the workspace,
  takes palace and the design tokens from the packages that already exist, is
  checked like everything else, and deploys with the rest of main.
- **A static folder served straight from a branch.** No build, but palace's
  CSS and fonts would be copied by hand and drift from the package, and
  nothing checks the links.
- **Rendering the page from one of the apps' servers.** It would bring the page
  back onto the hosted instances the page must not promote.

## Left to the builder

- The page's exact CSS, carried over from the approved mockup (version 14
  of the brainstorm mockups, which is ported into `apps/site/index.html`; the
  mockup itself is not committed).
- How the build finds palace's files (through `@tinylap/design`'s dependency).
- The poster frames' exact timestamps.
