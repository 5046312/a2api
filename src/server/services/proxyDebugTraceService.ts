import { and, asc, desc, eq, gte, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { db, schema, sqlite } from '../db/index.js';
import { ensureProxyDebugAttemptCompatibility } from '../db/migrate.js';
import { parseJsonArray, parseJsonObject, stringifyJson } from '../shared/json.js';
import { nowIso } from '../shared/time.js';
import type { SelectionCandidateSnapshot } from './tokenRouter.js';

const sensitiveHeaderNames = new Set(['authorization', 'cookie', 'x-api-key', 'x-goog-api-key']);
let proxyDebugAttemptCompatibilityChecked = false;

export type CreateProxyDebugTraceInput = {
  downstreamPath: string;
  requestedModel: string;
  downstreamApiKeyId: number | null;
  requestHeaders: Record<string, string | string[] | undefined>;
};

export type RecordProxyDebugAttemptInput = {
  traceId: number;
  attemptIndex: number;
  channelId?: number | null;
  routeId?: number | null;
  accountId?: number | null;
  modelActual?: string | null;
  routingStrategy?: string | null;
  selectionRandom?: number | null;
  selectionProbability?: number | null;
  selectionCandidates?: SelectionCandidateSnapshot[] | null;
  endpoint: string;
  requestPath: string;
  targetUrl: string;
  requestHeaders: Record<string, string | string[] | undefined>;
  responseStatus?: number | null;
  responseHeaders?: Record<string, string | string[] | undefined> | null;
  rawErrorText?: string | null;
};

export type FinalizeProxyDebugTraceInput = {
  selectedChannelId?: number | null;
  selectedRouteId?: number | null;
  selectedAccountId?: number | null;
  decisionSummary?: unknown;
  finalStatus: 'success' | 'failed';
  finalHttpStatus?: number | null;
  finalUpstreamPath?: string | null;
  finalResponseHeaders?: Record<string, string | string[] | undefined> | null;
};

export type ClearProxyDebugTracesResult = {
  ok: boolean;
  from: string;
  to: string;
  deletedProxyDebugTraces: number;
  deletedProxyDebugAttempts: number;
};

export async function createProxyDebugTrace(input: CreateProxyDebugTraceInput): Promise<number> {
  const now = nowIso();
  const inserted = await db
    .insert(schema.proxyDebugTraces)
    .values({
      downstreamPath: input.downstreamPath,
      requestedModel: input.requestedModel,
      downstreamApiKeyId: input.downstreamApiKeyId,
      requestHeadersJson: stringifyJson(sanitizeHeaders(input.requestHeaders)),
      createdAt: now,
      updatedAt: now
    })
    .returning({ id: schema.proxyDebugTraces.id })
    .get();
  return inserted.id;
}

export async function recordProxyDebugAttempt(input: RecordProxyDebugAttemptInput): Promise<void> {
  ensureProxyDebugAttemptColumns();
  const updateValues: Partial<typeof schema.proxyDebugAttempts.$inferInsert> = {
    endpoint: input.endpoint,
    requestPath: input.requestPath,
    targetUrl: input.targetUrl,
    responseStatus: input.responseStatus ?? null,
    responseHeadersJson: input.responseHeaders ? stringifyJson(sanitizeHeaders(input.responseHeaders)) : null,
    rawErrorText: input.rawErrorText ? input.rawErrorText.slice(0, 1000) : null
  };
  if (input.channelId !== undefined) updateValues.channelId = input.channelId;
  if (input.routeId !== undefined) updateValues.routeId = input.routeId;
  if (input.accountId !== undefined) updateValues.accountId = input.accountId;
  if (input.modelActual !== undefined) updateValues.modelActual = input.modelActual;
  if (input.routingStrategy !== undefined) updateValues.routingStrategy = input.routingStrategy;
  if (input.selectionRandom !== undefined) updateValues.selectionRandom = input.selectionRandom;
  if (input.selectionProbability !== undefined) updateValues.selectionProbability = input.selectionProbability;
  if (input.selectionCandidates !== undefined) updateValues.selectionCandidatesJson = stringifyJson(input.selectionCandidates);

  await db
    .insert(schema.proxyDebugAttempts)
    .values({
      traceId: input.traceId,
      attemptIndex: input.attemptIndex,
      channelId: input.channelId ?? null,
      routeId: input.routeId ?? null,
      accountId: input.accountId ?? null,
      modelActual: input.modelActual ?? null,
      routingStrategy: input.routingStrategy ?? null,
      selectionRandom: input.selectionRandom ?? null,
      selectionProbability: input.selectionProbability ?? null,
      selectionCandidatesJson: input.selectionCandidates === undefined ? null : stringifyJson(input.selectionCandidates),
      endpoint: input.endpoint,
      requestPath: input.requestPath,
      targetUrl: input.targetUrl,
      runtimeExecutor: 'default',
      requestHeadersJson: stringifyJson(sanitizeHeaders(input.requestHeaders)),
      responseStatus: input.responseStatus ?? null,
      responseHeadersJson: input.responseHeaders ? stringifyJson(sanitizeHeaders(input.responseHeaders)) : null,
      rawErrorText: input.rawErrorText ? input.rawErrorText.slice(0, 1000) : null,
      createdAt: nowIso()
    })
    .onConflictDoUpdate({
      target: [schema.proxyDebugAttempts.traceId, schema.proxyDebugAttempts.attemptIndex],
      set: updateValues
    })
    .run();
}

export async function finalizeProxyDebugTrace(traceId: number, input: FinalizeProxyDebugTraceInput): Promise<void> {
  await db
    .update(schema.proxyDebugTraces)
    .set({
      selectedChannelId: input.selectedChannelId ?? null,
      selectedRouteId: input.selectedRouteId ?? null,
      selectedAccountId: input.selectedAccountId ?? null,
      decisionSummaryJson: input.decisionSummary === undefined ? null : stringifyJson(input.decisionSummary),
      finalStatus: input.finalStatus,
      finalHttpStatus: input.finalHttpStatus ?? null,
      finalUpstreamPath: input.finalUpstreamPath ?? null,
      finalResponseHeadersJson: input.finalResponseHeaders ? stringifyJson(sanitizeHeaders(input.finalResponseHeaders)) : null,
      updatedAt: nowIso()
    })
    .where(eq(schema.proxyDebugTraces.id, traceId))
    .run();
}

export async function listProxyDebugTraces(query: {
  page?: number | undefined;
  pageSize?: number | undefined;
  limit?: number | undefined;
  requestId?: number | undefined;
  requestedModel?: string | undefined;
  finalStatus?: string | undefined;
}) {
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize || query.limit || 50));
  const filters: SQL[] = [];
  if (query.requestId) filters.push(eq(schema.proxyDebugTraces.id, query.requestId));
  if (query.requestedModel) filters.push(eq(schema.proxyDebugTraces.requestedModel, query.requestedModel));
  if (query.finalStatus === 'pending') {
    filters.push(isNull(schema.proxyDebugTraces.finalStatus));
  } else if (query.finalStatus) {
    filters.push(eq(schema.proxyDebugTraces.finalStatus, query.finalStatus));
  }
  const where = filters.length > 0 ? and(...filters) : undefined;
  const items = await db
    .select({
      id: schema.proxyDebugTraces.id,
      requestId: schema.proxyDebugTraces.id,
      downstreamPath: schema.proxyDebugTraces.downstreamPath,
      requestedModel: schema.proxyDebugTraces.requestedModel,
      downstreamApiKeyId: schema.proxyDebugTraces.downstreamApiKeyId,
      selectedChannelId: schema.proxyDebugTraces.selectedChannelId,
      selectedRouteId: schema.proxyDebugTraces.selectedRouteId,
      selectedAccountId: schema.proxyDebugTraces.selectedAccountId,
      finalStatus: schema.proxyDebugTraces.finalStatus,
      finalHttpStatus: schema.proxyDebugTraces.finalHttpStatus,
      finalUpstreamPath: schema.proxyDebugTraces.finalUpstreamPath,
      createdAt: schema.proxyDebugTraces.createdAt,
      updatedAt: schema.proxyDebugTraces.updatedAt,
      attemptCount: sql<number>`count(${schema.proxyDebugAttempts.id})`
    })
    .from(schema.proxyDebugTraces)
    .leftJoin(schema.proxyDebugAttempts, eq(schema.proxyDebugAttempts.traceId, schema.proxyDebugTraces.id))
    .where(where)
    .groupBy(schema.proxyDebugTraces.id)
    .orderBy(desc(schema.proxyDebugTraces.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();
  const totalRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.proxyDebugTraces)
    .where(where)
    .get();
  return { items, total: Number(totalRow?.count || 0), page, pageSize };
}

export async function listProxyFailureLogs(query: {
  page?: number | undefined;
  pageSize?: number | undefined;
  requestId?: number | undefined;
  model?: string | undefined;
  accountId?: number | undefined;
  downstreamApiKeyId?: number | undefined;
  isStream?: boolean | undefined;
  from?: string | undefined;
  to?: string | undefined;
}) {
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize || 50));
  // 失败日志按 attempt 展示，避免漏掉请求最终成功前的通道失败。
  const filters: SQL[] = [
    or(isNotNull(schema.proxyDebugAttempts.rawErrorText), gte(schema.proxyDebugAttempts.responseStatus, 400))!
  ];
  if (query.requestId) filters.push(eq(schema.proxyDebugAttempts.traceId, query.requestId));
  if (query.model) {
    const keyword = `%${query.model}%`;
    filters.push(sql`(${schema.proxyDebugTraces.requestedModel} LIKE ${keyword} OR ${schema.proxyDebugAttempts.modelActual} LIKE ${keyword})`);
  }
  if (query.accountId) filters.push(eq(schema.proxyDebugAttempts.accountId, query.accountId));
  if (query.downstreamApiKeyId) filters.push(eq(schema.proxyDebugTraces.downstreamApiKeyId, query.downstreamApiKeyId));
  if (typeof query.isStream === 'boolean') filters.push(eq(schema.proxyLogs.isStream, query.isStream));
  if (query.from) filters.push(gte(schema.proxyDebugAttempts.createdAt, query.from));
  if (query.to) filters.push(lte(schema.proxyDebugAttempts.createdAt, query.to));
  const where = and(...filters);
  const items = await db
    .select({
      id: schema.proxyDebugAttempts.id,
      requestId: schema.proxyDebugAttempts.traceId,
      traceId: schema.proxyDebugAttempts.traceId,
      attemptIndex: schema.proxyDebugAttempts.attemptIndex,
      createdAt: schema.proxyDebugAttempts.createdAt,
      downstreamPath: schema.proxyDebugTraces.downstreamPath,
      requestedModel: schema.proxyDebugTraces.requestedModel,
      modelActual: schema.proxyDebugAttempts.modelActual,
      routeId: schema.proxyDebugAttempts.routeId,
      channelId: schema.proxyDebugAttempts.channelId,
      accountId: schema.proxyDebugAttempts.accountId,
      accountName: schema.accounts.username,
      upstreamUrl: schema.accounts.baseUrl,
      platform: schema.accounts.platform,
      downstreamApiKeyId: schema.proxyDebugTraces.downstreamApiKeyId,
      downstreamKeyName: schema.downstreamApiKeys.name,
      endpoint: schema.proxyDebugAttempts.endpoint,
      targetUrl: schema.proxyDebugAttempts.targetUrl,
      responseStatus: schema.proxyDebugAttempts.responseStatus,
      rawErrorText: schema.proxyDebugAttempts.rawErrorText,
      requestStatus: schema.proxyLogs.status,
      requestHttpStatus: schema.proxyLogs.httpStatus,
      isStream: schema.proxyLogs.isStream
    })
    .from(schema.proxyDebugAttempts)
    .innerJoin(schema.proxyDebugTraces, eq(schema.proxyDebugTraces.id, schema.proxyDebugAttempts.traceId))
    .leftJoin(schema.proxyLogs, eq(schema.proxyLogs.debugTraceId, schema.proxyDebugAttempts.traceId))
    .leftJoin(schema.accounts, eq(schema.accounts.id, schema.proxyDebugAttempts.accountId))
    .leftJoin(schema.downstreamApiKeys, eq(schema.downstreamApiKeys.id, schema.proxyDebugTraces.downstreamApiKeyId))
    .where(where)
    .orderBy(desc(schema.proxyDebugAttempts.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();
  const totalRow = await db
    .select({ count: sql<number>`count(distinct ${schema.proxyDebugAttempts.id})` })
    .from(schema.proxyDebugAttempts)
    .innerJoin(schema.proxyDebugTraces, eq(schema.proxyDebugTraces.id, schema.proxyDebugAttempts.traceId))
    .leftJoin(schema.proxyLogs, eq(schema.proxyLogs.debugTraceId, schema.proxyDebugAttempts.traceId))
    .where(where)
    .get();
  return { items, total: Number(totalRow?.count || 0), page, pageSize };
}

export async function getProxyDebugTraceDetail(id: number) {
  ensureProxyDebugAttemptColumns();
  const trace = await db.select().from(schema.proxyDebugTraces).where(eq(schema.proxyDebugTraces.id, id)).get();
  if (!trace) return null;
  const attempts = await db
    .select()
    .from(schema.proxyDebugAttempts)
    .where(eq(schema.proxyDebugAttempts.traceId, id))
    .orderBy(asc(schema.proxyDebugAttempts.attemptIndex))
    .all();
  return {
    requestId: trace.id,
    ...trace,
    requestHeaders: parseJsonObject(trace.requestHeadersJson),
    decisionSummary: parseJsonObject(trace.decisionSummaryJson),
    finalResponseHeaders: parseJsonObject(trace.finalResponseHeadersJson),
    attempts: attempts.map((attempt) => ({
      ...attempt,
      selectionCandidates: parseJsonArray<SelectionCandidateSnapshot>(attempt.selectionCandidatesJson),
      requestHeaders: parseJsonObject(attempt.requestHeadersJson),
      responseHeaders: parseJsonObject(attempt.responseHeadersJson)
    }))
  };
}

export function clearProxyDebugTracesByRange(input: { from: string; to: string }): ClearProxyDebugTracesResult {
  const deleted = sqlite.transaction(() => {
    // 先删尝试记录，再删 trace 主记录，兼容未启用外键级联的 SQLite 运行环境。
    const deletedProxyDebugAttempts = sqlite.prepare(`
DELETE FROM proxy_debug_attempts
WHERE trace_id IN (
  SELECT id FROM proxy_debug_traces WHERE created_at >= ? AND created_at <= ?
)
`).run(input.from, input.to).changes;

    const deletedProxyDebugTraces = sqlite.prepare(`
DELETE FROM proxy_debug_traces
WHERE created_at >= ? AND created_at <= ?
`).run(input.from, input.to).changes;

    return {
      deletedProxyDebugTraces,
      deletedProxyDebugAttempts
    };
  })();

  return {
    ok: true,
    from: input.from,
    to: input.to,
    ...deleted
  };
}

function ensureProxyDebugAttemptColumns(): void {
  if (proxyDebugAttemptCompatibilityChecked) return;
  ensureProxyDebugAttemptCompatibility();
  proxyDebugAttemptCompatibilityChecked = true;
}

function sanitizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (value === undefined) continue;
    output[normalizedName] = sensitiveHeaderNames.has(normalizedName)
      ? '[redacted]'
      : Array.isArray(value)
        ? value.join(', ')
        : value;
  }
  return output;
}
