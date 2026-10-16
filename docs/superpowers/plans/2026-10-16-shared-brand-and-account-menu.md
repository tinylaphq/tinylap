# Shared brand and account menu: plan

> Native execution. Steps use checkbox (`- [ ]`) syntax.

**Goal:** all three TinyLap apps (timing, accounts, planner) show the same mark and the same account control. One source for the markup, CSS and behaviour lives in `@tinylap/design`.

**Decided** (2026-10-16):
- The mark moves to `@tinylap/design` under MPL-2.0.
- The planner gets the shared `<details>` menu, enhanced by a `tl-menu` element in this change.
- The space list is headed "Your clubs" in every product, with "Personal" first (glossary).

**Survey:** timing renders a `<details class="nav-account">` with no JS, accounts has only a lockup, and the planner has a static, JS-filled popover with `role="menu"`, arrow keys, and "Log in" / "Log out".

## Design

Revision 2, after a review of the design and of a first cut of the design-package code. It keeps the disclosure pattern. The review: scratchpad `review-menu.md`, 8 Important and 13 Minor findings, all addressed below.

### Markup: one source in `@tinylap/design/html/`

The modules are DOM-free and importable by Node. They return plain strings: timing wraps them in `safe()`, and a forgotten wrap shows escaped markup, never runs it.
- `escape.js` exports:
  - `escapeHtml`;
  - `safeHref(url)`, which lets through `http:`, `https:`, or a path starting with `/`, `./` or `?`, and gives `#` for anything else. A `javascript:` URL never becomes a link.
  - It applies to every URL the helpers write: `brand.href`, `markSrc`, `accountUrl`, each club's `href`, `signOutAction` and `signInLink.href`.
- `brand.js` exports:
  - `brand({ href, name, markSrc })`, which renders `<a class="navbar-brand" href><img src alt="" width="24" height="24"> name</a>`;
  - `brandLockup({ name, markSrc })`, which renders `<p class="brand-lockup"><img … 32><span class="brand">name</span></p>`.
- `account.js` exports:
  - `accountMenu({ name, accountUrl, signOutAction = '/auth/logout', clubs = null, items = [] })`;
  - `signInLink({ href })`.

`accountMenu` renders:

```html
<tl-menu class="nav-account">
  <details name="tl-account">
    <summary><span class="visually-hidden">Account: </span><span class="nav-account-name">NAME</span></summary>
    <div class="nav-account-menu">
      <!-- only when clubs is a non-empty array; Personal first is the caller's job -->
      <p class="nav-account-label" aria-hidden="true">Your clubs</p>
      <ul aria-label="Your clubs"><li><a href="…"[ aria-current="true"]>Personal</a></li>…</ul>
      <!-- items: { id, label, hidden } as <button type="button" class="nav-account-item"> -->
      <a class="nav-account-link" href="ACCOUNT_URL">Account</a>
      <form method="post" action="SIGN_OUT"><button type="submit" class="nav-account-signout">Sign out</button></form>
    </div>
  </details>
</tl-menu>
```

- **No ids of its own** (only those the caller gives its items), so two menus on one page cannot collide. The list is named by `aria-label`, and the visible label is `aria-hidden`.
- **Hooks are classes:** `.nav-account-name` (the name, so the hidden "Account:" prefix stays) and `.nav-account-link`. Hiding the whole control sits on a wrapper the app owns. In the planner that is `<div class="account" id="account" hidden>`, which holds the menu, `signInLink` and the down message.
- `signInLink({ href })` renders `<a class="btn btn-sm btn-outline nav-sign-in" href>Sign in</a>`. The planner finds it as `#account .nav-sign-in`.
- `undefined` or `null` text renders as empty, never as "undefined".
- **Planner drift test:**
  - It renders `accountMenu({ name: 'Account', accountUrl: '/', items: [{ id: 'menu-library', label: 'Library', hidden: true }] })` and `signInLink({ href: '/auth/login' })`.
  - It cuts those fragments out of `index.html` between `<!-- account-menu -->` / `<!-- /account-menu -->` and `<!-- sign-in -->` / `<!-- /sign-in -->` markers.
  - Before comparing, it normalises both sides: `>\s+<` becomes `><`, and any other whitespace run becomes one space.

### `tl-menu` in `@tinylap/design/elements/menu.js`

The element follows the WAI-ARIA disclosure (navigation) pattern, not `menu`. Focus stays on the summary when the menu opens.
- **Escape:**
  - while open, a `keydown` listener on `document` (capture) acts only when focus is inside the `tl-menu` or on the body (after a mouse open, Safari leaves it there);
  - with focus anywhere else, such as in a dialog a script opened, the key is left alone;
  - when it acts, it closes the menu, returns focus to the summary, and calls `stopPropagation()` and `preventDefault()`, so page shortcuts (the planner's Escape that clears the selection) don't also fire.
- **Outside press:** a `pointerdown` listener on `document`, in the capture phase while open, so a handler that stops propagation (the planner's drag handles) can't hide it.
  - A press inside never closes, so links and Sign out are never swallowed.
  - Focus then goes wherever the press puts it, as on any page: the pressed control, or the body if it can't take focus.
- **Focus leaving:** a `focusout` whose `relatedTarget` is outside closes the menu. A null `relatedTarget` doesn't close it; the outside-press rule covers clicks on page areas that can't take focus.
- **In-page items:** a `click` listener on the host, in the capture phase, closes the menu on a click of a `button[type="button"]` inside the panel (an app item such as Library), before the app's own handler runs.
- **`close({ focus })` is public:** it closes the menu if it is open, and with `focus: true` it always moves focus to the summary, even when the menu was already closed. An app calls it after its dialog closes.
- **Lifecycle:**
  - a `MutationObserver` on `open` (subtree) adds and removes the document listeners, and the `<details>` is looked up when needed, so markup filled or replaced later works. It is not the `toggle` event: Chrome fires that a moment late, so a quick Escape after opening would arrive before it.;
  - `connectedCallback` adds the document listeners if the menu is already open;
  - `disconnectedCallback` removes them all;
  - `pagehide` closes the menu, so the back/forward cache never restores it open.
- **Exclusivity:** native `<details name="tl-account">` makes only one open at a time, without JS. There is no "close the others" loop.
- No markup is built.

### Look: in `design.css`

The planner's version is the base. It is palace's `.navbar-user` idiom: the name in cyan, 12.9:1 on the navbar.
- **Summary:**
  - the btn-sm box, with a 1px `#333` border, the same as palace's `.navbar .btn`;
  - the name truncates with an ellipsis, and the caret sits in the right padding;
  - `max-width: min(14rem, 40vw)`, so it fits phone navbars;
  - hovered or open, it turns pink (5.8:1).
- **Timing's buttons:** timing drops its white outline buttons: `app.css` lines 25–26 (`.navbar .btn-outline` and its hover, a style choice from #21 that no test relies on) and the matching `.navbar-right .btn` border. Its navbar buttons then look like palace's and the planner's, which is the consistency the decision asks for. Check big mode in the screenshots.
- `.navbar-light` is not supported: cyan on white fails contrast. The CSS notes this.
- **Panel:**
  - `position: absolute`, right-aligned under the summary, `min-width: 14rem`, `max-width: calc(100vw - 2 * var(--p-space-md))`;
  - it keeps only its right edge in view: a summary far left on a narrow screen could push its left edge out. Every navbar puts the menu at the right, so this is a CSS note, not code;
  - white, with a 2px ink border and a purple offset shadow;
  - `z-index: 100`, above the board and canvas;
  - the top layer (popover) is not used, because `<details>` content cannot be placed there without JS.
- **Items:** 13px/600, sentence case.
  - Hover: the background only.
  - `:focus-visible`: `outline: 2px solid var(--p-accent-2); outline-offset: -2px`. The `aria-current` pink inset bar stays alongside it, so focus is visible on the current club too.
- **Labels:** "Your clubs" uses the label style (`--p-text-faint`, 5.3:1). Sign out sits under a thin rule.
- `.visually-hidden` moves to `design.css` from timing's `app.css`, and upstream to palace-ui later.
- **Lockup:** `.brand-lockup { gap: var(--p-space-sm) }` and its 32px image are shared, the gap timing and accounts both use today. Each app keeps its own margin around the lockup.
- The `<details>` navbar menu and `.visually-hidden` are generic; they join `[hidden]` on the palace-ui list.

### Mark

- `packages/design/mark.svg`, the byte-identical file, now MPL-2.0, served at `/pkg/design/mark.svg`.
- Each app's `public/mark.svg` is removed, and its references point to the package path.
- The planner's favicon becomes the mark.
- The planner brand becomes `<a class="navbar-brand" href="./">` with the mark, still reading "Circuit 30 Planner"; renaming it is for the copy pass.

### Tests for the element (review I8)

The design package has no browser runner. The element is tested in timing's browser suite (`test/browser/menu.test.js`) and, where the planner differs, in the planner's:
- a mouse open, then Escape with focus on the page, closes it;
- Escape from the summary and from inside the panel closes it, with focus back on the summary;
- an outside press closes it, also on an element that stops propagation;
- a click on a link or on Sign out is never swallowed;
- Tab past the last item closes it;
- an in-page button closes it;
- two menus on one page exclude each other (a fixture page in the test; it checks `<details name>` as the browser implements it);
- a `pagehide` event (dispatched synthetically) closes it, so the back/forward cache never restores it open;
- without JS it still opens and closes;
- big mode hides it.

The CSS test asserts the focus-visible outline, the `aria-current` rule not removing it, and the summary's `max-width`.

## Tasks

### Task 1: design package (helpers, element, CSS, mark)

- [ ] Write the tests first.
  - `test/html.test.js`:
    - escaping of the name, URLs and club names;
    - `safeHref` turns `javascript:` into `#` in every URL field;
    - null or undefined text renders empty;
    - the hidden "Account: " prefix and `.nav-account-name`;
    - the `.nav-account-link` hook, and no `id` anywhere in the menu;
    - `details name="tl-account"`;
    - the clubs section absent for `null` and `[]`, present with `aria-label` and an `aria-hidden` label otherwise;
    - `aria-current` on the current club;
    - items as `type="button"` with `hidden`;
    - the sign-out form's action;
    - `signInLink` markup.
  - `test/design-css.test.js` (the existing file):
    - the `:focus-visible` outline in the panel;
    - the `aria-current` rule setting only `box-shadow`, never `outline`;
    - the summary's `max-width: min(14rem, 40vw)`;
    - `.visually-hidden`;
    - the panel's `z-index: 100`.
- [ ] Implement:
  - `html/escape.js` (with `safeHref`), `html/brand.js` and `html/account.js`, per the Design markup;
  - `elements/menu.js`, per the Design behaviour;
  - the CSS block and `.visually-hidden` (timing's declarations, copied exactly) in `design.css`;
  - `mark.svg`, MPL-2.0.
- [ ] Update `package.json` (`files` gets `mark.svg`) and the README sections (Markup, Elements).
- [ ] Commit, amending the first cut: `feat(design): shared mark, account menu markup and tl-menu`.

### Task 2: timing adopts

- [ ] `layout.js`:
  - the brand comes from `brand()`;
  - the menu from `accountMenu()`, with `clubs` from `request.spaces`, personal first as today, and `current` the current space;
  - Sign in from `signInLink()`;
  - the module `pkg/design/elements/menu.js` loads on every page that shows the menu;
  - the favicon is `pkg/design/mark.svg`.
- [ ] `notice.js`: the lockup comes from `brandLockup()`.
- [ ] Remove:
  - `public/mark.svg`;
  - every `.nav-account*` rule in `app.css`, including the dead `.nav-account > summary` selectors;
  - the `gap` in `.notice .brand-lockup` (now shared);
  - `.visually-hidden`;
  - `.navbar .btn-outline` and its hover (lines 25–26);
  - the `.navbar-right .btn` white border (line 253).

  In the box rule at line 248, `.navbar-right .btn` gets `border-color: var(--p-border-dark)` instead of `transparent`, so "Big screen" and Sign in keep palace's `#333` border; `.live-status` stays transparent.

  Keep:
  - the navbar-right layout rules;
  - the `body.big` rule that hides `.nav-account`;
  - `.notice .brand-lockup`, without its `gap` (now shared), keeping its margin.
- [ ] Update the server tests:
  - `pages.test.js`:
    - `<tl-menu class="nav-account">`, `<details name="tl-account">`;
    - the summary's name in `.nav-account-name`;
    - the heading "Your clubs" (the list's `aria-label`);
    - the favicon `/pkg/design/mark.svg`;
    - the menu module present when signed in, absent when signed out;
  - `static.test.js`: the mark path;
  - `board-pages.test.js`: no account menu on watchers.
- [ ] New `test/browser/menu.test.js`, running every case in the Design's element test list that doesn't need the planner. The fixture page for "two menus" is a route-fulfilled page in the test.
- [ ] Take screenshots at 390 px and 1280 px, with the menu open and with a 40-character display name, signed out, and in big mode.
- [ ] Commit `feat(timing-app): the shared brand and account menu`.

### Task 3: accounts adopts the mark

- [ ] `pages/layout.js`: the favicon and the lockup (`brandLockup({ name: 'TinyLap', markSrc: '/pkg/design/mark.svg' })`) come from the package. The `accounts-brand` class goes.
- [ ] In `accounts.css`, `.accounts-brand { … }` becomes `.accounts > .brand-lockup`, with only the bottom margin (`var(--p-space-lg)`) and the name colour (`.accounts > .brand-lockup .brand { color: var(--p-text) }`). The gap and the image size are shared now.
- [ ] Remove `public/mark.svg` and the `.accounts-brand img` rules. Update `pages.test.js:104`.
- [ ] No navbar control here.
- [ ] Commit `feat(accounts): the shared mark`.

### Task 4: planner adopts

- [ ] `index.html`:
  - the brand link `brand({ href: './', name: 'Circuit 30 Planner', markSrc: './pkg/design/mark.svg' })`, and the mark as favicon;
  - inside `<div class="account" id="account" hidden>`:
    - `<!-- sign-in -->` + `signInLink({ href: '/auth/login' })` + `<!-- /sign-in -->`;
    - `<span class="account-down" role="status" hidden>Sign-in is unavailable right now</span>`;
    - `<!-- account-menu -->` + `accountMenu({ name: 'Account', accountUrl: '/', items: [{ id: 'menu-library', label: 'Library', hidden: true }] })` + `<!-- /account-menu -->`;
  - `<script type="module" src="./pkg/design/elements/menu.js">`.
- [ ] `js/account.js`:
  - keep `loadAccount` and `loginHref`;
  - `show()` sets `#account` `hidden` to false; `.nav-sign-in` `hidden` to `state !== 'out'`; `.account-down` `hidden` to `state !== 'down'`; and `.nav-account` (the `tl-menu`) `hidden` to `state !== 'in'`;
  - signed in, it sets `.nav-account-name` text to the name and `.nav-account-link` `href` to `accountUrl`;
  - the login click refresh of `.nav-sign-in` `href` stays;
  - delete the popover positioning, the arrow keys and `aria-expanded`.
- [ ] `js/library.js`:
  - remove the `hidePopover` call at line 597, since tl-menu closes on the Library click;
  - when the library dialog closes, call `document.querySelector('#account tl-menu')?.close({ focus: true })`.
- [ ] `js/app.js`: the document `keydown` handler returns early when `e.defaultPrevented`, so a menu's Escape never clears the selection. The other shortcuts (Space, Enter, `r`, Delete) firing while focus is on a navbar control predates this change. They are deferred to the copy-and-polish pass and noted in the PR.
- [ ] `css/app.css`: delete `.account-name`, `.account-menu` and the `[role=menuitem]` rules. Keep `.account` (the divider) and the phone layout: `.account` pinned beside the brand, which the summary's `max-width: min(14rem, 40vw)` now fits.
- [ ] Tests:
  - `test/account-markup.test.js`, the drift test: each marker pair appears exactly once in `index.html`, and each fragment equals the helper's output after normalising (`>\s+<` to `><`, other whitespace runs to one space);
  - `test/account.test.js`: `loadAccount` and `loginHref`, unchanged;
  - browser, updating `library.test.js` and `mobile.test.js`:
    - the hooks are now `.nav-sign-in`, the summary and `.nav-account-link`, and the wording "Sign in" / "Sign out";
    - new: a press on a drag handle closes the menu;
    - Escape with the menu open doesn't clear the canvas selection;
    - Library closes the menu, opens the dialog, and after the dialog closes focus is on the summary.
- [ ] Take screenshots at 390 px and 1280 px, with the menu open and a long name.
- [ ] Commit `feat(track-planner): the shared brand and account menu`.

### Task 5: review

- [ ] Run the full checks for design, timing, accounts and the planner, and all browser suites twice.
- [ ] A senior review of the whole branch; iterate until clean.
- [ ] Push and open a PR stacked on #25.
- [ ] Add the upstream items to the follow-up list: the `<details>` navbar menu and `.visually-hidden`.

## Review focus

1. Without JS, the timing menu still opens, and Sign out still posts.
2. Escape and outside-click must never swallow a click on a menu link or the Sign out button: close on `pointerdown` outside only, never inside.
3. The planner's markup must not drift from the helper, which the drift test pins.
4. Big mode on the board still hides the account control.
5. A long display name truncates and never pushes the navbar onto two lines at 1280 px.
