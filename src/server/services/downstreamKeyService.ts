import { randomBytes } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { parseJsonArray, parseJsonRecord, stringifyJson } from '../shared/json.js';
import { maskSecret } from '../shared/mask.js';
import { nowIso } from '../shared/time.js';
import { GLOBAL_ROUTING_POLICY, type CredentialRef, type DownstreamRoutingPolicy } from './downstreamPolicy.js';

export type ProxyAuthResult =
  | {
      ok: true;
      token: string;
      source: 'managed' | 'global';
      key: DownstreamKeyView | null;
      policy: DownstreamRoutingPolicy;
    }
  | { ok: false; statusCode: number; error: string };

export type DownstreamKeyPolicyResult =
  | { ok: true; key: DownstreamKeyView; policy: DownstreamRoutingPolicy }
  | { ok: false; statusCode: number; error: string; code: string };
type DownstreamKeyPolicyError = Extract<DownstreamKeyPolicyResult, { ok: false }>;

const credentialRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('account'),
    siteId: z.number().int().positive(),
    accountId: z.number().int().positive()
  }),
  z.object({
    kind: z.literal('account_token'),
    siteId: z.number().int().positive(),
    accountId: z.number().int().positive(),
    tokenId: z.number().int().positive()
  })
]);

export const downstreamKeyPayloadSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional().nullable(),
  enabled: z.boolean().optional(),
  expiresAt: z.string().optional().nullable(),
  maxCost: z.number().nullable().optional(),
  maxRequests: z.number().int().nullable().optional(),
  modelScope: z.enum(['all', 'selected']).default('selected'),
  supportedModels: z.array(z.string()).default([]),
  allowedRouteIds: z.array(z.number().int()).default([]),
  allowedSiteIds: z.array(z.number().int()).default([]),
  allowedCredentialRefs: z.array(credentialRefSchema).default([]),
  siteWeightMultipliers: z.record(z.string(), z.number()).default({}),
  excludedSiteIds: z.array(z.number().int()).default([]),
  excludedCredentialRefs: z.array(credentialRefSchema).default([])
});

export const downstreamKeyBatchPayloadSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1),
  action: z.enum(['enable', 'disable', 'delete', 'resetUsage'])
});

export type DownstreamKeyPayload = z.infer<typeof downstreamKeyPayloadSchema>;
export type DownstreamKeyBatchPayload = z.infer<typeof downstreamKeyBatchPayloadSchema>;

export type DownstreamKeyView = {
  id: number;
  name: string;
  keyMasked: string;
  key?: string;
  description: string | null;
  enabled: boolean;
  expiresAt: string | null;
  maxCost: number | null;
  usedCost: number;
  maxRequests: number | null;
  usedRequests: number;
  modelScope: 'all' | 'selected';
  supportedModels: string[];
  allowedRouteIds: number[];
  allowedSiteIds: number[];
  allowedCredentialRefs: CredentialRef[];
  siteWeightMultipliers: Record<string, number>;
  excludedSiteIds: number[];
  excludedCredentialRefs: CredentialRef[];
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DownstreamKeySecretView = {
  id: number;
  key: string;
  keyMasked: string;
};

type DownstreamKeyRow = typeof schema.downstreamApiKeys.$inferSelect;

export function createDownstreamKeyValue(): string {
  return `a2api_${randomBytes(24).toString('base64url')}`;
}

export function toDownstreamKeyView(row: DownstreamKeyRow, includeKey = false): DownstreamKeyView {
  const view: DownstreamKeyView = {
    id: row.id,
    name: row.name,
    keyMasked: maskSecret(row.key),
    description: row.description,
    enabled: row.enabled,
    expiresAt: row.expiresAt,
    maxCost: row.maxCost,
    usedCost: row.usedCost,
    maxRequests: row.maxRequests,
    usedRequests: row.usedRequests,
    modelScope: row.modelScope === 'all' ? 'all' : 'selected',
    supportedModels: parseJsonArray<string>(row.supportedModels),
    allowedRouteIds: parseJsonArray<number>(row.allowedRouteIds),
    allowedSiteIds: parseJsonArray<number>(row.allowedSiteIds),
    allowedCredentialRefs: parseJsonArray<CredentialRef>(row.allowedCredentialRefs),
    siteWeightMultipliers: parseJsonRecord<number>(row.siteWeightMultipliers),
    excludedSiteIds: parseJsonArray<number>(row.excludedSiteIds),
    excludedCredentialRefs: parseJsonArray<CredentialRef>(row.excludedCredentialRefs),
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
  if (includeKey) view.key = row.key;
  return view;
}

export async function listDownstreamKeys(): Promise<DownstreamKeyView[]> {
  const rows = await db.select().from(schema.downstreamApiKeys).orderBy(desc(schema.downstreamApiKeys.id)).all();
  return rows.map((row) => toDownstreamKeyView(row));
}

export async function getDownstreamKeySecret(id: number): Promise<DownstreamKeySecretView | null> {
  // 管理端列表默认只展示掩码；复制时按需读取单条明文，避免完整密钥常驻列表数据。
  const row = await db
    .select({ id: schema.downstreamApiKeys.id, key: schema.downstreamApiKeys.key })
    .from(schema.downstreamApiKeys)
    .where(eq(schema.downstreamApiKeys.id, id))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    keyMasked: maskSecret(row.key)
  };
}

export async function getDownstreamKeyPolicyById(id: number): Promise<DownstreamKeyPolicyResult> {
  const row = await db.select().from(schema.downstreamApiKeys).where(eq(schema.downstreamApiKeys.id, id)).get();
  if (!row) {
    return { ok: false, statusCode: 404, error: 'Downstream key not found', code: 'downstream_key_not_found' };
  }
  const view = toDownstreamKeyView(row);
  const validationError = validateDownstreamKeyView(view);
  if (validationError) return validationError;
  return { ok: true, key: view, policy: toDownstreamRoutingPolicy(view) };
}

export async function createDownstreamKey(payload: DownstreamKeyPayload): Promise<DownstreamKeyView> {
  const now = nowIso();
  const key = createDownstreamKeyValue();
  const inserted = await db
    .insert(schema.downstreamApiKeys)
    .values({
      name: payload.name,
      key,
      description: payload.description ?? null,
      enabled: payload.enabled ?? true,
      expiresAt: payload.expiresAt ?? null,
      maxCost: payload.maxCost ?? null,
      maxRequests: payload.maxRequests ?? null,
      modelScope: payload.modelScope,
      supportedModels: stringifyJson(payload.supportedModels),
      allowedRouteIds: stringifyJson(payload.allowedRouteIds),
      allowedSiteIds: stringifyJson(payload.allowedSiteIds),
      allowedCredentialRefs: stringifyJson(payload.allowedCredentialRefs),
      siteWeightMultipliers: stringifyJson(payload.siteWeightMultipliers),
      excludedSiteIds: stringifyJson(payload.excludedSiteIds),
      excludedCredentialRefs: stringifyJson(payload.excludedCredentialRefs),
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
  return toDownstreamKeyView(inserted, true);
}

export async function updateDownstreamKey(id: number, payload: Partial<DownstreamKeyPayload>): Promise<DownstreamKeyView | null> {
  const current = await db.select().from(schema.downstreamApiKeys).where(eq(schema.downstreamApiKeys.id, id)).get();
  if (!current) return null;
  const updated = await db
    .update(schema.downstreamApiKeys)
    .set({
      name: payload.name ?? current.name,
      description: payload.description === undefined ? current.description : payload.description,
      enabled: payload.enabled ?? current.enabled,
      expiresAt: payload.expiresAt === undefined ? current.expiresAt : payload.expiresAt,
      maxCost: payload.maxCost === undefined ? current.maxCost : payload.maxCost,
      maxRequests: payload.maxRequests === undefined ? current.maxRequests : payload.maxRequests,
      modelScope: payload.modelScope ?? current.modelScope,
      supportedModels: payload.supportedModels ? stringifyJson(payload.supportedModels) : current.supportedModels,
      allowedRouteIds: payload.allowedRouteIds ? stringifyJson(payload.allowedRouteIds) : current.allowedRouteIds,
      allowedSiteIds: payload.allowedSiteIds ? stringifyJson(payload.allowedSiteIds) : current.allowedSiteIds,
      allowedCredentialRefs: payload.allowedCredentialRefs ? stringifyJson(payload.allowedCredentialRefs) : current.allowedCredentialRefs,
      siteWeightMultipliers: payload.siteWeightMultipliers ? stringifyJson(payload.siteWeightMultipliers) : current.siteWeightMultipliers,
      excludedSiteIds: payload.excludedSiteIds ? stringifyJson(payload.excludedSiteIds) : current.excludedSiteIds,
      excludedCredentialRefs: payload.excludedCredentialRefs ? stringifyJson(payload.excludedCredentialRefs) : current.excludedCredentialRefs,
      updatedAt: nowIso()
    })
    .where(eq(schema.downstreamApiKeys.id, id))
    .returning()
    .get();
  return toDownstreamKeyView(updated);
}

export async function deleteDownstreamKey(id: number): Promise<boolean> {
  const result = await db.delete(schema.downstreamApiKeys).where(eq(schema.downstreamApiKeys.id, id)).run();
  return result.changes > 0;
}

export async function resetDownstreamKeyUsage(id: number): Promise<DownstreamKeyView | null> {
  const updated = await db
    .update(schema.downstreamApiKeys)
    .set({
      usedCost: 0,
      usedRequests: 0,
      updatedAt: nowIso()
    })
    .where(eq(schema.downstreamApiKeys.id, id))
    .returning()
    .get();
  return updated ? toDownstreamKeyView(updated) : null;
}

export async function batchUpdateDownstreamKeys(payload: DownstreamKeyBatchPayload) {
  const ids = Array.from(new Set(payload.ids));
  const successIds: number[] = [];
  const failedItems: Array<{ id: number; message: string }> = [];
  const now = nowIso();

  // 批量操作逐个落库，确保单个失败不会中断其他密钥处理。
  for (const id of ids) {
    try {
      const key = await db.select({ id: schema.downstreamApiKeys.id }).from(schema.downstreamApiKeys).where(eq(schema.downstreamApiKeys.id, id)).get();
      if (!key) {
        failedItems.push({ id, message: 'Downstream key not found' });
        continue;
      }

      if (payload.action === 'delete') {
        await db.delete(schema.downstreamApiKeys).where(eq(schema.downstreamApiKeys.id, id)).run();
      } else if (payload.action === 'resetUsage') {
        await db
          .update(schema.downstreamApiKeys)
          .set({ usedCost: 0, usedRequests: 0, updatedAt: now })
          .where(eq(schema.downstreamApiKeys.id, id))
          .run();
      } else {
        await db
          .update(schema.downstreamApiKeys)
          .set({ enabled: payload.action === 'enable', updatedAt: now })
          .where(eq(schema.downstreamApiKeys.id, id))
          .run();
      }
      successIds.push(id);
    } catch (error) {
      failedItems.push({ id, message: error instanceof Error ? error.message : 'Batch downstream key update failed' });
    }
  }

  return {
    ok: true,
    action: payload.action,
    successIds,
    failedItems,
    updated: payload.action === 'enable' || payload.action === 'disable' ? successIds.length : 0,
    deleted: payload.action === 'delete' ? successIds.length : 0,
    reset: payload.action === 'resetUsage' ? successIds.length : 0
  };
}

export async function authorizeDownstreamToken(token: string): Promise<ProxyAuthResult> {
  const managed = await db.select().from(schema.downstreamApiKeys).where(eq(schema.downstreamApiKeys.key, token)).get();
  if (managed) {
    const view = toDownstreamKeyView(managed);
    const validationError = validateDownstreamKeyView(view);
    if (validationError) return { ok: false, statusCode: validationError.statusCode, error: validationError.error };
    return {
      ok: true,
      token,
      source: 'managed',
      key: view,
      policy: toDownstreamRoutingPolicy(view)
    };
  }

  if (token === config.proxyToken) {
    return { ok: true, token, source: 'global', key: null, policy: GLOBAL_ROUTING_POLICY };
  }

  return { ok: false, statusCode: 403, error: 'Invalid proxy token' };
}

function validateDownstreamKeyView(view: DownstreamKeyView): DownstreamKeyPolicyError | null {
  if (!view.enabled) return { ok: false, statusCode: 403, error: 'Downstream key disabled', code: 'downstream_key_disabled' };
  if (view.expiresAt && Date.parse(view.expiresAt) <= Date.now()) {
    return { ok: false, statusCode: 403, error: 'Downstream key expired', code: 'downstream_key_expired' };
  }
  if (view.maxCost !== null && view.usedCost >= view.maxCost) {
    return { ok: false, statusCode: 429, error: 'Downstream key cost limit exceeded', code: 'downstream_key_cost_limit_exceeded' };
  }
  if (view.maxRequests !== null && view.usedRequests >= view.maxRequests) {
    return { ok: false, statusCode: 429, error: 'Downstream key request limit exceeded', code: 'downstream_key_request_limit_exceeded' };
  }
  return null;
}

function toDownstreamRoutingPolicy(view: DownstreamKeyView): DownstreamRoutingPolicy {
  return {
    modelScope: view.modelScope,
    supportedModels: view.supportedModels,
    allowedRouteIds: view.allowedRouteIds,
    allowedSiteIds: view.allowedSiteIds,
    allowedCredentialRefs: view.allowedCredentialRefs,
    siteWeightMultipliers: view.siteWeightMultipliers,
    excludedSiteIds: view.excludedSiteIds,
    excludedCredentialRefs: view.excludedCredentialRefs
  };
}

export async function consumeManagedKeyRequest(keyId: number): Promise<void> {
  await db
    .update(schema.downstreamApiKeys)
    .set({
      usedRequests: sql`${schema.downstreamApiKeys.usedRequests} + 1`,
      lastUsedAt: nowIso(),
      updatedAt: nowIso()
    })
    .where(and(eq(schema.downstreamApiKeys.id, keyId), eq(schema.downstreamApiKeys.enabled, true)))
    .run();
}

export async function recordManagedKeyCostUsage(keyId: number, estimatedCost: number): Promise<void> {
  const cost = Number(estimatedCost);
  if (!Number.isFinite(cost) || cost <= 0) return;
  await db
    .update(schema.downstreamApiKeys)
    .set({
      usedCost: sql`${schema.downstreamApiKeys.usedCost} + ${cost}`,
      lastUsedAt: nowIso(),
      updatedAt: nowIso()
    })
    .where(and(eq(schema.downstreamApiKeys.id, keyId), eq(schema.downstreamApiKeys.enabled, true)))
    .run();
}
