# Public sport, court and sports-base pages

`Idee Site/index.html` is the shared application shell. Its five sport sections
generate the category pages under `Idee Site/terenuri/`. Every published public
court and sports base also has an ordinary static HTML page with its own title,
description, H1, canonical URL and crawlable links. The homepage booking buttons
open the existing court chooser directly; sport navigation links still reach the
category pages. JavaScript enhances the same pages with the existing live booking
and base dialogs, while their names, locations and links remain readable without it.

URL rules live in the shared browser/CommonJS helper `js/entity-paths.js`:

- Courts: `terenuri/{sport}/{city}-{base-name-if-present}-{court-name}-{full-id}/`.
- Sports bases: `baze-sportive/{city}-{base-name}-{full-id}/`.

For example, a football court at Baza Transilvania in Târgu Mureș can use
`terenuri/fotbal/targu-mures-baza-transilvania-teren-sintetic-12/`.
The city also appears in each page's title, description and main heading.

Cities and names use bounded ASCII slugs, including Romanian diacritic normalization. The
full stable ID prevents collisions when different courts share a name. The public
`js/seo-route-index.js` contains only IDs and the exact generated relative paths.
The runtime uses that index for published clean URLs. A newly added court/base
that has not been generated yet uses a working query link with its ID, name and city;
regenerate the public snapshot/pages to give it a static indexable URL. A URL is
never authorization: the dialog reloads the court/base under the normal public
permissions and rechecks availability before a booking.

## Regenerate after public changes

Refresh when active courts, their public names, cities, base membership, prices
or sports-base public descriptions change:

```sh
node scripts/refresh-seo-catalog.mjs
node scripts/generate-seo-pages.mjs
node scripts/generate-seo-pages.mjs --check
node --test scripts/tests/*.test.mjs
node scripts/build-public.mjs
```

If only the shared HTML shell changes, omit the live refresh command. All builds
work offline from the reviewed snapshot; generation never fetches privileged
backend data. The refresh script uses the existing anonymous browser identity
and explicit public field lists. Snapshot version 2 contains only:

- Courts: `id`, `nume`, `sport`, `oras`, `pret`, `baza_sportiva_id`.
- Bases: `id`, `nume`, `oras`, `descriere`.

Inactive courts/bases and bases with no published active courts are excluded.
Standalone active courts remain supported. No customer, administrator, booking,
contact, token or service-key data is fetched or saved. Review the snapshot and
generated diff before pushing. Static prices carry their snapshot date, and the
runtime rechecks their current values and schedule when opening a court.

Commit the generated source HTML, `js/seo-route-index.js`, `robots.txt`,
`sitemap.xml`, snapshot and updated `scripts/public-files.json` together with the
shared shell. Generation updates only the reviewed generated entries in the
manifest. It marks owned pages and removes obsolete marked entity files when a
name changes or inventory is retired; unmarked contributor documents are kept,
and an unowned file at a required entity path is never overwritten. Names are
part of the canonical URL, so treat public renames as URL changes and review any
external links that need updating before publication.

`--check` refuses missing, changed or obsolete generated documents and manifest
drift. The public build derives its exact complete entity path set from the
validated snapshot, rejects unknown nested HTML, and scans both the source and
production bytes. It replaces `dist/` only after all checks pass. Neither the
snapshot nor development/backend scripts enter the public artifact.

## Hosting URLs

Checked-in documents and sitemap entries use the current GitHub Pages prefix:
`https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/`.
The safe Netlify build regenerates the same routes with `https://spotivity.ro/`
canonical, Open Graph and sitemap URLs. Court pages resolve resources from three
levels below the app root; bases and categories use two. No `<base>` element or
client-only metadata is required for indexable pages. Strict CSP and no-referrer
metadata precede resources in every generated document.

`robots.txt` controls the domain root on Netlify. GitHub Pages publishes this app
inside a subdirectory, so its nested file cannot control the `github.io` origin.
When the final domain launches, update the Pages canonical policy to production
or retire the staging copy. Unknown routes remain 404; do not add an SPA catch-all.

Local generation/building does not deploy the site. While Netlify remains
paused, pushed commits must retain `[skip netlify]` as required by `AGENTS.md`.
