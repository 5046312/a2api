import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { detectPlatform, getAdapter, type SitePlatform } from '../adapters/index.js';
import { db, schema } from '../db/index.js';
import { refreshAccountBalance } from './balanceService.js';
import { normalizeBaseUrl } from '../shared/http.js';
import { parseJsonObject, stringifyJson } from '../shared/json.js';
import { maskSecret } from '../shared/mask.js';
import { nowIso } from '../shared/time.js';
import { resolveDefaultAccountCredential, upsertDefaultAccountApiKey } from './accountTokenService.js';

export const accountPayloadSchema = z.object({
  siteId: z.number().int().positive().optional(),
  name: z.string().trim().optional().nullable(),
  baseUrl: z.string().trim().url().optional().nullable(),
  platform: z.string().trim().optional().nullable(),
  apiKey: z.string().optional().nullable(),
  customHeaders: z.record(z.string(), z.string()).optional().nullable(),
  useSystemProxy: z.boolean().optional(),
  username: z.string().optional().nullable(),
  credentialMode: z.enum(['auto', 'session', 'apikey', 'oauth']).default('apikey'),
  accessToken: z.string().optional().nullable(),
  apiToken: z.string().optional().nullable(),
  unitCost: z.number().optional().nullable(),
  status: z.enum(['active', 'disabled', 'expired']).optional(),
  isPinned: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  proxyUrl: z.string().trim().optional().nullable(),
  extraConfig: z.record(z.string(), z.unknown()).optional().nullable()
});

export const accountBatchPayloadSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1),
  action: z.enum(['enable', 'disable', 'delete', 'refreshBalance'])
});

export type AccountPayload = z.infer<typeof accountPayloadSchema>;
export type AccountBatchPayload = z.infer<typeof accountBatchPayloadSchema>;
export type AccountRow = typeof schema.accounts.$inferSelect;
type SiteRow = typeof schema.sites.$inferSelect;

export function toAccountView(row: AccountRow & {
  siteName?: string | null;
  sitePlatform?: string | null;
  siteUrl?: string | null;
  siteUseSystemProxy?: boolean | null;
  siteCustomHeaders?: string | null;
  defaultApiKeyMasked?: string | null;
  modelCount?: number | null;
}) {
  const extraConfig = parseJsonObject(row.extraConfig);
  const apiKeyMasked = row.defaultApiKeyMasked ?? maskSecret(row.apiToken);
  return {
    ...row,
    name: row.username,
    baseUrl: row.siteUrl ?? null,
    platform: row.sitePlatform ?? null,
    customHeaders: parseJsonObject(row.siteCustomHeaders),
    useSystemProxy: row.siteUseSystemProxy ?? false,
    apiKeyMasked,
    apiTokenMasked: apiKeyMasked,
    apiToken: undefined,
    accessToken: undefined,
    accessTokenMasked: maskSecret(row.accessToken),
    extraConfig,
    proxyUrl: accountProxyUrl(extraConfig),
    siteName: row.siteName ?? null,
    sitePlatform: row.sitePlatform ?? null,
    modelCount: Number(row.modelCount || 0)
  };
}

export async function listAccounts(query: { siteId?: number; status?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize || 50));
  const filters = [];
  if (query.siteId) filters.push(eq(schema.accounts.siteId, query.siteId));
  if (query.status) filters.push(eq(schema.accounts.status, query.status));
  const where = filters.length > 0 ? and(...filters) : undefined;
  const rows = await db
    .select({
      id: schema.accounts.id,
      siteId: schema.accounts.siteId,
      username: schema.accounts.username,
      credentialMode: schema.accounts.credentialMode,
      accessToken: schema.accounts.accessToken,
      apiToken: schema.accounts.apiToken,
      balance: schema.accounts.balance,
      balanceUsed: schema.accounts.balanceUsed,
      quota: schema.accounts.quota,
      unitCost: schema.accounts.unitCost,
      valueScore: schema.accounts.valueScore,
      status: schema.accounts.status,
      isPinned: schema.accounts.isPinned,
      sortOrder: schema.accounts.sortOrder,
      lastBalanceRefresh: schema.accounts.lastBalanceRefresh,
      oauthProvider: schema.accounts.oauthProvider,
      oauthAccountKey: schema.accounts.oauthAccountKey,
      oauthProjectId: schema.accounts.oauthProjectId,
      extraConfig: schema.accounts.extraConfig,
      createdAt: schema.accounts.createdAt,
      updatedAt: schema.accounts.updatedAt,
      siteName: schema.sites.name,
      sitePlatform: schema.sites.platform,
      siteUrl: schema.sites.url,
      siteUseSystemProxy: schema.sites.useSystemProxy,
      siteCustomHeaders: schema.sites.customHeaders
    })
    .from(schema.accounts)
    .leftJoin(schema.sites, eq(schema.sites.id, schema.accounts.siteId))
    .where(where)
    .orderBy(desc(schema.accounts.isPinned), schema.accounts.sortOrder, desc(schema.accounts.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();
  const totalRow = await db.select({ count: sql<number>`count(*)` }).from(schema.accounts).where(where).get();
  const items = await Promise.all(rows.map(async (row) => {
    const credential = await resolveDefaultAccountCredential(row.id, { apiToken: row.apiToken });
    const modelCountRow = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.modelAvailability)
      .where(and(eq(schema.modelAvailability.accountId, row.id), eq(schema.modelAvailability.available, true)))
      .get();
    return toAccountView({
      ...row,
      defaultApiKeyMasked: credential?.masked ?? '',
      modelCount: Number(modelCountRow?.count || 0)
    });
  }));
  return { items, total: Number(totalRow?.count || 0), page, pageSize };
}

export async function verifyAccountToken(payload: {
  siteId?: number;
  baseUrl?: string | null;
  platform?: string | null;
  proxyUrl?: string | null;
  customHeaders?: Record<string, string> | null;
  token: string;
  credentialMode: 'auto' | 'session' | 'apikey' | 'oauth';
}) {
  let siteId = 0;
  let baseUrl = '';
  let platform = '';
  let proxyUrl: string | null = null;
  let customHeaders: Record<string, string> | null = null;

  if (payload.siteId) {
    const site = await findSiteById(payload.siteId);
    if (!site) throw new Error('Site not found');
    siteId = site.id;
    baseUrl = site.url;
    platform = site.platform;
    proxyUrl = site.proxyUrl;
    customHeaders = parseJsonObject(site.customHeaders) as Record<string, string> | null;
  } else {
    if (!payload.baseUrl) throw new Error('baseUrl is required when siteId is missing');
    baseUrl = normalizeBaseUrl(payload.baseUrl);
    const detected = payload.platform ? null : await detectPlatform(baseUrl);
    platform = payload.platform?.trim() || detected?.platform || 'openai';
    proxyUrl = payload.proxyUrl ?? null;
    customHeaders = payload.customHeaders ?? null;
  }

  const adapter = getAdapter(platform);
  return adapter.verifyToken({
    siteId,
    baseUrl,
    platform: platform as SitePlatform,
    proxyUrl,
    customHeaders,
    token: payload.token,
    credentialMode: payload.credentialMode
  });
}

export async function createAccount(payload: AccountPayload) {
  const now = nowIso();
  const site = await resolveSiteForAccountPayload(payload);
  if (!site) throw new Error('baseUrl is required when siteId is missing');
  const extraConfig = mergeAccountExtraConfig(payload.extraConfig ?? null, payload.proxyUrl);
  const maxSortOrderRow = await db
    .select({ value: sql<number>`coalesce(max(${schema.accounts.sortOrder}), -1)` })
    .from(schema.accounts)
    .get();
  const inserted = await db
    .insert(schema.accounts)
    .values({
      siteId: site.id,
      username: payload.name ?? payload.username ?? null,
      credentialMode: payload.credentialMode,
      accessToken: payload.accessToken ?? null,
      apiToken: null,
      unitCost: payload.unitCost ?? null,
      status: payload.status ?? 'active',
      isPinned: payload.isPinned ?? false,
      sortOrder: payload.sortOrder ?? Number(maxSortOrderRow?.value ?? -1) + 1,
      extraConfig: extraConfig ? stringifyJson(extraConfig) : null,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
  const credential = await upsertDefaultAccountApiKey(inserted.id, payload.apiKey ?? payload.apiToken);
  return toAccountView({
    ...inserted,
    defaultApiKeyMasked: credential?.masked ?? '',
    siteName: site.name,
    sitePlatform: site.platform,
    siteUrl: site.url,
    siteUseSystemProxy: site.useSystemProxy,
    siteCustomHeaders: site.customHeaders
  });
}

export async function updateAccount(id: number, payload: Partial<AccountPayload>) {
  const current = await db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
  if (!current) return null;
  const site = await resolveSiteForAccountPayload(payload, current);
  const nextExtraConfig = accountExtraConfigForUpdate(current, payload);
  const credential = await upsertAccountCredentialForUpdate(current, payload);
  const updated = await db
    .update(schema.accounts)
    .set({
      siteId: site?.id ?? payload.siteId ?? current.siteId,
      username: payload.name === undefined && payload.username === undefined ? current.username : payload.name ?? payload.username ?? null,
      credentialMode: payload.credentialMode ?? current.credentialMode,
      accessToken: payload.accessToken === undefined ? current.accessToken : payload.accessToken,
      apiToken: null,
      unitCost: payload.unitCost === undefined ? current.unitCost : payload.unitCost,
      status: payload.status ?? current.status,
      isPinned: payload.isPinned ?? current.isPinned,
      sortOrder: payload.sortOrder ?? current.sortOrder,
      extraConfig: nextExtraConfig,
      updatedAt: nowIso()
    })
    .where(eq(schema.accounts.id, id))
    .returning()
    .get();
  const nextSite = site ?? (await findSiteById(updated.siteId));
  return toAccountView({
    ...updated,
    defaultApiKeyMasked: credential?.masked ?? '',
    siteName: nextSite?.name ?? null,
    sitePlatform: nextSite?.platform ?? null,
    siteUrl: nextSite?.url ?? null,
    siteUseSystemProxy: nextSite?.useSystemProxy ?? false,
    siteCustomHeaders: nextSite?.customHeaders ?? null
  });
}

export async function deleteAccount(id: number): Promise<boolean> {
  const result = await db.delete(schema.accounts).where(eq(schema.accounts.id, id)).run();
  return result.changes > 0;
}

export async function batchUpdateAccounts(payload: AccountBatchPayload) {
  const ids = Array.from(new Set(payload.ids));
  const successIds: number[] = [];
  const failedItems: Array<{ id: number; message: string }> = [];
  const now = nowIso();

  for (const id of ids) {
    try {
      if (payload.action === 'refreshBalance') {
        await refreshAccountBalance(id);
        successIds.push(id);
        continue;
      }

      const account = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.id, id)).get();
      if (!account) {
        failedItems.push({ id, message: 'Account not found' });
        continue;
      }

      if (payload.action === 'delete') {
        await db.delete(schema.accounts).where(eq(schema.accounts.id, id)).run();
      } else {
        await db
          .update(schema.accounts)
          .set({ status: payload.action === 'enable' ? 'active' : 'disabled', updatedAt: now })
          .where(eq(schema.accounts.id, id))
          .run();
      }
      successIds.push(id);
    } catch (error) {
      failedItems.push({ id, message: error instanceof Error ? error.message : 'Batch account update failed' });
    }
  }

  return {
    ok: true,
    action: payload.action,
    successIds,
    failedItems,
    updated: payload.action === 'enable' || payload.action === 'disable' ? successIds.length : 0,
    deleted: payload.action === 'delete' ? successIds.length : 0,
    refreshed: payload.action === 'refreshBalance' ? successIds.length : 0
  };
}

function accountExtraConfigForUpdate(current: AccountRow, payload: Partial<AccountPayload>): string | null {
  if (payload.extraConfig === undefined && payload.proxyUrl === undefined) return current.extraConfig;
  const baseExtraConfig = payload.extraConfig === undefined ? parseJsonObject(current.extraConfig) : payload.extraConfig;
  const nextExtraConfig = mergeAccountExtraConfig(baseExtraConfig ?? null, payload.proxyUrl);
  return nextExtraConfig ? stringifyJson(nextExtraConfig) : null;
}

async function upsertAccountCredentialForUpdate(current: AccountRow, payload: Partial<AccountPayload>) {
  const nextToken = payload.apiKey ?? payload.apiToken;
  if (nextToken !== undefined && nextToken !== null && nextToken.trim() !== '') {
    return upsertDefaultAccountApiKey(current.id, nextToken);
  }
  if (current.apiToken && current.apiToken.trim()) {
    return upsertDefaultAccountApiKey(current.id, current.apiToken);
  }
  return resolveDefaultAccountCredential(current.id);
}

async function resolveSiteForAccountPayload(payload: Partial<AccountPayload>, current?: AccountRow): Promise<SiteRow | null> {
  if (!payload.baseUrl && !payload.platform && payload.customHeaders === undefined && payload.useSystemProxy === undefined) {
    if (payload.siteId) return findSiteById(payload.siteId);
    if (current) return findSiteById(current.siteId);
    return null;
  }

  const currentSite = current ? await findSiteById(current.siteId) : null;
  const baseUrl = payload.baseUrl ? normalizeBaseUrl(payload.baseUrl) : currentSite?.url;
  if (!baseUrl) return payload.siteId ? findSiteById(payload.siteId) : null;

  const detected = payload.platform ? null : await detectPlatform(baseUrl);
  const platform = (payload.platform?.trim() || detected?.platform || currentSite?.platform || 'openai') as string;
  const existing = await db
    .select()
    .from(schema.sites)
    .where(and(eq(schema.sites.platform, platform), eq(schema.sites.url, baseUrl)))
    .get();
  if (existing) return updateInternalSite(existing, payload);

  const now = nowIso();
  const name = payload.name?.trim() || payload.username?.trim() || siteNameFromUrl(baseUrl);
  const inserted = await db.insert(schema.sites).values({
    name,
    url: baseUrl,
    platform,
    useSystemProxy: payload.useSystemProxy ?? currentSite?.useSystemProxy ?? false,
    customHeaders: payload.customHeaders === undefined
      ? currentSite?.customHeaders ?? null
      : payload.customHeaders === null
        ? null
        : stringifyJson(payload.customHeaders),
    globalWeight: currentSite?.globalWeight ?? 1,
    status: currentSite?.status ?? 'active',
    createdAt: now,
    updatedAt: now
  }).returning().get();
  await db.insert(schema.siteApiEndpoints).values({
    siteId: inserted.id,
    url: baseUrl,
    enabled: true,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now
  }).run();
  return inserted;
}

async function updateInternalSite(site: SiteRow, payload: Partial<AccountPayload>): Promise<SiteRow> {
  if (payload.customHeaders === undefined && payload.useSystemProxy === undefined) return site;
  const updated = await db.update(schema.sites)
    .set({
      customHeaders: payload.customHeaders === undefined
        ? site.customHeaders
        : payload.customHeaders === null
          ? null
          : stringifyJson(payload.customHeaders),
      useSystemProxy: payload.useSystemProxy ?? site.useSystemProxy,
      updatedAt: nowIso()
    })
    .where(eq(schema.sites.id, site.id))
    .returning()
    .get();
  return updated ?? site;
}

async function findSiteById(siteId: number): Promise<SiteRow | null> {
  const site = await db.select().from(schema.sites).where(eq(schema.sites.id, siteId)).get();
  return site ?? null;
}

function siteNameFromUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname || baseUrl;
  } catch {
    return baseUrl;
  }
}

// 账号级代理复用 extraConfig，避免为单个配置项新增数据库字段。
function mergeAccountExtraConfig(
  extraConfig: Record<string, unknown> | null,
  proxyUrl: string | null | undefined
): Record<string, unknown> | null {
  const next = { ...(extraConfig ?? {}) };
  if (proxyUrl !== undefined) {
    const normalizedProxyUrl = typeof proxyUrl === 'string' ? proxyUrl.trim() : '';
    if (normalizedProxyUrl) {
      next.proxyUrl = normalizedProxyUrl;
    } else {
      delete next.proxyUrl;
    }
  }
  return Object.keys(next).length > 0 ? next : null;
}

function accountProxyUrl(extraConfig: Record<string, unknown> | null): string | null {
  const value = extraConfig?.proxyUrl;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
