// Public application composition. Feature modules own their DOM bindings and
// private request guards; mutable identity/catalog data stays in one context.
(() => {
    'use strict';
    const modules = window.SpotivityModules;
    const context = {
        db, createClient, supabaseUrl, supabaseKey,
        state: { user: null, authGeneration: 0, courts: [], sport: '' },
        services: {}
    };
    const { services } = context;

    modules.publicI18n(context);
    // Register before DOMContentLoaded and before any catalog/Auth awaits, so a
    // verified recovery event captured during SDK startup is never lost.
    modules.publicRecovery(context);

    document.addEventListener('DOMContentLoaded', async () => {
        services.ui = modules.publicUi(context);
        services.profile = modules.publicProfile(context);
        services.courts = modules.publicCourts(context);
        services.bookings = modules.publicBookings(context);
        services.history = modules.publicHistory(context);

        window.schimbaLimba(window.lang);
        await services.courts.load();
        services.courts.populateCities();
        await services.profile.restore();

        services.chat = modules.publicChat(context);
        services.auth = modules.publicAuth(context);
        services.profile.mount();
        services.ui.mount();
        services.auth.mount();
        services.history.mount();
        services.bookings.mount();
        services.courts.mount();
        services.chat.mount();
        services.auth.watchIdentity();
        services.emailLinks = modules.emailLinks(context);
        services.emailLinks.mount();
    });
})();
