# Link preview for the landing page

A link to the landing page shows a preview card in Teams, WhatsApp, Slack,
Signal, iMessage, LinkedIn and X. They all read Open Graph tags, and without
`og:image` most of them show nothing.

## How it works

- `apps/site/index.html` carries `og:type`, `og:site_name`, `og:title`
  ("TinyLap: live lap timing for Mini-Z"), `og:description` (the page's
  description), `og:url`, `og:image` with its width, height and alt text, and
  `twitter:card` set to `summary_large_image`. The image and page URLs are
  absolute (`https://tinylaphq.github.io/tinylap/…`), because previews don't
  resolve relative ones.
- The card is 1200 × 630, the size every preview crops from. The race board
  (the hero's poster) fills it, and the mark, the name and the headline sit on
  a black slab in the middle with a purple offset shadow, inside the centre
  630 px, so WhatsApp's square crop keeps them whole.
- `apps/site/share/card.html` is the card, laid out with the page's own palace,
  fonts and poster. `apps/site/share/render.js` builds the site into a temporary
  folder, opens the card there in Chrome and writes `apps/site/share.png`,
  which is committed. It is run by hand when the card or the poster changes;
  the card hides the recording's pointer dot on this poster's last-laps list,
  so a new poster needs that patch checked.
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
