import { stub, WRITE_INTENTS, PICKER_INTENTS, getPickerOptions, applyFixtures, getCreateInfo, createPicked } from './stubs.js';

const V = 1;
let port = null;
let theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

// ── Fixtures ──────────────────────────────────────────────────────────────────

try {
    const res = await fetch('/wizard-host/fixtures.json');
    if (res.ok) applyFixtures(await res.json());
} catch { /* no fixtures — defaults stand */ }

// ── Panel resize ──────────────────────────────────────────────────────────────

const PANEL_W_KEY = 'mock-host-panel-w';
const panel = document.getElementById('panel');

const savedW = localStorage.getItem(PANEL_W_KEY);
if (savedW) document.documentElement.style.setProperty('--panel-w', savedW + 'px');

document.getElementById('rh').addEventListener('mousedown', e => {
    e.preventDefault();
    const startX = e.clientX, startW = panel.offsetWidth;
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
wiz.src = `/index.html?hostOrigin=${window.location.origin}`;
wiz.addEventListener('load', init);

applyTheme();
document.getElementById('tb').addEventListener('click', toggleTheme);

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStatus(text, cls = '') {
    const el = document.getElementById('st');
    el.textContent = text; el.className = cls;
}

function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// log(icon, text, cls?, payload?)
// If payload is provided the entry is expandable via <details>.
function log(icon, text, cls = '', payload = null) {
    const lg = document.getElementById('lg');
    const row = document.createElement('div');
    row.className = 'le ' + cls;
    if (payload !== null && payload !== undefined) {
        row.innerHTML =
            `<span>${icon}</span>` +
            `<details class="le-det">` +
                `<summary>${esc(text)}</summary>` +
                `<pre>${esc(JSON.stringify(payload, null, 2))}</pre>` +
            `</details>`;
    } else {
        row.innerHTML = `<span>${icon}</span><span>${esc(text)}</span>`;
    }
    lg.appendChild(row);
    lg.parentElement.scrollTop = lg.parentElement.scrollHeight;
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
    modalQueue.length = 0;
    document.getElementById('modal-back').hidden = true;

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

let lastPlan = null; // cached from deployment.plan so apply modal can show it

function dispatch({ id, intent, params }) {
    log('📨', intent, 'dim', Object.keys(params ?? {}).length ? params : null);

    if (intent === 'deployment.plan') {
        const result = stub(intent, params, theme);
        lastPlan = result;
        send(id, true, result);
        log('✅', `${intent} → ok`, 'ok', result);
    } else if (PICKER_INTENTS.has(intent)) {
        showPickerModal(id, intent);
    } else if (WRITE_INTENTS.has(intent)) {
        showConsentModal(id, intent, params);
    } else {
        const result = stub(intent, params, theme);
        send(id, true, result);
        log('✅', `${intent} → ok`, 'ok', result);
    }
}

// ── Modal system ──────────────────────────────────────────────────────────────
// One modal at a time. Intents that arrive while one is open are queued and
// shown immediately after the current one resolves.

const modalQueue = []; // array of render functions

function enqueueModal(renderFn) {
    modalQueue.push(renderFn);
    if (modalQueue.length === 1) renderFn();
}

function closeModal() {
    document.getElementById('modal-back').hidden = true;
    modalQueue.shift();
    if (modalQueue.length > 0) modalQueue[0]();
}

function openModal() {
    document.getElementById('modal-back').hidden = false;
}

const PICKER_LABELS = {
    'cdn.resources.pick': 'Select a CDN Resource',
    'fastedge.stores.pickOrCreate': 'Select or Create a KV Store',
    'fastedge.secrets.pickOrCreate': 'Select or Create a Secret',
};

// Returns the resolved value to send back for a given picker intent + selected item.
function pickerResult(intent, parsedValue) {
    // secrets.pickOrCreate and stores.pickOrCreate return Array<{id,name}>; cdn.resources.pick returns single object.
    return (intent === 'cdn.resources.pick') ? parsedValue : [parsedValue];
}

function showPickerModal(id, intent) {
    enqueueModal(() => {
        const options = getPickerOptions(intent);
        let selectedIdx = 0;

        document.getElementById('modal-head').textContent = PICKER_LABELS[intent] ?? intent;

        const body = document.getElementById('modal-body');
        body.innerHTML = options.length
            ? options.map((opt, i) =>
                `<div class="pi${i === 0 ? ' sel' : ''}" data-idx="${i}">` +
                    `<strong>${esc(opt.primary)}</strong>` +
                    (opt.secondary ? `<span>${esc(opt.secondary)}</span>` : '') +
                `</div>`).join('')
            : `<p class="empty-picker">No items available</p>`;

        body.onclick = e => {
            const item = e.target.closest?.('.pi');
            if (!item) return;
            body.querySelectorAll('.pi').forEach(el => el.classList.remove('sel'));
            item.classList.add('sel');
            selectedIdx = parseInt(item.dataset.idx, 10);
        };

        const foot = document.getElementById('modal-foot');
        foot.innerHTML =
            `<button class="bno" id="modal-no">Cancel</button>` +
            `<button class="bok" id="modal-ok">Select</button>`;

        document.getElementById('modal-ok').onclick = () => {
            if (!options.length) { closeModal(); deny(id, intent); return; }
            const val = JSON.parse(options[selectedIdx].value);

            // "Create new…" row — represents the real host's inline create. Seeded fixture names
            // are used silently; otherwise prompt the developer for a name (pre-filled default).
            if (val.__create) {
                const info = getCreateInfo(intent);
                let ref;
                if (info.seeded) {
                    ref = createPicked(intent);
                } else {
                    const typed = prompt(`Name for the new ${info.kind}:`, info.nextName);
                    if (typed === null) { closeModal(); deny(id, intent); return; } // cancelled create
                    ref = createPicked(intent, typed);
                }
                closeModal();
                const result = pickerResult(intent, ref);
                send(id, true, result);
                log('✅', `${intent} → created ${ref.name}`, 'ok', result);
                return;
            }

            closeModal();
            const result = pickerResult(intent, val);
            send(id, true, result);
            log('✅', `${intent} → ${val.cname ?? val.name}`, 'ok', result);
        };

        document.getElementById('modal-no').onclick = () => {
            closeModal();
            deny(id, intent);
        };

        openModal();
    });
}

function showConsentModal(id, intent, params) {
    enqueueModal(() => {
        const head = document.getElementById('modal-head');
        head.innerHTML = `<span class="modal-badge">${esc(intent)}</span>`;

        const body = document.getElementById('modal-body');
        body.onclick = null;
        if (intent === 'deployment.apply' && lastPlan) {
            const steps = lastPlan.steps.map(s => `<li>${esc(s.describe)}</li>`).join('');
            const warnings = (lastPlan.warnings ?? []).map(w => `<p class="warn">⚠ ${esc(w)}</p>`).join('');
            body.innerHTML = `<p><strong>${esc(lastPlan.summary)}</strong></p><ol>${steps}</ol>${warnings}`;
        } else {
            body.innerHTML = `<pre>${esc(JSON.stringify(params, null, 2))}</pre>`;
        }

        const foot = document.getElementById('modal-foot');
        const applyLabel = intent === 'deployment.apply' ? 'Apply' : 'Approve';
        foot.innerHTML =
            `<button class="bno" id="modal-no">Cancel</button>` +
            `<button class="bok" id="modal-ok">${applyLabel}</button>`;

        document.getElementById('modal-ok').onclick = async () => {
            document.getElementById('modal-ok').disabled = true;
            document.getElementById('modal-no').disabled = true;
            if (intent === 'deployment.apply') {
                await runApply(id, body, foot);
            } else {
                const result = stub(intent, params, theme);
                closeModal();
                send(id, true, result);
                log('✅', `${intent} → approved`, 'ok', result);
            }
        };

        document.getElementById('modal-no').onclick = () => {
            closeModal();
            deny(id, intent);
        };

        openModal();
    });
}

function deny(id, intent) {
    send(id, false, { code: 'user_cancelled', message: 'User cancelled' });
    log('🚫', `${intent} → user_cancelled`, 'err');
}

async function runApply(id, body, foot) {
    const steps = ['Creating app resources', 'Setting environment', 'Finalising deployment'];
    const progress = document.createElement('div');
    progress.className = 'apply-progress';
    body.appendChild(progress);
    foot.innerHTML = '';

    for (let i = 0; i < steps.length; i++) {
        await new Promise(r => setTimeout(r, 700));
        if (!port) return;
        port.postMessage({
            v: V, type: 'event', event: 'deployment.progress',
            payload: { step: i + 1, total: steps.length, describe: steps[i] },
        });
        const row = document.createElement('div');
        row.className = 'ap-step';
        row.textContent = `[${i + 1}/${steps.length}] ${steps[i]}`;
        progress.appendChild(row);
        log('📡', `deployment.progress [${i + 1}/${steps.length}] ${steps[i]}`, 'ev');
    }

    const result = stub('deployment.apply', {}, theme);
    closeModal();
    send(id, true, result);
    log('✅', 'deployment.apply → complete', 'ok', result);
}
