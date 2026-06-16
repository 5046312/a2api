import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getAdapter, type SitePlatform } from '../adapters/index.js';
import { db, schema } from '../db/index.js';
import { refreshAccountBalance } from './balanceService.js';
import { parseJsonObject, stringifyJson } from '../shared/json.js';
import { maskSecret } from '../shared/mask.js';
import { nowIso } from '../shared/time.js';

export const accountPayloadSchema = z.object({
  siteId: z.number().int().positive(),
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

export function toAccountView(row: AccountRow & { siteName?: string | null; sitePlatform?: string | null }) {
  const extraConfig = parseJsonObject(row.extraConfig);
  return {
    ...row,
    apiTokenMasked: maskSecret(row.apiToken),
    apiToken: undefined,
    accessToken: undefined,
    accessTokenMasked: maskSecret(row.accessToken),
    extraConfig,
    proxyUrl: accountProxyUrl(extraConfig),
    siteName: row.siteName ?? null,
    sitePlatform: row.sitePlatform ?? null
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
      sitePlatform: schema.sites.platform
    })
    .from(schema.accounts)
    .leftJoin(schema.sites, eq(schema.sites.id, schema.accounts.siteId))
    .where(where)
    .orderBy(desc(schema.accounts.isPinned), schema.accounts.sortOrder, desc(schema.accounts.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();
  const totalRow = await db.select({ count: sql<number>`count(*)` }).from(schema.accounts).where(where).get();
  return { items: rows.map(toAccountView), total: Number(totalRow?.count || 0), page, pageSize };
}

export async function verifyAccountToken(payload: { siteId: number; token: string; credentialMode: 'auto' | 'session' | 'apikey' | 'oauth' }) {
  const site = await db.select().from(schema.sites).where(eq(schema.sites.id, payload.siteId)).get();
  if (!site) throw new Error('Site not found');
  const adapter = getAdapter(site.platform);
  return adapter.verifyToken({
    siteId: site.id,
    baseUrl: site.url,
    platform: site.platform as SitePlatform,
    proxyUrl: site.proxyUrl,
    customHeaders: parseJsonObject(site.customHeaders) as Record<string, string> | null,
    token: payload.token,
    credentialMode: payload.credentialMode
  });
}

export async function createAccount(payload: AccountPayload) {
  const now = nowIso();
  const extraConfig = mergeAccountExtraConfig(payload.extraConfig ?? null, payload.proxyUrl);
  const maxSortOrderRow = await db
    .select({ value: sql<number>`coalesce(max(${schema.accounts.sortOrder}), -1)` })
    .from(schema.accounts)
    .get();
  const inserted = await db
    .insert(schema.accounts)
    .values({
      siteId: payload.siteId,
      username: payload.username ?? null,
      credentialMode: payload.credentialMode,
      accessToken: payload.accessToken ?? null,
      apiToken: payload.apiToken ?? null,
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
  return toAccountView(inserted);
}

export async function updateAccount(id: number, payload: Partial<AccountPayload>) {
  const current = await db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
  if (!current) return null;
  const nextExtraConfig = accountExtraConfigForUpdate(current, payload);
  const updated = await db
    .update(schema.accounts)
    .set({
      siteId: payload.siteId ?? current.siteId,
      username: payload.username === undefined ? current.username : payload.username,
      credentialMode: payload.credentialMode ?? current.credentialMode,
      accessToken: payload.accessToken === undefined ? current.accessToken : payload.accessToken,
      apiToken: payload.apiToken === undefined ? current.apiToken : payload.apiToken,
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
  return toAccountView(updated);
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
