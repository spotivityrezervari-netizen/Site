# Parallel work (read first)

Two AI agents may work in this same folder at the same time. One does design (`Idee Site/css/**`, `Idee Site/assets/imagini/**`); Claude does everything else. Before starting, read `C:\Users\Naznean Paul\Desktop\Spotivity\LUCRU-IN-PARALEL.md`. Short version:
- Never stage, revert, stash or delete files you did not change. Add your files by name; never use `git add -A`, `git add .`, `git commit -a`, `git stash`, `git restore`, `git checkout --`, `git reset --hard`, `git clean` or `git push --force`.
- Run `git pull --rebase origin main` before you push. Make small commits right after each change. After editing `index.html`, regenerate the SEO pages and commit them together.

# Deployment preference

spotivity.ro is live on Netlify, and only the owner decides when it is published. Don't create Netlify deployments, trigger build hooks, or start Netlify builds unless the owner asks for that deploy explicitly.

Push changes to GitHub as requested. Include `[skip netlify]` in every pushed commit message so Git pushes don't trigger Netlify builds.

Database changes go in a new numbered migration in `Idee Site/supabase/` (next: `050_…`). Never edit or re-run a migration that is already applied. Apply migrations as `supabase db query --remote --yes -f "<file>"` from `Desktop\Spotivity\supabase`. Paths are resolved from `Desktop\Spotivity`. Preserve other contributors' changes. Updating the Supabase email backend is separate from publishing the site to Netlify.

# Browser security

Browser HTML, CSS, JavaScript, and the Supabase anonymous key are public. Do not treat blocked F12, disabled right-click, minification, or hidden controls as authorization. Keep privileged keys and automation webhook URLs on the server, and enforce account/court/base permissions with Supabase RLS and server functions.

Preserve the strict CSP and no-referrer metadata before page resources, escape untrusted markup, and validate stored links with the shared URL helper. Before pushing public changes, run `node --test scripts/tests/build-public.test.mjs` and `node scripts/build-public.mjs`; only reviewed browser files may enter the public artifact.
