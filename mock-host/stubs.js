export const WRITE_INTENTS = new Set([
    'fastedge.apps.create',
    'fastedge.apps.update',
    'fastedge.apps.link',
    'fastedge.secrets.generateKeypair',
    'cdn.origins.create',
    'cdn.rules.create',
    'deployment.apply',
]);

// Picker intents open an interactive list modal so the user can choose from
// stub/fixture data, mimicking the portal's modal picker UX.
export const PICKER_INTENTS = new Set([
    'cdn.resources.pick',
    'fastedge.stores.pickOrCreate',
    'fastedge.secrets.pickOrCreate',
]);

// ── Stub database ─────────────────────────────────────────────────────────────
// Represents a realistic account with a mix of resource types.
// Wizard fixtures (if present) override these defaults via applyFixtures().

let templates = [
    {
        id: 1,
        name: 'Geo Redirect',
        short_descr: "Redirects requests to a region-specific origin based on the visitor's country",
        long_descr:
            'Set ORIGINS to a JSON object mapping ISO 3166-1 alpha-2 country codes to origin URLs. Requests from unlisted countries fall through to the default origin.',
        api_type: 'wasi-http',
        binary_id: 11,
        params: [
            { name: 'ORIGINS', data_type: 'string', descr: 'JSON map of country code → origin URL', mandatory: true },
            {
                name: 'DEFAULT',
                data_type: 'string',
                descr: 'Fallback origin URL for unlisted countries',
                mandatory: false,
            },
        ],
    },
    {
        id: 2,
        name: 'Markdown Renderer',
        short_descr: 'Fetches a Markdown document and returns it as HTML',
        long_descr:
            'Calls BASE + request path to retrieve a Markdown file, converts it to HTML, and optionally injects custom content into <head>.',
        api_type: 'wasi-http',
        binary_id: 12,
        params: [
            {
                name: 'BASE',
                data_type: 'string',
                descr: 'Origin URL; request path is appended to form the Markdown source URL',
                mandatory: true,
            },
            {
                name: 'HEAD',
                data_type: 'string',
                descr: 'Content injected into <head> of the generated HTML',
                mandatory: false,
            },
        ],
    },
    {
        id: 3,
        name: 'JWT Auth Filter',
        short_descr: 'Validates a Bearer JWT in the Authorization header before forwarding the request',
        long_descr:
            'Verifies the JWT signature against a JWKS endpoint and checks expiry. Returns 401 on failure. Attach as a CDN proxy-wasm filter on routes you want to protect.',
        api_type: 'proxy-wasm',
        binary_id: 13,
        params: [
            {
                name: 'JWKS_URI',
                data_type: 'string',
                descr: 'JWKS endpoint used to verify the token signature',
                mandatory: true,
            },
            {
                name: 'AUDIENCE',
                data_type: 'string',
                descr: 'Expected JWT audience claim (optional validation)',
                mandatory: false,
            },
        ],
    },
    {
        id: 4,
        name: 'Rate Limiter',
        short_descr: 'Enforces a per-IP request rate limit using a KV store for counters',
        long_descr:
            'Tracks request counts per IP in a KV store. Returns 429 when the limit is exceeded within the rolling window.',
        api_type: 'proxy-wasm',
        binary_id: 14,
        params: [
            { name: 'LIMIT', data_type: 'number', descr: 'Maximum requests allowed per window', mandatory: true },
            { name: 'WINDOW_SECS', data_type: 'number', descr: 'Rolling window duration in seconds', mandatory: true },
            {
                name: 'KV_STORE',
                data_type: 'store',
                descr: 'KV store used to hold rate-limit counters',
                mandatory: true,
            },
        ],
    },
];

let apps = [
    {
        id: 101,
        name: 'geo-redirect-prod',
        api_type: 'wasi-http',
        status: 1,
        url: 'https://geo-redirect-prod-101.fastedge.gcorelabs.net',
        template: 1,
        env: { BASE: 'https://example.com', DEFAULT: 'https://us.example.com' },
        secrets: [],
    },
    {
        id: 102,
        name: 'docs-renderer',
        api_type: 'wasi-http',
        status: 1,
        url: 'https://docs-renderer-102.fastedge.gcorelabs.net',
        template: 2,
        env: { BASE: 'https://raw.githubusercontent.com/my-org/docs/main' },
        secrets: [],
    },
    {
        id: 103,
        name: 'checkout-jwt-filter',
        api_type: 'proxy-wasm',
        status: 1,
        url: 'https://checkout-jwt-filter-103.fastedge.gcorelabs.net',
        template: 3,
        env: { JWKS_URI: 'https://auth.example.com/.well-known/jwks.json' },
        secrets: [],
    },
];

let secrets = [
    { id: 1, name: 'SIGNING_KEY', app_count: 1, comment: 'HMAC signing key for session tokens' },
    { id: 2, name: 'API_SECRET_TOKEN', app_count: 2, comment: 'API gateway shared secret' },
    { id: 3, name: 'WEBHOOK_SECRET', app_count: 0, comment: 'Stripe webhook verification secret' },
];

let stores = [
    { id: 1, name: 'session-store', comment: 'User session data (TTL managed by app)' },
    { id: 2, name: 'rate-limit-store', comment: 'Per-IP request counters for rate limiting' },
    { id: 3, name: 'feature-flags', comment: 'Edge-evaluated feature flag overrides' },
];

let cdnResources = [
    { id: 12000001, cname: 'cdn.example.com', description: 'Main site delivery domain', status: 'active' },
    { id: 12000002, cname: 'assets.example.com', description: 'Static asset CDN', status: 'active' },
    { id: 12000003, cname: 'api.example.com', description: 'API gateway CDN', status: 'active' },
];

let cdnOrigins = [
    { id: 500001, name: 'geo-redirect-origin' },
    { id: 500002, name: 'jwt-filter-origin' },
];

let cdnRules = [
    { id: 600001, name: 'auth-rule', rule: '^/auth', weight: 1, originGroupId: 500002, fastedgeFilter: { appId: 103, hook: 'on_request_headers' } },
    { id: 600002, name: 'geo-rule', rule: '^/', weight: 5, originGroupId: 500001 },
];

// ── Inline "Create new" for pickOrCreate ──────────────────────────────────────
// pickOrCreate lets the user create a resource from inside the picker. The mock
// represents that with a "Create new…" row (appended to the list). The created
// name comes, in priority order, from:
//   1. a seeded fixture queue (fixtures/fastedge/new-{secrets,stores}.json) —
//      best for scripted / many-create flows; deterministic, no prompts,
//   2. a name the developer types at the host prompt — ad-hoc, mirrors the portal,
//   3. an indexed default (new-{secret,store}-N) — last resort.
// Ids are high-based per-type counters, so they never collide with fixture ids.
// ponytail: 900000/910000 bases are a mock heuristic, not a real id-allocation policy.
const createState = {
    'fastedge.secrets.pickOrCreate': { kind: 'secret', base: 900000, queue: [], seq: 0 },
    'fastedge.stores.pickOrCreate': { kind: 'store', base: 910000, queue: [], seq: 0 },
};

/** What the "Create new…" row + host prompt should show for the next create. */
export function getCreateInfo(intent) {
    const st = createState[intent];
    if (!st) return null;
    return {
        kind: st.kind,
        seeded: st.queue.length > 0,
        nextName: st.queue[0]?.name ?? `new-${st.kind}-${st.seq + 1}`,
    };
}

/** Allocate a new resource ref: seeded fixture name wins, else developer-typed, else indexed.
 *  The id always comes from the per-type counter, so it is guaranteed unique within a session. */
export function createPicked(intent, typedName) {
    const st = createState[intent];
    if (!st) return null;
    st.seq += 1;
    const queued = st.queue.shift();
    const name = queued?.name ?? (typedName?.trim() || `new-${st.kind}-${st.seq}`);
    // Return only { id, name } — the SecretRef/KvStoreRef contract. The seed's comment
    // is for the picker list display (createRow), not the created ref handed to the wizard.
    return { id: st.base + st.seq, name };
}

function createRow(intent) {
    const info = getCreateInfo(intent);
    return {
        primary: '➕ Create new…',
        secondary: info?.seeded ? `next: "${info.nextName}"` : 'you’ll be asked for a name',
        value: JSON.stringify({ __create: true }),
    };
}

// ── Picker options ────────────────────────────────────────────────────────────
// Returns display items for the modal picker. Each item has:
//   primary  — main label
//   secondary — subtitle/meta
//   value    — the object to send back on selection (JSON-stringified)

export function getPickerOptions(intent) {
    switch (intent) {
        case 'cdn.resources.pick':
            return cdnResources.map(r => ({
                primary: r.cname,
                secondary: [r.description, r.status].filter(Boolean).join(' · '),
                value: JSON.stringify({ id: r.id, cname: r.cname }),
            }));
        case 'fastedge.stores.pickOrCreate':
            return [
                ...stores.map(s => ({
                    primary: s.name,
                    secondary: s.comment ?? '',
                    value: JSON.stringify({ id: s.id, name: s.name }),
                })),
                createRow(intent),
            ];
        case 'fastedge.secrets.pickOrCreate':
            return [
                ...secrets.map(s => ({
                    primary: s.name,
                    secondary: `used by ${s.app_count} app${s.app_count !== 1 ? 's' : ''}`,
                    value: JSON.stringify({ id: s.id, name: s.name }),
                })),
                createRow(intent),
            ];
        default:
            return [];
    }
}

// ── Fixture override ──────────────────────────────────────────────────────────

export function applyFixtures(fixtures) {
    if (fixtures['fastedge/templates']?.length) templates = fixtures['fastedge/templates'];
    if (fixtures['fastedge/apps']?.length) apps = fixtures['fastedge/apps'];
    if (fixtures['fastedge/secrets']?.length) secrets = fixtures['fastedge/secrets'];
    if (fixtures['fastedge/stores']?.length) stores = fixtures['fastedge/stores'];
    if (fixtures['fastedge/new-secrets']?.length)
        createState['fastedge.secrets.pickOrCreate'].queue = [...fixtures['fastedge/new-secrets']];
    if (fixtures['fastedge/new-stores']?.length)
        createState['fastedge.stores.pickOrCreate'].queue = [...fixtures['fastedge/new-stores']];
    if (fixtures['cdn/resources']?.length) cdnResources = fixtures['cdn/resources'];
    if (fixtures['cdn/origins']?.length) cdnOrigins = fixtures['cdn/origins'];
    if (fixtures['cdn/rules']?.length) cdnRules = fixtures['cdn/rules'];
    if (fixtures['deployment/current'] && !live) setLive(fixtures['deployment/current']);
}

// ── Re-entry: live deployment state ───────────────────────────────────────────
// Open the mock host with ?mode=reentry to launch the wizard as if from a deployed app.
// The live state comes from fixtures/deployment/current.json, or from the last successful
// deployment.apply in this tab (kept in sessionStorage so a reload shows the change).
// ?reset clears it.

const LIVE_KEY = 'mock-host-live-deployment';
const query = new URLSearchParams(location.search);
export const reentry = query.get('mode') === 'reentry';
if (query.has('reset')) sessionStorage.removeItem(LIVE_KEY);

let live = (() => {
    try { return JSON.parse(sessionStorage.getItem(LIVE_KEY) ?? 'null'); } catch { return null; }
})();
// Validated plan params by planId. deployment.apply consumes one (a plan applies once), so a rejected
// or later plan can't change what an open consent dialog applies.
const plans = new Map();
let planSeq = 0;
let latestPlanId = null;

function rememberPlan(params, result) {
    if (result?.__error) return result;
    const planId = `mock-plan-${++planSeq}`;
    plans.set(planId, structuredClone(params ?? {}));
    latestPlanId = planId;
    return { ...result, planId };
}

/** Each app's effective env: sharedEnv first, the app's own env overrides it. */
const effectiveApps = (p) => (p.fastedgeApps ?? []).map((a) =>
    p.sharedEnv ? { ...a, env: { ...p.sharedEnv, ...(a.env ?? {}) } } : a);

/** The current live deployment (for "Save as fixture"), or null. */
export const getLive = () => live;

export function setLive(state) {
    live = state;
    sessionStorage.setItem(LIVE_KEY, JSON.stringify(state));
}

const fail = (code, message) => ({ __error: { code, message } });

// Names for every referenced secret/store: picker fixtures first, then the names the state already had.
function lookupNames(state, prev = state) {
    const ids = (bag) => new Set(state.fastedgeApps.flatMap((a) => Object.values(a[bag] ?? {})));
    const secretIds = ids('secretRefs');
    const storeIds = ids('storeRefs');
    const known = (list, had, wanted) => [...wanted].map((id) => ({
        id,
        name: list.find((x) => x.id === id)?.name ?? had?.find((x) => x.id === id)?.name ?? `#${id}`,
    }));
    return { secrets: known(secrets, prev?.secrets, secretIds), stores: known(stores, prev?.stores, storeIds) };
}

// Plan steps for a Re-entry plan, diffed by Ref against the live state.
function reentryPlan(params) {
    if (!live) return fail('conflict', 'no live deployment — add fixtures/deployment/current.json or deploy once in template mode');
    if (params?.revision !== live.revision) {
        return fail('conflict', `stale revision "${params?.revision}" — the deployment changed (now "${live.revision}"); reload current()`);
    }
    if (params.cdnResourceId !== undefined && live.cdnResourceId !== undefined && params.cdnResourceId !== live.cdnResourceId) {
        return fail('invalid_params', `the CDN resource cannot change on Re-entry (deployed: ${live.cdnResourceId})`);
    }
    const planApps = effectiveApps(params);
    const removed = new Set(params.remove?.fastedgeApps ?? []);
    const anchorRef = live.fastedgeApps[0]?.ref;
    if (removed.has(anchorRef)) return fail('invalid_params', `cannot remove the anchor app "${anchorRef}"`);

    const steps = [];
    for (const old of live.fastedgeApps) {
        const next = planApps.find((a) => a.ref === old.ref);
        if (removed.has(old.ref)) { steps.push({ action: 'fastedge.apps.delete', describe: `Delete app "${old.name}"` }); continue; }
        if (!next) return fail('conflict', `managed app "${old.ref}" is missing from the plan — list it in remove.fastedgeApps to delete it`);
        if (next.name !== old.name || JSON.stringify(next.source) !== JSON.stringify(old.source)) {
            return fail('invalid_params', `app "${old.ref}": name and source cannot change on Re-entry`);
        }
        if (JSON.stringify(next) !== JSON.stringify(old)) steps.push({ action: 'fastedge.apps.update', describe: `Update app "${old.name}"` });
    }
    for (const a of planApps) {
        if (!live.fastedgeApps.some((o) => o.ref === a.ref)) steps.push({ action: 'fastedge.apps.create', describe: `Create app "${a.name}"` });
    }
    const diffDomain = (key, kind, label) => {
        if (params[key] === undefined) return; // omitted domain → untouched
        const before = live[key] ?? [];
        for (const o of before) {
            const n = params[key].find((x) => x.ref === o.ref);
            if (!n) steps.push({ action: `cdn.${kind}.delete`, describe: `Delete ${label} "${o.name}"` });
            else if (JSON.stringify(n) !== JSON.stringify(o)) steps.push({ action: `cdn.${kind}.update`, describe: `Update ${label} "${o.name}"` });
        }
        for (const n of params[key]) {
            if (!before.some((o) => o.ref === n.ref)) steps.push({ action: `cdn.${kind}.create`, describe: `Create ${label} "${n.name}"` });
        }
    };
    diffDomain('cdnOrigins', 'origins', 'CDN origin group');
    diffDomain('cdnRules', 'rules', 'CDN rule');

    // Same execution order as the real host: creates → updates → deletes.
    const rank = (a) => (a.endsWith('.create') ? 0 : a.endsWith('.update') ? 1 : 2);
    steps.sort((x, y) => rank(x.action) - rank(y.action));
    return {
        summary: steps.length ? `Update deployment: ${steps.length} change(s)` : 'No changes',
        steps,
        warnings: [],
    };
}

function reentryApply(p) {
    const removed = new Set(p.remove?.fastedgeApps ?? []);
    const planApps = effectiveApps(p).filter((a) => !removed.has(a.ref));
    // Keep the live order (the anchor is the first app), new apps after it: reordering the plan must
    // not move the anchor.
    const kept = live.fastedgeApps.map((o) => planApps.find((a) => a.ref === o.ref)).filter(Boolean);
    const next = {
        ...live,
        fastedgeApps: [...kept, ...planApps.filter((a) => !live.fastedgeApps.some((o) => o.ref === a.ref))],
        ...(p.cdnOrigins !== undefined ? { cdnOrigins: p.cdnOrigins } : {}),
        ...(p.cdnRules !== undefined ? { cdnRules: p.cdnRules } : {}),
        revision: String(Number(live.revision) + 1 || 1),
    };
    setLive({ ...next, ...lookupNames(next, live) });
    return { createdFastedgeApps: [], createdCdnOrigins: [], createdCdnRules: [], status: 'complete' };
}

// A template-mode apply becomes the live state, so ?mode=reentry can pick up where it left off.
function recordTemplateDeploy(p) {
    if (!p?.fastedgeApps) return;
    const state = {
        revision: '1',
        fastedgeApps: p.fastedgeApps.map((a) => ({
            ...a,
            env: { ...(p.sharedEnv ?? {}), ...(a.env ?? {}) },
        })),
        ...(p.cdnResourceId !== undefined ? { cdnResourceId: p.cdnResourceId } : {}),
        ...(p.newCdnOrigins ? { cdnOrigins: p.newCdnOrigins } : {}),
        ...(p.newCdnRules ? { cdnRules: p.newCdnRules } : {}),
    };
    setLive({ ...state, ...lookupNames(state) });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function byId(collection, id) {
    return collection.find((item) => item.id === id) ?? collection[0];
}

function templateSummary({ id, name, short_descr, api_type }) {
    return { id, name, short_descr, api_type };
}

function appSummary({ id, name, api_type, status, url }) {
    return { id, name, api_type, status, url };
}

function secretRef({ id, name }) {
    return { id, name };
}

// ── Stub resolver ─────────────────────────────────────────────────────────────

export function stub(intent, params, theme) {
    switch (intent) {
        case 'context.get':
            return {
                specVersion: '1',
                locale: navigator.language || 'en',
                theme,
                wizardAppId: 1,
                managed: { appIds: [] },
                features: {},
                launchTemplateId: reentry ? null : 1,
                // Derive companions from fixture templates with id 2–19.
                // wizard-intake and sync-wizard-fixtures normalise template ids so
                // the launch template is always id 1 and companions are ids 2..19.
                // Templates with id >= 20 are regular platform templates (not wizard-specific).
                companionTemplateIds: templates
                    .filter(t => t.id >= 2 && t.id <= 19)
                    .map(t => t.id),
            };

        case 'fastedge.templates.list':
            return templates.map(templateSummary);
        case 'fastedge.templates.read':
            return byId(templates, params?.id);

        case 'fastedge.apps.list':
            return apps.map(appSummary);
        case 'fastedge.apps.get':
            return byId(apps, params?.id);

        case 'fastedge.secrets.pickOrCreate':
            return secrets.map(secretRef);

        case 'fastedge.stores.pickOrCreate':
            return stores.map(({ id, name }) => ({ id, name }));

        case 'cdn.resources.list':
            return cdnResources.map(({ id, cname, description, status }) => ({
                id,
                cname,
                status,
                ...(description ? { description } : {}),
            }));
        case 'cdn.resources.pick':
            return { id: cdnResources[0].id, cname: cdnResources[0].cname };

        case 'cdn.origins.list':
            return cdnOrigins.map(({ id, name }) => ({ id, name }));

        case 'cdn.rules.list':
            // ponytail: returns all rules regardless of resourceId — mock has no cross-resource data
            return cdnRules.map(({ id, name, rule, weight, originGroupId, fastedgeFilter }) => ({
                id, name, rule,
                ...(weight !== undefined ? { weight } : {}),
                ...(originGroupId !== undefined ? { originGroupId } : {}),
                ...(fastedgeFilter ? { fastedgeFilter } : {}),
            }));

        case 'deployment.current':
            if (!reentry) return fail('denied', 'deployment.current is only available on Re-entry (open the mock host with ?mode=reentry)');
            if (!live) return fail('conflict', 'no live deployment — add fixtures/deployment/current.json or deploy once in template mode');
            return structuredClone(live);

        case 'deployment.plan': {
            if (reentry) return rememberPlan(params, reentryPlan(params));
            const planApps = Array.isArray(params?.fastedgeApps) ? params.fastedgeApps : [{ name: 'stub-app' }];
            const planSecrets = Array.isArray(params?.newFastedgeSecrets) ? params.newFastedgeSecrets : [];
            const planStores = Array.isArray(params?.newFastedgeStores) ? params.newFastedgeStores : [];
            const planOrigins = Array.isArray(params?.newCdnOrigins) ? params.newCdnOrigins : [];
            const planRules = Array.isArray(params?.newCdnRules) ? params.newCdnRules : [];
            const fastedgeHandlers = params?.cdnResourceFastedgeHandlers ?? null;
            const fastedgeHandlerHooks = fastedgeHandlers
                ? Object.keys(fastedgeHandlers).filter((hook) => fastedgeHandlers[hook] !== undefined)
                : [];
            const hasFastedgeHandlerStep = fastedgeHandlerHooks.length > 0 && params?.cdnResourceId !== undefined;

            const steps = [
                ...planSecrets.map((s) => ({ action: 'fastedge.secrets.create', describe: `Create secret "${s.name ?? s.ref}"` })),
                ...planStores.map((s) => ({ action: 'fastedge.stores.create', describe: `Create KV store "${s.name ?? s.ref}"` })),
                ...planApps.map((a) => ({ action: 'fastedge.apps.create', describe: `Create app "${a.name ?? 'stub-app'}"` })),
                ...(params?.cdnResourceId !== undefined ? [{ action: 'cdn.resources.pick', describe: `Use CDN resource #${params.cdnResourceId}` }] : []),
                ...(hasFastedgeHandlerStep ? [{ action: 'cdn.resources.set-fastedge-handlers', describe: `Attach FastEdge handlers on CDN resource #${params.cdnResourceId} (${fastedgeHandlerHooks.join(', ')})` }] : []),
                ...planOrigins.map((o) => ({ action: 'cdn.origins.create', describe: `Create CDN origin group "${o.name}"` })),
                ...planRules.map((r) => ({ action: 'cdn.rules.create', describe: `Create CDN rule "${r.name}"` })),
            ];

            const parts = [];
            if (planSecrets.length) parts.push(`${planSecrets.length} secret(s)`);
            if (planStores.length) parts.push(`${planStores.length} store(s)`);
            parts.push(`${planApps.length} app(s)`);
            if (hasFastedgeHandlerStep) parts.push(`${fastedgeHandlerHooks.length} FastEdge handler(s)`);
            if (planOrigins.length) parts.push(`${planOrigins.length} CDN origin(s)`);
            if (planRules.length) parts.push(`${planRules.length} CDN rule(s)`);

            return rememberPlan(params, {
                summary: `Deploy: ${parts.join(', ')}`,
                steps,
                warnings: [],
            });
        }

        // Write intents — resolved via consent dialog in host.js
        case 'fastedge.apps.create':
            return { id: 201, url: 'https://new-app-201.fastedge.gcorelabs.net', status: 1 };
        case 'fastedge.apps.update':
            return { id: params?.id ?? 101, status: 1 };
        case 'fastedge.apps.link':
            return { updated: Array.isArray(params?.appIds) ? params.appIds : [] };
        case 'fastedge.secrets.generateKeypair':
            return {
                id: 303,
                name: params?.name ?? 'generated-keypair',
                publicKey: JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'mock-x', y: 'mock-y' }),
            };
        case 'cdn.origins.create':
            return { id: 500001, name: params?.name ?? 'new-origin-group' };
        case 'cdn.rules.create':
            return { id: 600001, name: params?.name ?? 'new-rule', rule: params?.rule ?? '^/' };
        case 'deployment.apply': {
            // The host forwards the planId it is applying; tests may omit it (→ the latest plan).
            const id = params?.planId ?? latestPlanId;
            const plan = plans.get(id);
            if (!plan) return fail('not_found', `plan "${id}" not found or already applied`);
            plans.delete(id);
            // Like the real host: a plan made at an older revision (another plan applied since) is stale.
            if (reentry && plan.revision !== live?.revision) {
                return fail('conflict', `stale plan — made at revision "${plan.revision}", the deployment is now "${live?.revision}"; reload current()`);
            }
            if (reentry) return reentryApply(plan);
            recordTemplateDeploy(plan);
            return {
                createdFastedgeApps: [{ ref: 'app-1', id: 201, url: 'https://new-app-201.fastedge.gcorelabs.net' }],
                createdCdnOrigins: [],
                createdCdnRules: [],
                status: 'complete',
            };
        }

        default:
            return null;
    }
}
