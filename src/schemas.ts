import { z } from 'zod';
import type { TemplateDetail, TemplateParam, AppDetail, SecretSummary } from './types.js';

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

// ── Fixture map — used by dev.mjs at startup ──────────────────────────────────

export const fixtureSchemas = {
    templates: z.array(TemplateDetailSchema),
    apps: z.array(AppDetailSchema),
    secrets: z.array(SecretSummarySchema),
} as const;

export type FixtureName = keyof typeof fixtureSchemas;
