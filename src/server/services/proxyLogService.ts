import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { stringifyJson } from '../shared/json.js';
import { nowIso } from '../shared/time.js';

export type ProxyLogInput = {
  id?: number;
  routeId?: number | null;
  channelId?: number | null;
  accountId?: number | null;
  downstreamApiKeyId?: number | null;
  modelRequested?: string | null;
  modelActual?: string | null;
  status: 'pending' | 'success' | 'failed' | 'retried';
  httpStatus?: number | null;
  isStream?: boolean;
  firstByteLatencyMs?: number | null;
  latencyMs?: number | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  billingDetails?: unknown;
  debugTraceId?: number | null;
  errorMessage?: string | null;
  retryCount?: number;
};

export type PendingProxyLogInput = Pick<
  ProxyLogInput,
  'downstreamApiKeyId' | 'modelRequested' | 'isStream' | 'debugTraceId'
>;

function parseBillingDetails(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export async function createProxyLog(input: ProxyLogInput): Promise<void> {
  await db.insert(schema.proxyLogs).values({
    routeId: input.routeId ?? null,
    channelId: input.channelId ?? null,
    accountId: input.accountId ?? null,
    downstreamApiKeyId: input.downstreamApiKeyId ?? null,
    modelRequested: input.modelRequested ?? null,
    modelActual: input.modelActual ?? null,
    status: input.status,
    httpStatus: input.httpStatus ?? null,
    isStream: input.isStream ?? false,
    firstByteLatencyMs: input.firstByteLatencyMs ?? null,
    latencyMs: input.latencyMs ?? null,
    promptTokens: input.promptTokens ?? 0,
    completionTokens: input.completionTokens ?? 0,
    totalTokens: input.totalTokens ?? 0,
    estimatedCost: input.estimatedCost ?? 0,
    billingDetails: input.billingDetails ? stringifyJson(input.billingDetails) : null,
    debugTraceId: input.debugTraceId ?? null,
    errorMessage: input.errorMessage ?? null,
    retryCount: input.retryCount ?? 0,
    createdAt: nowIso()
  }).run();
}

export async function createPendingProxyLog(input: PendingProxyLogInput): Promise<number> {
  const inserted = await db.insert(schema.proxyLogs).values({
    downstreamApiKeyId: input.downstreamApiKeyId ?? null,
    modelRequested: input.modelRequested ?? null,
    status: 'pending',
    isStream: input.isStream ?? false,
    debugTraceId: input.debugTraceId ?? null,
    createdAt: nowIso()
  }).returning({ id: schema.proxyLogs.id }).get();
  return inserted.id;
}

export async function finalizeProxyLog(input: ProxyLogInput): Promise<void> {
  if (!input.id) throw new Error('Proxy log id is required');
  await db
    .update(schema.proxyLogs)
    .set({
      routeId: input.routeId ?? null,
      channelId: input.channelId ?? null,
      accountId: input.accountId ?? null,
      downstreamApiKeyId: input.downstreamApiKeyId ?? null,
      modelRequested: input.modelRequested ?? null,
      modelActual: input.modelActual ?? null,
      status: input.status,
      httpStatus: input.httpStatus ?? null,
      isStream: input.isStream ?? false,
      firstByteLatencyMs: input.firstByteLatencyMs ?? null,
      latencyMs: input.latencyMs ?? null,
      promptTokens: input.promptTokens ?? 0,
      completionTokens: input.completionTokens ?? 0,
      totalTokens: input.totalTokens ?? 0,
      estimatedCost: input.estimatedCost ?? 0,
      billingDetails: input.billingDetails ? stringifyJson(input.billingDetails) : null,
      debugTraceId: input.debugTraceId ?? null,
      errorMessage: input.errorMessage ?? null,
      retryCount: input.retryCount ?? 0
    })
    .where(eq(schema.proxyLogs.id, input.id))
    .run();
}

export async function listProxyLogs(query: {
  page?: number;
  pageSize?: number;
  requestId?: number;
  status?: string;
  model?: string;
  siteId?: number;
  accountId?: number;
  downstreamApiKeyId?: number;
  isStream?: boolean;
  from?: string;
  to?: string;
}) {
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize || 50));
  const filters: SQL[] = [];
  if (query.requestId) filters.push(eq(schema.proxyLogs.debugTraceId, query.requestId));
  if (query.status) filters.push(eq(schema.proxyLogs.status, query.status));
  if (query.model) {
    const keyword = `%${query.model}%`;
    filters.push(sql`(${schema.proxyLogs.modelRequested} LIKE ${keyword} OR ${schema.proxyLogs.modelActual} LIKE ${keyword})`);
  }
  if (query.siteId) filters.push(eq(schema.accounts.siteId, query.siteId));
  if (query.accountId) filters.push(eq(schema.proxyLogs.accountId, query.accountId));
  if (query.downstreamApiKeyId) filters.push(eq(schema.proxyLogs.downstreamApiKeyId, query.downstreamApiKeyId));
  if (typeof query.isStream === 'boolean') filters.push(eq(schema.proxyLogs.isStream, query.isStream));
  if (query.from) filters.push(gte(schema.proxyLogs.createdAt, query.from));
  if (query.to) filters.push(lte(schema.proxyLogs.createdAt, query.to));
  const where = filters.length > 0 ? and(...filters) : undefined;
  const items = await db
    .select({
      id: schema.proxyLogs.id,
      requestId: schema.proxyLogs.debugTraceId,
      routeId: schema.proxyLogs.routeId,
      channelId: schema.proxyLogs.channelId,
      accountId: schema.proxyLogs.accountId,
      downstreamApiKeyId: schema.proxyLogs.downstreamApiKeyId,
      modelRequested: schema.proxyLogs.modelRequested,
      modelActual: schema.proxyLogs.modelActual,
      status: schema.proxyLogs.status,
      httpStatus: schema.proxyLogs.httpStatus,
      isStream: schema.proxyLogs.isStream,
      firstByteLatencyMs: schema.proxyLogs.firstByteLatencyMs,
      latencyMs: schema.proxyLogs.latencyMs,
      promptTokens: schema.proxyLogs.promptTokens,
      completionTokens: schema.proxyLogs.completionTokens,
      cacheReadTokens: schema.proxyLogs.cacheReadTokens,
      cacheWriteTokens: schema.proxyLogs.cacheWriteTokens,
      totalTokens: schema.proxyLogs.totalTokens,
      estimatedCost: schema.proxyLogs.estimatedCost,
      billingDetails: schema.proxyLogs.billingDetails,
      debugTraceId: schema.proxyLogs.debugTraceId,
      errorMessage: schema.proxyLogs.errorMessage,
      retryCount: schema.proxyLogs.retryCount,
      createdAt: schema.proxyLogs.createdAt,
      downstreamPath: schema.proxyDebugTraces.downstreamPath,
      siteId: schema.accounts.siteId,
      siteName: schema.sites.name,
      accountName: schema.accounts.username,
      downstreamKeyName: schema.downstreamApiKeys.name
    })
    .from(schema.proxyLogs)
    .leftJoin(schema.proxyDebugTraces, eq(schema.proxyDebugTraces.id, schema.proxyLogs.debugTraceId))
    .leftJoin(schema.accounts, eq(schema.accounts.id, schema.proxyLogs.accountId))
    .leftJoin(schema.sites, eq(schema.sites.id, schema.accounts.siteId))
    .leftJoin(schema.downstreamApiKeys, eq(schema.downstreamApiKeys.id, schema.proxyLogs.downstreamApiKeyId))
    .where(where)
    .orderBy(desc(schema.proxyLogs.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();
  const totalRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.proxyLogs)
    .leftJoin(schema.proxyDebugTraces, eq(schema.proxyDebugTraces.id, schema.proxyLogs.debugTraceId))
    .leftJoin(schema.accounts, eq(schema.accounts.id, schema.proxyLogs.accountId))
    .where(where)
    .get();
  return { items, total: Number(totalRow?.count || 0), page, pageSize };
}

export async function getProxyLog(id: number) {
  const row = await db
    .select({
      id: schema.proxyLogs.id,
      requestId: schema.proxyLogs.debugTraceId,
      routeId: schema.proxyLogs.routeId,
      channelId: schema.proxyLogs.channelId,
      accountId: schema.proxyLogs.accountId,
      downstreamApiKeyId: schema.proxyLogs.downstreamApiKeyId,
      modelRequested: schema.proxyLogs.modelRequested,
      modelActual: schema.proxyLogs.modelActual,
      status: schema.proxyLogs.status,
      httpStatus: schema.proxyLogs.httpStatus,
      isStream: schema.proxyLogs.isStream,
      firstByteLatencyMs: schema.proxyLogs.firstByteLatencyMs,
      latencyMs: schema.proxyLogs.latencyMs,
      promptTokens: schema.proxyLogs.promptTokens,
      completionTokens: schema.proxyLogs.completionTokens,
      cacheReadTokens: schema.proxyLogs.cacheReadTokens,
      cacheWriteTokens: schema.proxyLogs.cacheWriteTokens,
      totalTokens: schema.proxyLogs.totalTokens,
      estimatedCost: schema.proxyLogs.estimatedCost,
      billingDetails: schema.proxyLogs.billingDetails,
      debugTraceId: schema.proxyLogs.debugTraceId,
      errorMessage: schema.proxyLogs.errorMessage,
      retryCount: schema.proxyLogs.retryCount,
      createdAt: schema.proxyLogs.createdAt,
      downstreamPath: schema.proxyDebugTraces.downstreamPath,
      siteId: schema.accounts.siteId,
      siteName: schema.sites.name,
      accountName: schema.accounts.username,
      downstreamKeyName: schema.downstreamApiKeys.name
    })
    .from(schema.proxyLogs)
    .leftJoin(schema.proxyDebugTraces, eq(schema.proxyDebugTraces.id, schema.proxyLogs.debugTraceId))
    .leftJoin(schema.accounts, eq(schema.accounts.id, schema.proxyLogs.accountId))
    .leftJoin(schema.sites, eq(schema.sites.id, schema.accounts.siteId))
    .leftJoin(schema.downstreamApiKeys, eq(schema.downstreamApiKeys.id, schema.proxyLogs.downstreamApiKeyId))
    .where(eq(schema.proxyLogs.id, id))
    .get();
  return row ? { ...row, billingDetails: parseBillingDetails(row.billingDetails) } : null;
}
