// ESLint for the browser code in `Idee Site/js`: catches real mistakes
// (undefined names, unreachable code, wrong comparisons). It does not enforce a
// style. Run: npx eslint   (CI installs eslint and globals; see ci.yml).
'use strict';
const globals = require('globals');

module.exports = [
    { ignores: ['dist/**', '**/node_modules/**', '.public-build-*/**'] },
    {
        files: ['Idee Site/js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                // Supabase SDK loaded from the pinned CDN script.
                supabase: 'readonly',
                // Shared top-level constants declared once in js/db.js.
                createClient: 'readonly',
                supabaseUrl: 'readonly',
                supabaseKey: 'readonly',
                db: 'readonly',
                // entity-paths.js and seo-data.js are also loaded by Node build scripts.
                module: 'readonly',
                require: 'readonly'
            }
        },
        rules: {
            'no-undef': 'error',
            'no-redeclare': ['error', { builtinGlobals: false }],
            'no-unreachable': 'error',
            'no-dupe-keys': 'error',
            'no-duplicate-case': 'error',
            'no-self-compare': 'error',
            'no-cond-assign': 'error',
            'use-isnan': 'error',
            'valid-typeof': 'error',
            'no-unsafe-negation': 'error',
            'no-unsafe-finally': 'error',
            'no-unsafe-optional-chaining': 'error',
            'no-constant-condition': ['error', { checkLoops: false }],
            'no-func-assign': 'error',
            'no-sparse-arrays': 'error',
            'no-loss-of-precision': 'error',
            'no-fallthrough': 'error',
            'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }]
        }
    }
];
