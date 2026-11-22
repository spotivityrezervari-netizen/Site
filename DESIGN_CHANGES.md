# DESIGN_CHANGES

Changes made only to the visual layer (the page background). Newest first.
Restore point: git tag `design-before-background` (commit 304a439, before any design change).

## 2026-11-22 (12): "Arena" background replaces "Fundal Final" (done by Claude, at the owner's request)

Owner: "still looks clumsy and copied; make it authentic, beautiful, eye-catching and well made". The old background was a repeated stock-style icon wallpaper (whistles, trophies, jerseys, dots) that also sat behind the hero text.

- **New generator** `scripts/design/fundal-arena.mjs` (the old `fundal-final.mjs` is removed; it is in git history). It writes `--design-bg-arena` (wide), `--design-bg-arena-phone` (portrait) and `--design-bg-grain` in `css/design-background.css`. Never edit those lines by hand; change the scene configs at the end of the script and re-run it.
- **One composed scene per screen shape** instead of a tile, because the layer is `position: fixed` (only one screen of it is ever seen):
  - a football pitch in perspective (real dimensions: halfway line, centre circle, boxes, arcs, spots, mowing stripes), fading into the dark towards the horizon, with a floodlight pool;
  - 3D balls (projected spheres): opaque dark body, seams, form shadow, a bright top rim light and a sheen; the soccer ball sits on the pitch with a contact shadow, the volleyball is slightly out of focus;
  - light trails: twisted "silk" bands (filled sheet + strands + a lit crest + a halo). On desktop the main trail ends under the tennis ball, on phones under the basketball, so they read as balls in flight;
  - soft floodlight glows and beams, an edge vignette, and a calm zone (mask) that dims the trails behind the hero text;
  - a 180px grain tile on top removes banding in the dark gradients.
- **CSS** (block "2026-11-22 (2): Arena", replacing the "Fundal Final" block): wide screens `background-size: cover`; portrait screens and ≤640px use the tall picture full width from the top (no jump when the phone address bar hides); portrait tablets (aspect ≥ 3/5) show its middle (`center 55%`).
- The unused old art variables (`--design-bg-left/right/scatter/final/final-phone`) are removed; the two old rules that used them now say `none`. The background now weighs ~87 KB instead of ~140 KB.
- `design-background.css?v=14`; SEO pages regenerated. Checked with screenshots at 1440×900, 1920×1080, 768×1024 and 390×844.
- **Revert:** `git revert` this commit then `node scripts/generate-seo-pages.mjs`, or restore from tag `design-before-arena`.

## 2026-11-22 (11): Home title is the brand "Spotivity", with a tagline (done by Claude, at the owner's request)

- `index.html`: the eyebrow span was removed. The h1 is now `<h1 id="home-intro-title" class="welcome-brand">Spotivity</h1>`, with no i18n key because the brand never changes. It is followed by `<p class="welcome-tagline" data-i18n="home_welcome_tagline">`.
- `js/home.js`: `home_intro_title` and `home_welcome_eyebrow` were removed, and `home_welcome_tagline` was added in RO/HU/EN.
- `css/design-background.css`: a new block, "2026-11-22: home title", before `@media print`:
  - brand: `clamp(64px, 7vw, 104px)` (phones `clamp(52px, 15vw, 72px)`), weight 750;
  - tagline: `clamp(22px, 2.3vw, 30px)`, colour `#E8F1EE`.
- Tests: `seo-schema-browser` (h1 = Spotivity in every language, tagline per language) and `public-resilience-browser`.
- Versions: `design-background.css?v=13` and `home.js?v=11`. The SEO pages were regenerated.

## 2026-11-22 (10): Better whistle, no touching balls on desktop (done by Claude, at the owner's request)

- `whistle()` is redrawn after the reference: a curved body with a top-face ridge, a boxy mouthpiece end, a round chamber hooking back under itself, two grip lines and three rays. Placement scale is 1.15, rotation -22.
- **Wide panel:** the columns are now `COL_GAP = 40` apart (`PITCH = W + COL_GAP`). The overlap score is squared, and the shift search runs over 420–1180. The big volleyball moved to x=40 at scale 1.92. Result: shift 624, no two pieces touch across a join. The script prints a warning if they ever do.
- CSS: the desktop background-size is 1240px and the tablet size is 1070px, so the drawing keeps the same scale with the wider panel.

## 2026-11-22 (9): Line art closer to the reference photo (done by Claude, at the owner's request)

- **The balls are real 3D spheres** in `scripts/design/fundal-final.mjs`. Their seams are 3D curves, rotated (`rotator(yaw, pitch, roll)`) and projected, and only the front half is drawn (`frontPath`):
  - soccer: a true truncated icosahedron. Pentagons are filled with the `pentFill` gradient, brighter where they face the light (upper left), and pinned to the outline at the rim;
  - basketball: two perpendicular great circles plus two side seams (small circles at x = ±0.62);
  - volleyball: the cube layout, 6 faces with 3 strips each, neighbours at right angles. The two volleyballs use different angles.
- **Other icons redrawn after the photo:**
  - whistle: 3/4 view, with the mouthpiece end face, the underside and sound rays;
  - stopwatch: double ring, crown, two side buttons, one hand;
  - trophy: a slim stem flaring into a trapezoid base;
  - racket: a 7x9 string grid and a banded grip.
- **Ribbons are brighter:** `GLOW` `#14a07e`, a fuller crescent fill (.55) and stronger edge strokes. `ICON_OPACITY` went from 0.27 to 0.30.
- **Fixed:** the racket strings and the stopwatch ticks set an absolute `stroke-opacity`, which made them brighter than the rest. The strings are now `ICON_OPACITY * 0.8`, and the ticks are gone.
- Each tile is ~55 KB (it was ~29 KB). `<link>` went to `?v=11` and the SEO pages were regenerated.
- **Revert only this step:** `git revert` the commit "Design: 3D balls and redrawn line art", then run `node scripts/design/fundal-final.mjs` and `node scripts/generate-seo-pages.mjs`.

## 2026-11-21 (8): Fundal Final fixed again, cleaner line art (done by Claude, at the owner's request)

- **Fixed again:** the owner wants the background to stay still while the content scrolls over it. The `position: absolute` override was removed, so `.home-shell::after` is `position: fixed` again, as it was originally.
- **Icons redrawn** in `scripts/design/fundal-final.mjs` with clean geometry, one stroke weight and true symmetry:
  - soccer ball: a real pentagon/hexagon layout with filled pentagons;
  - basketball: seams are proper curves;
  - volleyball: three seams 120 deg apart, each with a parallel panel line;
  - trophy: a smooth bowl, a two-step base and a proper 5-point star;
  - whistle: the body joins the mouthpiece, with a slot and an attached ring;
  - stopwatch: 12 ticks and a crown;
  - jersey: a collar, sleeve cuffs and a cleaner "10";
  - racket: tidier strings and a wrapped handle.
  - Whistles and the top trophy are slightly bigger, as in the photo.
- `<link>` went to `?v=10` and the SEO pages were regenerated.
- **Check sheet:** `node scripts/design/fundal-final.mjs --sheet out.svg` draws every icon large.

## 2026-11-21 (7): "Fundal Final" background from the owner (done by Claude, at the owner's request)

- **Reference:** `Desktop\Spotivity\FundalFinal.jpeg` (547x1600): near-black green base `#011012`, emerald light ribbons, and sport line art (balls, trophies, whistles, stopwatch, jersey "10", racket, plus/x/circle marks, dot grids).
- **Not used as a photo:** at 547 px wide it would be stretched about 3.5x on desktop and look blurry. It was redrawn 1:1 as a vector tile by `scripts/design/fundal-final.mjs`. That script writes two base64 SVG data URIs into `design-background.css`:
  - `--design-bg-final` (wide screens): it wraps on all four edges, so tiles join seamlessly side by side;
  - `--design-bg-final-phone` (phones): it wraps only top and bottom, and one tile spans the width exactly like the photo.
  - They are base64 because the gradients use `url(#id)` internally, which the public build scanner reads as a file reference.
- **It scrolls with the page:** `.home-shell::after` changed from `position: fixed` to `absolute`, so the drawing moves with the content. The shell is already `position: relative`.
- **Wide screens:** a double panel (2 x 547 wide). The right half is the same drawing moved down (the script picks the shift with the least overlap at the joins, currently 656 px), so the repeats never form identical rows. It is drawn once and placed with `<use>`, so it is no bigger than the phone version.
- **Sizes:** desktop panel 1160 px wide, tablet 1000 px, phones 100% of the width.
- **Override block:** new section "2026-11-21" at the end of `design-background.css`. The old layer variables are left in place but no longer shown. `<link>` went to `?v=9` and the SEO pages were regenerated. All 92 tests pass.
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
