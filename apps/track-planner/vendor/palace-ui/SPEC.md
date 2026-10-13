# Palace UI — Design Specification

> AI-first design spec. When building UIs for projects that use Palace UI,
> follow this document exactly. Include `palace.css` and write HTML using
> these classes. Do not invent new patterns — use what's here.

## Philosophy

- **Retro-technical.** Hard edges (border-radius: 0 everywhere), thick 2px borders, chunky offset box-shadows. Gradients on text, thin decorative stripes (≤3px), and narrow fixed bars (e.g. sticky CTAs) only — never on large surfaces or card backgrounds.
- **Three-color accent system.** Hot pink `#ff2d9b`, electric purple `#5b4cff`, cyan `#00e5ff`. These rotate across card lists and provide visual rhythm.
- **Snappy interactions.** All transitions are `0.1s`. Hovers lift elements up-left and cast a hard shadow down-right. Fast, mechanical feedback.
- **Uppercase everything.** All headings, labels, buttons, and status text are `text-transform: uppercase` with tracked letter-spacing. Body text is the exception.
- **Dark on light.** `#0a0a0a` text on `#f0f0f0` background. Cards are white `#fff`. Code blocks invert to dark `#0a0a0a` backgrounds.
- **No border radius.** Ever. `border-radius: 0` is the rule, not the exception.
- **Content-width containers.** Max-width `640px` for main content, `420px` for auth/narrow forms.

## Setup

### Fonts

Include these Google Fonts in every page `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
```

Only include JetBrains Mono if the page has code blocks. Otherwise just Space Grotesk:

```html
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet">
```

### Stylesheet

```html
<link rel="stylesheet" href="/vendor/palace-ui/palace.css">
```

Or if consuming via npm with a build tool:

```css
@import 'palace-ui/palace.css';
```

## Token Reference

### Colors

| Token | Value | Usage |
|---|---|---|
| `--p-accent-1` | `#ff2d9b` | Primary action, CTA buttons, first card in rotation |
| `--p-accent-2` | `#5b4cff` | Secondary action, links, input focus, second card |
| `--p-accent-3` | `#00e5ff` | Tertiary accent, navbar user, code highlights, third card |
| `--p-text` | `#0a0a0a` | Body text, borders |
| `--p-text-secondary` | `#444` | Body copy in cards, descriptions |
| `--p-text-muted` | `#666` | Subtitles, labels |
| `--p-text-faint` | `#6b6b6b` | Table headers, brand labels, meta text |
| `--p-bg` | `#f0f0f0` | Page background |
| `--p-surface` | `#fff` | Card/container backgrounds |
| `--p-surface-inset` | `#f7f7f7` | Inset/recessed surfaces |
| `--p-dark` | `#0a0a0a` | Dark backgrounds (navbar, code, hover fills) |
| `--p-error` | `#ff4444` | Error states, danger zones |
| `--p-success` | `#00ff88` | Success states |
| `--p-warning` | `#ffcc00` | Warning states |
| `--p-info` | `var(--p-accent-3)` | Informational states (semantic alias for cyan) |
| `--p-overlay` | `rgba(10, 10, 10, 0.7)` | Overlay/backdrop for dialogs |
| `--p-hover-bg` | `#e8e8e8` | Subtle hover background for rows/lists |
| `--p-code-bg` | `#1a1a2e` | Inline code background on dark surfaces |
| `--p-code-highlight` | `#00ff88` | Highlighted code text (values, keys) |

### Typography

| Token | Value |
|---|---|
| `--p-font` | `'Space Grotesk', system-ui, sans-serif` |
| `--p-font-mono` | `'JetBrains Mono', monospace` |

### Spacing

| Token | Value | Usage |
|---|---|---|
| `--p-space-xs` | `4px` | Tight gaps |
| `--p-space-sm` | `8px` | Button gaps, small margins |
| `--p-space-md` | `16px` | Card margins, standard padding |
| `--p-space-lg` | `24px` | Card padding, section spacing |
| `--p-space-xl` | `32px` | Intermediate section gaps |
| `--p-space-2xl` | `48px` | Hero padding, major section gaps |

### Spacing Rules

Three mechanisms for spacing, each with a clear use case:

1. **`margin-bottom`** — spacing between sibling elements. All vertical inter-element spacing uses `margin-bottom` only (single-direction margins). Elements push the next sibling down; never pull themselves away with `margin-top`. This keeps spacing predictable, portable, and avoids margin-collapsing surprises.

2. **`gap`** — spacing inside flex/grid containers. Preferred when the parent is `display: flex` or `display: grid`. No margin needed on children.

3. **`.stack-*`** — spacing between children of a non-flex/grid container. Apply to the parent; children get uniform vertical spacing via the owl selector (`> * + *`). Available sizes: `stack-xs` (4px), `stack-sm` (8px), `stack-md` (16px), `stack-lg` (24px), `stack-xl` (32px), `stack-2xl` (48px).

**Never** use `padding` to create distance between sibling elements — padding is for internal space within an element.

**Exceptions:** dividers (`.divider`, `.divider-danger`, `.gradient-stripe`) use top+bottom margin because they are structural separators by nature. Tight optical adjustments inside components (e.g. `.stat-label` 2px nudge) are exempt.

### Layout

| Token | Value |
|---|---|
| `--p-container-width` | `640px` |
| `--p-container-narrow` | `420px` |
| `--p-navbar-height` | `52px` |

## Component Catalog

### Page Shell

Every page follows this structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Page Title</title>
  <!-- fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet">
  <!-- palace -->
  <link rel="stylesheet" href="/vendor/palace-ui/palace.css">
</head>
<body>
  <!-- optional navbar -->
  <!-- content -->
</body>
</html>
```

### Navbar

```html
<nav class="navbar">
  <a href="/" class="navbar-brand">App Name</a>
  <div class="navbar-right">
    <span class="navbar-user">Username</span>
    <button class="btn btn-sm">Log Out</button>
  </div>
</nav>
```

With an icon beside the brand name (`.navbar-brand` uses `inline-flex` layout with `gap: 10px`; images/SVGs are auto-sized to 24×24):

```html
<nav class="navbar">
  <a href="/" class="navbar-brand">
    <img src="/icons/app-icon.svg" alt="">
    <span>App Name</span>
  </a>
  <div class="navbar-right">
    <span class="navbar-user">Username</span>
    <button class="btn btn-sm">Log Out</button>
  </div>
</nav>
```

Light variant for pages that need a white navbar:

```html
<nav class="navbar navbar-light">
  <a href="/" class="navbar-brand">App Name</a>
  <div class="navbar-right">
    <span class="navbar-user">Username</span>
    <button class="btn btn-sm">Log Out</button>
  </div>
</nav>
```

### Page Header

Standard spacing for non-hero pages (after navbar). Provides `48px` top padding and consistent gaps between h1, subtitle, and content.

```html
<div class="container page-header">
  <h1>Page Title</h1>
  <p class="subtitle">Helpful subtitle</p>
  <!-- content -->
</div>
```

Combines with any container class:

```html
<div class="container-narrow page-header">
  <h1>Narrow Page</h1>
  <p class="subtitle">For auth forms</p>
  <!-- content -->
</div>
```

Spacing: `48px` top padding, `8px` below h1, `32px` below `.subtitle`. Do **not** use on landing/hero pages (those use custom hero spacing).

### Hero Section (Landing Pages)

```html
<div class="container" style="padding-top: 80px; padding-bottom: 48px;">
  <p class="brand">App Name</p>
  <h1 class="h1-hero">Main Headline Here</h1>
  <p class="tagline">
    A sentence or two explaining what this does. Keep it short.
  </p>
  <div style="display: flex; gap: 12px; flex-wrap: wrap; margin-top: 32px;">
    <a href="/signup" class="cta cta-primary">Sign Up</a>
    <a href="/login" class="cta cta-secondary">Log In</a>
  </div>
</div>
```

When the app has a visual mark/icon, use `.brand-lockup` instead of a standalone `.brand`:

```html
<div class="container" style="padding-top: 80px; padding-bottom: 48px;">
  <div class="brand-lockup" style="margin-bottom: 32px;">
    <img src="/icons/app-icon.svg" alt="">
    <div>
      <p class="brand" style="font-size: 17px; letter-spacing: 3px;">App Name</p>
      <p class="subtitle">Short descriptor</p>
    </div>
  </div>
  <h1 class="h1-hero">Main Headline Here</h1>
  <!-- ... -->
</div>
```

### Brand Lockup

Icon beside app name and descriptor, forming a single cohesive block. The icon scales to match the combined text height.

```html
<div class="brand-lockup">
  <img src="/icons/app-icon.svg" alt="">
  <div>
    <p class="brand">App Name</p>
    <p class="subtitle">Short descriptor</p>
  </div>
</div>
```

Use in hero sections and landing pages where the app has a visual mark. The `.brand` and `.subtitle` classes handle typography; `.brand-lockup` handles layout only.

### Card List (3-Color Rotation)

When you have a list of cards, the accent color auto-rotates via `nth-child`:

```html
<div class="container">
  <div class="card">
    <h2>First Card</h2>
    <p>Description goes here. Color will be accent-1 (pink).</p>
  </div>
  <div class="card">
    <h2>Second Card</h2>
    <p>This one gets accent-2 (purple).</p>
  </div>
  <div class="card">
    <h2>Third Card</h2>
    <p>This one gets accent-3 (cyan).</p>
  </div>
</div>
```

For explicit accent control (e.g. server-rendered cards), use the `--accent` custom property:

```html
<div class="card" style="--accent: var(--p-accent-2)">
  <h2>Specific Accent</h2>
</div>
```

### Static Card

For cards used as form containers or static content that should not lift on hover:

```html
<div class="card-static">
  <label for="name">Name</label>
  <input type="text" id="name" placeholder="Enter your name">
</div>
```

Use `.card-static` instead of `.card` when the card is a container (e.g. auth forms, settings panels) rather than a clickable list item.

### Buttons

Size modifiers compose with any color variant:

```html
<!-- Size modifiers -->
<button class="btn btn-sm btn-primary">Small Primary</button>
<button class="btn btn-primary">Medium Primary</button>
<button class="btn btn-lg btn-primary">Large Primary</button>

<!-- Primary (hot pink) — main actions -->
<button class="btn btn-primary">Create</button>

<!-- Secondary (purple) — secondary actions -->
<button class="btn btn-secondary">Copy</button>

<!-- Outline (transparent) — tertiary actions -->
<button class="btn btn-outline">View Details</button>

<!-- Danger (red) — destructive inline actions -->
<button class="btn btn-sm btn-danger">Revoke</button>

<!-- Danger full-width — destructive section actions -->
<button class="btn btn-danger btn-block">Delete My Account</button>

<!-- CTA (larger) — hero sections. `.cta` is a semantic alias for `.btn-lg` -->
<a href="/signup" class="cta cta-primary">Sign Up</a>
<a href="/login" class="cta cta-secondary">Log In</a>

<!-- Disabled (any button) -->
<button class="btn btn-primary" disabled>Processing...</button>
```

### Forms

```html
<div class="card">
  <label for="name">Your Name</label>
  <input type="text" id="name" placeholder="Enter your name" style="margin-bottom: 16px;">
  <button class="btn-primary" style="width: 100%;">Submit</button>
</div>
```

Inline form (input + button side by side):

```html
<div style="display: flex; gap: 8px;">
  <input type="text" placeholder="Label" style="flex: 1;">
  <button class="btn-primary">Create</button>
</div>
```

### Status Messages

```html
<!-- Success — use role="status" for polite announcements -->
<div class="status status-success" role="status">Account created successfully</div>

<!-- Error — use role="alert" for urgent announcements -->
<div class="status status-error" role="alert">Something went wrong</div>

<!-- Warning — use role="alert" for urgent announcements -->
<div class="status status-warning" role="alert">Your session will expire soon</div>

<!-- Info — use role="status" for polite announcements -->
<div class="status status-info" role="status">New features are available</div>

<!-- Neutral (base, no color variant) -->
<div class="status">Neutral message</div>
```

Use `role="alert"` for error and warning messages (assertive — interrupts the user). Use `role="status"` for success and info messages (polite — announced at the next opportunity). Omit the role for neutral/static messages that don't need to be announced.

Show/hide with JavaScript:
```js
function showStatus(el, msg, type) {
  el.textContent = msg;
  el.className = 'status status-' + type; // 'success', 'error', 'warning', 'info'
  el.style.display = 'block';
}
```

### Tables

```html
<table>
  <thead>
    <tr>
      <th>Name</th>
      <th>Value</th>
      <th>Date</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Compression</td>
      <td style="font-weight: 600;">12 clicks</td>
      <td>Mar 1, 2026</td>
    </tr>
  </tbody>
</table>
```

### Code Blocks

Standard code block:
```html
<pre>const config = {
  server: "https://example.com"
};</pre>
```

Dark reveal panel (for secrets, API keys, terminal output):
```html
<div class="code-reveal">
  <p class="eyebrow" style="color: var(--p-accent-3); margin-bottom: 10px;">
    Copy this — you won't see it again
  </p>
  <code>sk_live_abc123def456</code>
  <div style="display: flex; gap: 8px; margin-top: 12px;">
    <button class="btn-secondary">Copy</button>
  </div>
</div>
```

### Tags & Badges

```html
<!-- Tag (bordered, light background) -->
<span class="tag">Volume Spacer</span>

<!-- Badge (dark background, white text) -->
<span class="badge">clicks</span>
```

### Steps (Numbered Instructions)

```html
<div class="steps">
  <div class="step">
    <span class="step-num">1</span>
    <p><strong>Create an account</strong> with a passkey</p>
  </div>
  <div class="step">
    <span class="step-num">2</span>
    <p><strong>Get an API key</strong> and paste the config</p>
  </div>
  <div class="step">
    <span class="step-num">3</span>
    <p><strong>Go.</strong> Start using the tools</p>
  </div>
</div>
```

### Stack Spacing

Uniform vertical spacing between direct children. Apply to the parent element.

```html
<div class="stack-md">
  <p>First item</p>
  <p>16px gap</p>
  <p>16px gap</p>
</div>
```

Available: `stack-xs` (4px) · `stack-sm` (8px) · `stack-md` (16px) · `stack-lg` (24px) · `stack-xl` (32px) · `stack-2xl` (48px)

For flex/grid parents, prefer `gap` instead. `.stack-*` is for flow-layout contexts where children are block-level elements stacked vertically.

### Dividers

```html
<!-- Standard dashed divider -->
<hr class="divider">

<!-- Danger divider (above danger zones) -->
<hr class="divider-danger">
```

### Danger Zone

```html
<hr class="divider-danger">
<div class="danger-zone">
  <h2>Danger Zone</h2>
  <p>This will permanently delete your account. This cannot be undone.</p>
  <button class="btn btn-danger btn-block">Delete My Account</button>
</div>
```

### Footer

```html
<div class="container">
  <div class="footer">
    Built with care. <a href="/">Home</a>
  </div>
</div>
```

### Empty States

```html
<p class="empty">No items yet</p>
```

### Gradient Stripe

A thin (3px) animated gradient divider. Uses the 3-accent gradient with a shifting `background-position`.

```html
<hr class="gradient-stripe">
```

Use between header and content, or between major sections as a vibrant alternative to `.divider`.

### Stat Callout

Oversized number with a small label below. Picks up the card's `--accent` color automatically.

```html
<div>
  <div class="stat">180mm</div>
  <div class="stat-label">Travel</div>
</div>
```

Group multiple stats in a flex row with `.stat-row`:

```html
<div class="stat-row">
  <div>
    <div class="stat">180mm</div>
    <div class="stat-label">Travel</div>
  </div>
  <div>
    <div class="stat">20%</div>
    <div class="stat-label">Sag</div>
  </div>
</div>
```

### Sticker Tags

Filled accent-colored tags with slight rotation for a sticker-board feel. Use instead of `.tag` when you want more visual pop.

```html
<span class="tag-sticker">Volume Spacer</span>
<span class="tag-sticker">Custom Tune</span>
<span class="tag-sticker">Bleed Kit</span>
```

Rotation alternates automatically via `nth-child`. Tags pick up `--accent` from their parent card.

### Entrance Animation

Fade-up entrance for staggered card lists. Apply `.fade-up` and set `animation-delay` per element.

```html
<div class="card fade-up" style="animation-delay: 0s">...</div>
<div class="card fade-up" style="animation-delay: 0.1s">...</div>
<div class="card fade-up" style="animation-delay: 0.2s">...</div>
```

Uses `animation-fill-mode: both` so elements stay hidden until their delay fires.

### Watermark Background

Fixed-position SVG watermarks for visual texture. Non-interactive (`pointer-events: none`), very low opacity.

```html
<div class="watermarks">
  <svg style="top: 10%; left: -5%;"><!-- SVG content --></svg>
  <svg style="top: 50%; right: -5%;"><!-- SVG content --></svg>
</div>
```

### Lists

Lists inside `.container` or `.container-narrow` are automatically styled with proper padding and markers:

```html
<div class="container">
  <ul>
    <li>Unordered list item</li>
    <li>Another item</li>
  </ul>
  <ol>
    <li>Ordered list item</li>
    <li>Another item</li>
  </ol>
</div>
```

## Accessibility

### Focus Visible

All interactive elements (buttons, links, inputs) have `:focus-visible` styles with a `2px` outline in accent-2 (purple) and `2px` offset. Buttons also get a lift + shadow on focus.

### Reduced Motion

The system respects `prefers-reduced-motion: reduce`. When enabled, all animations and transitions are effectively disabled (duration set to `0.01ms`).

### Contrast

- Third-card headings (cyan rotation) use dark text (`--p-text`) instead of cyan for accessible contrast on white
- `--p-text-faint` is `#6b6b6b` (4.5:1 contrast ratio on `#f0f0f0`)

## Icon Style

When creating SVG icons for palace-ui projects:

- Use **stroke-based** icons (not filled)
- `stroke-linecap: square` and `stroke-linejoin: miter` (matches the hard-edge aesthetic)
- `stroke-width: 2` (matches `--p-border-width`)
- Color with `currentColor` so icons inherit text color

## Layout Patterns

### Auth Pages (Login, Register)

Use `container-narrow page-header` (420px). No navbar. Centered with top padding.

```html
<body>
  <div class="container-narrow page-header">
    <p class="brand">App Name</p>
    <h1>Page Title</h1>
    <p class="subtitle">Helpful subtitle</p>
    <div class="card">
      <!-- form contents -->
    </div>
    <p style="margin-top: 20px; text-align: center; font-size: 13px; color: var(--p-text-muted);">
      Already in? <a href="/login">Log in</a>
    </p>
  </div>
</body>
```

### Dashboard Pages

Navbar + container with `page-header`. Use `divider` between major sections.

```html
<body>
  <nav class="navbar">...</nav>
  <div class="container page-header">
    <h1>Dashboard</h1>
    <p class="subtitle">Manage your stuff</p>
    <!-- content sections -->
    <hr class="divider">
    <!-- more sections -->
    <hr class="divider-danger">
    <div class="danger-zone">...</div>
  </div>
</body>
```

### Landing/Public Pages

Full container, no navbar. Hero section, then card list, then footer.

```html
<body>
  <div class="container" style="padding-top: 80px; padding-bottom: 48px;">
    <!-- hero -->
  </div>
  <div class="container" style="padding-bottom: 20px;">
    <!-- card list -->
  </div>
  <div class="container">
    <div class="footer">...</div>
  </div>
</body>
```

## Interaction Rules

1. **Hover = lift + shadow.** Elements move `translate(-1px, -1px)` or `translate(-2px, -2px)` and cast a hard shadow in the opposite direction. Shadow color matches the element's accent.
2. **Focus = border-color + shadow.** Input focus changes border to accent-2 (purple) and adds a `3px 3px 0` shadow. Number inputs focus to accent-1 (pink).
3. **Disabled = flat gray.** `#ddd` background, `#999` text, `#ccc` border. No transform, no shadow, `cursor: not-allowed`.
4. **Transitions are 0.1s.** Never slower. The UI should feel mechanical and responsive.
5. **Links underline with border-bottom**, not `text-decoration`. Hover swaps from accent-2 (purple) to accent-1 (pink).
6. **`@keyframes` ≠ transitions.** The 0.1s rule applies to hover/focus transitions. Entrance animations (`@keyframes`) and infinite loops (gradient-shift) use their own appropriate durations.
7. **Gradient stripes** are decorative (≤3px). They use the 3-accent gradient with animated `background-position`. This is not a "gradient surface."

## Color Usage Rules

- **accent-1 (pink):** Primary buttons, first card in a list, CTA buttons, link hover color
- **accent-2 (purple):** Secondary buttons, links, input focus borders, second card
- **accent-3 (cyan):** Navbar user name, code highlights, key reveal borders, third card
- **Never mix** accent colors in a single element (except the gradient on h1 text)
- **The 3-color rotation** applies to any list of sibling cards: 1=pink, 2=purple, 3=cyan, 4=pink...
- **Error is always `#ff4444`**, success is always `#00ff88`, warning is `#ffcc00`, info is `#00e5ff`. Status colors are not accent colors.

## Do's and Don'ts

### Do
- Use uppercase for headings, labels, buttons, badges, and status messages
- Use the 3-color card rotation for any list of cards
- Keep `border-radius: 0` everywhere
- Use `2px solid` borders on cards, buttons, inputs
- Use hard shadows (`Npx Npx 0 color`) — never blurred shadows
- Use `font-weight: 700` for headings and buttons
- Use `letter-spacing` on all uppercase text (0.5px to 2px)
- Keep containers at 640px max width
- Use dashed borders for dividers (`2px dashed #ccc`)

### Don't
- Add border-radius to anything
- Use `box-shadow` with blur (the third value must always be `0`)
- Use gradients on large surfaces or card backgrounds (allowed on: text, decorative stripes ≤3px, narrow fixed bars)
- Use colors outside the token system
- Use `text-decoration: underline` for links (use `border-bottom` instead)
- Use hover/focus transitions slower than `0.1s` (keyframe animations are exempt)
- Put body text in uppercase (only headings, labels, buttons)
- Use more than 640px for content width
- Create soft/subtle hover effects — make them obvious

## Responsive Breakpoint

Single breakpoint at `480px`:

```css
@media (max-width: 480px) {
  /* h1 shrinks, container gets tighter padding, cards lose some padding */
}
```

Palace CSS handles h1, container, and card adjustments automatically. For page-specific adjustments:

```css
@media (max-width: 480px) {
  .hero { padding: 48px 16px 32px; }
  .cta-row { flex-direction: column; }
}
```
