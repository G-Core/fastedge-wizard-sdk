/**
 * Doc-04 intent catalog shapes — full typed surface (Phase 2). Write/deployment
 * intents (`apps.*`, `secrets.*`, `deployment.*`) are transport-real stubs whose
 * host handlers land in Phase 4, so calls resolve `denied` today.
 */

// --- context.get ---

export interface WizardContext {
    specVersion: string;
    locale: string;
    theme: 'light' | 'dark';
    wizardAppId: number;
    managed: { appIds: number[] };
    features: Record<string, boolean>;
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

export interface SecretCreateParams {
    name: string;
    comment?: string;
}

export interface SecretRef {
    id: number;
    name: string;
}

// --- deployment.* ---

export interface DeploymentPlanApp {
    ref: string;
    name: string;
    api_type: 'wasi-http' | 'proxy-wasm';
    source: { fromTemplateId: number } | { binaryId: number };
    env?: Record<string, string>;
    secretRefs?: Record<string, number>;
}

export interface DeploymentPlanParams {
    apps: DeploymentPlanApp[];
    sharedEnv?: Record<string, string>;
    newSecrets?: Array<{ ref: string; name: string }>;
}

export interface DeploymentPlanStep {
    action: 'create-app' | 'set-env' | 'create-secret' | 'link';
    describe: string;
}

export interface DeploymentPlan {
    planId: string;
    summary: string;
    steps: DeploymentPlanStep[];
    warnings: string[];
}

export interface DeploymentApplyResult {
    created: Array<{ ref: string; id: number; url: string }>;
    status: 'complete' | 'rolled_back' | 'partial';
    failedStep?: { describe: string; error: string };
}
