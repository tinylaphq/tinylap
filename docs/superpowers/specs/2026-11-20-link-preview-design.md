# Link preview for the landing page

A link to the landing page shows a preview card in Teams, WhatsApp, Slack,
Signal, iMessage, LinkedIn and X. They all read Open Graph tags, and without
`og:image` most of them show nothing.

## How it works

- `apps/site/index.html` carries `og:type`, `og:site_name`, `og:title`
  ("TinyLap: lap timing for Mini-Z racing"), `og:description` (the page's
  description), `og:url`, `og:image` with its width, height and alt text, and
  `twitter:card` set to `summary_large_image`. The image and page URLs are
  absolute (`https://tinylaphq.github.io/tinylap/…`), because previews don't
  resolve relative ones.
- The card is 1200 × 630, the size every preview crops from. Apps crop it
  differently and not always around the middle (Teams to about 4:3, a little
  left of centre; WhatsApp to a square), so it is black edge to edge, with the
  mark and the headline in the middle and a strip of last laps along the bottom
  that runs off both edges. No crop can make it look off-centre. The name is
  left out: at thumbnail size it can't be read, and every app prints the title
  beside the image.
- `og:image` carries `?v=` with the card's version. Previews cache an image by
  its URL, so a new card gets the next number.
- `apps/site/share/card.html` is the card, laid out with the page's own palace,
  fonts and poster. `apps/site/share/render.js` builds the site into a temporary
  folder, opens the card there in Chrome at 3× and writes
  `apps/site/share.png`, which is committed. The card is laid out at 400 × 210,
  the size previews show it, so palace's own sizes and shadows apply. It is run
  by hand when the card changes.
- The build copies `share.png` into `dist/`. A test checks the tags, that the
  image is 1200 × 630, and that it stays under 300 KB, above which WhatsApp
  leaves it out.

## Approaches

- **A designed card rendered from HTML (chosen):** it says "TinyLap" at a
  glance and can be made again from the page's own styles.
- **The hero poster as it is:** no work, but it is cropped badly and carries no
  name.
- **The card with words left and board right:** calmer, but a square crop cuts
  the headline.
- **The headline on a black slab over the race board:** the board's edges show
  any off-centre crop, and the name on it was too small to read.
