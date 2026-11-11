/**
 * Field mapping — declare once where each form field lives in a deployment, then:
 *
 *   const { values, errors } = map.load(state);   // live deployment → form values
 *   const next = map.save(values, state);         // form values → deployment (only mapped keys change)
 *
 * Pure functions: no bridge, no session. `save` never mutates its input and leaves every key it
 * doesn't map untouched, so hand-made dashboard edits survive a Re-entry round trip.
 */
import { WizardError } from './errors.js';
import type { DeploymentPlanApp, DeploymentPlanRule, DeploymentState } from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Pass as a field's value to `save` to delete what the field maps to. `undefined` leaves it untouched. */
export const REMOVE: unique symbol = Symbol('field.REMOVE');
export type Remove = typeof REMOVE;

export interface FieldError {
    /** `missing`: nothing deployed for this field · `invalid`: present but undecodable ·
     *  `diverged`: a multi-app field whose apps disagree. */
    code: 'missing' | 'invalid' | 'diverged';
    message: string;
    /** The raw deployed value(s), so the wizard can show what it couldn't load. Never a secret value. */
    raw?: string | Record<string, string | undefined>;
}

export interface Codec<T> {
    decode(raw: string): T;
    encode(value: T): string;
}

export interface SecretValue {
    id: number;
    name: string;
}

export interface KeypairValue {
    id: number;
    name: string;
    publicKey: string;
}

/** A destination a `custom` field may write. `cdnRules` matches every rule whose Ref starts with the prefix. */
export type Destination =
    | { app: string; env: string }
    | { app: string; secret: string }
    | { app: string; store: string }
    | { cdnRules: string };

export interface Field<T> {
    readonly kind: string;
    /** @internal */
    readonly destinations: Destination[];
    /** @internal */
    load(state: DeploymentState): { value?: T; error?: FieldError };
    /** @internal */
    save(value: T | Remove, state: DeploymentState): DeploymentState;
}

export type FieldValues<F extends Record<string, Field<unknown>>> = {
    [K in keyof F]: F[K] extends Field<infer T> ? T : never;
};

export type FieldSaveValues<F extends Record<string, Field<unknown>>> = {
    [K in keyof F]?: (F[K] extends Field<infer T> ? T : never) | Remove;
};

export interface FieldMap<F extends Record<string, Field<unknown>>> {
    load(state: DeploymentState): { values: Partial<FieldValues<F>>; errors: Partial<Record<keyof F, FieldError>> };
    save(values: FieldSaveValues<F>, state: DeploymentState): DeploymentState;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Refs = string | string[];
const toRefs = (refs: Refs): string[] => (Array.isArray(refs) ? refs : [refs]);

function findApp(state: DeploymentState, ref: string): DeploymentPlanApp {
    const app = state.fastedgeApps.find((a) => a.ref === ref);
    if (!app) throw new WizardError('invalid_params', `field map: no app with ref "${ref}" in the deployment`);
    return app;
}

function clone(state: DeploymentState): DeploymentState {
    return structuredClone(state);
}

function destKey(d: Destination): string {
    if ('env' in d) return `env:${d.app}:${d.env}`;
    if ('secret' in d) return `secret:${d.app}:${d.secret}`;
    if ('store' in d) return `store:${d.app}:${d.store}`;
    return `cdnRules:${d.cdnRules}`;
}

const sameValues = (vals: Array<string | undefined>): boolean => vals.every((v) => v === vals[0]);

/**
 * Read one binding (env key / secret binding / store binding) across several apps. Absent everywhere → absent;
 * present everywhere with one value → that value; anything else → diverged.
 */
function readAcross(
    state: DeploymentState,
    refs: string[],
    read: (app: DeploymentPlanApp) => string | undefined,
    label: string,
): { raw?: string; absent?: true; error?: FieldError } {
    const vals = refs.map((ref) => read(findApp(state, ref)));
    if (vals.every((v) => v === undefined)) return { absent: true };
    if (!sameValues(vals)) {
        return {
            error: {
                code: 'diverged',
                message: `${label} differs between apps ${refs.join(', ')}`,
                raw: Object.fromEntries(refs.map((r, i) => [r, vals[i]])),
            },
        };
    }
    return { raw: vals[0] as string };
}

function writeAcross(state: DeploymentState, refs: string[], write: (app: DeploymentPlanApp) => void): DeploymentState {
    const next = clone(state);
    refs.forEach((ref) => write(findApp(next, ref)));
    return next;
}

function setOrDelete<V>(record: Record<string, V> | undefined, key: string, value: V | undefined): Record<string, V> {
    const out = { ...(record ?? {}) };
    if (value === undefined) delete out[key];
    else out[key] = value;
    return out;
}

// ---------------------------------------------------------------------------
// Codecs
// ---------------------------------------------------------------------------

const stringCodec: Codec<string> = {
    decode: (raw) => raw,
    encode: (value) => {
        if (typeof value !== 'string') throw new Error('expected a string');
        return value;
    },
};

/**
 * JSON-encoded env value. `parse` validates/upgrades what was deployed (e.g. migrate an old
 * `schemaVersion`) — throw to report the field `invalid`. `validate` runs before every encode.
 */
function json<T = unknown>(opts: { parse?: (raw: unknown) => T; validate?: (value: T) => void } = {}): Codec<T> {
    return {
        decode: (raw) => {
            const parsed: unknown = JSON.parse(raw);
            return opts.parse ? opts.parse(parsed) : (parsed as T);
        },
        encode: (value) => {
            opts.validate?.(value);
            const out = JSON.stringify(value);
            if (typeof out !== 'string') throw new Error('value is not JSON-serialisable');
            return out;
        },
    };
}

// ---------------------------------------------------------------------------
// Field kinds
// ---------------------------------------------------------------------------

interface EnvOptions<T> {
    codec?: Codec<T>;
    /** Used when the key is absent (instead of reporting `missing`). */
    default?: T;
    /** Saving the default deletes the key rather than writing it (the app applies its own default). */
    omitIfDefault?: boolean;
}

function env(refs: Refs, key: string): Field<string>;
function env<T>(refs: Refs, key: string, opts: EnvOptions<T> & { codec: Codec<T> }): Field<T>;
function env(refs: Refs, key: string, opts: EnvOptions<string>): Field<string>;
function env<T>(refs: Refs, key: string, opts: EnvOptions<T> = {}): Field<T> {
    const list = toRefs(refs);
    const codec = (opts.codec ?? stringCodec) as Codec<T>;
    const label = `env ${key}`;

    return {
        kind: 'env',
        destinations: list.map((app) => ({ app, env: key })),
        load(state) {
            const r = readAcross(state, list, (a) => a.env?.[key], label);
            if (r.error) return { error: r.error };
            if (r.absent) {
                return opts.default !== undefined
                    ? { value: opts.default }
                    : { error: { code: 'missing', message: `${label} is not set` } };
            }
            try {
                return { value: codec.decode(r.raw as string) };
            } catch (e) {
                return { error: { code: 'invalid', message: `${label}: ${(e as Error).message}`, raw: r.raw } };
            }
        },
        save(value, state) {
            let encoded: string | undefined;
            if (value !== REMOVE) {
                try {
                    encoded = codec.encode(value);
                } catch (e) {
                    throw new WizardError('invalid_params', `${label}: ${(e as Error).message}`);
                }
                if (opts.omitIfDefault && opts.default !== undefined && encoded === codec.encode(opts.default)) {
                    encoded = undefined;
                }
            }
            return writeAcross(state, list, (a) => {
                a.env = setOrDelete(a.env, key, encoded);
            });
        },
    };
}

function refBinding(
    kind: 'secret' | 'store',
    refs: Refs,
    binding: string,
): Field<SecretValue> {
    const list = toRefs(refs);
    const label = `${kind} ${binding}`;
    const bag = kind === 'secret' ? 'secretRefs' : 'storeRefs';
    const lookup = kind === 'secret' ? 'secrets' : 'stores';

    return {
        kind,
        destinations: list.map((app) => (kind === 'secret' ? { app, secret: binding } : { app, store: binding })),
        load(state) {
            const r = readAcross(state, list, (a) => {
                const id = a[bag]?.[binding];
                return id === undefined ? undefined : String(id);
            }, label);
            if (r.error) return { error: r.error };
            if (r.absent) return { error: { code: 'missing', message: `${label} is not bound` } };
            const id = Number(r.raw);
            const name = state[lookup]?.find((s) => s.id === id)?.name ?? `#${id}`;
            return { value: { id, name } };
        },
        save(value, state) {
            if (value !== REMOVE && !Number.isInteger(value?.id)) {
                throw new WizardError('invalid_params', `${label}: value needs a numeric id`);
            }
            const id = value === REMOVE ? undefined : value.id;
            return writeAcross(state, list, (a) => {
                a[bag] = setOrDelete(a[bag], binding, id);
            });
        },
    };
}

const secret = (refs: Refs, binding: string): Field<SecretValue> => refBinding('secret', refs, binding);
const store = (refs: Refs, binding: string): Field<SecretValue> => refBinding('store', refs, binding);

/** A generated keypair: private half in a secret binding, public JWK in an env key. Reuse it — never regenerate on Re-entry. */
function keypair(ref: string, secretBinding: string, publicJwkKey: string): Field<KeypairValue> {
    const label = `keypair ${secretBinding}/${publicJwkKey}`;
    return {
        kind: 'keypair',
        destinations: [{ app: ref, secret: secretBinding }, { app: ref, env: publicJwkKey }],
        load(state) {
            const app = findApp(state, ref);
            const id = app.secretRefs?.[secretBinding];
            const publicKey = app.env?.[publicJwkKey];
            if (id === undefined && publicKey === undefined) {
                return { error: { code: 'missing', message: `${label} is not set` } };
            }
            if (id === undefined || publicKey === undefined) {
                return {
                    error: {
                        code: 'invalid',
                        message: `${label} is incomplete (${id === undefined ? 'private key' : 'public key'} missing)`,
                        ...(publicKey !== undefined ? { raw: publicKey } : {}),
                    },
                };
            }
            const name = state.secrets?.find((s) => s.id === id)?.name ?? `#${id}`;
            return { value: { id, name, publicKey } };
        },
        save(value, state) {
            if (value !== REMOVE && (!Number.isInteger(value?.id) || typeof value?.publicKey !== 'string')) {
                throw new WizardError('invalid_params', `${label}: value needs an id and a publicKey`);
            }
            return writeAcross(state, [ref], (a) => {
                a.secretRefs = setOrDelete(a.secretRefs, secretBinding, value === REMOVE ? undefined : value.id);
                a.env = setOrDelete(a.env, publicJwkKey, value === REMOVE ? undefined : value.publicKey);
            });
        },
    };
}

const FIELD_CODES: ReadonlyArray<FieldError['code']> = ['missing', 'invalid', 'diverged'];

/** A custom `load` reports `invalid` by default; throw `fieldError('missing' | 'diverged', …)` to say otherwise. */
function fieldCodeOf(e: unknown): FieldError['code'] {
    const code = (e as { fieldCode?: unknown } | null)?.fieldCode;
    return FIELD_CODES.find((c) => c === code) ?? 'invalid';
}

/** Throw from a `custom` field's `load` to report a specific error code. */
export function fieldError(code: FieldError['code'], message: string): Error {
    return Object.assign(new Error(message), { fieldCode: code });
}

/**
 * Escape hatch for a value derived from several keys or from CDN rules. `writes` must list every
 * destination `save` may change — anything else it changes throws, so a custom field can't clobber
 * the rest of the deployment. Cover each one with a load→save round-trip test.
 */
function custom<T>(spec: {
    writes: Destination[];
    load: (state: DeploymentState) => T;
    save: (value: T, state: DeploymentState) => DeploymentState;
}): Field<T> {
    return {
        kind: 'custom',
        destinations: spec.writes,
        load(state) {
            try {
                return { value: spec.load(state) };
            } catch (e) {
                return { error: { code: fieldCodeOf(e), message: (e as Error).message } };
            }
        },
        save(value, state) {
            if (value === REMOVE) throw new WizardError('invalid_params', 'custom fields do not support REMOVE — handle removal in save()');
            const next = spec.save(value, clone(state));
            assertOnlyWrote(state, next, spec.writes);
            return next;
        },
    };
}

export const field = { env, secret, store, keypair, custom, json, REMOVE };

// ---------------------------------------------------------------------------
// custom write enforcement
// ---------------------------------------------------------------------------

function assertOnlyWrote(before: DeploymentState, after: DeploymentState, writes: Destination[]): void {
    const allowed = new Set(writes.map(destKey));
    const rulePrefixes = writes.flatMap((d) => ('cdnRules' in d ? [d.cdnRules] : []));
    const fail = (what: string): never => {
        throw new WizardError('invalid_params', `custom field changed ${what}, which it did not declare in writes`);
    };

    if (after.fastedgeApps.length !== before.fastedgeApps.length) fail('the app list');
    before.fastedgeApps.forEach((b) => {
        const a = after.fastedgeApps.find((x) => x.ref === b.ref) ?? fail(`app "${b.ref}"`);
        if (a.name !== b.name || a.api_type !== b.api_type || JSON.stringify(a.source) !== JSON.stringify(b.source)) {
            fail(`app "${b.ref}" identity`);
        }
        const bags = [
            ['env', b.env, a.env],
            ['secret', b.secretRefs, a.secretRefs],
            ['store', b.storeRefs, a.storeRefs],
        ] as const;
        for (const [kind, x, y] of bags) {
            const keys = new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {})]);
            keys.forEach((k) => {
                if ((x as Record<string, unknown> | undefined)?.[k] !== (y as Record<string, unknown> | undefined)?.[k]
                    && !allowed.has(`${kind}:${b.ref}:${k}`)) {
                    fail(`${kind} "${k}" on app "${b.ref}"`);
                }
            });
        }
    });

    const owned = (r: DeploymentPlanRule): boolean => rulePrefixes.some((p) => r.ref.startsWith(p));
    const outside = (rules: DeploymentPlanRule[] | undefined): string =>
        JSON.stringify((rules ?? []).filter((r) => !owned(r)));
    if (outside(before.cdnRules) !== outside(after.cdnRules)) fail('CDN rules outside its declared prefixes');

    if (JSON.stringify(before.cdnOrigins ?? []) !== JSON.stringify(after.cdnOrigins ?? [])) fail('CDN origins');
    if (before.cdnResourceId !== after.cdnResourceId) fail('the CDN resource');
}

// ---------------------------------------------------------------------------
// defineFieldMap
// ---------------------------------------------------------------------------

export function defineFieldMap<F extends Record<string, Field<unknown>>>(fields: F): FieldMap<F> {
    // Two fields writing the same place would make `save` order-dependent — reject up front.
    const seen = new Map<string, string>();
    const prefixes: Array<[string, string]> = [];
    for (const [name, f] of Object.entries(fields)) {
        for (const d of f.destinations) {
            if ('cdnRules' in d) {
                const clash = prefixes.find(([p]) => p.startsWith(d.cdnRules) || d.cdnRules.startsWith(p));
                if (clash) throw new WizardError('invalid_params', `fields "${clash[1]}" and "${name}" both write CDN rules under "${d.cdnRules}"`);
                prefixes.push([d.cdnRules, name]);
                continue;
            }
            const key = destKey(d);
            const other = seen.get(key);
            if (other) throw new WizardError('invalid_params', `fields "${other}" and "${name}" both write ${key}`);
            seen.set(key, name);
        }
    }

    return {
        load(state) {
            const values: Record<string, unknown> = {};
            const errors: Record<string, FieldError> = {};
            for (const [name, f] of Object.entries(fields)) {
                const r = f.load(state);
                if (r.error) errors[name] = r.error;
                else values[name] = r.value;
            }
            return { values: values as Partial<FieldValues<F>>, errors: errors as Partial<Record<keyof F, FieldError>> };
        },
        save(values, state) {
            let next = state;
            for (const [name, f] of Object.entries(fields)) {
                const v = (values as Record<string, unknown>)[name];
                if (v === undefined) continue; // untouched
                next = f.save(v, next);
            }
            return next === state ? clone(state) : next;
        },
    };
}
