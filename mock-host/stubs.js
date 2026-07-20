export const WRITE_INTENTS = new Set([
    'fastedge.apps.create',
    'fastedge.apps.update',
    'fastedge.apps.link',
    'fastedge.secrets.create',
    'deployment.apply',
]);

// ── Stub database ─────────────────────────────────────────────────────────────
// Full detail shape for each record. List intents strip to summary; read/get
// intents return the full record looked up by id.
// Wizard fixtures (if present) override these defaults via applyFixtures().

let templates = [
    {
        id: 1,
        name: 'Markdown Renderer',
        short_descr: 'Converts a Markdown document to HTML, optionally applying CSS',
        long_descr:
            'Call the application at /. It fetches the Markdown document from the path and converts it to HTML. Specify styles via HEAD; set it to an empty string to supply your own CSS in the request body.',
        api_type: 'wasi-http',
        binary_id: 42,
        params: [
            {
                name: 'BASE',
                data_type: 'string',
                descr: 'Base origin URL; the request path is appended to form the Markdown source URL',
                mandatory: true,
            },
            {
                name: 'HEAD',
                data_type: 'string',
                descr: 'Content injected into <head> of the generated HTML document',
                mandatory: false,
            },
        ],
    },
    {
        id: 2,
        name: 'JWT Validation',
        short_descr: 'Validates a JWT passed in the Authorization header as "Bearer <token>"',
        long_descr:
            'Validates the JWT signature and expiry before forwarding the request upstream. Returns 401 on failure.',
        api_type: 'proxy-wasm',
        binary_id: 43,
        params: [
            {
                name: 'JWKS_URI',
                data_type: 'string',
                descr: 'JWKS endpoint used to verify the token signature',
                mandatory: true,
            },
        ],
    },
];

let apps = [
    {
        id: 101,
        name: 'my-first-app',
        api_type: 'wasi-http',
        status: 1,
        url: 'https://my-first-app-101.fastedge.example',
        template: 1,
        env: { BASE: 'https://example.com' },
        secrets: [],
    },
];

let secrets = [{ id: 1, name: 'API_SECRET_TOKEN', app_count: 1 }];

// ── Fixture override ──────────────────────────────────────────────────────────

export function applyFixtures(fixtures) {
    if (fixtures.templates?.length) templates = fixtures.templates;
    if (fixtures.apps?.length)      apps = fixtures.apps;
    if (fixtures.secrets?.length)   secrets = fixtures.secrets;
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
            };

        case 'fastedge.templates.list':
            return templates.map(templateSummary);
        case 'fastedge.templates.read':
            return byId(templates, params?.id);

        case 'fastedge.apps.list':
            return apps.map(appSummary);
        case 'fastedge.apps.get':
            return byId(apps, params?.id);

        case 'fastedge.secrets.list':
            return secrets;
        case 'fastedge.secrets.pick':
            return secrets.map(secretRef);

        case 'deployment.plan': {
            const planApps = Array.isArray(params?.apps) ? params.apps : [{ name: 'stub-app' }];
            return {
                planId: 'mock-plan-abc123',
                summary: `${planApps.length} app(s) to create`,
                steps: planApps.map((a) => ({
                    action: 'create-app',
                    describe: `Create app "${a.name ?? 'stub-app'}"`,
                })),
                warnings: [],
            };
        }

        // Write intents — resolved via consent dialog in host.js
        case 'fastedge.apps.create':
            return { id: 102, url: 'https://new-app-102.fastedge.example', status: 1 };
        case 'fastedge.apps.update':
            return { id: params?.id ?? 101, status: 1 };
        case 'fastedge.apps.link':
            return { updated: Array.isArray(params?.appIds) ? params.appIds : [] };
        case 'fastedge.secrets.create':
            return { id: 201, name: params?.name ?? 'new-secret' };
        case 'deployment.apply':
            return {
                created: [{ ref: 'app-1', id: 102, url: 'https://new-app-102.fastedge.example' }],
                status: 'complete',
            };

        default:
            return null;
    }
}
