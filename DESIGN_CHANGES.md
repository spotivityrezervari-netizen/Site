# DESIGN_CHANGES

Changes made only to the visual layer (the page background). Newest first.
Restore point: git tag `design-before-background` (commit 304a439, before any design change).

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
