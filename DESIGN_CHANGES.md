# DESIGN_CHANGES

Changes made only to the visual layer (the page background). Newest first.
Restore point: git tag `design-before-background` (commit 304a439, before any design change).

## 2026-11-21 (7): "Fundal Final" background from the owner (done by Claude, at the owner's request)

- **Reference:** `Desktop\Spotivity\FundalFinal.jpeg` (547x1600): near-black green base `#011012`, emerald light ribbons, and sport line art (balls, trophies, whistles, stopwatch, jersey "10", racket, plus/x/circle marks, dot grids).
- **Not used as a photo:** at 547 px wide it would be stretched about 3.5x on desktop and look blurry. It was redrawn 1:1 as a vector tile by `scripts/design/fundal-final.mjs`. That script writes two base64 SVG data URIs into `design-background.css`:
  - `--design-bg-final` (wide screens): it wraps on all four edges, so tiles join seamlessly side by side;
  - `--design-bg-final-phone` (phones): it wraps only top and bottom, and one tile spans the width exactly like the photo.
  - They are base64 because the gradients use `url(#id)` internally, which the public build scanner reads as a file reference.
- **It scrolls with the page:** `.home-shell::after` changed from `position: fixed` to `absolute`, so the drawing moves with the content. The shell is already `position: relative`.
- **Sizes:** desktop tile 600 px wide, tablet 520 px, phones 100% of the width.
- **Override block:** new section "2026-11-21" at the end of `design-background.css`. The old layer variables are left in place but no longer shown. `<link>` went to `?v=8` and the SEO pages were regenerated. All 92 tests pass.
- **Revert only this step:** delete the "2026-11-21" block and the two `--design-bg-final*` variables, or `git revert` the commit "Design: Fundal Final background", then run `node scripts/generate-seo-pages.mjs`.

## 2026-11-20 (6): Legal pages and base initials circles in the new palette

- **New file `Idee Site/css/design-legal.css`:** the legal pages (`termeni.html`, `confidentialitate.html`, `cookies.html`) now use the same palette:
  - background `#031817`, white headings, light grey-green text, green links `#22C55E`;
  - `#1F3A3D` borders on the header, tables and the bottom nav;
  - the "[de completat]" placeholders are highlighted in light blue.
- **Existing files edited:**
  - each of the three legal pages got one `<link rel="stylesheet" href="css/design-legal.css?v=1">` line, right after `legal.css`;
  - `scripts/public-files.json` got one line, `"css/design-legal.css"`.
- **Initials circles:** the base initials circles ("BB", "S") on public pages now have a dark-teal fill, a `#1F3A3D` border and light-blue letters `#38BDF8`. This is section "(6)" in `design-background.css`; the `<link>` went to `?v=6` and the SEO pages were regenerated.
- **Revert only this step:** `git revert` the commit "Design: legal pages and base initials", then run `node scripts/generate-seo-pages.mjs`.

## 2026-11-20 (5): Colour palette from the owner

All changes are in `Idee Site/css/design-background.css` (section "(5)"). The `<link>` went to `?v=5` and the SEO pages were regenerated. Public pages only: admin pages, status colours (errors, confirmations) and the legal pages (`termeni`/`confidentialitate`/`cookies`, which don't load this file) are unchanged.

- **Background:** `#031817`. The base gradient, html background, header/city bar and mobile menu are now in this tone.
- **Main action, green `#22C55E` (hover `#4ADE80`, dark text `#052e16`):**
  - all buttons: welcome "Rezervă un teren", gallery and sport-card buttons, "Vezi bazele sportive", the club sign-up button, booking buttons, the active login tab, and the profile editor buttons;
  - links, "Descoperă sporturile", the share button, gallery dots, nav hover, and focus rings.
- **Labels and numbers, light blue `#38BDF8`:** the welcome eyebrow, steps 01/02/03, the club eyebrow, city and price on cards, and entity eyebrows.
- **Text:**
  - headings are white: the home title, sport titles, section titles, dialog titles, and SEO page headings;
  - body text is light grey-green `#C9DAD5`. Nav and menu text is `#E8F1EE`.
- **Surfaces:**
  - fields, header, city bar, footer, cards, dialogs, the club box and the photo cards keep their dark-teal fill and now have thin `#1F3A3D` borders (they were gold);
  - the shared theme variables (`--spotivity-gold*`, `--spotivity-cream`, `--spotivity-muted`) are re-pointed inside `.pagina-publica` only.
- **Revert only this step:** `git revert` the commit "Design: owner colour palette", then run `node scripts/generate-seo-pages.mjs`.

## 2026-11-20 (4): Sport photos as framed landscape cards (no blur)

Asked by the owner: no blur on the sport photos. They should look like the welcome gallery at the top: all landscape, same size, not zoomed in too much. All changes are in `Idee Site/css/design-background.css`. The `<link>` went to `?v=4` and the SEO pages were regenerated.

- **Removed:**
  - the edge masks (fades) and the teal veil behind the sport photos;
  - the earlier phone-only inset/fade block.
- **Photo cards:** each sport photo is now a card.
  - Frame: same 3:2 frame and width, `min(100% - 32px, 900px)`, with rounded corners (22px; 18px on phones) and the same thin gold border as the welcome photos.
  - Crop: `object-fit: cover` with no extra zoom (`transform: none`). Tenis is centred at `50% 80%` and Tenis de picior at `50% 32%`, because those two sources are portrait.
  - Title: the title and button sit at the top of the card on a light shade, as in the gallery. On phones the title is 28–36px so it fits.
  - Spacing: the court cards below start 20px under the photo; they used to overlap it by 28px.
- **Revert only this step:** `git revert` the commit "Design: sport photos as framed landscape cards", then run `node scripts/generate-seo-pages.mjs`.

## 2026-11-20 (3): One teal colour everywhere, smoother photo fades on mobile

Asked by the owner: mobile looked worse than desktop (mixed green/blue/brown shades, hard photo edges). All changes are in `Idee Site/css/design-background.css`. The `<link>` went to `?v=3` and the SEO pages were regenerated.

- **Base background:** now almost flat (`#04201f` to `#041c1b` to `#031a19`). The coloured radial glows that created patches are gone.
- **Same tone everywhere on public pages:**
  - city bar, header, mobile menu, footer, city select, search field, court and base cards, the club sign-up box and its dialog, and the welcome photo caption shade now use that teal tone;
  - before, they used olive-green `#142219`/`#1b2d20`/`#203226` or brown `#242017`/`#1b1812`;
  - gold accents (buttons, borders, text) are unchanged, and admin pages are not affected.
- **Photo fades:**
  - the photo-edge masks now use eased (S-curve) stops, so there is no visible line where a fade starts or ends;
  - the veil behind each photo is exactly the background tone, with eased stops;
  - phones and tablets (≤1023px) get the desktop look: the photo is slightly inset, side fades are 36–72px (were 24px) and the bottom fade is longer.
- **Revert only this step:** `git revert` the commit "Design: one teal colour everywhere ...", then run `node scripts/generate-seo-pages.mjs`.

## 2026-11-20 (2): Smooth scrolling, photo edges, landscape welcome photos

All of this is in `Idee Site/css/design-background.css` (new section at the end). No other CSS file was edited. The `<link>` went from `?v=1` to `?v=2` in `index.html`, and the SEO pages were regenerated (that version number is the only change in them).

- **Scroll stutter:**
  - the illustration layer is now `position: fixed`, so it is no longer repainted on every scroll;
  - the `backdrop-filter: blur(16px)` on the sport-photo edges (mobile) is switched off (`.home-hero-art::before { content: none }`). Re-blurring on every scrolled frame is what made phones stutter.
- **"Background first, photo later":**
  - the sport sections were kept at `opacity: 0` until scrolled into view and then faded in over 0.8s;
  - `.home-section-pending` is now overridden to `opacity: 1; transform: none`, so the photos appear immediately (the JS in `home-motion.js` is untouched).
- **Photo edges show the new background:**
  - the forest-green overlay (`.home-hero-art::after`) and the section/art backgrounds `#101a14` are made transparent;
  - each sport photo now fades to transparent with a CSS `mask-image` (same edge sizes as before: `--home-edge-top/bottom`, `--home-side-fade`);
  - a soft dark-teal radial veil behind each photo softens the line art around it and fills the space while the photo downloads on a slow connection. A real blur of the illustrations would bring the stutter back, so it was not used.
- **Welcome gallery (the auto-sliding photos):**
  - every photo uses the same 3:2 landscape frame with `object-fit: cover`, so photos are cropped, never squashed;
  - Tenis is centred at `50% 82%` and Tenis de picior at `50% 30%` (portrait sources);
  - on mobile the frame hugs the card (no empty space above or below).
- **Low bandwidth:**
  - the heavy photos were already well-compressed WebP/AVIF. Re-encoding saved only 3–4% at a quality cost, so they were not changed;
  - the large PNG icons are not loaded on the home page.
- **Revert only this step:** `git revert <commit "Design: smooth scroll, photo edges ...">`, then run `node scripts/generate-seo-pages.mjs`.

## 2026-11-20 18:07: Premium dark sports background (teal / emerald)

**Files created**
- `Idee Site/css/design-background.css`: the whole background (about 17 KB). It holds:
  - a fixed gradient (`#031817` to `#041c1b` to dark teal) with soft emerald glows (`.home-shell::before`, `z-index: -2`);
  - teal/emerald line art (footballs, basketballs, tennis balls, volleyballs, a number 10 jersey, stopwatches, trophies, court markings, crosses, dots, curves) at 6–20% opacity with a soft double-outline glow. It lives in `.home-shell::after` (`z-index: -1`, `pointer-events: none`) and scrolls with the whole page;
  - large elements sit at the left and right edges and are partly cut off by the screen. The centre only gets tiny marks, so text stays readable;
  - tablet (≤1024px) uses smaller illustrations. Mobile (≤640px) shows edge strips only, smaller and fainter.
  - The SVGs are inlined as `data:` URIs because the public build (`scripts/build-public.mjs`) only ships raster images from `assets/imagini/`, and the CSP already allows `img-src data:`. So there is no `assets/bg/` folder.
- `DESIGN_CHANGES.md`: this file.

**Existing files edited (approved by the owner)**
- `Idee Site/index.html`: one line added before `</head>`: `<link rel="stylesheet" href="css/design-background.css?v=1">`.
- `scripts/public-files.json`: one line, `"css/design-background.css"` (without it the public build refuses the page).
- The 22 generated SEO pages (`Idee Site/terenuri/**`, `teren/**`, `baze-sportive/**`) were regenerated with `node scripts/generate-seo-pages.mjs`. Each one gained only the same `<link>` line.

**Existing background**: the old background was a flat forest green/black (`#101a14` / `#000` in `home-layout.css`, `home.css`, `theme.css`). Those files were NOT edited. The new file loads last and only makes `.home-shell` and `.home-main` transparent so the new layers show through. Header, footer, cards, buttons, and the sport hero photos (which still fade into `#101a14`) are unchanged.

**How to revert**
1. Delete `Idee Site/css/design-background.css`.
2. Remove the `design-background.css` `<link>` line from `Idee Site/index.html`.
3. Remove `"css/design-background.css",` from `scripts/public-files.json`.
4. Run `node scripts/generate-seo-pages.mjs` (it removes the line from the generated pages).
Or revert the design commit itself: `git revert <commit "Design: premium dark sports background">`.
