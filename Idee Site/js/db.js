// js/db.js

// Aici extragem funcția de creare a conexiunii din biblioteca Supabase
const { createClient } = supabase;

// Datele tale reale (extrase din cheia ta!)
const supabaseUrl = 'https://ndubcdwohqzgxpuiowye.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kdWJjZHdvaHF6Z3hwdWlvd3llIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1ODIxMjYsImV4cCI6MjEwMTE1ODEyNn0.in5vgHm5P87HTACR_S8SVln-_3rf_u2la8XssQoguMY';

// Creăm conexiunea globală la baza de date
const db = createClient(supabaseUrl, supabaseKey);

// Capture a verified recovery event before the deferred app script loads.
// Keep it in memory only; a URL parameter alone never authorizes a reset.
(() => {
    let pendingRecoverySession = null;
    db.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') pendingRecoverySession = session;
        else if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN'
            && pendingRecoverySession && session?.user?.id !== pendingRecoverySession.user?.id)) {
            pendingRecoverySession = null;
        }
    });
    window.takeSpotivityRecoverySession = () => {
        const session = pendingRecoverySession;
        pendingRecoverySession = null;
        return session;
    };
})();

console.log('Client Supabase inițializat.');

