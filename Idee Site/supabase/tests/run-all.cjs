#!/usr/bin/env node
// Runs every test in this folder: SQL tests on an in-memory PGlite database and
// browser tests in Chromium/Edge against a local static copy of `Idee Site/`.
// Nothing here reaches the hosted Supabase project or publishes anything.
//
//   cd "Idee Site/supabase/tests" && npm ci && npm test
//   npm test -- owner-home auth-recovery     (only files whose name matches)
//
// CHROMIUM_PATH selects the browser (default: Playwright's Chromium, else
// /usr/bin/chromium). TEST_JOBS sets parallelism (default 4).
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const testsDir = __dirname;
const siteRoot = path.resolve(testsDir, '..', '..');
// Ports the browser tests expect when SITE_BASE_URL is not set.
const PORTS = [8002, 8010, 8096, 8103, 8105, 8117];
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 240000);
const JOBS = Math.max(1, Number(process.env.TEST_JOBS || 4));
const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8'
};

function serve(request, response) {
    let file;
    try { file = path.join(siteRoot, decodeURIComponent(new URL(request.url, 'http://local').pathname)); }
    catch { response.writeHead(400); return response.end(); }
    if (file !== siteRoot && !file.startsWith(siteRoot + path.sep)) { response.writeHead(403); return response.end(); }
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch { /* 404 below */ }
    fs.readFile(file, (error, body) => {
        if (error) { response.writeHead(404, { 'Content-Type': 'text/plain' }); return response.end('not found'); }
        response.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        response.end(body);
    });
}

function browserPath() {
    if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
    try {
        const candidate = require('playwright').chromium.executablePath();
        if (candidate && fs.existsSync(candidate)) return candidate;
    } catch { /* fall back to the tests' default */ }
    return '';
}

function runOne(file, env) {
    return new Promise(resolve => {
        const started = Date.now();
        const child = spawn(process.execPath, [file], { cwd: siteRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.on('data', chunk => { output += chunk; });
        const timer = setTimeout(() => { output += `\nTIMEOUT after ${TIMEOUT_MS} ms`; child.kill('SIGKILL'); }, TIMEOUT_MS);
        child.on('close', code => { clearTimeout(timer); resolve({ file, code, output, seconds: (Date.now() - started) / 1000 }); });
    });
}

(async () => {
    const filters = process.argv.slice(2);
    const files = fs.readdirSync(testsDir)
        .filter(name => /\.test\.cjs$/.test(name))
        .filter(name => !filters.length || filters.some(filter => name.includes(filter)))
        .sort()
        .map(name => path.join(testsDir, name));
    if (!files.length) { console.error('No matching tests.'); process.exit(2); }

    const servers = PORTS.map(port => http.createServer(serve).listen(port, '127.0.0.1'));
    await Promise.all(servers.map(server => new Promise(resolve => server.once('listening', resolve))));
    const env = { ...process.env, NODE_PATH: path.join(testsDir, 'node_modules') };
    const chromium = browserPath();
    if (chromium) env.CHROMIUM_PATH = chromium;
    console.log(`Running ${files.length} test files (${JOBS} at a time)${chromium ? ` with ${chromium}` : ''}`);

    const queue = [...files]; const results = [];
    await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
        while (queue.length) {
            const result = await runOne(queue.shift(), env);
            results.push(result);
            console.log(`${result.code === 0 ? 'ok  ' : 'FAIL'} ${path.basename(result.file)} (${result.seconds.toFixed(1)}s)`);
        }
    }));
    servers.forEach(server => server.close());

    const failed = results.filter(result => result.code !== 0);
    for (const result of failed) {
        console.log(`\n===== ${path.basename(result.file)} =====`);
        console.log(result.output.split('\n').filter(line => !/^\s+at /.test(line)).slice(-40).join('\n'));
    }
    console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
    process.exit(failed.length ? 1 : 0);
})();
