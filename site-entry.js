// GitHub Pages starts at the repository root; Netlify publishes the app itself.
(() => {
    'use strict';
    const destination = new URL('./Idee%20Site/', document.currentScript?.src || window.location.href);
    // Keep shared court links and authentication/recovery callbacks intact.
    destination.search = window.location.search;
    destination.hash = window.location.hash;
    window.location.replace(destination.href);
})();
