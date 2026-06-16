import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { parseJsonObject, stringifyJson } from '../shared/json.js';
import { nowIso } from '../shared/time.js';

type SiteRow = typeof schema.sites.$inferSelect;

export type ProxyVideoTaskRecord = {
  publicId: string;
  upstreamVideoId: string;
  siteUrl: string;
  tokenRef: string;
  requestedModel: string | null;
  actualModel: string | null;
  channelId: number | null;
  accountId: number | null;
  statusSnapshot: unknown | null;
  upstreamResponseMeta: unknown | null;
  lastUpstreamStatus: number | null;
  lastPolledAt: string | null;
};

export type SaveProxyVideoTaskInput = {
  upstreamVideoId: string;
  siteUrl: string;
  tokenRef: string;
  requestedModel: string;
  actualModel: string;
  channelId: number | null;
  accountId: number | null;
  statusSnapshot?: unknown;
  upstreamResponseMeta?: unknown;
  lastUpstreamStatus?: number | null;
  lastPolledAt?: string | null;
};

export type ProxyVideoTaskCredential = {
  token: string;
  site: SiteRow;
  proxyUrl: string | null;
  customHeaders: Record<string, string> | null;
};

export function buildProxyVideoTaskTokenRef(input: { accountId: number; tokenId: number | null }): string {
  return input.tokenId === null ? `account:${input.accountId}` : `account_token:${input.tokenId}`;
}

export async function saveProxyVideoTask(input: SaveProxyVideoTaskInput): Promise<{ publicId: string; upstreamVideoId: string }> {
  const publicId = `vid_${randomUUID()}`;
  const now = nowIso();
  await db
    .insert(schema.proxyVideoTasks)
    .values({
      publicId,
      upstreamVideoId: input.upstreamVideoId,
      siteUrl: input.siteUrl,
      tokenRef: input.tokenRef,
      requestedModel: input.requestedModel,
      actualModel: input.actualModel,
      channelId: input.channelId,
      accountId: input.accountId,
      statusSnapshot: input.statusSnapshot === undefined ? null : stringifyJson(input.statusSnapshot),
      upstreamResponseMeta: input.upstreamResponseMeta === undefined ? null : stringifyJson(input.upstreamResponseMeta),
      lastUpstreamStatus: input.lastUpstreamStatus ?? null,
      lastPolledAt: input.lastPolledAt ?? (input.lastUpstreamStatus == null ? null : now),
      createdAt: now,
      updatedAt: now
    })
    .run();
  return { publicId, upstreamVideoId: input.upstreamVideoId };
}

export async function getProxyVideoTaskByPublicId(publicId: string): Promise<ProxyVideoTaskRecord | null> {
  const row = await db.select().from(schema.proxyVideoTasks).where(eq(schema.proxyVideoTasks.publicId, publicId)).get();
  if (!row) return null;
  return {
    publicId: row.publicId,
    upstreamVideoId: row.upstreamVideoId,
    siteUrl: row.siteUrl,
    tokenRef: row.tokenRef,
    requestedModel: row.requestedModel,
    actualModel: row.actualModel,
    channelId: row.channelId,
    accountId: row.accountId,
    statusSnapshot: parseJsonColumn(row.statusSnapshot),
    upstreamResponseMeta: parseJsonColumn(row.upstreamResponseMeta),
    lastUpstreamStatus: row.lastUpstreamStatus,
    lastPolledAt: row.lastPolledAt
  };
}

export async function deleteProxyVideoTaskByPublicId(publicId: string): Promise<void> {
  await db.delete(schema.proxyVideoTasks).where(eq(schema.proxyVideoTasks.publicId, publicId)).run();
}

export async function refreshProxyVideoTaskSnapshot(
  publicId: string,
  input: {
    statusSnapshot?: unknown;
    upstreamResponseMeta?: unknown;
    lastUpstreamStatus?: number | null;
    lastPolledAt?: string | null;
  }
): Promise<void> {
  const now = nowIso();
  await db
    .update(schema.proxyVideoTasks)
    .set({
      statusSnapshot: input.statusSnapshot === undefined ? null : stringifyJson(input.statusSnapshot),
      upstreamResponseMeta: input.upstreamResponseMeta === undefined ? null : stringifyJson(input.upstreamResponseMeta),
      lastUpstreamStatus: input.lastUpstreamStatus ?? null,
      lastPolledAt: input.lastPolledAt ?? now,
      updatedAt: now
    })
    .where(eq(schema.proxyVideoTasks.publicId, publicId))
    .run();
}

export async function resolveProxyVideoTaskCredential(record: ProxyVideoTaskRecord): Promise<ProxyVideoTaskCredential | null> {
  const tokenRef = parseTokenRef(record.tokenRef);
  if (!tokenRef) return null;
  if (tokenRef.kind === 'account_token') return resolveAccountTokenCredential(tokenRef.id);
  return resolveAccountCredential(tokenRef.id);
}

async function resolveAccountTokenCredential(tokenId: number): Promise<ProxyVideoTaskCredential | null> {
  const row = await db
    .select({
      token: schema.accountTokens.token,
      tokenEnabled: schema.accountTokens.enabled,
      tokenStatus: schema.accountTokens.valueStatus,
      accountExtraConfig: schema.accounts.extraConfig,
      accountStatus: schema.accounts.status,
      site: schema.sites
    })
    .from(schema.accountTokens)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.accountTokens.accountId))
    .innerJoin(schema.sites, eq(schema.sites.id, schema.accounts.siteId))
    .where(eq(schema.accountTokens.id, tokenId))
    .get();
  if (!row || !row.tokenEnabled || row.tokenStatus !== 'ready' || row.accountStatus !== 'active' || row.site.status !== 'active') {
    return null;
  }
  return {
    token: row.token,
    site: row.site,
    proxyUrl: accountProxyUrl(row.accountExtraConfig) || row.site.proxyUrl,
    customHeaders: parseJsonObject(row.site.customHeaders) as Record<string, string> | null
  };
}

async function resolveAccountCredential(accountId: number): Promise<ProxyVideoTaskCredential | null> {
  const row = await db
    .select({
      accountApiToken: schema.accounts.apiToken,
      accountAccessToken: schema.accounts.accessToken,
      accountExtraConfig: schema.accounts.extraConfig,
      accountStatus: schema.accounts.status,
      site: schema.sites
    })
    .from(schema.accounts)
    .innerJoin(schema.sites, eq(schema.sites.id, schema.accounts.siteId))
    .where(eq(schema.accounts.id, accountId))
    .get();
  const token = row?.accountApiToken || row?.accountAccessToken || '';
  if (!row || !token || row.accountStatus !== 'active' || row.site.status !== 'active') return null;
  return {
    token,
    site: row.site,
    proxyUrl: accountProxyUrl(row.accountExtraConfig) || row.site.proxyUrl,
    customHeaders: parseJsonObject(row.site.customHeaders) as Record<string, string> | null
  };
}

function parseTokenRef(value: string): { kind: 'account' | 'account_token'; id: number } | null {
  const [kind, rawId] = value.split(':', 2);
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (kind === 'account') return { kind, id };
  if (kind === 'account_token') return { kind, id };
  return null;
}

function parseJsonColumn(value: unknown): unknown | null {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function accountProxyUrl(extraConfig: string | null): string | null {
  const parsed = parseJsonObject(extraConfig);
  const value = parsed?.proxyUrl;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
