import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { detectPlatform, getAdapter, type UpstreamPlatform } from '../adapters/index.js';
import { db, schema } from '../db/index.js';
import { refreshAccountBalance } from './balanceService.js';
import { normalizeBaseUrl } from '../shared/http.js';
import { parseJsonObject, stringifyJson } from '../shared/json.js';
import { maskSecret } from '../shared/mask.js';
import { nowIso } from '../shared/time.js';
import { resolveDefaultAccountCredential } from './accountTokenService.js';

export const accountPayloadSchema = z.object({
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

export function toAccountView(row: AccountRow & {
  defaultApiKeyMasked?: string | null;
  modelCount?: number | null;
}) {
  const extraConfig = parseJsonObject(row.extraConfig);
  const apiKeyMasked = row.defaultApiKeyMasked ?? maskSecret(row.apiToken);
  return {
    ...row,
    name: row.username,
    customHeaders: parseJsonObject(row.customHeaders),
    apiKeyMasked,
    apiTokenMasked: apiKeyMasked,
    apiToken: undefined,
    accessToken: undefined,
    accessTokenMasked: maskSecret(row.accessToken),
    extraConfig,
    modelCount: Number(row.modelCount || 0)
  };
}

export async function listAccounts(query: { status?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize || 50));
  const filters = [];
  if (query.status) filters.push(eq(schema.accounts.status, query.status));
  const where = filters.length > 0 ? and(...filters) : undefined;
  const rows = await db
    .select({
      id: schema.accounts.id,
      username: schema.accounts.username,
      baseUrl: schema.accounts.baseUrl,
      platform: schema.accounts.platform,
      proxyUrl: schema.accounts.proxyUrl,
      useSystemProxy: schema.accounts.useSystemProxy,
      customHeaders: schema.accounts.customHeaders,
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
      updatedAt: schema.accounts.updatedAt
    })
    .from(schema.accounts)
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
  baseUrl?: string | null;
  platform?: string | null;
  proxyUrl?: string | null;
  customHeaders?: Record<string, string> | null;
  token: string;
  credentialMode: 'auto' | 'session' | 'apikey' | 'oauth';
}) {
  if (!payload.baseUrl) throw new Error('baseUrl is required');
  const baseUrl = normalizeBaseUrl(payload.baseUrl);
  const detected = payload.platform ? null : await detectPlatform(baseUrl);
  const platform = payload.platform?.trim() || detected?.platform || 'openai';

  const adapter = getAdapter(platform);
  return adapter.verifyToken({
    accountId: 0,
    baseUrl,
    platform: platform as UpstreamPlatform,
    proxyUrl: payload.proxyUrl ?? null,
    customHeaders: payload.customHeaders ?? null,
    token: payload.token,
    credentialMode: payload.credentialMode
  });
}

export async function detectAccountPlatform(baseUrl: string) {
  return detectPlatform(normalizeBaseUrl(baseUrl));
}

export async function createAccount(payload: AccountPayload) {
  const now = nowIso();
  const upstream = await resolveUpstreamForAccountPayload(payload);
  if (!upstream) throw new Error('baseUrl is required');
  const maxSortOrderRow = await db
    .select({ value: sql<number>`coalesce(max(${schema.accounts.sortOrder}), -1)` })
    .from(schema.accounts)
    .get();
  const inserted = await db
    .insert(schema.accounts)
    .values({
      username: payload.name ?? payload.username ?? null,
      baseUrl: upstream.baseUrl,
      platform: upstream.platform,
      proxyUrl: payload.proxyUrl ?? null,
      useSystemProxy: payload.useSystemProxy ?? false,
      customHeaders: payload.customHeaders ? stringifyJson(payload.customHeaders) : null,
      credentialMode: payload.credentialMode,
      accessToken: payload.accessToken ?? null,
      apiToken: payload.apiKey ?? payload.apiToken ?? null,
      unitCost: payload.unitCost ?? null,
      status: payload.status ?? 'active',
      isPinned: payload.isPinned ?? false,
      sortOrder: payload.sortOrder ?? Number(maxSortOrderRow?.value ?? -1) + 1,
      extraConfig: payload.extraConfig ? stringifyJson(payload.extraConfig) : null,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
  const credential = await resolveDefaultAccountCredential(inserted.id, { apiToken: inserted.apiToken });
  return toAccountView({
    ...inserted,
    defaultApiKeyMasked: credential?.masked ?? ''
  });
}

export async function updateAccount(id: number, payload: Partial<AccountPayload>) {
  const current = await db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
  if (!current) return null;
  const upstream = await resolveUpstreamForAccountPayload(payload, current);
  const nextApiToken = accountApiTokenForUpdate(current, payload);
  const updated = await db
    .update(schema.accounts)
    .set({
      username: payload.name === undefined && payload.username === undefined ? current.username : payload.name ?? payload.username ?? null,
      baseUrl: upstream?.baseUrl ?? current.baseUrl,
      platform: upstream?.platform ?? current.platform,
      proxyUrl: payload.proxyUrl === undefined ? current.proxyUrl : payload.proxyUrl,
      useSystemProxy: payload.useSystemProxy ?? current.useSystemProxy,
      customHeaders: payload.customHeaders === undefined
        ? current.customHeaders
        : payload.customHeaders === null
          ? null
          : stringifyJson(payload.customHeaders),
      credentialMode: payload.credentialMode ?? current.credentialMode,
      accessToken: payload.accessToken === undefined ? current.accessToken : payload.accessToken,
      apiToken: nextApiToken,
      unitCost: payload.unitCost === undefined ? current.unitCost : payload.unitCost,
      status: payload.status ?? current.status,
      isPinned: payload.isPinned ?? current.isPinned,
      sortOrder: payload.sortOrder ?? current.sortOrder,
      extraConfig: payload.extraConfig === undefined ? current.extraConfig : payload.extraConfig ? stringifyJson(payload.extraConfig) : null,
      updatedAt: nowIso()
    })
    .where(eq(schema.accounts.id, id))
    .returning()
    .get();
  const credential = await resolveDefaultAccountCredential(updated.id, { apiToken: updated.apiToken });
  return toAccountView({
    ...updated,
    defaultApiKeyMasked: credential?.masked ?? ''
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

function accountApiTokenForUpdate(current: AccountRow, payload: Partial<AccountPayload>) {
  const nextToken = payload.apiKey ?? payload.apiToken;
  if (nextToken !== undefined && nextToken !== null && nextToken.trim() !== '') {
    return nextToken;
  }
  return current.apiToken;
}

async function resolveUpstreamForAccountPayload(
  payload: Partial<AccountPayload>,
  current?: AccountRow
): Promise<{ baseUrl: string; platform: string } | null> {
  if (!payload.baseUrl && !payload.platform) {
    if (!current) return null;
    return { baseUrl: current.baseUrl, platform: current.platform };
  }
  const baseUrl = payload.baseUrl ? normalizeBaseUrl(payload.baseUrl) : current?.baseUrl;
  if (!baseUrl) return null;
  const detected = payload.platform ? null : await detectPlatform(baseUrl);
  return {
    baseUrl,
    platform: payload.platform?.trim() || detected?.platform || current?.platform || 'openai'
  };
}
