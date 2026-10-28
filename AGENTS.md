# Deployment preference

The user has paused Netlify publishing to conserve credits. Until the user explicitly requests it again, do not create Netlify deployments, trigger build hooks, or start Netlify builds.

Push changes to GitHub as requested. Include `[skip netlify]` in each pushed commit message to skip Git-triggered Netlify builds. Preserve other contributors' changes. Updating the Supabase email backend is separate from publishing the site to Netlify.

# Browser security

Browser HTML, CSS, JavaScript, and the Supabase anonymous key are public. Do not treat blocked F12, disabled right-click, minification, or hidden controls as authorization. Keep privileged keys and automation webhook URLs on the server, and enforce account/court/base permissions with Supabase RLS and server functions.

Preserve the strict CSP and no-referrer metadata before page resources, escape untrusted markup, and validate stored links with the shared URL helper. Before pushing public changes, run `node --test scripts/tests/build-public.test.mjs` and `node scripts/build-public.mjs`; only reviewed browser files may enter the public artifact.
