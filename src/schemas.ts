import { z } from 'zod';
import type {
    TemplateDetail,
    TemplateParam,
    AppDetail,
    SecretSummary,
    KvStoreSummary,
    CdnResourceSummary,
    CdnOriginSummary,
    CdnRuleSummary,
    DeploymentCurrent,
} from './types.js';

// ── Sub-types ─────────────────────────────────────────────────────────────────

const TemplateParamSchema: z.ZodType<TemplateParam> = z.object({
    name: z.string(),
    data_type: z.enum(['string', 'number', 'bool', 'date', 'time', 'secret', 'store']),
    descr: z.string(),
    mandatory: z.boolean(),
    metadata: z.string().optional(),
});

// ── Fixture schemas ───────────────────────────────────────────────────────────

export const TemplateDetailSchema: z.ZodType<TemplateDetail> = z.object({
    id: z.number().int(),
    name: z.string(),
    short_descr: z.string(),
    long_descr: z.string(),
    api_type: z.string(),
    binary_id: z.number().int(),
    params: z.array(TemplateParamSchema),
});

export const AppDetailSchema: z.ZodType<AppDetail> = z.object({
    id: z.number().int(),
    name: z.string(),
    api_type: z.string(),
    status: z.number().int(),
    url: z.string(),
    template: z.number().int().nullable().optional(),
    env: z.record(z.string()),
    secrets: z.array(z.object({ name: z.string(), id: z.number().int() })),
    rsp_headers: z.record(z.string()).optional(),
});

export const SecretSummarySchema: z.ZodType<SecretSummary> = z.object({
    id: z.number().int(),
    name: z.string(),
    app_count: z.number().int().optional(),
    comment: z.string().optional(),
});

export const KvStoreSummarySchema: z.ZodType<KvStoreSummary> = z.object({
    id: z.number().int(),
    name: z.string(),
    comment: z.string().optional(),
});

export const CdnResourceSummarySchema: z.ZodType<CdnResourceSummary> = z.object({
    id: z.number().int(),
    cname: z.string(),
    description: z.string().optional(),
    status: z.string(),
});

export const CdnOriginSummarySchema: z.ZodType<CdnOriginSummary> = z.object({
    id: z.number().int(),
    name: z.string(),
});

const CdnFastedgeFilterSchema = z.object({
    appId: z.number().int(),
    hook: z.enum(['on_request_headers', 'on_response_headers']),
});

export const CdnRuleSummarySchema: z.ZodType<CdnRuleSummary> = z.object({
    id: z.number().int(),
    name: z.string(),
    rule: z.string(),
    weight: z.number().optional(),
    originGroupId: z.number().int().optional(),
    fastedgeFilter: CdnFastedgeFilterSchema.optional(),
});

// deployment.current() fixture — the live state the mock host serves in Re-entry mode.
const RefNameSchema = z.object({ id: z.number().int(), name: z.string() });

export const DeploymentCurrentSchema: z.ZodType<DeploymentCurrent> = z.object({
    revision: z.string(),
    fastedgeApps: z.array(
        z.object({
            ref: z.string().min(1),
            name: z.string(),
            api_type: z.enum(['wasi-http', 'proxy-wasm']),
            source: z.union([
                z.object({ fromTemplateId: z.number().int() }),
                z.object({ binaryId: z.number().int() }),
            ]),
            env: z.record(z.string()).optional(),
            secretRefs: z.record(z.number().int()).optional(),
            storeRefs: z.record(z.number().int()).optional(),
        }),
    ),
    cdnResourceId: z.number().int().optional(),
    cdnOrigins: z.array(z.object({ ref: z.string().min(1), name: z.string(), appRef: z.string() })).optional(),
    cdnRules: z
        .array(
            z.object({
                ref: z.string().min(1),
                name: z.string(),
                rule: z.string(),
                weight: z.number().optional(),
                originGroupRef: z.string().optional(),
                fastedgeFilter: z
                    .object({
                        appRef: z.string(),
                        hook: z.enum(['on_request_headers', 'on_response_headers']),
                        interruptOnError: z.boolean().optional(),
                    })
                    .optional(),
            }),
        )
        .optional(),
    secrets: z.array(RefNameSchema),
    stores: z.array(RefNameSchema),
});

// Optional seed queue for the mock host's inline "Create new" in {secrets,stores}.pickOrCreate.
// Each entry is handed out (in order) as a created resource, so a scripted flow that creates
// several resources gets stable, meaningful names without per-create prompts.
const NewResourceSeedSchema = z.object({
    name: z.string(),
    comment: z.string().optional(),
});

// ── Fixture map — used by dev.mjs at startup ──────────────────────────────────
// Keys are relative paths under fixtures/: 'fastedge/templates' → fixtures/fastedge/templates.json

export const fixtureSchemas = {
    'fastedge/templates': z.array(TemplateDetailSchema),
    'fastedge/apps': z.array(AppDetailSchema),
    'fastedge/secrets': z.array(SecretSummarySchema),
    'fastedge/stores': z.array(KvStoreSummarySchema),
    'fastedge/new-secrets': z.array(NewResourceSeedSchema),
    'fastedge/new-stores': z.array(NewResourceSeedSchema),
    'cdn/resources': z.array(CdnResourceSummarySchema),
    'cdn/origins': z.array(CdnOriginSummarySchema),
    'cdn/rules': z.array(CdnRuleSummarySchema),
    'deployment/current': DeploymentCurrentSchema,
} as const;

export type FixtureName = keyof typeof fixtureSchemas;
