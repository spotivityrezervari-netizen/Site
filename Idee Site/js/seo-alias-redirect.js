// Generated public alias navigation. No inline script is needed.
(function redirectSeoAlias() {
  'use strict';
  try {
    const script = document.currentScript;
    const link = document.getElementById('seo-alias-destination');
    if (!script?.src || !link) return;
    const root = new URL('../', script.src);
    const destination = new URL(link.href, location.href);
    if (destination.origin !== location.origin || destination.origin !== root.origin
      || !destination.pathname.startsWith(root.pathname)) return;
    const relative = destination.pathname.slice(root.pathname.length);
    if (!/^(?:(?:teren\/(?:fotbal|baschet|tenis|volei|tenis-de-picior)\/(?:[a-z0-9-]+\/)?[a-z0-9-]+|terenuri\/(?:fotbal|baschet|tenis|volei|tenis-de-picior)\/[a-z0-9-]+)|baze-sportive\/[a-z0-9-]+)\/$/.test(relative)) return;
    // Auth/recovery and signed cancellation intents must survive an old slug.
    destination.search = location.search;
    destination.hash = location.hash;
    if (destination.href !== location.href) location.replace(destination.href);
  } catch {
    // The ordinary destination link remains usable without redirect support.
  }
})();
