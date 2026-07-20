import { stub, WRITE_INTENTS, applyFixtures } from './stubs.js';

const V = 1;
let port = null;
let theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
const consents = new Map(); // id → { intent, params }

// ── Fixtures ──────────────────────────────────────────────────────────────────
// Load wizard-specific fixture overrides before the iframe starts. Top-level
// await defers the rest of this module until the fetch resolves.

try {
    const res = await fetch('/wizard-host/fixtures.json');
    if (res.ok) applyFixtures(await res.json());
} catch { /* no fixtures or server not ready — defaults stand */ }

// ── Panel resize ──────────────────────────────────────────────────────────────

const PANEL_W_KEY = 'mock-host-panel-w';
const panel = document.getElementById('panel');

const savedW = localStorage.getItem(PANEL_W_KEY);
if (savedW) document.documentElement.style.setProperty('--panel-w', savedW + 'px');

document.getElementById('rh').addEventListener('mousedown', e => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panel.offsetWidth;
    document.body.classList.add('resizing');
    document.getElementById('wiz').style.pointerEvents = 'none';

    function onMove(e) {
        const w = Math.min(700, Math.max(200, startW - (e.clientX - startX)));
        document.documentElement.style.setProperty('--panel-w', w + 'px');
    }
    function onUp() {
        document.body.classList.remove('resizing');
        document.getElementById('wiz').style.pointerEvents = '';
        localStorage.setItem(PANEL_W_KEY, panel.offsetWidth);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
});

// ── Setup ─────────────────────────────────────────────────────────────────────

const wiz = document.getElementById('wiz');
// Derive hostOrigin from the current page — no PORT substitution needed in HTML.
wiz.src = `/index.html?hostOrigin=${window.location.origin}`;
wiz.addEventListener('load', init);

applyTheme();
document.getElementById('tb').addEventListener('click', toggleTheme);
document.getElementById('cl').addEventListener('click', onConsentClick);

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStatus(text, cls = '') {
    const el = document.getElementById('st');
    el.textContent = text; el.className = cls;
}

function log(icon, text, cls = '') {
    const lg = document.getElementById('lg');
    const row = document.createElement('div');
    row.className = 'le ' + cls;
    row.innerHTML = `<span>${icon}</span><span>${esc(text)}</span>`;
    lg.appendChild(row);
    lg.parentElement.scrollTop = lg.parentElement.scrollHeight;
}

function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function applyTheme() {
    document.body.className = 'gc-theme-' + theme;
    document.getElementById('tb').textContent = `Switch to ${theme === 'light' ? 'dark' : 'light'}`;
}

function toggleTheme() {
    theme = theme === 'light' ? 'dark' : 'light';
    applyTheme();
    if (port) {
        port.postMessage({ v: V, type: 'event', event: 'theme.changed', payload: { theme } });
        log('🎨', `theme.changed → ${theme}`, 'ev');
    }
}

// ── Bridge ────────────────────────────────────────────────────────────────────

function init() {
    if (port) { port.onmessage = null; port.close(); port = null; }
    document.getElementById('cl').innerHTML = '';
    consents.clear();

    const ch = new MessageChannel();
    port = ch.port1;
    port.onmessage = onPortMessage;
    port.start();

    wiz.contentWindow.postMessage({ v: V, type: 'init' }, '*', [ch.port2]);
    port.postMessage({
        v: V, type: 'hello',
        hostContext: { specVersion: '1', theme, locale: navigator.language || 'en' },
    });

    setStatus('connecting…');
    log('🤝', 'INIT + HELLO sent', 'dim');
}

function onPortMessage(e) {
    const m = e.data;
    if (!m || m.v !== V) return;
    if (m.type === 'ready') {
        setStatus('● connected', 'live');
        log('✅', `READY (SDK v${m.sdkVersion})`, 'ok');
    } else if (m.type === 'intent') {
        dispatch(m);
    }
}

function send(id, ok, payload) {
    if (!port) return;
    port.postMessage(ok
        ? { v: V, type: 'result', id, ok: true, data: payload }
        : { v: V, type: 'result', id, ok: false, error: payload });
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

function dispatch({ id, intent, params }) {
    log('📨', intent, 'dim');
    if (WRITE_INTENTS.has(intent)) {
        addConsent(id, intent, params);
    } else {
        send(id, true, stub(intent, params, theme));
        log('✅', `${intent} → ok`, 'ok');
    }
}

// ── Consent queue ─────────────────────────────────────────────────────────────

function addConsent(id, intent, params) {
    consents.set(id, { intent, params });
    const div = document.createElement('div');
    div.className = 'ci';
    div.dataset.cid = id;
    div.innerHTML =
        `<div class="cn">${esc(intent)}</div>` +
        `<pre class="cp">${esc(JSON.stringify(params, null, 2))}</pre>` +
        `<div class="cb">` +
            `<button class="bok" data-action="approve">Approve</button>` +
            `<button class="bno" data-action="deny">Cancel</button>` +
        `</div>`;
    document.getElementById('cl').appendChild(div);
}

function removeConsent(id) {
    consents.delete(id);
    document.querySelector(`.ci[data-cid="${id}"]`)?.remove();
}

async function onConsentClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.closest('.ci')?.dataset.cid;
    if (!id) return;
    if (btn.dataset.action === 'approve') await approve(id);
    else deny(id);
}

async function approve(id) {
    const { intent, params } = consents.get(id) ?? {};
    removeConsent(id);
    if (!intent) return;
    if (intent === 'deployment.apply') {
        await runApply(id);
    } else {
        send(id, true, stub(intent, params, theme));
        log('✅', `${intent} → approved`, 'ok');
    }
}

function deny(id) {
    const { intent } = consents.get(id) ?? {};
    removeConsent(id);
    if (!intent) return;
    send(id, false, { code: 'user_cancelled', message: 'User cancelled' });
    log('🚫', `${intent} → user_cancelled`, 'err');
}

async function runApply(id) {
    const steps = ['Creating app resources', 'Setting environment', 'Finalising deployment'];
    for (let i = 0; i < steps.length; i++) {
        await new Promise(r => setTimeout(r, 700));
        if (!port) return;
        port.postMessage({
            v: V, type: 'event', event: 'deployment.progress',
            payload: { step: i + 1, total: steps.length, describe: steps[i] },
        });
        log('📡', `deployment.progress [${i + 1}/${steps.length}] ${steps[i]}`, 'ev');
    }
    send(id, true, stub('deployment.apply', {}, theme));
    log('✅', 'deployment.apply → complete', 'ok');
}
