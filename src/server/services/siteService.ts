import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { detectPlatform } from '../adapters/index.js';
import { normalizeBaseUrl } from '../shared/http.js';
import { parseJsonObject, stringifyJson } from '../shared/json.js';
import { nowIso } from '../shared/time.js';

export const sitePayloadSchema = z.object({
  name: z.string().trim().min(1),
  url: z.string().trim().url(),
  platform: z.string().trim().min(1),
  proxyUrl: z.string().trim().optional().nullable(),
  useSystemProxy: z.boolean().optional(),
  customHeaders: z.record(z.string(), z.string()).optional().nullable(),
  globalWeight: z.number().positive().optional(),
  isPinned: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  status: z.enum(['active', 'disabled']).optional()
});

export const siteEndpointPayloadSchema = z.object({
  url: z.string().trim().url(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional()
});

export const siteDisabledModelsPayloadSchema = z.object({
  models: z.array(z.string())
});

export const siteBatchPayloadSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1),
  action: z.enum(['enable', 'disable', 'delete', 'enableSystemProxy', 'disableSystemProxy'])
});

export type SitePayload = z.infer<typeof sitePayloadSchema>;
export type SiteEndpointPayload = z.infer<typeof siteEndpointPayloadSchema>;
export type SiteDisabledModelsPayload = z.infer<typeof siteDisabledModelsPayloadSchema>;
export type SiteBatchPayload = z.infer<typeof siteBatchPayloadSchema>;
export type SiteRow = typeof schema.sites.$inferSelect;
export type SiteEndpointRow = typeof schema.siteApiEndpoints.$inferSelect;

export function toSiteView(row: SiteRow) {
  return {
    ...row,
    customHeaders: parseJsonObject(row.customHeaders)
  };
}

function toSiteEndpointView(row: SiteEndpointRow) {
  return row;
}

export async function listSites(query: {
  status?: string;
  platform?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize || 50));
  const filters = [];
  if (query.status) filters.push(eq(schema.sites.status, query.status));
  if (query.platform) filters.push(eq(schema.sites.platform, query.platform));
  if (query.keyword) {
    const keyword = `%${query.keyword}%`;
    filters.push(or(like(schema.sites.name, keyword), like(schema.sites.url, keyword)));
  }
  const where = filters.length > 0 ? and(...filters) : undefined;
  const items = await db
    .select()
    .from(schema.sites)
    .where(where)
    .orderBy(desc(schema.sites.isPinned), schema.sites.sortOrder, desc(schema.sites.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();
  const totalRow = await db.select({ count: sql<number>`count(*)` }).from(schema.sites).where(where).get();
  return {
    items: items.map(toSiteView),
    total: Number(totalRow?.count || 0),
    page,
    pageSize
  };
}

export async function createSite(payload: SitePayload) {
  const now = nowIso();
  const normalizedUrl = normalizeBaseUrl(payload.url);
  const maxSortOrderRow = await db
    .select({ value: sql<number>`coalesce(max(${schema.sites.sortOrder}), -1)` })
    .from(schema.sites)
    .get();
  const inserted = await db
    .insert(schema.sites)
    .values({
      name: payload.name,
      url: normalizedUrl,
      platform: payload.platform,
      proxyUrl: payload.proxyUrl || null,
      useSystemProxy: payload.useSystemProxy ?? false,
      customHeaders: payload.customHeaders ? stringifyJson(payload.customHeaders) : null,
      globalWeight: payload.globalWeight ?? 1,
      isPinned: payload.isPinned ?? false,
      sortOrder: payload.sortOrder ?? Number(maxSortOrderRow?.value ?? -1) + 1,
      status: payload.status ?? 'active',
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();

  await db.insert(schema.siteApiEndpoints).values({
    siteId: inserted.id,
    url: normalizedUrl,
    enabled: true,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now
  }).run();

  return toSiteView(inserted);
}

export async function updateSite(id: number, payload: Partial<SitePayload>) {
  const current = await db.select().from(schema.sites).where(eq(schema.sites.id, id)).get();
  if (!current) return null;
  const normalizedUrl = payload.url ? normalizeBaseUrl(payload.url) : current.url;
  const updated = await db
    .update(schema.sites)
    .set({
      name: payload.name ?? current.name,
      url: normalizedUrl,
      platform: payload.platform ?? current.platform,
      proxyUrl: payload.proxyUrl === undefined ? current.proxyUrl : payload.proxyUrl,
      useSystemProxy: payload.useSystemProxy ?? current.useSystemProxy,
      customHeaders: payload.customHeaders === undefined
        ? current.customHeaders
        : payload.customHeaders === null
          ? null
          : stringifyJson(payload.customHeaders),
      globalWeight: payload.globalWeight ?? current.globalWeight,
      isPinned: payload.isPinned ?? current.isPinned,
      sortOrder: payload.sortOrder ?? current.sortOrder,
      status: payload.status ?? current.status,
      updatedAt: nowIso()
    })
    .where(eq(schema.sites.id, id))
    .returning()
    .get();
  return toSiteView(updated);
}

export async function deleteSite(id: number): Promise<boolean> {
  const result = await db.delete(schema.sites).where(eq(schema.sites.id, id)).run();
  return result.changes > 0;
}

export async function batchUpdateSites(payload: SiteBatchPayload) {
  const ids = Array.from(new Set(payload.ids));
  const successIds: number[] = [];
  const failedItems: Array<{ id: number; message: string }> = [];
  const now = nowIso();

  for (const id of ids) {
    const site = await db.select({ id: schema.sites.id }).from(schema.sites).where(eq(schema.sites.id, id)).get();
    if (!site) {
      failedItems.push({ id, message: 'Site not found' });
      continue;
    }

    try {
      if (payload.action === 'delete') {
        await db.delete(schema.sites).where(eq(schema.sites.id, id)).run();
      } else if (payload.action === 'enableSystemProxy' || payload.action === 'disableSystemProxy') {
        await db
          .update(schema.sites)
          .set({ useSystemProxy: payload.action === 'enableSystemProxy', updatedAt: now })
          .where(eq(schema.sites.id, id))
          .run();
      } else {
        await db
          .update(schema.sites)
          .set({ status: payload.action === 'enable' ? 'active' : 'disabled', updatedAt: now })
          .where(eq(schema.sites.id, id))
          .run();
      }
      successIds.push(id);
    } catch (error) {
      failedItems.push({ id, message: error instanceof Error ? error.message : 'Batch site update failed' });
    }
  }

  return {
    ok: true,
    action: payload.action,
    successIds,
    failedItems,
    updated: payload.action === 'delete' ? 0 : successIds.length,
    deleted: payload.action === 'delete' ? successIds.length : 0
  };
}

export async function listSiteEndpoints(siteId: number) {
  const site = await db.select({ id: schema.sites.id }).from(schema.sites).where(eq(schema.sites.id, siteId)).get();
  if (!site) return null;
  const rows = await db
    .select()
    .from(schema.siteApiEndpoints)
    .where(eq(schema.siteApiEndpoints.siteId, siteId))
    .orderBy(asc(schema.siteApiEndpoints.sortOrder), asc(schema.siteApiEndpoints.id))
    .all();
  return rows.map(toSiteEndpointView);
}

export async function createSiteEndpoint(siteId: number, payload: SiteEndpointPayload) {
  const site = await db.select({ id: schema.sites.id }).from(schema.sites).where(eq(schema.sites.id, siteId)).get();
  if (!site) return null;
  const now = nowIso();
  // 地址池运行态字段由代理层维护，管理端只写基础配置。
  const endpoint = await db
    .insert(schema.siteApiEndpoints)
    .values({
      siteId,
      url: normalizeBaseUrl(payload.url),
      enabled: payload.enabled ?? true,
      sortOrder: payload.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
  return toSiteEndpointView(endpoint);
}

export async function updateSiteEndpoint(endpointId: number, payload: Partial<SiteEndpointPayload>) {
  const current = await db.select().from(schema.siteApiEndpoints).where(eq(schema.siteApiEndpoints.id, endpointId)).get();
  if (!current) return null;
  const endpoint = await db
    .update(schema.siteApiEndpoints)
    .set({
      url: payload.url ? normalizeBaseUrl(payload.url) : current.url,
      enabled: payload.enabled ?? current.enabled,
      sortOrder: payload.sortOrder ?? current.sortOrder,
      updatedAt: nowIso()
    })
    .where(eq(schema.siteApiEndpoints.id, endpointId))
    .returning()
    .get();
  return toSiteEndpointView(endpoint);
}

export async function deleteSiteEndpoint(endpointId: number): Promise<boolean> {
  const result = await db.delete(schema.siteApiEndpoints).where(eq(schema.siteApiEndpoints.id, endpointId)).run();
  return result.changes > 0;
}

export async function listSiteDisabledModels(siteId: number) {
  const site = await db.select({ id: schema.sites.id }).from(schema.sites).where(eq(schema.sites.id, siteId)).get();
  if (!site) return null;
  const rows = await db
    .select({ modelName: schema.siteDisabledModels.modelName })
    .from(schema.siteDisabledModels)
    .where(eq(schema.siteDisabledModels.siteId, siteId))
    .orderBy(asc(schema.siteDisabledModels.modelName))
    .all();
  return { siteId, models: rows.map((row) => row.modelName) };
}

export async function listSiteAvailableModels(siteId: number) {
  const site = await db.select({ id: schema.sites.id }).from(schema.sites).where(eq(schema.sites.id, siteId)).get();
  if (!site) return null;
  const accountModels = await db
    .select({ modelName: schema.modelAvailability.modelName })
    .from(schema.modelAvailability)
    .innerJoin(schema.accounts, eq(schema.modelAvailability.accountId, schema.accounts.id))
    .where(and(eq(schema.accounts.siteId, siteId), eq(schema.modelAvailability.available, true)))
    .all();
  const tokenModels = await db
    .select({ modelName: schema.tokenModelAvailability.modelName })
    .from(schema.tokenModelAvailability)
    .innerJoin(schema.accountTokens, eq(schema.tokenModelAvailability.tokenId, schema.accountTokens.id))
    .innerJoin(schema.accounts, eq(schema.accountTokens.accountId, schema.accounts.id))
    .where(and(eq(schema.accounts.siteId, siteId), eq(schema.tokenModelAvailability.available, true)))
    .all();
  const models = Array.from(new Set([...accountModels, ...tokenModels].map((row) => row.modelName.trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  return { siteId, models };
}

export async function updateSiteDisabledModels(siteId: number, payload: SiteDisabledModelsPayload) {
  const site = await db.select({ id: schema.sites.id }).from(schema.sites).where(eq(schema.sites.id, siteId)).get();
  if (!site) return null;
  const now = nowIso();
  const models = [...new Set(payload.models.map((model) => model.trim()).filter(Boolean))];
  await db.delete(schema.siteDisabledModels).where(eq(schema.siteDisabledModels.siteId, siteId)).run();
  if (models.length > 0) {
    // 全量替换更贴近管理端编辑语义，避免前端和数据库差异累积。
    await db.insert(schema.siteDisabledModels).values(models.map((modelName) => ({
      siteId,
      modelName,
      createdAt: now
    }))).run();
  }
  return { siteId, models };
}

export async function detectSite(url: string) {
  return detectPlatform(url);
}
