import { and, desc, eq, gte, like, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { getAdapter, type UpstreamPlatform } from '../adapters/index.js';
import { db, schema } from '../db/index.js';
import { parseJsonObject, stringifyJson } from '../shared/json.js';
import { nowIso } from '../shared/time.js';
import { resolveDefaultAccountCredential } from './accountTokenService.js';
import { sendNotification } from './notificationService.js';

export const monitorStatusSchema = z.enum(['up', 'down', 'pending', 'maintenance']);
export type MonitorStatus = z.infer<typeof monitorStatusSchema>;

export const monitorSettingsPayloadSchema = z.object({
  enabled: z.boolean().optional(),
  intervalSec: z.number().int().min(30).max(86400).optional(),
  timeoutSec: z.number().int().min(1).max(120).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  concurrency: z.number().int().min(1).max(20).optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
  notifyOnDown: z.boolean().optional(),
  notifyOnRecovery: z.boolean().optional()
});

export const monitorAccountPatchSchema = z.object({
  enabled: z.boolean().optional(),
  intervalSec: z.number().int().min(30).max(86400).nullable().optional()
});

export type MonitorSettings = {
  enabled: boolean;
  intervalSec: number;
  timeoutSec: number;
  maxRetries: number;
  concurrency: number;
  retentionDays: number;
  notifyOnDown: boolean;
  notifyOnRecovery: boolean;
};

type AccountMonitorRow = typeof schema.accountMonitors.$inferSelect;

type MonitorAccountRow = AccountMonitorRow & {
  accountId: number;
  username: string | null;
  credentialMode: string;
  accessToken: string | null;
  apiToken: string | null;
  accountStatus: string;
  baseUrl: string;
  platform: string;
  proxyUrl: string | null;
  customHeaders: string | null;
};

type ProbeResult = {
  status: MonitorStatus;
  latencyMs: number | null;
  message: string;
  errorType: string | null;
  modelCount: number | null;
};

const MONITOR_SETTINGS_KEY = 'monitorSettings';
const DEFAULT_SETTINGS: MonitorSettings = {
  enabled: true,
  intervalSec: 300,
  timeoutSec: 20,
  maxRetries: 1,
  concurrency: 3,
  retentionDays: 30,
  notifyOnDown: true,
  notifyOnRecovery: true
};

export function getMonitorSettings(): MonitorSettings {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, MONITOR_SETTINGS_KEY)).get();
  const parsed = parseJsonObject(row?.value ?? null);
  const merged = { ...DEFAULT_SETTINGS, ...(parsed ?? {}) };
  const result = monitorSettingsPayloadSchema.required().safeParse(merged);
  return result.success ? result.data : { ...DEFAULT_SETTINGS };
}

export function updateMonitorSettings(payload: Partial<MonitorSettings>): MonitorSettings {
  const current = getMonitorSettings();
  const next = monitorSettingsPayloadSchema.required().parse({ ...current, ...payload });
  db.insert(schema.settings)
    .values({ key: MONITOR_SETTINGS_KEY, value: stringifyJson(next) })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: stringifyJson(next) }
    })
    .run();
  return next;
}

export async function syncAccountMonitors(): Promise<{ created: number; total: number }> {
  const rows = await db.select({ id: schema.accounts.id }).from(schema.accounts).all();
  const now = nowIso();
  let created = 0;
  for (const row of rows) {
    const existing = await db.select({ id: schema.accountMonitors.id }).from(schema.accountMonitors).where(eq(schema.accountMonitors.accountId, row.id)).get();
    if (existing) continue;
    await db.insert(schema.accountMonitors).values({
      accountId: row.id,
      enabled: true,
      status: 'pending',
      nextCheckAt: now,
      createdAt: now,
      updatedAt: now
    }).run();
    created += 1;
  }
  return { created, total: rows.length };
}

export async function getMonitorOverview() {
  await syncAccountMonitors();
  const settings = getMonitorSettings();
  const monitors = await getMonitorRows();
  const enabledRows = monitors.filter((row) => row.enabled && row.accountStatus === 'active');
  const disabled = monitors.length - enabledRows.length;
  const statusCount = {
    up: enabledRows.filter((row) => row.status === 'up').length,
    down: enabledRows.filter((row) => row.status === 'down').length,
    pending: enabledRows.filter((row) => row.status === 'pending').length,
    maintenance: enabledRows.filter((row) => row.status === 'maintenance').length
  };
  const latencyRows = enabledRows.filter((row) => row.status === 'up' && typeof row.latencyMs === 'number');
  const lastIncident = await db
    .select()
    .from(schema.monitorHeartbeats)
    .where(and(eq(schema.monitorHeartbeats.important, true), eq(schema.monitorHeartbeats.status, 'down')))
    .orderBy(desc(schema.monitorHeartbeats.checkedAt), desc(schema.monitorHeartbeats.id))
    .limit(1)
    .get();

  return {
    settings,
    totalAccounts: monitors.length,
    enabledAccounts: enabledRows.length,
    disabledAccounts: disabled,
    statusCount,
    averageLatencyMs: average(latencyRows.map((row) => row.latencyMs ?? 0)),
    uptime24h: await calculateUptimeRatio(hoursAgo(24)),
    uptime7d: await calculateUptimeRatio(hoursAgo(24 * 7)),
    lastIncident: lastIncident ? heartbeatView(lastIncident) : null
  };
}

export async function listMonitorAccounts(query: {
  status?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) {
  await syncAccountMonitors();
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize || 50));
  const filters = monitorListFilters(query);
  const where = filters.length > 0 ? and(...filters) : undefined;
  const rows = await getMonitorRows(where, pageSize, (page - 1) * pageSize);
  const totalRow = await db.select({ count: sql<number>`count(*)` })
    .from(schema.accountMonitors)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.accountMonitors.accountId))
    .where(where)
    .get();
  const items = [];
  for (const row of rows) {
    items.push({
      ...monitorAccountView(row),
      uptime24h: await calculateAccountUptimeRatio(row.accountId, hoursAgo(24)),
      uptime7d: await calculateAccountUptimeRatio(row.accountId, hoursAgo(24 * 7)),
      heartbeats: await listHeartbeatBars(row.id, 48)
    });
  }
  return { items, total: Number(totalRow?.count || 0), page, pageSize };
}

export async function getMonitorAccount(accountId: number) {
  await syncAccountMonitors();
  const row = await getMonitorRowByAccountId(accountId);
  if (!row) return null;
  const heartbeats = await db
    .select()
    .from(schema.monitorHeartbeats)
    .where(eq(schema.monitorHeartbeats.accountId, accountId))
    .orderBy(desc(schema.monitorHeartbeats.checkedAt), desc(schema.monitorHeartbeats.id))
    .limit(120)
    .all();
  const events = heartbeats.filter((heartbeat) => heartbeat.important).slice(0, 20);
  return {
    ...monitorAccountView(row),
    uptime24h: await calculateAccountUptimeRatio(accountId, hoursAgo(24)),
    uptime7d: await calculateAccountUptimeRatio(accountId, hoursAgo(24 * 7)),
    heartbeats: heartbeats.map(heartbeatView).reverse(),
    events: events.map(heartbeatView)
  };
}

export async function updateMonitorAccount(accountId: number, payload: z.infer<typeof monitorAccountPatchSchema>) {
  await syncAccountMonitors();
  const row = await getMonitorRowByAccountId(accountId);
  if (!row) return null;
  const values: Partial<typeof schema.accountMonitors.$inferInsert> = { updatedAt: nowIso() };
  if (payload.enabled !== undefined) values.enabled = payload.enabled;
  if (payload.intervalSec !== undefined) values.intervalSec = payload.intervalSec;
  await db.update(schema.accountMonitors).set(values).where(eq(schema.accountMonitors.accountId, accountId)).run();
  return getMonitorAccount(accountId);
}

export async function checkMonitorAccount(accountId: number) {
  await syncAccountMonitors();
  const row = await getMonitorRowByAccountId(accountId);
  if (!row) throw new Error('Account not found');
  return runAccountProbe(row);
}

export async function checkAllMonitorAccounts(): Promise<{ total: number; succeeded: number; failed: number; skipped: number; items: unknown[] }> {
  await syncAccountMonitors();
  const settings = getMonitorSettings();
  const rows = await getDueMonitorRows(settings, true);
  const items: unknown[] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  await runWithConcurrency(rows, settings.concurrency, async (row) => {
    if (!isMonitorActive(row)) {
      skipped += 1;
      return;
    }
    try {
      const result = await runAccountProbe(row);
      items.push(result);
      if (result.status === 'up') succeeded += 1;
      if (result.status === 'down') failed += 1;
    } catch (error) {
      failed += 1;
      items.push({ accountId: row.accountId, status: 'down', message: error instanceof Error ? error.message : 'Monitor check failed' });
    }
  });

  return { total: rows.length, succeeded, failed, skipped, items };
}

export async function runDueMonitorChecks(): Promise<void> {
  const settings = getMonitorSettings();
  if (!settings.enabled) return;
  await syncAccountMonitors();
  const rows = await getDueMonitorRows(settings, false);
  await runWithConcurrency(rows, settings.concurrency, async (row) => {
    if (!isMonitorActive(row)) {
      await markMonitorMaintenance(row);
      return;
    }
    try {
      await runAccountProbe(row);
    } catch (error) {
      console.warn('[accountMonitor] check failed', error);
    }
  });
  await cleanupMonitorHeartbeats(settings.retentionDays);
}

export async function cleanupMonitorHeartbeats(retentionDays = getMonitorSettings().retentionDays): Promise<{ deleted: number }> {
  const where = retentionDays <= 0
    ? undefined
    : lt(schema.monitorHeartbeats.checkedAt, new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString());
  const result = await db.delete(schema.monitorHeartbeats).where(where).run();
  return { deleted: result.changes };
}

async function runAccountProbe(row: MonitorAccountRow) {
  const settings = getMonitorSettings();
  if (!isMonitorActive(row)) {
    return markMonitorMaintenance(row);
  }

  let result: ProbeResult = {
    status: 'down',
    latencyMs: null,
    message: '账号探测失败',
    errorType: 'probe_failed',
    modelCount: null
  };
  for (let attempt = 0; attempt <= settings.maxRetries; attempt += 1) {
    result = await probeAccount(row, settings.timeoutSec);
    if (result.status === 'up') break;
  }
  return saveProbeResult(row, result, settings.maxRetries);
}

async function probeAccount(row: MonitorAccountRow, timeoutSec: number): Promise<ProbeResult> {
  const token = await resolveProbeToken(row);
  if (!token) {
    return {
      status: 'down',
      latencyMs: null,
      message: '账号没有可用 token',
      errorType: 'missing_token',
      modelCount: null
    };
  }

  const adapter = getAdapter(row.platform);
  const startedAt = Date.now();
  try {
    const models = await withTimeout(adapter.getModels({
      accountId: row.accountId,
      baseUrl: row.baseUrl,
      platform: row.platform as UpstreamPlatform,
      proxyUrl: row.proxyUrl,
      customHeaders: parseJsonObject(row.customHeaders) as Record<string, string> | null,
      token,
      credentialMode: row.credentialMode === 'oauth' ? 'oauth' : 'apikey'
    }), timeoutSec);
    const latencyMs = Date.now() - startedAt;
    return {
      status: models.length > 0 ? 'up' : 'down',
      latencyMs,
      message: models.length > 0 ? `模型接口正常，发现 ${models.length} 个模型` : '模型接口无可用模型',
      errorType: models.length > 0 ? null : 'empty_models',
      modelCount: models.length
    };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : '账号探测失败',
      errorType: error instanceof Error && error.message === 'monitor_probe_timeout' ? 'timeout' : 'probe_error',
      modelCount: null
    };
  }
}

async function saveProbeResult(row: MonitorAccountRow, result: ProbeResult, retries: number) {
  const checkedAt = nowIso();
  const previousStatus = row.status as MonitorStatus;
  const important = previousStatus !== result.status && previousStatus !== 'pending';
  const nextCheckAt = nextCheckIso(row);
  const values = {
    status: result.status,
    lastCheckAt: checkedAt,
    lastUpAt: result.status === 'up' ? checkedAt : row.lastUpAt,
    lastDownAt: result.status === 'down' ? checkedAt : row.lastDownAt,
    nextCheckAt,
    consecutiveFailCount: result.status === 'down' ? row.consecutiveFailCount + 1 : 0,
    consecutiveSuccessCount: result.status === 'up' ? row.consecutiveSuccessCount + 1 : 0,
    latencyMs: result.latencyMs,
    lastMessage: result.message,
    updatedAt: checkedAt
  };
  await db.update(schema.accountMonitors).set(values).where(eq(schema.accountMonitors.id, row.id)).run();
  await db.insert(schema.monitorHeartbeats).values({
    monitorId: row.id,
    accountId: row.accountId,
    status: result.status,
    checkedAt,
    latencyMs: result.latencyMs,
    message: result.message,
    retries,
    important,
    errorType: result.errorType,
    modelCount: result.modelCount
  }).run();
  await notifyStatusChange(row, previousStatus, result.status, result.message);
  return { accountId: row.accountId, status: result.status, checkedAt, latencyMs: result.latencyMs, message: result.message };
}

async function markMonitorMaintenance(row: MonitorAccountRow) {
  const checkedAt = nowIso();
  await db.update(schema.accountMonitors)
    .set({
      status: 'maintenance',
      lastCheckAt: checkedAt,
      nextCheckAt: nextCheckIso(row),
      lastMessage: '账号已停用',
      updatedAt: checkedAt
    })
    .where(eq(schema.accountMonitors.id, row.id))
    .run();
  await db.insert(schema.monitorHeartbeats).values({
    monitorId: row.id,
    accountId: row.accountId,
    status: 'maintenance',
    checkedAt,
    message: '账号已停用',
    important: row.status !== 'maintenance'
  }).run();
  return { accountId: row.accountId, status: 'maintenance' as const, checkedAt, latencyMs: null, message: '账号已停用' };
}

async function notifyStatusChange(row: MonitorAccountRow, previousStatus: MonitorStatus, nextStatus: MonitorStatus, message: string): Promise<void> {
  if (previousStatus === nextStatus || previousStatus === 'pending') return;
  const settings = getMonitorSettings();
  if (nextStatus === 'down' && !settings.notifyOnDown) return;
  if (nextStatus === 'up' && !settings.notifyOnRecovery) return;
  if (nextStatus !== 'down' && nextStatus !== 'up') return;

  const title = nextStatus === 'down' ? '账号监控故障' : '账号监控恢复';
  const level = nextStatus === 'down' ? 'error' : 'info';
  const text = `${row.baseUrl} / ${row.username || `账号 ${row.accountId}`}: ${message}`;
  await db.insert(schema.events).values({
    type: 'monitor',
    title,
    message: text,
    level,
    relatedId: row.accountId,
    relatedType: 'account',
    createdAt: nowIso()
  }).run();
  try {
    await sendNotification(title, text, level);
  } catch {
    // 通知失败不影响监控状态写入，详情可由设置页测试 Webhook。
  }
}

async function resolveProbeToken(row: MonitorAccountRow): Promise<string> {
  const credential = await resolveDefaultAccountCredential(row.accountId, {
    apiToken: row.apiToken,
    accessToken: row.accessToken,
    includeAccessToken: true
  });
  return credential?.token || '';
}

async function getDueMonitorRows(settings: MonitorSettings, includeAll: boolean): Promise<MonitorAccountRow[]> {
  const now = nowIso();
  const filters = includeAll ? [] : [
    eq(schema.accountMonitors.enabled, true),
    or(lte(schema.accountMonitors.nextCheckAt, now), sql`${schema.accountMonitors.nextCheckAt} IS NULL`)
  ];
  const where = filters.length > 0 ? and(...filters) : undefined;
  return getMonitorRows(where, includeAll ? 10000 : Math.max(1, settings.concurrency * 5), 0);
}

async function getMonitorRowByAccountId(accountId: number): Promise<MonitorAccountRow | null> {
  const rows = await getMonitorRows(eq(schema.accountMonitors.accountId, accountId), 1, 0);
  return rows[0] ?? null;
}

async function getMonitorRows(where?: SQL, limit = 10000, offset = 0): Promise<MonitorAccountRow[]> {
  const rows = await db
    .select({
      id: schema.accountMonitors.id,
      accountId: schema.accountMonitors.accountId,
      enabled: schema.accountMonitors.enabled,
      intervalSec: schema.accountMonitors.intervalSec,
      status: schema.accountMonitors.status,
      lastCheckAt: schema.accountMonitors.lastCheckAt,
      lastUpAt: schema.accountMonitors.lastUpAt,
      lastDownAt: schema.accountMonitors.lastDownAt,
      nextCheckAt: schema.accountMonitors.nextCheckAt,
      consecutiveFailCount: schema.accountMonitors.consecutiveFailCount,
      consecutiveSuccessCount: schema.accountMonitors.consecutiveSuccessCount,
      latencyMs: schema.accountMonitors.latencyMs,
      lastMessage: schema.accountMonitors.lastMessage,
      createdAt: schema.accountMonitors.createdAt,
      updatedAt: schema.accountMonitors.updatedAt,
      username: schema.accounts.username,
      credentialMode: schema.accounts.credentialMode,
      accessToken: schema.accounts.accessToken,
      apiToken: schema.accounts.apiToken,
      accountStatus: schema.accounts.status,
      baseUrl: schema.accounts.baseUrl,
      platform: schema.accounts.platform,
      proxyUrl: schema.accounts.proxyUrl,
      customHeaders: schema.accounts.customHeaders
    })
    .from(schema.accountMonitors)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.accountMonitors.accountId))
    .where(where)
    .orderBy(desc(schema.accountMonitors.status), desc(schema.accountMonitors.lastCheckAt), desc(schema.accountMonitors.id))
    .limit(limit)
    .offset(offset)
    .all();
  return rows as MonitorAccountRow[];
}

function monitorListFilters(query: { status?: string; keyword?: string }): SQL[] {
  const filters: SQL[] = [];
  if (query.status && query.status !== 'all') {
    if (query.status === 'disabled') {
      const disabledWhere = or(eq(schema.accountMonitors.enabled, false), sql`${schema.accounts.status} != 'active'`);
      if (disabledWhere) filters.push(disabledWhere);
    } else {
      filters.push(eq(schema.accountMonitors.status, query.status));
    }
  }
  const keyword = query.keyword?.trim();
  if (keyword) {
    const pattern = `%${keyword}%`;
    const keywordWhere = or(like(schema.accounts.username, pattern), like(schema.accounts.baseUrl, pattern));
    if (keywordWhere) filters.push(keywordWhere);
  }
  return filters;
}

function monitorAccountView(row: MonitorAccountRow) {
  const active = isMonitorActive(row);
  return {
    id: row.id,
    accountId: row.accountId,
    accountName: row.username || `账号 ${row.accountId}`,
    accountStatus: row.accountStatus,
    upstreamUrl: row.baseUrl,
    platform: row.platform,
    enabled: row.enabled,
    active,
    intervalSec: row.intervalSec,
    status: active ? row.status : 'maintenance',
    lastCheckAt: row.lastCheckAt,
    lastUpAt: row.lastUpAt,
    lastDownAt: row.lastDownAt,
    nextCheckAt: row.nextCheckAt,
    consecutiveFailCount: row.consecutiveFailCount,
    consecutiveSuccessCount: row.consecutiveSuccessCount,
    latencyMs: row.latencyMs,
    lastMessage: active ? row.lastMessage : '账号已停用'
  };
}

function heartbeatView(row: typeof schema.monitorHeartbeats.$inferSelect) {
  return {
    id: row.id,
    monitorId: row.monitorId,
    accountId: row.accountId,
    status: row.status,
    checkedAt: row.checkedAt,
    latencyMs: row.latencyMs,
    message: row.message,
    retries: row.retries,
    important: row.important,
    errorType: row.errorType,
    modelCount: row.modelCount
  };
}

async function listHeartbeatBars(monitorId: number, limit: number) {
  const rows = await db
    .select()
    .from(schema.monitorHeartbeats)
    .where(eq(schema.monitorHeartbeats.monitorId, monitorId))
    .orderBy(desc(schema.monitorHeartbeats.checkedAt), desc(schema.monitorHeartbeats.id))
    .limit(limit)
    .all();
  return rows.map(heartbeatView).reverse();
}

async function calculateUptimeRatio(fromIso: string): Promise<number | null> {
  const rows = await db.select({ status: schema.monitorHeartbeats.status }).from(schema.monitorHeartbeats).where(gte(schema.monitorHeartbeats.checkedAt, fromIso)).all();
  return uptimeRatio(rows.map((row) => row.status));
}

async function calculateAccountUptimeRatio(accountId: number, fromIso: string): Promise<number | null> {
  const rows = await db
    .select({ status: schema.monitorHeartbeats.status })
    .from(schema.monitorHeartbeats)
    .where(and(eq(schema.monitorHeartbeats.accountId, accountId), gte(schema.monitorHeartbeats.checkedAt, fromIso)))
    .all();
  return uptimeRatio(rows.map((row) => row.status));
}

function uptimeRatio(statuses: string[]): number | null {
  const effective = statuses.filter((status) => status === 'up' || status === 'down');
  if (effective.length === 0) return null;
  return Math.round((effective.filter((status) => status === 'up').length / effective.length) * 10000) / 100;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function isMonitorActive(row: MonitorAccountRow): boolean {
  return row.enabled && row.accountStatus === 'active';
}

function nextCheckIso(row: MonitorAccountRow): string {
  const settings = getMonitorSettings();
  const intervalSec = row.intervalSec || settings.intervalSec;
  return new Date(Date.now() + intervalSec * 1000).toISOString();
}

async function withTimeout<T>(promise: Promise<T>, timeoutSec: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('monitor_probe_timeout')), timeoutSec * 1000);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(workers);
}
