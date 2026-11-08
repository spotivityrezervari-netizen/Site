# Public sport pages

The homepage in `Idee Site/index.html` is the shared application shell. Its five
reviewed sport sections generate the real category pages under
`Idee Site/terenuri/`. Each page has one selected sport, unique Romanian copy,
static public court names, a canonical URL and links to the other sports. The
existing booking flow reloads the court and checks its current schedule; the
snapshot never promises current availability.

After changing the shell or the approved public snapshot, run:

```sh
node scripts/generate-seo-pages.mjs
node scripts/generate-seo-pages.mjs --check
node --test scripts/tests/*.test.mjs
node scripts/build-public.mjs
```

Commit the generated `Idee Site/terenuri/*/index.html`, `robots.txt` and
`sitemap.xml` together with the shared shell. The build rejects stale generated
source before replacing a valid `dist` directory. It copies only explicitly
reviewed browser assets; it never publishes `scripts/` or backend source.

## Refresh the public catalog

Refresh explicitly when active courts, public names, cities or prices change:

```sh
node scripts/refresh-seo-catalog.mjs
node scripts/generate-seo-pages.mjs
```

The refresh script uses only the existing public anonymous Supabase identity.
It requests an explicit field list, filters active courts and their active
public bases, and saves only `id`, `nume`, `sport`, `oras`, `pret`. It never uses
a service key or fetches customers, administrators, reservations or contact
details. Review the snapshot and generated diff before pushing. Builds work
offline and do not fetch live data. Runtime discovery refreshes the displayed
catalog; static prices include their snapshot date and are rechecked when a
visitor opens a court.

## Hosting URLs

Checked-in documents use canonical URLs and sitemap entries for the current
GitHub Pages location:
`https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/`.
The safe Netlify build regenerates the same routes with `https://spotivity.ro/`
canonical, Open Graph and sitemap URLs. Relative resource links support both
hosting roots without a `<base>` element or a client-side canonical change.
The strict CSP and no-referrer metadata remain in every generated document.

`robots.txt` becomes effective at the domain root on Netlify. GitHub Pages
publishes this app inside a subdirectory, so that file cannot control crawling
for the `github.io` origin. When the final domain is launched, update the Pages
canonical policy to the production domain or retire the public staging site to
avoid maintaining two indexable copies. Do not add an SPA catch-all rewrite:
these pages are ordinary directories with `index.html` and unknown routes
should remain 404.

Generating or building locally does not deploy the site. While Netlify remains
paused, pushed commits must retain `[skip netlify]` as required by `AGENTS.md`.
