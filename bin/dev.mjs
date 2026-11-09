#!/usr/bin/env node
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockHostDir = path.join(__dirname, '..', 'mock-host');

// Flags: boolean `--x`, or valued `--x value` / `--x=value` (only for VALUED_FLAGS).
const VALUED_FLAGS = new Set(['--brand', '--brand-dark']);
const positional = [];
const flags = new Set();
const flagValues = {};
for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const [name, inline] = arg.split(/=(.*)/s);
    if (VALUED_FLAGS.has(name)) flagValues[name] = inline ?? process.argv[++i];
    else flags.add(arg);
}
const wizardDir = path.resolve(positional[0] ?? '.');
const PORT = parseInt(process.env.PORT ?? '9999', 10);
const VALIDATE_ONLY = flags.has('--validate-only');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

function serveFile(res, filePath, extraHeaders = {}) {
    let data;
    try {
        data = fs.readFileSync(filePath);
    } catch {
        res.writeHead(404);
        res.end('Not found');
        return;
    }
    const mime = MIME[path.extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, ...extraHeaders });
    res.end(data);
}

// ── Portal styles ─────────────────────────────────────────────────────────────
// Fetched from the CDN at startup so local dev mirrors production exactly.
// Falls back to the bundled wizard.css if the CDN is unreachable (offline dev).

const CDN_BASE = 'https://wizard-app-4732724.fastedge.cdn.gc.onl';
const PORTAL_LINK = '<link rel="stylesheet" href="/styles/v1/wizard.css">';

let wizardCSS = fs.readFileSync(path.join(mockHostDir, 'wizard.css'), 'utf8');

function injectPortalLinks(html) {
    const i = html.indexOf('</head>');
    if (i !== -1) return html.slice(0, i) + PORTAL_LINK + '\n' + html.slice(i);
    return html;
}

// ── Fixture loading ───────────────────────────────────────────────────────────

function findProjectRoot(dir) {
    let d = dir;
    while (true) {
        if (fs.existsSync(path.join(d, 'package.json'))) return d;
        const parent = path.dirname(d);
        if (parent === d) return dir;
        d = parent;
    }
}

async function loadFixtures() {
    const fixturesDir = path.join(findProjectRoot(wizardDir), 'fixtures');
    if (!fs.existsSync(fixturesDir)) return { fixtures: {}, hasErrors: false };

    let fixtureSchemas;
    try {
        ({ fixtureSchemas } = await import(path.join(__dirname, '..', 'dist', 'schemas.js')));
    } catch (e) {
        console.warn(`  Warning: could not load schemas — ${e.message}`);
        return { fixtures: {}, hasErrors: false };
    }

    const fixtures = {};
    let hasErrors = false;

    for (const [key, schema] of Object.entries(fixtureSchemas)) {
        const filePath = path.join(fixturesDir, `${key}.json`);
        if (!fs.existsSync(filePath)) continue;

        let raw;
        try {
            raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            console.error(`  ✗ fixtures/${key}.json: invalid JSON — ${e.message}`);
            hasErrors = true;
            continue;
        }

        const result = schema.safeParse(raw);
        if (!result.success) {
            console.error(`  ✗ fixtures/${key}.json:`);
            for (const issue of result.error.issues) {
                const p = issue.path.length ? issue.path.join('.') : '(root)';
                console.error(`      [${p}] ${issue.message}`);
            }
            hasErrors = true;
        } else {
            fixtures[key] = result.data;
            console.log(`  ✓ fixtures/${key}.json`);
        }
    }

    return { fixtures, hasErrors };
}

// ── Reseller brand preview ────────────────────────────────────────────────────
// The real portal sends a reseller's brand colour over the bridge as `--gc-wizard-brand`.
// A partner fork sets theirs once in `wizard-brand.json` at the repo root
// (`{ "brand": "#ff7900", "brandDark": "#ff9a40" }`, brandDark optional); the nearest one
// above the wizard wins. `--brand` / `--brand-dark` override it for a one-off check.

function findUp(dir, name) {
    for (let d = dir; ; d = path.dirname(d)) {
        const f = path.join(d, name);
        if (fs.existsSync(f)) return f;
        if (path.dirname(d) === d) return null;
    }
}

function loadBrand() {
    let brand = {};
    const file = findUp(wizardDir, 'wizard-brand.json');
    if (file) {
        try {
            brand = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (e) {
            console.warn(`  Warning: ${file}: invalid JSON — ${e.message}`);
        }
    }
    if (flagValues['--brand']) brand.brand = flagValues['--brand'];
    if (flagValues['--brand-dark']) brand.brandDark = flagValues['--brand-dark'];
    const out = {};
    if (typeof brand.brand === 'string') out.brand = brand.brand;
    if (typeof brand.brandDark === 'string') out.brandDark = brand.brandDark;
    return { brand: out, file };
}

// ── Startup ───────────────────────────────────────────────────────────────────

console.log(`\nFastEdge wizard dev server`);
console.log(`  Wizard: ${wizardDir}`);

// Fetch portal styles from CDN
console.log('\nFetching portal styles...');
try {
    const res = await fetch(`${CDN_BASE}/styles/v1/wizard.css`);
    if (res.ok) {
        wizardCSS = await res.text();
        console.log('  ✓ wizard.css (CDN)');
    } else {
        console.log(`  ✓ wizard.css (bundled fallback — CDN returned ${res.status})`);
    }
} catch {
    console.log('  ✓ wizard.css (bundled fallback — CDN unreachable)');
}

const { brand: brandPreview, file: brandFile } = loadBrand();
if (brandPreview.brand || brandPreview.brandDark) {
    const src = flagValues['--brand'] || flagValues['--brand-dark'] ? 'flags' : brandFile;
    console.log(`\nBrand preview: ${brandPreview.brand ?? '(default)'} light, ${brandPreview.brandDark ?? brandPreview.brand ?? '(default)'} dark — from ${src}`);
}

let loadedFixtures = {};

const fixturesDir = path.join(findProjectRoot(wizardDir), 'fixtures');
const hasFixtures = fs.existsSync(fixturesDir);

if (hasFixtures || VALIDATE_ONLY) {
    console.log('\nValidating fixtures...');
    if (!hasFixtures) {
        console.log('  No fixtures directory found.');
    } else {
        const { fixtures, hasErrors } = await loadFixtures();
        loadedFixtures = fixtures;

        if (VALIDATE_ONLY) {
            console.log(hasErrors ? '\nFixture validation failed.' : '\nAll fixtures valid.');
            process.exit(hasErrors ? 1 : 0);
        }

        if (hasErrors) {
            console.warn('\n  Warning: fixture errors above — defaults will be used.');
        }
    }

    if (VALIDATE_ONLY) {
        console.log('\nAll fixtures valid.');
        process.exit(0);
    }
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
    const urlPath = new URL(req.url, `http://localhost:${PORT}`).pathname;

    if (urlPath === '/' || urlPath === '/wizard-host') {
        serveFile(res, path.join(mockHostDir, 'index.html'));
        return;
    }

    // Fixture data for host.js to override stubs
    if (urlPath === '/wizard-host/fixtures.json') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(loadedFixtures));
        return;
    }

    // Brand preview for host.js to send as `tokens`
    if (urlPath === '/wizard-host/brand.json') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(brandPreview));
        return;
    }

    // Portal styles — mirrors what the WASM proxy serves in production
    if (urlPath === '/styles/v1/wizard.css') {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        res.end(wizardCSS);
        return;
    }

    // Mock host assets (JS, CSS) — same origin, no CORS needed
    if (urlPath.startsWith('/wizard-host/')) {
        const rel = urlPath.slice('/wizard-host/'.length);
        const target = path.join(mockHostDir, rel);
        if (!target.startsWith(mockHostDir + path.sep)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }
        serveFile(res, target);
        return;
    }

    // Wizard files — sandboxed iframe needs CORS; HTML gets portal links injected
    const target = path.resolve(wizardDir, '.' + urlPath);
    const rel = path.relative(wizardDir, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    if (path.extname(target) === '.html') {
        let html;
        try { html = fs.readFileSync(target, 'utf8'); } catch { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(injectPortalLinks(html));
        return;
    }

    serveFile(res, target, { 'Access-Control-Allow-Origin': '*' });
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\nPort ${PORT} is already in use. Set PORT=<n> env var to change it.\n`);
    } else {
        console.error(err.message);
    }
    process.exit(1);
});

const NO_COLOUR = '[0m';
const GREEN = '[32m';
const YELLOW = '[33m';

server.listen(PORT, '127.0.0.1', () => {
    console.log(`\n ${YELLOW}Open:  ${GREEN}http://localhost:${PORT}/wizard-host${NO_COLOUR}`);
    console.log(` ${YELLOW}Press Ctrl+C to stop.${NO_COLOUR}\n`);
});
