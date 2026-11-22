# Public sport, court and sports-base pages

`Idee Site/index.html` is the shared application shell. Its five sport sections
generate the category pages under `Idee Site/terenuri/`. Every published public
court and sports base also has an ordinary static HTML page with its own title,
description, H1, canonical URL and crawlable links. The homepage booking buttons
open the existing court chooser directly; sport navigation links still reach the
category pages. JavaScript enhances the same pages with the existing live booking
and base dialogs, while their names, locations and links remain readable without it.

The homepage has one main heading for booking sports courts; its five sport
headings follow at level two. Generated category, court and base pages remove
that homepage introduction and each retain one page-specific main heading.

`js/seo-data.js` shares the structured-data rules between static generation and
browser navigation. Every page includes one `application/ld+json` block with
Spotivity's public brand organization, website and page identity. Categories,
courts and bases also describe their visible breadcrumbs. Bases use
`SportsActivityLocation`; courts use `Place` and reference their actual base
when public membership is known. Locations include only the published city in
`PostalAddress.addressLocality`. The graph adds no legal company details,
street address, coordinates, ratings, hours, search action or availability.
Opening another published entity updates the block, and closing its dialog or
returning through browser history restores the original page graph.

JSON remains parseable data with literal quotation marks. The serializer escapes
`<`, `&` and Unicode line separators so public names cannot close the script
element. The block follows the existing strict CSP; it adds no executable inline
script and needs no weaker script policy.

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

## Addresses for every list, court and base (2026-11-22)

At the owner's request every public view has its own readable address:

- Opening a sport's court list pushes `terenuri/<sport>/`. Choosing a city in the open list replaces it with `terenuri/<sport>/<city>/`; on other hosts the sport address stays, because only spotivity.ro can serve a city page that was not generated yet. Closing the list goes back through history, and Back from a court opened in the list reopens the list with its filters.
- A court or base without a generated page uses its path from `js/entity-paths.js` on spotivity.ro (`teren/<sport>/<city>/<name>-<id>/`, `baze-sportive/<city>-<name>-<id>/`) instead of the `?teren=` query. Other hosts keep the query link.
- The production build writes `app.html`, the home shell with root-absolute references and `noindex,follow`, and four non-forced `_redirects` rewrites (`/teren/:sport/:city/:court`, `/teren/:sport/:court`, `/terenuri/:sport/:city`, `/baze-sportive/:base`) to it. Netlify serves an existing file first, so generated pages and aliases always win. `js/public-navigation.js` reads the trailing ID (or the sport and city) from the address. The ID is only a lookup key, and the dialog rereads the court or base under RLS. A retired ID shows the existing "not available" message on the noindex shell.
- Netlify runs `scripts/netlify-build.mjs`: it refreshes the public catalog, regenerates the pages, then runs the reviewed build. Each deploy therefore publishes generated pages for new courts and bases. If the refresh or the regeneration fails, the committed snapshot is restored and the deploy uses it.

## All courts: terenuri/ (2026-11-22)

`terenuri/` is a generated, indexable page with every published court grouped by sport, links to every sport and city page, and a general FAQ. Its structured data is a `CollectionPage` (`kind: 'catalog'` in `js/seo-data.js`). It is in the sitemap. Every breadcrumb, visible and structured, now reads Acasă › Terenuri › Terenuri de <sport> › … .

The homepage "Rezervă un teren" button opens the search over every court at `terenuri/`, with that page's title, description and canonical (`SpotivityNavigation.enterSearch`/`leaveSearch`). A typed query becomes `terenuri/?q=…`, which is never indexed. Closing the search, or Back, returns to the previous address.

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

Commit the generated source HTML, `js/seo-route-index.js`,
`js/seo-alias-redirect.js`, `robots.txt`, `sitemap.xml`, snapshot,
`scripts/seo-route-history.json` and updated `scripts/public-files.json` together
with the shared shell. The route history records every reviewed public path by
stable court/base ID. Preserve it across refreshes: after a rename, city change,
sport change or base reassignment, every historical active path points directly
to the latest canonical path, including after several changes or a name revert.

GitHub Pages serves a small `noindex,follow` alias page with the current canonical
URL, an ordinary destination link and an external CSP-compatible redirect script.
The script preserves query/hash intents such as Auth recovery and cancellation.
The production build emits forced one-hop HTTP301 rules in `dist/_redirects` for
Netlify; building this file does not deploy anything. Alias paths stay out of the
sitemap. Retired/deleted identities lose their marked pages and aliases, giving
real404 responses; their history remains recorded for a later reactivation.
Unmarked contributor documents remain untouched and an unowned document at a
required path is never overwritten.

`--check` refuses missing, changed or obsolete generated documents and manifest
drift. The public build derives its exact complete entity path set from the
validated snapshot, rejects unknown nested HTML, and scans both the source and
production bytes. It replaces `dist/` only after all checks pass. Neither the
snapshot nor development/backend scripts enter the public artifact.

## Hosting URLs

Checked-in documents and sitemap entries use the current GitHub Pages prefix:
`https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/`.
The safe Netlify build regenerates the same routes with `https://spotivity.ro/`
canonical, Open Graph, structured-data and sitemap URLs. Every structured-data
identity and breadcrumb uses the same deployment root as its canonical URL,
including the production homepage graph. Court pages resolve resources from three
levels below the app root; bases and categories use two. No `<base>` element or
client-only metadata is required for indexable pages. Strict CSP and no-referrer
metadata precede resources in every generated document.

`robots.txt` controls the domain root on Netlify. GitHub Pages publishes this app
inside a subdirectory, so its nested file cannot control the `github.io` origin.
When the final domain launches, update the Pages canonical policy to production
or retire the staging copy. Unknown routes remain 404; do not add an SPA catch-all.

Local generation/building does not deploy the site. While Netlify remains
paused, pushed commits must retain `[skip netlify]` as required by `AGENTS.md`.
