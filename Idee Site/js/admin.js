/* Administration is hosted in index.html. Feature factories share one live session context. */
(() => {
    'use strict';
    document.addEventListener('DOMContentLoaded', () => {
        const modules = window.SpotivityModules;
        const context = modules.adminCore(db);
        modules.adminSchedule(context);
        modules.adminBookings(context);
        modules.adminCourts(context);
        modules.adminAllocations(context);
        modules.adminHistory(context);
        context.chat = modules.adminChat(context);
        modules.adminCourtView(context);
        context.start();
    });
})();
