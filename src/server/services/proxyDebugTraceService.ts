import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { parseJsonObject, stringifyJson } from '../shared/json.js';
import { nowIso } from '../shared/time.js';

const sensitiveHeaderNames = new Set(['authorization', 'cookie', 'x-api-key', 'x-goog-api-key']);

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
  await db
    .insert(schema.proxyDebugAttempts)
    .values({
      traceId: input.traceId,
      attemptIndex: input.attemptIndex,
      channelId: input.channelId ?? null,
      routeId: input.routeId ?? null,
      accountId: input.accountId ?? null,
      modelActual: input.modelActual ?? null,
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
      set: {
        channelId: input.channelId ?? null,
        routeId: input.routeId ?? null,
        accountId: input.accountId ?? null,
        modelActual: input.modelActual ?? null,
        endpoint: input.endpoint,
        requestPath: input.requestPath,
        targetUrl: input.targetUrl,
        responseStatus: input.responseStatus ?? null,
        responseHeadersJson: input.responseHeaders ? stringifyJson(sanitizeHeaders(input.responseHeaders)) : null,
        rawErrorText: input.rawErrorText ? input.rawErrorText.slice(0, 1000) : null
      }
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

export async function getProxyDebugTraceDetail(id: number) {
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
      requestHeaders: parseJsonObject(attempt.requestHeadersJson),
      responseHeaders: parseJsonObject(attempt.responseHeadersJson)
    }))
  };
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
