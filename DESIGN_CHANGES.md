# DESIGN_CHANGES

Changes made only to the visual layer (the page background). Newest first.
Restore point: git tag `design-before-background` (commit 304a439, before any design change).

## 2026-11-24 (38): Golden-ratio fade and depth for the sunflower icons (done by Claude, at the owner's request)

Owner: "I don't really like it, it looks like the WhatsApp background; add a fade at golden-ratio distances to the icons and try to make it nicer".

- `goldenFade: { r0, low }` in `sunflower()`: rings of light around the centre at r0·φ^k (wide r0 60, phone 45); between two rings the icons fade down to `low` (0.25) of their brightness, as a soft wave.
- Depth: each icon is randomly one of three sizes in the golden ratio, 1 : 1/φ : 1/φ² (1 in 5 big, 2 in 5 middle, 2 in 5 small), and the smaller ones are fainter by the same ratio, so the field looks deep instead of a flat wallpaper.
- `iconFill` 0.8 (big icons a bit bigger), `iconOp` wide [.95, .75, .42, 0], phone [1, .9, .55, 0]. Sizes: wide 109 KB, phone 90 KB. Removing `goldenFade` returns to the flat version. `design-background.css?v=39`; SEO pages regenerated.

## 2026-11-24 (37): Icons in the sunflower mixed at random (done by Claude, at the owner's request)

Owner: "put the icons more randomly, not so one after another".

- In `iconSeeds` mode the kind is now picked at random for each seed (its own seeded generator, so the picture is the same on every run), and never the same as the nearest neighbours in the packing (n-8, n-13, n-21, n-34). The ball turn (one of three) and the lean of the whistle/stopwatch (±25°) are random too.
- Positions, sizes and brightness are unchanged. `design-background.css?v=38`; SEO pages regenerated.

## 2026-11-24 (36): Sunflower made of icons instead of dots (done by Claude, at the owner's request)

Owner: "instead of those dots, make them a bit sparser and put the icons".

- `sunflower()` has a new mode `iconSeeds: true` (now on for wide and phone): every seed is a small icon (tennis, whistle, stopwatch, volleyball, basketball, soccer). Each icon is drawn once in `<defs>` (balls in three turns) and placed with `<use>`, so a seed costs about 60 bytes.
- Sparser seeds: wide c 32 (was 19), phone c 28 (was 15); the icon is 62% of the distance between neighbours (`iconFill`), so there is space around each one.
- The kind is the same along each of the 21 spirals (`n % 21`), so the spirals show through the pattern without any line.
- Brightness falls off with the distance from the centre (`iconOp` .75 → .55 → .32 → 0); over the text or the photo it is ×0.3 (`seedDim`). The separate big icons are off in this mode.
- Picture size: wide 120 KB, phone 93 KB (dots version: 71 / 65). Removing `iconSeeds` brings the dots back. `design-background.css?v=37`; SEO pages regenerated.

## 2026-11-24 (35): Sunflower without drawn spirals, packed like a real flower head (done by Claude, at the owner's request)

Owner: "I want it to be like in nature, the spiral lines should not be drawn, like the sunflower, as natural as possible".

- `sunflower()` rewritten: no arm lines any more. The seeds are packed densely (wide c 19, phone c 15, out to rMax 980 / 760), so they almost touch and the 21/34/55 spirals appear by themselves, as in a real sunflower head.
- Each seed is a small oval pointing away from the centre (a short stroke with round ends, grouped by width so the picture stays small: wide 71 KB, phone 65 KB). The centre seeds are smaller and brighter, with a soft glow; the seeds fade towards the edges (gradient `seedG`). A small seeded jitter in position and size makes it look grown, not drawn.
- The icons keep their old places (three of the 21 spirals of the wider sunflower, `iconC`), each moved onto the nearest seed; the seeds under an icon are left out. Over the text or the photo the seeds are drawn at 30% (`seedDim`), the icons at 40%.
- `design-background.css?v=36`; SEO pages regenerated.

## 2026-11-24 (34): "Sunflower" background: many Fibonacci spirals at once (done by Claude, at the owner's request)

Owner: "it is not really centred", then "should we put several sequences? how do you think it looks better".

- New composition `sunflower()` in `scripts/design/fundal-arena.mjs` (Vogel's model of a sunflower head): seed n at n × 137.5° (the golden angle), radius c·√n, centred on the screen (wide 800,540; phone 273,600). The seeds are small points of light; the 21 spiral arms are drawn faintly, so several Fibonacci spirals show at once.
- The icons (tennis, whistle, stopwatch, volleyball, basketball, soccer, repeating) sit on three evenly spaced arms (2, 9, 16; every second seed on desktop), growing with the distance from the centre. Over the text or the photo they are drawn at 40%.
- The single-spiral composition (`fibonacci()`, `chain` / `items`) is still in the file: remove `sunflower` from `fibWide` / `fibPhone` to use it again. `iconArms: 'auto'` picks the arms with the most clear icons.
- `design-background.css?v=35`; SEO pages regenerated.

## 2026-11-24 (33): Fibonacci background centred; icons repeat along the spiral at the golden ratio; text halo (done by Claude, at the owner's request)

Owner: "centre it more on desktop and phone", then "the icons should start from one point and repeat at the same ratio as the spiral, as distance between them", then "do the golden ratio and where it comes over the text, make the text show more".

- The eye of the spiral is at the centre of the screen (wide 800,500; phone 273,600, unit 0.6).
- `chain` in `fibonacci()`: one icon per Fibonacci square (step 1), starting at square 7, so the distance between two neighbours grows by the golden ratio; the six icons repeat in order (tennis, whistle, stopwatch, volleyball, basketball, soccer). Sizes grow by 1.2 per step (the golden ratio would make the outer icons huge). Icons outside the screen are left out.
- Icons that pass behind the welcome text or the photo are drawn at 45% opacity (`chain.dim`).
- `design-background.css`: the welcome text (title, tagline, paragraph, link, steps) has a soft dark halo (`text-shadow`), so it reads clearly over the spiral.
- The hand-placed `items` list still works when `chain` is not given. `design-background.css?v=34`; SEO pages regenerated.

## 2026-11-24 (32): Fibonacci background brighter and clearer (done by Claude, at the owner's request)

Owner: "it does not show very well, work on it more".

- Lighter ball and object bodies, a softer form shadow, stronger sheen; seams and dial lines much more visible (`fibBrightDefs`, `fibBrighten`, used only by the Fibonacci composition).
- A soft light and a thin light ring around every icon; brighter spiral line, Fibonacci squares a bit more visible, stronger flight trails; icons about 10-20% bigger.
- `design-background.css`: the bottom fade of the background layer now covers only the last 16% of the screen (was 40%), so the icons near the spiral's eye are no longer darkened. The very bottom still ends in #011012 (no visible band against the phone bar).
- `design-background.css?v=33`; SEO pages regenerated. Checked at 1440×900, 1920×1080 and 390×844.

## 2026-11-24 (31): "Fibonacci" background: stopwatch, whistle and balls on a Fibonacci spiral (done by Claude, at the owner's request)

Owner: "I don't really like the background, I want it more coherent and beautiful; now it is arranged very badly. I want these icons, made very nicely: stopwatch, whistle, balls, the ball flight effects; arrange them along Fibonacci to start with, to see how it looks".

- `scripts/design/fundal-arena.mjs` draws the classic Fibonacci spiral: a quarter circle in each square of the tiling 1, 1, 2, 3, 5, 8, 13, 21, ... (`fibTiling`). The squares themselves are drawn barely visible.
- The eye of the spiral sits below the content, between the text and the photo; the spiral grows between them and sweeps over the content, so the large turns run through the free space at the top.
- Only the owner's icons: tennis ball, whistle, stopwatch, volleyball, basketball and soccer ball, in that order outwards. Each icon's size follows its Fibonacci square (small near the eye, big outside).
- Each ball flies outward along the spiral and leaves a light trail (a tapered shape fading towards the eye, plus two thin speed lines). The stopwatch and the whistle get a soft light behind them.
- Removed: the silk ribbons, trophy, medal, racket, pin, jersey, scoreboard and the other pieces of the previous layout. That layout still exists: `node scripts/design/fundal-arena.mjs --ref`.
- No icon touches the text, the photo cards, the gallery dots or the header (the generator warns otherwise; the checks use the measured boxes `FIB_ZONES_WIDE` / `FIB_ZONES_PHONE`).
- New options: `--dry` (do not write the CSS), `--debug` (with `--svg`: an overlay with numbered positions on the spiral, to place icons).
- `design-background.css?v=32`; SEO pages regenerated. Checked at 1440×900, 1920×1080 and 390×844. Restore tag: `design-before-fibonacci`.

## 2026-11-22 (30): Welcome-photo dots centred under the slider; pause button removed (done by Claude, at the owner's request)

Owner: "the dots under the slider where the sports move are not centred, and remove the pause button for the transition".

- `css/home-layout.css`: `.welcome-gallery-controls` uses `justify-content: center` (was `flex-end`). The photo is centred in its full-width frame, so the dots now sit under the middle of the photo.
- The pause button (`[data-gallery-toggle]`) is gone from `index.html`, and `js/home-gallery.js` no longer has a pause state. The rotation still stops while the visitor focuses the booking link, while a menu or dialog is open, while the tab is hidden, and with "reduce motion".
- `home-layout.css?v=29`, `home-gallery.js?v=8`; SEO pages regenerated.

## 2026-11-22 (29): Left column back at the left edge; phone whistle and stopwatch a little further left (done by Claude, at the owner's request)

Owner: "more to the left, you placed them badly; on the phone too, a bit more to the left".

- **Desktop:** the left column (reference pieces and `LEFT_EXTRA`) is glued to the left edge again (`xMinYMid`), at x≈64–70. The middle and right columns stay centred with the content.
- **Phone:** the whistle (x 246) and the stopwatch (x 344) moved left, just after the "Descoperă sporturile" link, without touching it.
- `design-background.css?v=31`; SEO pages regenerated. Checked at 1920×1080 and 390×844.

## 2026-11-22 (28): Desktop side pieces centred in the free margins; phone whistle and stopwatch further left (done by Claude, at the owner's request)

Owner: "put them more to the left on the phone; on desktop put them more to the centre".

- **Desktop:** all wide groups use `xMidYMid` (they used to be glued to the screen edges). The composition is now centred with the page content, so the side columns sit in the middle of the free side margins on every width: at 1920 they are well away from the screen edge, and at 1440, where the margin is narrow, they stay as far from the text as they can. The left extras moved to x≈96–100 accordingly.
- **Phone:** the whistle and the stopwatch moved left, right after the "Descoperă sporturile" link (x 262 and 372).
- `design-background.css?v=30`; SEO pages regenerated. Checked at 1440×900, 1920×1080 and 390×844.

## 2026-11-22 (27): Whistle and stopwatch on the phone too (done by Claude, at the owner's request)

Owner: "but you didn't put the stopwatch or the whistle" (they were on desktop only).

- `PHONE_EXTRA` in `scripts/design/fundal-arena.mjs`: a whistle and a stopwatch in the free spot right of the "Descoperă sporturile" link, below the jersey. They are placed first (`takenPhone`), so the reference pieces make room. On the phone the left side is all text, so this is the closest free spot.
- Desktop whistle a bit larger (88).
- `design-background.css?v=29`; SEO pages regenerated. Checked at 390×844 and 1440×900.

## 2026-11-22 (26): Bottom of the screen fades into the page colour; more pieces on the left (done by Claude, at the owner's request)

Owner: "it is not a black bar, it is a change of contrast; can't we make it the same colour?" and "add a whistle, a stopwatch etc. on the left".

- **Contrast at the bottom:** the background layer (glows + grain + icons) met the flat page / browser-bar colour at the bottom of the screen. A new top background layer on `.home-shell::after` (desktop and portrait) is a long eased gradient from transparent at 60% to exactly `#011012` at 100%, so the bottom edge is the same colour as what the phone shows below / around it.
- **Left side (desktop):** `LEFT_EXTRA` in `scripts/design/fundal-arena.mjs` adds a whistle (top), a volleyball, a medal and a trophy on the left edge. Together with the reference stopwatch they make an even column. They are placed first, so the reference pieces make room for them (`takenWide`).
- `design-background.css?v=28`; SEO pages regenerated. Checked at 1440×900, 1920×1080 and the phone page bottom.

## 2026-11-22 (25): No bounce strip at the bottom; icons laid out like the reference with no overlaps (done by Claude, at the owner's request)

Owner: "at the very bottom when I scroll there is an ugly bar; the icons are not placed nicely at all; look at the reference picture and place them that way".

- **Bar at the bottom while scrolling:** phones rubber-band / stretch the page at its end, and the pull showed a flat strip under the footer. `overscroll-behavior-y: none` on `html` and `body.pagina-publica` stops that pull. `theme-color` in `index.html` was still the old forest green `#101a14` (the colour phones use for their browser bars); it is now the page base `#011012`. The SEO pages were regenerated, so they carry the new value too.
- **Icons:** they follow the reference photo again (`REF` / `REF_RIBBONS`): a zigzag of big pieces, light ribbons sweeping between them, small marks in the gaps. `cleanRef()` adds two rules: a piece that would sit behind the text, the photo card, the steps row, the gallery dots, the header or the footer text is left out (no more dimmed icons under the text), and pieces never touch each other.
  - **Desktop:** the reference column drawn three times (left / centre / right), each showing a different stretch of it (top / middle / bottom), at 0.78 size.
  - **Phone:** the whole column across the width, as in the photo, with the same rules.
- `design-background.css?v=27`; SEO pages regenerated. Checked at 1440×900, 1920×1080 and 390×844 (top and bottom of the page).

## 2026-11-22 (24): Icons arranged in small stories, nothing overlaps or is cut; title 15% smaller (done by Claude, at the owner's request)

Owner: "title 15% smaller but still bigger than the text; the icons still overlap; give them a meaning, not random, it looks rather ugly"; then "extend it downward too, it looks ugly that it gets cut".

- **Title:** `clamp(36px, 3.6vw, 53px)` (phone `clamp(29px, 8.5vw, 36px)`), still above the tagline (max 28px).
- **Desktop** (the reference layout is no longer used for wide screens): every piece sits in a free area, never behind the text or the photo card, and each group tells a small story:
  - left column (`xMinYMid`): basketball shot into the hoop on a dashed arc, then volleyball, medal and trophy at even spacing;
  - right column (`xMaxYMid`): stopwatch, the racket with the tennis ball and its light trail, the whistle, the location pin, and the soccer ball with a trail that fades in from the left and stays fully on screen (it used to run off the bottom edge);
  - top band: the scoreboard and a few small marks; bottom band: the booking path jersey, calendar, pin and stopwatch, linked by dashed arcs.
  - Checked at 1440×900 and 1920×1080: no overlaps, nothing cut.
- **Phone:** top as before (basketball with trail, racket). The bottom row (soccer ball, stopwatch, trophy) moved down, so it sits between the last box and the footer text instead of being cut by the box.
- `design-background.css?v=26`; SEO pages regenerated.

## 2026-11-22 (23): "SPOTIVITY" bigger than the tagline (done by Claude, at the owner's request)

Owner: "make the text a bit smaller and Spotivity bigger, the title should be bigger than the tagline".

- Blue uppercase title: `clamp(42px, 4.2vw, 62px)`, weight 750, letter spacing .05em (phone `clamp(34px, 10vw, 42px)`).
- White tagline: `clamp(22px, 1.9vw, 28px)`, weight 600 (phone `clamp(19px, 5.2vw, 22px)`).
- `design-background.css?v=25`; SEO pages regenerated. Checked at 1440×900 and 390×844.

## 2026-11-22 (22): Title back to the blue label style; no darkening at the bottom; fewer, tidier icons on the phone (done by Claude, at the owner's request)

Owner: "the title is too big, make it like before in blue but a bit bigger; the picture still has the black bar; too many icons on the phone, make the arrangement nicer".

- **Title:** "Spotivity" (the h1) is back in the blue label style it had before (11): `--design-blue`, uppercase, letter spacing .16em, but larger: `clamp(17px, 1.35vw, 21px)` (was 12px; phone 15px, was 10px). The tagline is the white headline: `clamp(32px, 3.1vw, 46px)`, weight 650 (phone `clamp(28px, 7.6vw, 34px)`).
- **Black bar:** the darkening at the bottom of the picture is gone. `bottomFade` from (20) was removed, and the vignette is now sides-only (a linear left/right gradient, nothing at the top or bottom edge), so on a real phone, where the toolbar hides part of the 100lvh layer, no darker band shows near the bottom.
- **Phone:** its own calm layout instead of the full reference column. At the top: the basketball with its light trail right of the title, the racket right of the green button, and a few small marks. At the bottom (seen between sections while scrolling): two staggered rows, soccer ball / stopwatch / trophy, then whistle / volleyball, kept clear of the footer text. 7 icons instead of 16.
- **Desktop:** the top-left soccer ball moved left and got smaller (`REF` 62,62 at 1.5), so it no longer touches the label.
- `design-background.css?v=24`; SEO pages regenerated. Checked at 1440×900 and 390×844 (top, bottom of the page).

## 2026-11-22 (21): Smaller "Spotivity" title (done by Claude, at the owner's request)

Owner: "you made Spotivity too big; same style as before but a bit smaller, it is exaggerated now".

- `css/design-background.css`, home title block: the brand title went from `clamp(64px, 7vw, 104px)` to `clamp(50px, 5.2vw, 78px)`; phones (≤767px) from `clamp(52px, 15vw, 72px)` to `clamp(42px, 12vw, 56px)`. Same weight, letter spacing and colour; the tagline is unchanged.
- `design-background.css?v=23`; SEO pages regenerated.

## 2026-11-22 (20): No dark band at the bottom of the phone page (done by Claude, at the owner's request)

Owner: "the line at the bottom on the phone is back".

- **Cause:** the footer gradient from (14) ended in a solid band of the base colour `#011012`. Over the now brighter background (bottom glow and bright icons since (18)/(19)), that band read as a dark strip at the very bottom.
- **Fix:** the footer is fully transparent (`css/design-background.css`). Instead, the background picture fades softly into the base colour along its own bottom edge (`bottomFade` in `layout()`, from 80% to 100% of the height), so whatever a phone shows below the page (overscroll, toolbar area) matches it with no edge. The phone's bottom-left glow moved up and was softened.
- `design-background.css?v=22`; SEO pages regenerated. Checked at the bottom of the page and while scrolling at 390×844.

## 2026-11-22 (19): Reference layout spread evenly and centred on desktop; softening only right behind text (done by Claude, at the owner's request)

Owner: "on desktop it looks ugly; on the phone it is better but you can do better; on desktop centre them a bit more".

- **Desktop:** the photo's layout now fills the whole screen evenly instead of hugging the edges. Its top half fills the left half (`WL`: x×1.42, y×1.03, from below the header) and its bottom half fills the right half (`WR`). Only pieces right behind the text block or the photo card are softened (`behindWide` zones, opacity 0.2); everything else is at full strength. The middle extras (scoreboard, hoop, pin group) were removed because the layout now covers the middle.
- **Phone:** the same per-piece rule (`behindPhone`): pieces at the edges stay bright, those right behind the text block are softened (0.35). The drawing starts a little lower (`235 + y×0.585`), so it clears the header.
- `zoned()` splits a reference half into a clear group and a softened group. `design-background.css?v=21`; SEO pages regenerated. Checked at 1440×900, 1920×1080 and 390×844.

## 2026-11-22 (18): Arena icons laid out like the owner's reference photo (done by Claude, at the owner's request)

Owner: "not good, you cut the icons down drastically; look at the example I sent and lay them out the same way, but with your icons; the ones from the previous push look good".

- `REF` / `REF_RIBBONS` in `scripts/design/fundal-arena.mjs` hold the positions measured from `Desktop\Spotivity\FundalFinal.jpeg` (547×1600, taken from the old `fundal-final.mjs`): 16 icons, the small marks (dots, rings, crosses, plus signs) and the 10 light ribbons. `refGroup()` maps them into a group and draws them with the 3D icons. The second trophy became the medal, the second whistle the pin and the second jersey the calendar, so the icon set from the previous push stays.
- **Desktop:** the photo's column is split in two. Its top half runs down the left edge (x×0.62), its bottom half down the right edge. The drawing starts below the two header bars. Pieces that reach in under the text or the photo card are softened (`dim: 0.32`). The scoreboard, the hoop shot and the pin from the previous push stay in the middle.
- **Phone:** the whole column across the full width, as in the photo, fitted into 547×1184 (upper half glued to the top, lower half to the bottom, scaled to fit), so nothing is cut. Softened (0.55 / 0.6) because the text covers the whole width.
- `decor()` draws the small marks; layout groups take a `decor` list. `design-background.css?v=20`; SEO pages regenerated. Checked at 1440×900, 1920×1080 and 390×844 (plus phone scroll).

## 2026-11-22 (17): Arena icons rearranged on a clear structure (done by Claude, at the owner's request)

Owner: "I like the icons but they are arranged very badly on the page, on both desktop and phone".

- **Desktop:** one column on each side margin (`xMinYMid` / `xMaxYMid` groups). Pieces sit every ~165 units with a gentle zigzag, and the big pieces are in opposite corners (basketball top left, soccer ball bottom right). The other pieces sit only in free areas: the scoreboard and the tennis ball with its trail in the top band, the jersey between the text and the photo, the hoop shot and the pin in the bottom band. The duplicate stopwatch, the whistle in the middle and the scattered calendar position are gone (the whistle and the calendar now sit in the side columns).
- **Phone:** the top screen only uses the free spots next to the text: the basketball with its trail right of the title, and the hoop with a small ball on a dashed shot right of the green button. Below the text there is one tidy row of three (stopwatch, trophy, racket), glued to the bottom edge, which shows between sections while scrolling. Nothing sits behind the "01/02/03" steps any more.
- `design-background.css?v=19`; SEO pages regenerated. Checked at 1440×900, 1920×1080 and 390×844 (plus phone scroll).

## 2026-11-22 (16): Arena objects glued to screen corners, never cut; phone layout redone with items in the middle (done by Claude, at the owner's request)

Owner: "great, it looks good, but at the bottom things get cut, and at the sides on the phone; I also want things in the middle, please redo it".

- **Why things were cut:** the picture was one fixed-ratio image (cover on desktop, full width on phones), so every screen shape cropped it differently.
- **New method (`layout()` in `scripts/design/fundal-arena.mjs`):** the SVG has no fixed size and is shown with `background-size: 100% 100%`. Inside it:
  - one `xMidYMid slice` layer holds the atmosphere (glows, light particles) and always fills the screen;
  - the objects sit in groups (`xMinYMin`, `xMidYMin`, `xMaxYMin`, `xMinYMax`, `xMidYMax`, `xMaxYMax`), each a nested `<svg preserveAspectRatio="<align> meet">`. A group is glued to its corner or edge and scaled down until it fits, so no object is ever cut, on any screen;
  - all groups share the same coordinates (1600×1000 wide, 600×1400 portrait), so it still reads as one composition. Ribbons travel with the ball they trail. A group can be softened with `dim`.
- **Phone layout redone:** a right column next to the text (basketball and trail, stopwatch, racket, medal, volleyball); in the middle a softened pin and tennis ball; at the bottom (glued to the bottom edge, ~90 units kept free for the browser bar) the jersey, calendar, soccer ball, a big stopwatch, the hoop shot, the whistle and the trophy. Checked at 390×844, 360×640 and 430×932, and in phone scroll.
- **Desktop:** same composition, now fully on screen (the basketball, soccer ball and stopwatch were partly cut before). Checked at 1440×900 and 1920×1080.
- CSS: both pictures `background-size: 180px 180px, 100% 100%`; the portrait-tablet `center 55%` rule is removed. `design-background.css?v=18`; SEO pages regenerated. The scroll measurement is unchanged (as smooth as with no background).

## 2026-11-22 (15): Arena without the pitch and floodlights; hoop shot, jersey, light particles; racket fully visible (done by Claude, at the owner's request)

Owner: "remove the pitch with the lighting, centre the tennis racket better, work a bit more on the design and play with the symbols". Asked to clarify: remove the whole pitch AND the floodlights.

- Removed from both scenes: the perspective pitch (lines, stripes, goals, nets, flags), the training cones, the light pool on the grass, the floodlight masts and the corner light beams. `scene()` now draws the pitch only if a `cam` is given, so `pitch()` stays in the script and can come back. The contact shadows under the soccer ball and the trophy are gone (no floor any more).
- **New:** a floating basketball `hoop` (backboard, target square, glowing rim, net) with a small basketball on a dashed flight path into it (`arcs`, desktop); the `jersey` with a lit 10 (desktop between the text and the photo, phone at the right edge); fine light particles (`sparkles`, fixed seed, dimmed behind the text); a soft glow low in the middle where the grass was.
- **Racket:** desktop `[1548, 338]`, rotation 16, so the whole racket is on screen (it was cut by the right edge). On the phone it moved to the right edge next to the green button (it sat behind "01 Alegi terenul"). The medal was dropped on the phone to keep that edge calm.
- `design-background.css?v=17`; SEO pages regenerated. Checked on the real page at 1440×900, 1920×1080, 768×1024 and 390×844, plus phone scroll positions.

## 2026-11-22 (14): Footer melts into the background; floodlights, location pin, LED scoreboard, booking calendar, racket, medal (done by Claude, at the owner's request)

Owner: "at the very bottom on the phone there is a black line, get rid of it; I want more of those graphics, be inventive".

- **Black line at the bottom:** it was the footer, an opaque dark band (`--design-bar`) with a 1px line on top that cut the background off. In `css/design-background.css` (new block before the home title block) the footer is now a transparent-to-base gradient with no line. Its last colour is the page base `#011012`, so the iOS overscroll area below it matches too.
- **New objects** (`Object.assign(objects, ...)` in `scripts/design/fundal-arena.mjs`), all in the back-lit 3D style:
  - `floodlight`: lattice mast on the horizon, lamp head, glow and a soft light cone onto the pitch;
  - `pin`: location pin hovering over the grass with pulse rings (the "spot" of Spotivity);
  - `scoreboard`: hanging board with real seven-segment LED digits (lit segments glow, unlit ones stay as faint ghosts), showing 2:1;
  - `calendar`: booking card with one day ticked;
  - `racket` (strings clipped to the head, wrapped grip) and `medal` on a ribbon;
  - `jersey` with a lit 10 is also available, but not placed yet.
- New gradients: `lampBeam`, `lampGlow`, `pinPool`. Still no SVG filters.
- Placement was checked on the real page at 1440×900, 1920×1080 and 390×844 (nothing behind the title, buttons or the steps row). `design-background.css?v=16`; SEO pages regenerated.

## 2026-11-22 (13): Arena: scroll fix, stopwatches, whistle, trophy, cones, goals and corner flags (done by Claude, at the owner's request)

Owner: "the idea is good but make it much better; there are bugs when I scroll; add the stopwatches and the whistle and a few more things in the same artwork".

- **Scroll fix** (`css/design-background.css`, Arena block): the fixed layer is now `inset: 0 0 auto 0; height: 100lvh` (fallback `100vh`), so it no longer resizes when a phone's address bar slides in or out (each resize re-rasterised the whole picture: stutter or a jump). It is also promoted to its own GPU layer (`transform: translateZ(0)`, `will-change: transform`, `contain: strict`).
- **No SVG filters left** in the generator (the Gaussian blurs on beams and out-of-focus balls were the expensive part of every re-raster). Beams are now three nested gradient cones; balls are sharp.
- Measured in Edge (phone emulation, CPU slowed 4x): scrolling with the background is as smooth as with no background at all. The rare ~120 ms frames that remain also happen without it, so they come from the rest of the page.
- **New objects** in the same back-lit 3D style (`objects` in `scripts/design/fundal-arena.mjs`): a stopwatch (crown, pushers, rim-lit case, dial with 60 ticks, sub-dial, glowing hand, glass sheen), a whistle with a lanyard cord and sound waves, a trophy with a glowing star, and training cones standing on the pitch in perspective. The pitch now also has goals with nets and corner flags.
- Placement: desktop has a big stopwatch at the left edge, a small one top right, the whistle above the photo card, the trophy bottom left and a cone slalom near the centre circle. Phone has the stopwatches at the edges and the whistle, trophy and cones low on the right.
- Cones are placed by screen position (`cones: [[x, y], ...]`, converted to the grass by `unproject`). `design-background.css?v=15`; SEO pages regenerated.
- **Revert:** `git revert` this commit then `node scripts/generate-seo-pages.mjs`; tag `design-before-arena` = before Arena.

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
