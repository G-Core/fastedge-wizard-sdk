/**
 * Intent catalog shapes — all SDK-exposed namespaces fully typed.
 *
 * Mock host (`pnpm run dev`) simulates every intent across all namespaces —
 * `fastedge.*` (incl. `fastedge.stores.*`), `cdn.*`, `deployment.*` — using fixture data.
 * Build and test end-to-end locally without a live portal connection.
 */

// --- context.get ---

export interface WizardContext {
    specVersion: string;
    locale: string;
    theme: 'light' | 'dark';
    wizardAppId: number;
    managed: { appIds: number[] };
    features: Record<string, boolean>;
    /** ID of the template that launched this wizard (template mode), or null (app re-entry). */
    launchTemplateId: number | null;
    /** IDs of companion templates this wizard deploys alongside the main one (e.g. proxy-wasm filter pair). */
    companionTemplateIds: number[];
}

// --- templates.* ---

export interface TemplateSummary {
    id: number;
    name: string;
    short_descr: string;
    long_descr: string;
    api_type: string;
}

export interface TemplateParam {
    name: string;
    data_type: 'string' | 'number' | 'bool' | 'date' | 'time' | 'secret' | 'store';
    descr: string;
    mandatory: boolean;
    metadata?: string;
}

export interface TemplateDetail {
    id: number;
    name: string;
    short_descr: string;
    long_descr: string;
    api_type: string;
    binary_id: number;
    params: TemplateParam[];
}

export interface TemplatesListParams {
    apiType?: 'wasi-http' | 'proxy-wasm';
}

// --- apps.* ---

export interface AppSummary {
    id: number;
    name: string;
    api_type: string;
    status: number;
    url?: string;
}

export interface AppDetail {
    id: number;
    name: string;
    api_type: string;
    status: number;
    url: string;
    template?: number | null;
    env: Record<string, string>;
    secrets: Array<{ name: string; id: number }>;
    rsp_headers?: Record<string, string>;
}

export interface AppCreateParams {
    name: string;
    api_type: 'wasi-http' | 'proxy-wasm';
    source: { fromTemplateId: number } | { binaryId: number };
    env?: Record<string, string>;
    secretRefs?: Record<string, number>;
/** Binds a KV store (selected via `fastedge.stores.pickOrCreate`) to a `store`-type template param,
 *  keyed by param name → store id. */
    storeRefs?: Record<string, number>;
    rsp_headers?: Record<string, string>;
    comment?: string;
    networks?: string[];
}

export interface AppCreateResult {
    id: number;
    url: string;
    status: number;
}

export interface AppUpdateParams {
    id: number;
    name?: string;
    comment?: string;
    env?: Record<string, string>;
    secretRefs?: Record<string, number>;
    storeRefs?: Record<string, number>;
    rsp_headers?: Record<string, string>;
    networks?: string[];
}

export interface AppUpdateResult {
    id: number;
    status: number;
}

export interface AppLinkParams {
    appIds: number[];
    sharedEnv: Record<string, string>;
}

export interface AppLinkResult {
    updated: number[];
}

// --- secrets.* ---

export interface SecretSummary {
    id: number;
    name: string;
    app_count?: number;
    comment?: string;
}

/** How a picked/created ref was obtained: 'picked' (an existing account resource the user selected)
 *  | 'created' (a new one made inline — value typed OR host-generated). Informational for the guest. */
export type SecretRefOrigin = 'picked' | 'created';

export interface SecretRef {
    id: number;
    name: string;
    /** Optional — the guest may use it or ignore it. */
    origin?: SecretRefOrigin;
}

/** Optional params for secrets.pickOrCreate. `bytes` arms the create-inline Generate button with a
 *  host-made random value of that strength (replacing the old generateRandom); `name`/`comment`
 *  pre-fill the create form. `label` is shown in the picker dialog so the user knows what they're
 *  selecting a secret for (e.g. "Handoff key") — purely cosmetic, never sent to the create form.
 *  All optional — omit for a plain pick-or-paste. */
export interface SecretPickOrCreateParams {
    bytes?: number;
    name?: string;
    comment?: string;
    label?: string;
}

// --- stores.* ---

export interface KvStoreSummary {
    id: number;
    name: string;
    comment?: string;
}

export interface KvStoreRef {
    id: number;
    name: string;
    /** Optional — guest may use or ignore. See SecretRefOrigin. */
    origin?: SecretRefOrigin;
}

// --- secrets.generateKeypair ---

export interface SecretGenerateKeypairParams {
    name: string;
    comment?: string;
    algorithm: 'ES256';
}

export interface SecretGenerateKeypairResult {
    id: number;
    name: string;
    publicKey: string;
}

// --- cdn.resources.* ---

export interface CdnResourceSummary {
    id: number;
    cname: string;
    description?: string;
    status: string;
}

export interface CdnResourcePickResult {
    id: number;
    cname: string;
}

// --- cdn.origins.* ---

export interface CdnOriginCreateParams {
    name: string;
    appId: number;
}

export interface CdnOriginCreateResult {
    id: number;
    name: string;
}

export interface CdnOriginSummary {
    id: number;
    name: string;
}

// --- cdn.rules.* ---

export interface CdnRuleCreateParams {
    resourceId: number;
    name: string;
    rule: string;
    weight?: number;
    originGroupId?: number;
    fastedgeFilter?: {
        appId: number;
        hook: 'on_request_headers' | 'on_response_headers';
        interruptOnError?: boolean;
    };
}

export interface CdnRuleCreateResult {
    id: number;
    name: string;
    rule: string;
}

export interface CdnRulesListParams {
    resourceId: number;
}

export interface CdnRuleSummary {
    id: number;
    name: string;
    rule: string;
    weight?: number;
    originGroupId?: number;
    fastedgeFilter?: {
        appId: number;
        hook: 'on_request_headers' | 'on_response_headers';
    };
}

// --- deployment.* ---

export interface DeploymentPlanApp {
    ref: string;
    name: string;
    api_type: 'wasi-http' | 'proxy-wasm';
    source: { fromTemplateId: number } | { binaryId: number };
    env?: Record<string, string>;
    secretRefs?: Record<string, number>;
    storeRefs?: Record<string, number>;
}

export interface DeploymentPlanOrigin {
    ref: string;
    name: string;
    appRef: string; // ref of an app in fastedgeApps[]
}

export interface DeploymentPlanRule {
    ref: string;
    name: string;
    rule: string;
    weight?: number;
    originGroupRef?: string; // ref of an origin in newCdnOrigins[]
    fastedgeFilter?: {
        appRef: string; // ref of an app in fastedgeApps[]
        hook: 'on_request_headers' | 'on_response_headers';
        interruptOnError?: boolean;
    };
}

export interface DeploymentPlanParams {
    fastedgeApps: DeploymentPlanApp[];
    sharedEnv?: Record<string, string>;
    cdnResourceId?: number;
    newCdnOrigins?: DeploymentPlanOrigin[];
    newCdnRules?: DeploymentPlanRule[];
}

export interface DeploymentPlanStep {
    action:
        | 'fastedge.apps.create'
        | 'fastedge.apps.set-env'
        | 'fastedge.apps.link'
        | 'cdn.resources.pick'
        | 'cdn.origins.create'
        | 'cdn.rules.create';
    describe: string;
}

export interface DeploymentPlan {
    planId: string;
    summary: string;
    steps: DeploymentPlanStep[];
    warnings: string[];
}

export interface DeploymentApplyResult {
    createdFastedgeApps: Array<{ ref: string; id: number; url: string }>;
    createdCdnOrigins?: Array<{ ref: string; id: number; name: string }>;
    createdCdnRules?: Array<{ ref: string; id: number }>;
    status: 'complete' | 'rolled_back' | 'partial';
    failedStep?: { describe: string; error: string };
}

export interface DeploymentProgressEvent {
    step: number;
    total: number;
    describe: string;
}

export interface DeployOptions {
    /** Called once after the plan is computed, before apply begins. */
    onPlan?: (plan: DeploymentPlan) => void;
    /** Called for each deployment.progress event during apply. */
    onProgress?: (event: DeploymentProgressEvent) => void;
}
