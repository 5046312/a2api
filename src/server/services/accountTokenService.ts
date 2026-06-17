import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getAdapter, type SitePlatform } from '../adapters/index.js';
import type { ApiTokenInfo } from '../adapters/types.js';
import { db, schema } from '../db/index.js';
import { parseJsonObject } from '../shared/json.js';
import { maskSecret } from '../shared/mask.js';
import { nowIso } from '../shared/time.js';

export const accountTokenPayloadSchema = z.object({
  accountId: z.number().int().positive(),
  name: z.string().trim().min(1),
  token: z.string().trim().min(1),
  tokenGroup: z.string().optional().nullable(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional()
});

export type AccountTokenPayload = z.infer<typeof accountTokenPayloadSchema>;
type AccountTokenRow = typeof schema.accountTokens.$inferSelect;
type MutableAccountTokenRow = AccountTokenRow;

const preservedLocalFields = ['name', 'tokenGroup', 'enabled', 'isDefault'] as const;

export type AccountApiCredential = {
  token: string;
  tokenId: number | null;
  masked: string;
};

export function toAccountTokenView(row: AccountTokenRow & { accountName?: string | null; siteName?: string | null }) {
  return {
    ...row,
    token: undefined,
    tokenMasked: maskSecret(row.token),
    accountName: row.accountName ?? null,
    siteName: row.siteName ?? null
  };
}

export async function listAccountTokens(query: { accountId?: number; enabled?: boolean; tokenGroup?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize || 50));
  const filters = [];
  if (query.accountId) filters.push(eq(schema.accountTokens.accountId, query.accountId));
  if (typeof query.enabled === 'boolean') filters.push(eq(schema.accountTokens.enabled, query.enabled));
  if (query.tokenGroup) filters.push(eq(schema.accountTokens.tokenGroup, query.tokenGroup));
  const where = filters.length > 0 ? and(...filters) : undefined;
  const rows = await db
    .select({
      id: schema.accountTokens.id,
      accountId: schema.accountTokens.accountId,
      name: schema.accountTokens.name,
      token: schema.accountTokens.token,
      tokenGroup: schema.accountTokens.tokenGroup,
      valueStatus: schema.accountTokens.valueStatus,
      source: schema.accountTokens.source,
      enabled: schema.accountTokens.enabled,
      isDefault: schema.accountTokens.isDefault,
      localNameLocked: schema.accountTokens.localNameLocked,
      localStatusLocked: schema.accountTokens.localStatusLocked,
      createdAt: schema.accountTokens.createdAt,
      updatedAt: schema.accountTokens.updatedAt,
      accountName: schema.accounts.username,
      siteName: schema.sites.name
    })
    .from(schema.accountTokens)
    .leftJoin(schema.accounts, eq(schema.accounts.id, schema.accountTokens.accountId))
    .leftJoin(schema.sites, eq(schema.sites.id, schema.accounts.siteId))
    .where(where)
    .orderBy(desc(schema.accountTokens.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();
  const totalRow = await db.select({ count: sql<number>`count(*)` }).from(schema.accountTokens).where(where).get();
  return { items: rows.map(toAccountTokenView), total: Number(totalRow?.count || 0), page, pageSize };
}

export async function createAccountToken(payload: AccountTokenPayload) {
  const now = nowIso();
  if (payload.isDefault) {
    await db.update(schema.accountTokens).set({ isDefault: false }).where(eq(schema.accountTokens.accountId, payload.accountId)).run();
  }
  const inserted = await db
    .insert(schema.accountTokens)
    .values({
      accountId: payload.accountId,
      name: payload.name,
      token: payload.token,
      tokenGroup: payload.tokenGroup ?? null,
      enabled: payload.enabled ?? true,
      isDefault: payload.isDefault ?? false,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
  return toAccountTokenView(inserted);
}

export async function resolveDefaultAccountCredential(
  accountId: number,
  fallback: { apiToken?: string | null; accessToken?: string | null; includeAccessToken?: boolean } = {}
): Promise<AccountApiCredential | null> {
  const legacyApiKey = normalizeTokenValue(fallback.apiToken);
  if (legacyApiKey) return { token: legacyApiKey, tokenId: null, masked: maskSecret(legacyApiKey) };

  const defaultToken = await findReadyAccountToken(accountId, true);
  if (defaultToken) return { token: defaultToken.token, tokenId: defaultToken.id, masked: maskSecret(defaultToken.token) };

  const readyToken = await findReadyAccountToken(accountId, false);
  if (readyToken) return { token: readyToken.token, tokenId: readyToken.id, masked: maskSecret(readyToken.token) };

  const accessToken = fallback.includeAccessToken ? normalizeTokenValue(fallback.accessToken) : null;
  return accessToken ? { token: accessToken, tokenId: null, masked: maskSecret(accessToken) } : null;
}

export async function updateAccountToken(id: number, payload: Partial<AccountTokenPayload>) {
  const current = await db.select().from(schema.accountTokens).where(eq(schema.accountTokens.id, id)).get();
  if (!current) return null;
  if (payload.isDefault) {
    await db.update(schema.accountTokens).set({ isDefault: false }).where(eq(schema.accountTokens.accountId, current.accountId)).run();
  }
  const updated = await db
    .update(schema.accountTokens)
    .set({
      name: payload.name ?? current.name,
      token: payload.token ?? current.token,
      tokenGroup: payload.tokenGroup === undefined ? current.tokenGroup : payload.tokenGroup,
      enabled: payload.enabled ?? current.enabled,
      isDefault: payload.isDefault ?? current.isDefault,
      updatedAt: nowIso()
    })
    .where(eq(schema.accountTokens.id, id))
    .returning()
    .get();
  return toAccountTokenView(updated);
}

export async function batchSetAccountTokensEnabled(ids: number[], enabled: boolean): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db
    .update(schema.accountTokens)
    .set({ enabled, updatedAt: nowIso() })
    .where(inArray(schema.accountTokens.id, ids))
    .run();
  return result.changes;
}

export async function deleteAccountToken(id: number): Promise<boolean> {
  const result = await db.delete(schema.accountTokens).where(eq(schema.accountTokens.id, id)).run();
  return result.changes > 0;
}

export async function syncAccountTokens(accountId: number) {
  const account = await db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).get();
  if (!account) throw new Error('Account not found');
  const site = await db.select().from(schema.sites).where(eq(schema.sites.id, account.siteId)).get();
  if (!site) throw new Error('Site not found');

  const adapter = getAdapter(site.platform);
  const existing = await db.select().from(schema.accountTokens).where(eq(schema.accountTokens.accountId, accountId)).all();
  if (!adapter.getApiTokens) {
    return syncAccountTokenSummary(existing);
  }

  const credential = await resolveDefaultAccountCredential(accountId, {
    apiToken: account.apiToken,
    accessToken: account.accessToken,
    includeAccessToken: true
  });
  const upstreamTokens = await adapter.getApiTokens({
    siteId: site.id,
    baseUrl: site.url,
    platform: site.platform as SitePlatform,
    proxyUrl: accountProxyUrl(account.extraConfig) || site.proxyUrl,
    customHeaders: parseJsonObject(site.customHeaders) as Record<string, string> | null,
    accessToken: account.accessToken,
    apiToken: credential?.token ?? null
  });

  return syncAccountTokensFromUpstream(accountId, upstreamTokens, existing);
}

async function syncAccountTokensFromUpstream(accountId: number, upstreamTokens: ApiTokenInfo[], existing: MutableAccountTokenRow[]) {
  const now = nowIso();
  let created = 0;
  let updated = 0;
  let maskedPending = 0;

  for (const [index, upstream] of upstreamTokens.entries()) {
    const tokenValue = normalizeTokenValue(upstream.key);
    if (!tokenValue) continue;

    const tokenName = normalizeTokenName(upstream.name, existing.length + index + 1);
    const tokenGroup = normalizeTokenGroup(upstream.tokenGroup);
    const enabled = upstream.enabled ?? true;

    if (isMaskedTokenValue(tokenValue)) {
      const match = findReadyTokenByMaskedValue(existing, tokenValue);
      if (match) {
        await updateTokenFacts(match, now, 'ready');
        updated += 1;
        continue;
      }

      const placeholder = findMaskedPlaceholder(existing, tokenValue, tokenName, tokenGroup);
      if (placeholder) {
        await updateTokenFacts(placeholder, now, 'masked_pending');
        updated += 1;
      } else {
        const inserted = await insertSyncedToken({
          accountId,
          name: tokenName,
          token: tokenValue,
          tokenGroup,
          valueStatus: 'masked_pending',
          enabled: false,
          now
        });
        existing.push(inserted);
        created += 1;
      }
      maskedPending += 1;
      continue;
    }

    const exact = existing.find((item) => item.token === tokenValue && item.valueStatus === 'ready');
    if (exact) {
      await updateTokenFacts(exact, now, 'ready');
      updated += 1;
      continue;
    }

    const placeholder = existing.find((item) => item.valueStatus === 'masked_pending' && matchesMaskedTokenValue(tokenValue, item.token));
    if (placeholder) {
      await db
        .update(schema.accountTokens)
        .set({
          token: tokenValue,
          valueStatus: 'ready',
          source: 'sync',
          updatedAt: now
        })
        .where(eq(schema.accountTokens.id, placeholder.id))
        .run();
      placeholder.token = tokenValue;
      placeholder.valueStatus = 'ready';
      placeholder.source = 'sync';
      placeholder.updatedAt = now;
      updated += 1;
      continue;
    }

    const inserted = await insertSyncedToken({
      accountId,
      name: tokenName,
      token: tokenValue,
      tokenGroup,
      valueStatus: 'ready',
      enabled,
      now
    });
    existing.push(inserted);
    created += 1;
  }

  return {
    created,
    updated,
    maskedPending,
    preservedLocalFields
  };
}

function syncAccountTokenSummary(existing: AccountTokenRow[]) {
  return {
    created: 0,
    updated: 0,
    maskedPending: existing.filter((item) => item.valueStatus === 'masked_pending').length,
    preservedLocalFields
  };
}

function normalizeTokenName(name: string | null | undefined, fallbackIndex: number): string {
  const trimmed = (name || '').trim();
  if (trimmed) return trimmed;
  return `key-${fallbackIndex}`;
}

function normalizeTokenValue(token: string | null | undefined): string | null {
  const trimmed = (token || '').trim();
  return trimmed ? trimmed : null;
}

async function findReadyAccountToken(accountId: number, requireDefault: boolean): Promise<AccountTokenRow | null> {
  const filters = [
    eq(schema.accountTokens.accountId, accountId),
    eq(schema.accountTokens.enabled, true),
    eq(schema.accountTokens.valueStatus, 'ready')
  ];
  if (requireDefault) filters.push(eq(schema.accountTokens.isDefault, true));
  const row = await db
    .select()
    .from(schema.accountTokens)
    .where(and(...filters))
    .orderBy(desc(schema.accountTokens.isDefault), desc(schema.accountTokens.id))
    .get();
  return row ?? null;
}

function normalizeTokenGroup(value: string | null | undefined): string | null {
  const trimmed = (value || '').trim();
  return trimmed ? trimmed : null;
}

function isMaskedTokenValue(token: string | null | undefined): boolean {
  const value = (token || '').trim();
  return !!value && (value.includes('*') || value.includes('•'));
}

function matchesMaskedTokenValue(fullToken: string | null | undefined, maskedToken: string | null | undefined): boolean {
  const full = (fullToken || '').trim();
  const masked = (maskedToken || '').trim().replace(/•/g, '*');
  if (!full || !masked) return false;
  if (!isMaskedTokenValue(masked)) return full === masked;

  const firstMaskIndex = masked.indexOf('*');
  const lastMaskIndex = masked.lastIndexOf('*');
  const prefix = masked.slice(0, firstMaskIndex);
  const suffix = masked.slice(lastMaskIndex + 1);
  if (!prefix && !suffix) return false;
  if (full.length < prefix.length + suffix.length) return false;
  if (prefix && !full.startsWith(prefix)) return false;
  if (suffix && !full.endsWith(suffix)) return false;
  return true;
}

function findReadyTokenByMaskedValue(existing: AccountTokenRow[], maskedToken: string): AccountTokenRow | null {
  const matches = existing.filter((item) => item.valueStatus === 'ready' && matchesMaskedTokenValue(item.token, maskedToken));
  return matches.length === 1 ? matches[0] ?? null : null;
}

function findMaskedPlaceholder(
  existing: AccountTokenRow[],
  tokenValue: string,
  tokenName: string,
  tokenGroup: string | null
): AccountTokenRow | null {
  return existing.find((item) => (
    item.valueStatus === 'masked_pending'
    && (item.token === tokenValue || (item.name === tokenName && item.tokenGroup === tokenGroup))
  )) ?? null;
}

async function updateTokenFacts(token: MutableAccountTokenRow, now: string, valueStatus: 'ready' | 'masked_pending') {
  await db
    .update(schema.accountTokens)
    .set({
      valueStatus,
      source: 'sync',
      updatedAt: now
    })
    .where(eq(schema.accountTokens.id, token.id))
    .run();
  token.valueStatus = valueStatus;
  token.source = 'sync';
  token.updatedAt = now;
}

async function insertSyncedToken(input: {
  accountId: number;
  name: string;
  token: string;
  tokenGroup: string | null;
  valueStatus: 'ready' | 'masked_pending';
  enabled: boolean;
  now: string;
}): Promise<AccountTokenRow> {
  return db
    .insert(schema.accountTokens)
    .values({
      accountId: input.accountId,
      name: input.name,
      token: input.token,
      tokenGroup: input.tokenGroup,
      valueStatus: input.valueStatus,
      source: 'sync',
      enabled: input.enabled,
      isDefault: false,
      createdAt: input.now,
      updatedAt: input.now
    })
    .returning()
    .get();
}

function accountProxyUrl(extraConfig: string | null): string | null {
  const parsed = parseJsonObject(extraConfig);
  const value = parsed?.proxyUrl;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
