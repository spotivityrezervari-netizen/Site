# Deployment preference

The user has paused Netlify publishing to conserve credits. Until the user explicitly requests it again, do not create Netlify deployments, trigger build hooks, or start Netlify builds.

Push changes to GitHub as requested. Include `[skip netlify]` in each pushed commit message to skip Git-triggered Netlify builds. Preserve other contributors' changes. Updating the Supabase email backend is separate from publishing the site to Netlify.
