import { describe, it, expect } from 'vitest';

import { defineFieldMap, field, fieldError, REMOVE } from './field-map';
import { WizardError } from './errors';
import type { DeploymentPlanRule, DeploymentState } from './types';

// A two-app deployment shaped like edge-totp's (filter + app), as `deployment.current()` would return it.
function liveState(): DeploymentState {
    return {
        fastedgeApps: [
            {
                ref: 'filter',
                name: 'acme-filter',
                api_type: 'proxy-wasm',
                source: { fromTemplateId: 1 },
                env: { AUTH_PREFIX: '/auth', MFA_LOGIN_URL: 'https://login.example' },
                secretRefs: { MFA_SESSION_KEY: 11 },
            },
            {
                ref: 'app',
                name: 'acme-app',
                api_type: 'wasi-http',
                source: { fromTemplateId: 2 },
                env: {
                    AUTH_PREFIX: '/auth',
                    KV_STORE_ID: '7',
                    PROOF_TTL: '300',
                    MFA_PROOF_PUBLIC_JWK: '{"kty":"EC"}',
                    HAND_ADDED: 'keep me',
                    ROUTER_CONFIG: '{"schemaVersion":1,"rules":[]}',
                },
                secretRefs: { MFA_SESSION_KEY: 11, MFA_PROOF_SIGNING_KEY: 12 },
                storeRefs: { TOTP_USER_SEEDS: 7 },
            },
        ],
        cdnResourceId: 99,
        cdnRules: [
            { ref: 'app-route', name: 'acme-route', rule: '^/auth', weight: 1, originGroupRef: 'app-origin' },
            { ref: 'filter:/admin', name: 'acme-f1', rule: '^/admin', weight: 10 },
            { ref: 'filter:/billing', name: 'acme-f2', rule: '^/billing', weight: 10 },
        ],
        secrets: [
            { id: 11, name: 'acme-session-key' },
            { id: 12, name: 'acme-proof-key' },
        ],
        stores: [{ id: 7, name: 'acme-seeds' }],
    };
}

const app = (s: DeploymentState, ref: string) => s.fastedgeApps.find((a) => a.ref === ref)!;

function expectInvalidParams(fn: () => unknown, match: RegExp): void {
    try {
        fn();
    } catch (e) {
        expect(e).toBeInstanceOf(WizardError);
        expect((e as WizardError).code).toBe('invalid_params');
        expect((e as Error).message).toMatch(match);
        return;
    }
    throw new Error('expected a WizardError(invalid_params)');
}

describe('field.env', () => {
    it('loads a value, and saving it back changes only that key', () => {
        const map = defineFieldMap({ loginUrl: field.env('filter', 'MFA_LOGIN_URL') });
        const state = liveState();
        const { values, errors } = map.load(state);
        expect(errors).toEqual({});
        expect(values.loginUrl).toBe('https://login.example');

        const next = map.save({ loginUrl: 'https://new.example' }, state);
        expect(app(next, 'filter').env).toEqual({ AUTH_PREFIX: '/auth', MFA_LOGIN_URL: 'https://new.example' });
        expect(app(next, 'app')).toEqual(app(state, 'app')); // other app untouched
        expect(app(state, 'filter').env?.MFA_LOGIN_URL).toBe('https://login.example'); // input not mutated
    });

    it('live → load → save round trip keeps keys the wizard does not map (hand edits survive)', () => {
        const map = defineFieldMap({ ttl: field.env('app', 'PROOF_TTL') });
        const state = liveState();
        const next = map.save(map.load(state).values, state);
        expect(next).toEqual(state);
        expect(app(next, 'app').env?.HAND_ADDED).toBe('keep me');
    });

    it('reports missing, or falls back to default', () => {
        const state = liveState();
        expect(defineFieldMap({ x: field.env('app', 'NOPE') }).load(state).errors.x?.code).toBe('missing');
        expect(defineFieldMap({ x: field.env('app', 'NOPE', { default: 'd' }) }).load(state).values.x).toBe('d');
    });

    it('undefined leaves the key untouched; REMOVE deletes it', () => {
        const map = defineFieldMap({ loginUrl: field.env('filter', 'MFA_LOGIN_URL') });
        const state = liveState();
        expect(map.save({}, state)).toEqual(state);
        expect(map.save({ loginUrl: REMOVE }, state).fastedgeApps[0]!.env).not.toHaveProperty('MFA_LOGIN_URL');
    });

    it('omitIfDefault deletes an existing key when the value goes back to default', () => {
        const map = defineFieldMap({ ttl: field.env('app', 'PROOF_TTL', { default: '90', omitIfDefault: true }) });
        const state = liveState();
        expect(app(map.save({ ttl: '90' }, state), 'app').env).not.toHaveProperty('PROOF_TTL');
        expect(app(map.save({ ttl: '120' }, state), 'app').env?.PROOF_TTL).toBe('120');
    });

    it('rejects a non-string value for a plain env field', () => {
        const map = defineFieldMap({ ttl: field.env('app', 'PROOF_TTL') });
        expectInvalidParams(() => map.save({ ttl: 5 as unknown as string }, liveState()), /PROOF_TTL/);
    });
});

describe('field.env across several apps', () => {
    const map = defineFieldMap({ prefix: field.env(['filter', 'app'], 'AUTH_PREFIX') });

    it('loads the shared value and writes it to every app', () => {
        const state = liveState();
        expect(map.load(state).values.prefix).toBe('/auth');
        const next = map.save({ prefix: '/mfa' }, state);
        expect(app(next, 'filter').env?.AUTH_PREFIX).toBe('/mfa');
        expect(app(next, 'app').env?.AUTH_PREFIX).toBe('/mfa');
    });

    it('reports diverged when the apps disagree or only some have it', () => {
        const state = liveState();
        app(state, 'app').env!.AUTH_PREFIX = '/other';
        const err = map.load(state).errors.prefix;
        expect(err?.code).toBe('diverged');
        expect(err?.raw).toEqual({ filter: '/auth', app: '/other' });

        delete app(state, 'app').env!.AUTH_PREFIX;
        expect(map.load(state).errors.prefix?.code).toBe('diverged');
    });
});

describe('field.json', () => {
    type Router = { schemaVersion: 2; rules: string[] };
    const parse = (raw: unknown): Router => {
        const o = raw as { schemaVersion?: number; rules?: string[] };
        if (o.schemaVersion === 1) return { schemaVersion: 2, rules: o.rules ?? [] }; // upgrade
        if (o.schemaVersion === 2) return o as Router;
        throw new Error(`unknown schemaVersion ${String(o.schemaVersion)}`);
    };
    const validate = (r: Router) => {
        if (!Array.isArray(r.rules)) throw new Error('rules must be an array');
    };
    const map = defineFieldMap({ router: field.env('app', 'ROUTER_CONFIG', { codec: field.json({ parse, validate }) }) });

    it('decodes and upgrades through parse; encodes compactly', () => {
        const state = liveState();
        const { values } = map.load(state);
        expect(values.router).toEqual({ schemaVersion: 2, rules: [] });
        const next = map.save({ router: { schemaVersion: 2, rules: ['a'] } }, state);
        expect(app(next, 'app').env?.ROUTER_CONFIG).toBe('{"schemaVersion":2,"rules":["a"]}');
    });

    it('reports invalid (with raw) for broken JSON or a parse rejection', () => {
        const state = liveState();
        app(state, 'app').env!.ROUTER_CONFIG = '{oops';
        expect(map.load(state).errors.router).toMatchObject({ code: 'invalid', raw: '{oops' });

        app(state, 'app').env!.ROUTER_CONFIG = '{"schemaVersion":9}';
        expect(map.load(state).errors.router).toMatchObject({ code: 'invalid', message: expect.stringMatching(/schemaVersion 9/) });
    });

    it('runs validate on save and rejects non-serialisable values', () => {
        expectInvalidParams(() => map.save({ router: { schemaVersion: 2, rules: 'x' as unknown as string[] } }, liveState()), /rules must be an array/);
        const plain = defineFieldMap({ x: field.env('app', 'X', { codec: field.json() }) });
        expectInvalidParams(() => plain.save({ x: () => 1 }, liveState()), /JSON-serialisable/);
    });
});

describe('field.secret / field.store', () => {
    it('loads { id, name } from the lookup, and saves the id', () => {
        const map = defineFieldMap({
            session: field.secret(['filter', 'app'], 'MFA_SESSION_KEY'),
            seeds: field.store('app', 'TOTP_USER_SEEDS'),
        });
        const state = liveState();
        const { values, errors } = map.load(state);
        expect(errors).toEqual({});
        expect(values.session).toEqual({ id: 11, name: 'acme-session-key' });
        expect(values.seeds).toEqual({ id: 7, name: 'acme-seeds' });

        const next = map.save({ session: { id: 20, name: 'rotated' } }, state);
        expect(app(next, 'filter').secretRefs?.MFA_SESSION_KEY).toBe(20);
        expect(app(next, 'app').secretRefs?.MFA_SESSION_KEY).toBe(20);
        expect(app(next, 'app').secretRefs?.MFA_PROOF_SIGNING_KEY).toBe(12);
    });

    it('reports diverged when two apps bind different secrets; falls back to #id for an unknown name', () => {
        const map = defineFieldMap({ session: field.secret(['filter', 'app'], 'MFA_SESSION_KEY') });
        const state = liveState();
        app(state, 'filter').secretRefs!.MFA_SESSION_KEY = 13;
        expect(map.load(state).errors.session?.code).toBe('diverged');

        const one = defineFieldMap({ s: field.secret('filter', 'MFA_SESSION_KEY') });
        expect(one.load(state).values.s).toEqual({ id: 13, name: '#13' });
    });

    it('rejects a value without a numeric id', () => {
        const map = defineFieldMap({ s: field.secret('app', 'X') });
        expectInvalidParams(() => map.save({ s: { name: 'x' } as unknown as { id: number; name: string } }, liveState()), /numeric id/);
    });
});

describe('field.keypair', () => {
    const map = defineFieldMap({ proof: field.keypair('app', 'MFA_PROOF_SIGNING_KEY', 'MFA_PROOF_PUBLIC_JWK') });

    it('loads the existing pair for reuse', () => {
        expect(map.load(liveState()).values.proof).toEqual({ id: 12, name: 'acme-proof-key', publicKey: '{"kty":"EC"}' });
    });

    it('reports an incomplete pair as invalid, an absent one as missing', () => {
        const state = liveState();
        delete app(state, 'app').secretRefs!.MFA_PROOF_SIGNING_KEY;
        expect(map.load(state).errors.proof).toMatchObject({ code: 'invalid', message: expect.stringMatching(/private key missing/) });
        delete app(state, 'app').env!.MFA_PROOF_PUBLIC_JWK;
        expect(map.load(state).errors.proof?.code).toBe('missing');
    });

    it('saves both halves; REMOVE removes both', () => {
        const next = map.save({ proof: { id: 30, name: 'k', publicKey: 'jwk' } }, liveState());
        expect(app(next, 'app').secretRefs?.MFA_PROOF_SIGNING_KEY).toBe(30);
        expect(app(next, 'app').env?.MFA_PROOF_PUBLIC_JWK).toBe('jwk');
        const removed = map.save({ proof: REMOVE }, liveState());
        expect(app(removed, 'app').secretRefs).not.toHaveProperty('MFA_PROOF_SIGNING_KEY');
        expect(app(removed, 'app').env).not.toHaveProperty('MFA_PROOF_PUBLIC_JWK');
    });
});

describe('field.custom', () => {
    // edge-totp's protected paths: one filter rule per path, Ref named by content.
    const PREFIX = 'filter:';
    const protectedPaths = field.custom<string[]>({
        writes: [{ cdnRules: PREFIX }],
        load: (s) => (s.cdnRules ?? []).filter((r) => r.ref.startsWith(PREFIX)).map((r) => r.ref.slice(PREFIX.length)),
        save: (paths, s) => {
            const kept = (s.cdnRules ?? []).filter((r) => !r.ref.startsWith(PREFIX));
            const filters: DeploymentPlanRule[] = paths.map((p, i) => ({ ref: `${PREFIX}${p}`, name: `acme-f${i + 1}`, rule: `^${p}`, weight: 10 }));
            return { ...s, cdnRules: [...kept, ...filters] };
        },
    });

    it('round-trips: live → load → save keeps state; edits only touch its prefix', () => {
        const map = defineFieldMap({ paths: protectedPaths });
        const state = liveState();
        const { values } = map.load(state);
        expect(values.paths).toEqual(['/admin', '/billing']);
        expect(map.save(values, state)).toEqual(state);

        const next = map.save({ paths: ['/admin'] }, state);
        expect(next.cdnRules?.map((r) => r.ref)).toEqual(['app-route', 'filter:/admin']);
    });

    it('throws if save changes anything it did not declare', () => {
        const sneaky = defineFieldMap({
            x: field.custom<string>({
                writes: [{ app: 'app', env: 'A' }],
                load: () => '',
                save: (v, s) => {
                    s.fastedgeApps[1]!.env = { ...s.fastedgeApps[1]!.env, A: v, B: 'clobbered' };
                    return s;
                },
            }),
        });
        expectInvalidParams(() => sneaky.save({ x: 'v' }, liveState()), /env "B" on app "app"/);

        const ruleThief = defineFieldMap({
            x: field.custom<null>({
                writes: [{ cdnRules: PREFIX }],
                load: () => null,
                save: (_v, s) => ({ ...s, cdnRules: [] }), // also deletes app-route
            }),
        });
        expectInvalidParams(() => ruleThief.save({ x: null }, liveState()), /CDN rules outside/);
    });

    it('reports a load failure as invalid', () => {
        const map = defineFieldMap({
            x: field.custom<string>({ writes: [], load: () => { throw new Error('unrecognised rule pattern'); }, save: (_v, s) => s }),
        });
        expect(map.load(liveState()).errors.x).toEqual({ code: 'invalid', message: 'unrecognised rule pattern' });
    });

    it('reports the code a load throws with fieldError', () => {
        const map = defineFieldMap({
            x: field.custom<string>({ writes: [], load: () => { throw fieldError('diverged', 'KV_STORE_ID and TOTP_USER_SEEDS disagree'); }, save: (_v, s) => s }),
        });
        expect(map.load(liveState()).errors.x).toEqual({ code: 'diverged', message: 'KV_STORE_ID and TOTP_USER_SEEDS disagree' });
    });
});

describe('defineFieldMap', () => {
    it('rejects two fields writing the same destination', () => {
        expectInvalidParams(
            () => defineFieldMap({ a: field.env('app', 'X'), b: field.env(['filter', 'app'], 'X') }),
            /"a" and "b" both write env:app:X/,
        );
        expectInvalidParams(
            () => defineFieldMap({
                a: field.keypair('app', 'K', 'JWK'),
                b: field.env('app', 'JWK'),
            }),
            /both write env:app:JWK/,
        );
        const rules = (p: string) => field.custom({ writes: [{ cdnRules: p }], load: () => 0, save: (_v, s) => s });
        expectInvalidParams(() => defineFieldMap({ a: rules('filter:'), b: rules('filter:/a') }), /both write CDN rules/);
    });

    it('throws on a Ref that is not in the deployment', () => {
        const map = defineFieldMap({ x: field.env('ghost', 'X') });
        expectInvalidParams(() => map.load(liveState()), /no app with ref "ghost"/);
        expectInvalidParams(() => map.save({ x: 'v' }, liveState()), /no app with ref "ghost"/);
    });

    it('template mode: saves form values into the wizard\'s own skeletons', () => {
        const map = defineFieldMap({
            router: field.env('main', 'ROUTER_CONFIG', { codec: field.json() }),
            key: field.secret('main', 'API_KEY'),
        });
        const skeleton: DeploymentState = {
            fastedgeApps: [{ ref: 'main', name: 'router', api_type: 'wasi-http', source: { fromTemplateId: 5 } }],
        };
        const plan = map.save({ router: { rules: [] }, key: { id: 3, name: 'k' } }, skeleton);
        expect(plan.fastedgeApps[0]).toEqual({
            ref: 'main',
            name: 'router',
            api_type: 'wasi-http',
            source: { fromTemplateId: 5 },
            env: { ROUTER_CONFIG: '{"rules":[]}' },
            secretRefs: { API_KEY: 3 },
        });
    });
});

describe('field.fixed', () => {
    const live = (): DeploymentState => ({ ...liveState(), revision: 'r1' } as DeploymentState);
    const map = defineFieldMap({
        store: field.fixed('Seeds live here.', field.store('app', 'TOTP_USER_SEEDS')),
        sessionKey: field.fixed('Changing it signs everyone out.', field.secret(['filter', 'app'], 'MFA_SESSION_KEY')),
        loginUrl: field.env('filter', 'MFA_LOGIN_URL'),
        cookie: field.fixed('Visitors hold this cookie.', field.env(['filter', 'app'], 'MFA_SESSION_COOKIE', { default: 'mfa_session' })),
    });

    it('locks() lists fixed fields with their reasons in Re-entry, and nothing in template mode', () => {
        expect(map.locks(live())).toEqual({
            store: 'Seeds live here.',
            sessionKey: 'Changing it signs everyone out.',
            cookie: 'Visitors hold this cookie.',
        });
        expect(map.locks(null)).toEqual({});
    });

    it('save refuses to change a fixed field on a live deployment; unchanged values and other fields pass', () => {
        expectInvalidParams(() => map.save({ store: { id: 8, name: 'other' } }, live()), /"store" is fixed once deployed: Seeds live here\./);
        expectInvalidParams(() => map.save({ sessionKey: REMOVE }, live()), /"sessionKey" is fixed/);
        const next = map.save({ store: { id: 7, name: 'acme-seeds' }, loginUrl: 'https://new.example' }, live());
        expect(app(next, 'filter').env?.MFA_LOGIN_URL).toBe('https://new.example');
    });

    it('a fixed field that could not be loaded is not locked and may be written (a repair)', () => {
        const broken = live();
        delete app(broken, 'app').storeRefs;
        expect(map.locks(broken)).not.toHaveProperty('store');
        expect(app(map.save({ store: { id: 8, name: 'new' } }, broken), 'app').storeRefs).toEqual({ TOTP_USER_SEEDS: 8 });
    });

    it('template mode (no revision) is never enforced, even for a field with a default', () => {
        const next = map.save({ cookie: 'custom_session', store: { id: 8, name: 'x' } }, liveState());
        expect(app(next, 'app').env?.MFA_SESSION_COOKIE).toBe('custom_session');
    });

    it('needs a reason', () => {
        expectInvalidParams(() => field.fixed('', field.env('app', 'X')), /needs a reason/);
    });
});
