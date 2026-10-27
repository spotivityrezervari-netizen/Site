// js/db.js

// Aici extragem funcția de creare a conexiunii din biblioteca Supabase
const { createClient } = supabase;

// Datele tale reale (extrase din cheia ta!)
const supabaseUrl = 'https://ndubcdwohqzgxpuiowye.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kdWJjZHdvaHF6Z3hwdWlvd3llIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1ODIxMjYsImV4cCI6MjEwMTE1ODEyNn0.in5vgHm5P87HTACR_S8SVln-_3rf_u2la8XssQoguMY';

// New OAuth and reset links use PKCE. Older password-reset emails still carry
// an implicit token hash, which the SDK must verify using its matching flow.
const legacyAuthHash = new URLSearchParams(window.location.hash.slice(1));
// Capture only recovery UI context before the SDK consumes its PKCE verifier.
// This marker never authorizes a password change; a verified Auth session does.
window.isSpotivityRecoveryCallback = (() => {
    const initialUrl = new URL(window.location.href);
    let recovery = initialUrl.searchParams.get('type') === 'recovery'
        || legacyAuthHash.get('type') === 'recovery';
    const callback = ['code', 'error', 'error_code'].some(key => initialUrl.searchParams.has(key))
        || ['error', 'error_code'].some(key => legacyAuthHash.has(key));
    if (!recovery && callback) {
        try {
            const storageKey = 'sb-' + new URL(supabaseUrl).hostname.split('.')[0] + '-auth-token-code-verifier';
            const verifier = JSON.parse(localStorage.getItem(storageKey) || 'null');
            recovery = typeof verifier === 'string' && verifier.endsWith('/recovery');
        } catch { /* An unavailable verifier cannot authorize or restore a session. */ }
    }
    return () => recovery;
})();
const db = createClient(supabaseUrl, supabaseKey, {
    auth: {
        flowType: legacyAuthHash.has('access_token') || legacyAuthHash.has('refresh_token')
            ? 'implicit' : 'pkce'
    }
});

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
