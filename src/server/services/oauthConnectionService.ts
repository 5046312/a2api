import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { parseJsonObject } from '../shared/json.js';
import { nowIso } from '../shared/time.js';

export type OAuthConnectionInfo = {
  accountId: number;
  provider: string;
  username: string | null;
  email: string | null;
  accountKey: string | null;
  projectId: string | null;
  modelCount: number;
  modelsPreview: string[];
  accountStatus: string;
  enabled: boolean;
  status: 'healthy' | 'abnormal';
  routeChannelCount: number;
  lastModelSyncAt: string | null;
  proxyUrl: string | null;
  upstreamUrl: string;
  platform: string;
};

export type OAuthConnectionsResponse = {
  items: OAuthConnectionInfo[];
  total: number;
  limit: number;
  offset: number;
};

type OAuthAccountRow = {
  id: number;
  username: string | null;
  credentialMode: string;
  accessToken: string | null;
  status: string;
  baseUrl: string;
  platform: string;
  proxyUrl: string | null;
  oauthProvider: string | null;
  oauthAccountKey: string | null;
  oauthProjectId: string | null;
  extraConfig: string | null;
};

export async function listOAuthConnections(input: { limit?: number; offset?: number } = {}): Promise<OAuthConnectionsResponse> {
  const limit = Math.min(200, Math.max(1, Math.trunc(input.limit || 50)));
  const offset = Math.max(0, Math.trunc(input.offset || 0));
  const where = oauthAccountWhere();

  const rows = await db
    .select({
      id: schema.accounts.id,
      username: schema.accounts.username,
      credentialMode: schema.accounts.credentialMode,
      accessToken: schema.accounts.accessToken,
      status: schema.accounts.status,
      baseUrl: schema.accounts.baseUrl,
      platform: schema.accounts.platform,
      proxyUrl: schema.accounts.proxyUrl,
      oauthProvider: schema.accounts.oauthProvider,
      oauthAccountKey: schema.accounts.oauthAccountKey,
      oauthProjectId: schema.accounts.oauthProjectId,
      extraConfig: schema.accounts.extraConfig
    })
    .from(schema.accounts)
    .where(where)
    .orderBy(desc(schema.accounts.id))
    .limit(limit)
    .offset(offset)
    .all();
  const totalRow = await db.select({ count: sql<number>`count(*)` }).from(schema.accounts).where(where).get();
  const accountIds = rows.map((row) => row.id);
  const modelSnapshotMap = accountIds.length > 0 ? await loadModelSnapshotMap(accountIds) : new Map<number, { models: string[]; lastCheckedAt: string | null }>();
  const routeChannelCountMap = accountIds.length > 0 ? await loadRouteChannelCountMap(accountIds) : new Map<number, number>();

  return {
    items: rows.map((row) => toOAuthConnection(row, modelSnapshotMap, routeChannelCountMap)),
    total: Number(totalRow?.count || 0),
    limit,
    offset
  };
}

export async function setOAuthConnectionEnabled(accountId: number, enabled: boolean): Promise<OAuthConnectionInfo | null> {
  const current = await findOAuthAccount(accountId);
  if (!current) return null;
  await db
    .update(schema.accounts)
    .set({ status: enabled ? 'active' : 'disabled', updatedAt: nowIso() })
    .where(eq(schema.accounts.id, accountId))
    .run();
  return getOAuthConnection(accountId);
}

export async function deleteOAuthConnection(accountId: number): Promise<boolean> {
  const current = await findOAuthAccount(accountId);
  if (!current) return false;
  const result = await db.delete(schema.accounts).where(eq(schema.accounts.id, accountId)).run();
  return result.changes > 0;
}

function oauthAccountWhere() {
  return or(eq(schema.accounts.credentialMode, 'oauth'), sql`${schema.accounts.oauthProvider} IS NOT NULL`);
}

async function findOAuthAccount(accountId: number) {
  return db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, accountId), oauthAccountWhere()))
    .get();
}

async function getOAuthConnection(accountId: number): Promise<OAuthConnectionInfo | null> {
  const row = await db
    .select({
      id: schema.accounts.id,
      username: schema.accounts.username,
      credentialMode: schema.accounts.credentialMode,
      accessToken: schema.accounts.accessToken,
      status: schema.accounts.status,
      baseUrl: schema.accounts.baseUrl,
      platform: schema.accounts.platform,
      proxyUrl: schema.accounts.proxyUrl,
      oauthProvider: schema.accounts.oauthProvider,
      oauthAccountKey: schema.accounts.oauthAccountKey,
      oauthProjectId: schema.accounts.oauthProjectId,
      extraConfig: schema.accounts.extraConfig
    })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, accountId), oauthAccountWhere()))
    .get();
  if (!row) return null;
  const modelSnapshotMap = await loadModelSnapshotMap([accountId]);
  const routeChannelCountMap = await loadRouteChannelCountMap([accountId]);
  return toOAuthConnection(row, modelSnapshotMap, routeChannelCountMap);
}

async function loadModelSnapshotMap(accountIds: number[]): Promise<Map<number, { models: string[]; lastCheckedAt: string | null }>> {
  const rows = await db
    .select({
      accountId: schema.modelAvailability.accountId,
      modelName: schema.modelAvailability.modelName,
      checkedAt: schema.modelAvailability.checkedAt
    })
    .from(schema.modelAvailability)
    .where(and(inArray(schema.modelAvailability.accountId, accountIds), eq(schema.modelAvailability.available, true)))
    .all();
  const modelMap = new Map<number, { models: string[]; lastCheckedAt: string | null }>();
  for (const row of rows) {
    const current = modelMap.get(row.accountId) || { models: [], lastCheckedAt: null };
    current.models.push(row.modelName);
    if (!current.lastCheckedAt || row.checkedAt > current.lastCheckedAt) current.lastCheckedAt = row.checkedAt;
    modelMap.set(row.accountId, current);
  }
  return modelMap;
}

async function loadRouteChannelCountMap(accountIds: number[]): Promise<Map<number, number>> {
  const rows = await db
    .select({
      accountId: schema.routeChannels.accountId,
      count: sql<number>`count(*)`
    })
    .from(schema.routeChannels)
    .where(inArray(schema.routeChannels.accountId, accountIds))
    .groupBy(schema.routeChannels.accountId)
    .all();
  return new Map(rows.map((row) => [row.accountId, Number(row.count || 0)]));
}

function toOAuthConnection(
  row: OAuthAccountRow,
  modelSnapshotMap: Map<number, { models: string[]; lastCheckedAt: string | null }>,
  routeChannelCountMap: Map<number, number>
): OAuthConnectionInfo {
  const extraConfig = parseJsonObject(row.extraConfig);
  const modelSnapshot = modelSnapshotMap.get(row.id) || { models: [], lastCheckedAt: null };
  const models = modelSnapshot.models;
  const provider = row.oauthProvider || inferProviderFromPlatform(row.platform) || 'oauth';
  const status = row.status === 'active' && row.accessToken ? 'healthy' : 'abnormal';
  return {
    accountId: row.id,
    provider,
    username: row.username,
    email: readString(extraConfig?.email) || row.username,
    accountKey: row.oauthAccountKey,
    projectId: row.oauthProjectId,
    modelCount: models.length,
    modelsPreview: models.slice(0, 5),
    accountStatus: row.status,
    enabled: row.status === 'active',
    status,
    routeChannelCount: routeChannelCountMap.get(row.id) || 0,
    lastModelSyncAt: modelSnapshot.lastCheckedAt,
    proxyUrl: row.proxyUrl || readString(extraConfig?.proxyUrl),
    upstreamUrl: row.baseUrl,
    platform: row.platform
  };
}

function inferProviderFromPlatform(platform: string | null): string | null {
  if (platform === 'codex' || platform === 'claude' || platform === 'gemini-cli' || platform === 'antigravity') return platform;
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
