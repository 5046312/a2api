import { and, eq, gte, lt, ne, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export type StatsOverview = {
  todayRequests: number;
  todaySuccessRate: number;
  todayTokens: number;
  todayCost: number;
  activeAccountCount: number;
  abnormalAccountCount: number;
};

export type StatsRange = '24h' | '7d' | '30d';
export type StatsBucket = 'hour' | 'day';

export type UpstreamUsageItem = {
  bucket: string;
  accountId: number | null;
  accountName: string | null;
  upstreamUrl: string | null;
  requests: number;
  successRequests: number;
  successRate: number;
  totalTokens: number;
  estimatedCost: number;
  averageLatencyMs: number;
};

export type ModelUsageItem = {
  model: string;
  requests: number;
  successRequests: number;
  successRate: number;
  totalTokens: number;
  estimatedCost: number;
  averageLatencyMs: number;
};

export type StatsMarketplaceItem = {
  model: string;
  accountCount: number;
  minCost: number;
  avgCost: number;
  avgLatencyMs: number;
  successRate: number;
};

type MarketplaceAggregate = {
  accountIds: Set<number>;
  costs: number[];
  latencies: number[];
  logSuccess: number;
  logTotal: number;
  logLatencyTotal: number;
  logLatencyCount: number;
};

function localTodayRangeIso(now = new Date()): { startIso: string; endIso: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function rangeStartIso(range: StatsRange, now = new Date()): string {
  const start = new Date(now);
  if (range === '24h') start.setHours(start.getHours() - 24);
  if (range === '7d') start.setDate(start.getDate() - 7);
  if (range === '30d') start.setDate(start.getDate() - 30);
  return start.toISOString();
}

function bucketSql(bucket: StatsBucket): SQL<string> {
  return bucket === 'hour'
    ? sql<string>`substr(${schema.proxyLogs.createdAt}, 1, 13)`
    : sql<string>`substr(${schema.proxyLogs.createdAt}, 1, 10)`;
}

function successRate(success: number, total: number): number {
  return total > 0 ? success / total : 0;
}

export async function getStatsOverview(): Promise<StatsOverview> {
  const { startIso, endIso } = localTodayRangeIso();
  const [todayRow, activeAccountRow, abnormalAccountRow] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`,
        success: sql<number>`coalesce(sum(case when ${schema.proxyLogs.status} = 'success' then 1 else 0 end), 0)`,
        tokens: sql<number>`coalesce(sum(coalesce(${schema.proxyLogs.totalTokens}, 0)), 0)`,
        cost: sql<number>`coalesce(sum(coalesce(${schema.proxyLogs.estimatedCost}, 0)), 0)`
      })
      .from(schema.proxyLogs)
      .where(and(gte(schema.proxyLogs.createdAt, startIso), lt(schema.proxyLogs.createdAt, endIso)))
      .get(),
    db.select({ count: sql<number>`count(*)` }).from(schema.accounts).where(eq(schema.accounts.status, 'active')).get(),
    db.select({ count: sql<number>`count(*)` }).from(schema.accounts).where(ne(schema.accounts.status, 'active')).get()
  ]);

  const todayRequests = Number(todayRow?.total || 0);
  const todaySuccess = Number(todayRow?.success || 0);

  return {
    todayRequests,
    todaySuccessRate: todayRequests > 0 ? todaySuccess / todayRequests : 0,
    todayTokens: Number(todayRow?.tokens || 0),
    todayCost: Number(todayRow?.cost || 0),
    activeAccountCount: Number(activeAccountRow?.count || 0),
    abnormalAccountCount: Number(abnormalAccountRow?.count || 0)
  };
}

export async function getUpstreamUsageStats(query: { range: StatsRange; bucket: StatsBucket; accountId?: number | undefined }): Promise<UpstreamUsageItem[]> {
  const bucket = bucketSql(query.bucket);
  const filters: SQL[] = [gte(schema.proxyLogs.createdAt, rangeStartIso(query.range))];
  if (query.accountId) filters.push(eq(schema.accounts.id, query.accountId));

  const rows = await db
    .select({
      bucket,
      accountId: schema.accounts.id,
      accountName: schema.accounts.username,
      upstreamUrl: schema.accounts.baseUrl,
      requests: sql<number>`count(*)`,
      successRequests: sql<number>`coalesce(sum(case when ${schema.proxyLogs.status} = 'success' then 1 else 0 end), 0)`,
      totalTokens: sql<number>`coalesce(sum(coalesce(${schema.proxyLogs.totalTokens}, 0)), 0)`,
      estimatedCost: sql<number>`coalesce(sum(coalesce(${schema.proxyLogs.estimatedCost}, 0)), 0)`,
      averageLatencyMs: sql<number>`coalesce(avg(${schema.proxyLogs.latencyMs}), 0)`
    })
    .from(schema.proxyLogs)
    .leftJoin(schema.accounts, eq(schema.accounts.id, schema.proxyLogs.accountId))
    .where(and(...filters))
    .groupBy(bucket, schema.accounts.id, schema.accounts.username, schema.accounts.baseUrl)
    .orderBy(bucket, schema.accounts.id)
    .all();

  return rows.map((row) => {
    const requests = Number(row.requests || 0);
    const successRequests = Number(row.successRequests || 0);
    return {
      bucket: row.bucket,
      accountId: row.accountId,
      accountName: row.accountName,
      upstreamUrl: row.upstreamUrl,
      requests,
      successRequests,
      successRate: successRate(successRequests, requests),
      totalTokens: Number(row.totalTokens || 0),
      estimatedCost: Number(row.estimatedCost || 0),
      averageLatencyMs: Number(row.averageLatencyMs || 0)
    };
  });
}

export async function getModelUsageStats(query: { range: StatsRange; model?: string | undefined; accountId?: number | undefined }): Promise<ModelUsageItem[]> {
  const modelName = sql<string>`coalesce(${schema.proxyLogs.modelActual}, ${schema.proxyLogs.modelRequested}, 'unknown')`;
  const filters: SQL[] = [gte(schema.proxyLogs.createdAt, rangeStartIso(query.range))];
  if (query.model) filters.push(sql`${modelName} = ${query.model}`);
  if (query.accountId) filters.push(eq(schema.accounts.id, query.accountId));

  const rows = await db
    .select({
      model: modelName,
      requests: sql<number>`count(*)`,
      successRequests: sql<number>`coalesce(sum(case when ${schema.proxyLogs.status} = 'success' then 1 else 0 end), 0)`,
      totalTokens: sql<number>`coalesce(sum(coalesce(${schema.proxyLogs.totalTokens}, 0)), 0)`,
      estimatedCost: sql<number>`coalesce(sum(coalesce(${schema.proxyLogs.estimatedCost}, 0)), 0)`,
      averageLatencyMs: sql<number>`coalesce(avg(${schema.proxyLogs.latencyMs}), 0)`
    })
    .from(schema.proxyLogs)
    .leftJoin(schema.accounts, eq(schema.accounts.id, schema.proxyLogs.accountId))
    .where(and(...filters))
    .groupBy(modelName)
    .orderBy(modelName)
    .all();

  return rows.map((row) => {
    const requests = Number(row.requests || 0);
    const successRequests = Number(row.successRequests || 0);
    return {
      model: row.model,
      requests,
      successRequests,
      successRate: successRate(successRequests, requests),
      totalTokens: Number(row.totalTokens || 0),
      estimatedCost: Number(row.estimatedCost || 0),
      averageLatencyMs: Number(row.averageLatencyMs || 0)
    };
  });
}

export async function getStatsMarketplace(): Promise<StatsMarketplaceItem[]> {
  const aggregates = new Map<string, MarketplaceAggregate>();

  const accountRows = await db
    .select({
      model: schema.modelAvailability.modelName,
      accountId: schema.accounts.id,
      modelCost: schema.modelAvailability.modelCost,
      unitCost: schema.accounts.unitCost,
      latencyMs: schema.modelAvailability.latencyMs
    })
    .from(schema.modelAvailability)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.modelAvailability.accountId))
    .where(and(eq(schema.modelAvailability.available, true), eq(schema.accounts.status, 'active')))
    .all();

  for (const row of accountRows) {
    const aggregate = ensureMarketplaceAggregate(aggregates, row.model);
    aggregate.accountIds.add(row.accountId);
    pushNumber(aggregate.costs, row.modelCost ?? row.unitCost);
    pushNumber(aggregate.latencies, row.latencyMs);
  }

  const modelName = sql<string>`coalesce(${schema.proxyLogs.modelActual}, ${schema.proxyLogs.modelRequested}, 'unknown')`;
  const logRows = await db
    .select({
      model: modelName,
      total: sql<number>`count(*)`,
      success: sql<number>`coalesce(sum(case when ${schema.proxyLogs.status} = 'success' then 1 else 0 end), 0)`,
      latencyTotal: sql<number>`coalesce(sum(coalesce(${schema.proxyLogs.latencyMs}, 0)), 0)`,
      latencyCount: sql<number>`coalesce(sum(case when ${schema.proxyLogs.latencyMs} is null then 0 else 1 end), 0)`
    })
    .from(schema.proxyLogs)
    .where(gte(schema.proxyLogs.createdAt, rangeStartIso('7d')))
    .groupBy(modelName)
    .all();

  for (const row of logRows) {
    const aggregate = ensureMarketplaceAggregate(aggregates, row.model);
    aggregate.logTotal = Number(row.total || 0);
    aggregate.logSuccess = Number(row.success || 0);
    aggregate.logLatencyTotal = Number(row.latencyTotal || 0);
    aggregate.logLatencyCount = Number(row.latencyCount || 0);
  }

  return Array.from(aggregates.entries())
    .map(([model, aggregate]) => {
      const latencyAverage = average(aggregate.latencies);
      const logLatencyAverage = aggregate.logLatencyCount > 0 ? aggregate.logLatencyTotal / aggregate.logLatencyCount : 0;
      return {
        model,
        accountCount: aggregate.accountIds.size,
        minCost: aggregate.costs.length > 0 ? Math.min(...aggregate.costs) : 0,
        avgCost: aggregate.costs.length > 0 ? average(aggregate.costs) : 0,
        avgLatencyMs: Math.round(latencyAverage || logLatencyAverage || 0),
        successRate: successRate(aggregate.logSuccess, aggregate.logTotal)
      };
    })
    .sort((left, right) => right.accountCount - left.accountCount || left.model.localeCompare(right.model));
}

function ensureMarketplaceAggregate(aggregates: Map<string, MarketplaceAggregate>, model: string): MarketplaceAggregate {
  const key = model || 'unknown';
  const current = aggregates.get(key);
  if (current) return current;
  const next: MarketplaceAggregate = {
    accountIds: new Set(),
    costs: [],
    latencies: [],
    logSuccess: 0,
    logTotal: 0,
    logLatencyTotal: 0,
    logLatencyCount: 0
  };
  aggregates.set(key, next);
  return next;
}

function pushNumber(target: number[], value: number | null): void {
  if (typeof value === 'number' && Number.isFinite(value)) target.push(value);
}

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
