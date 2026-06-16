import { lt } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { matchesCron, minuteKey, parseCronExpression, type ParsedCron } from '../shared/cron.js';

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let activeCron: ParsedCron | null = null;
let lastRunKey: string | null = null;
let running = false;

export type ProxyLogCleanupResult = {
  enabled: boolean;
  retentionDays: number;
  cutoffUtc: string | null;
  deleted: number;
};

export function startProxyLogRetentionScheduler(): void {
  updateProxyLogRetentionSchedule({
    cron: config.logCleanupCron,
    retentionDays: config.logCleanupRetentionDays
  });
}

export function stopProxyLogRetentionScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  activeCron = null;
  lastRunKey = null;
  running = false;
}

export function updateProxyLogRetentionSchedule(input: { cron?: string; retentionDays?: number }): void {
  const cron = input.cron ?? config.logCleanupCron;
  const parsed = parseCronExpression(cron);
  if (!parsed) throw new Error(`Invalid log cleanup cron: ${cron}`);
  config.logCleanupCron = cron;
  if (input.retentionDays !== undefined) config.logCleanupRetentionDays = normalizeRetentionDays(input.retentionDays);
  activeCron = parsed;
  lastRunKey = null;
  if (!schedulerTimer) {
    schedulerTimer = setInterval(() => {
      void runDueProxyLogCleanup(new Date());
    }, 60_000);
    schedulerTimer.unref?.();
  }
}

export async function runDueProxyLogCleanup(now = new Date()): Promise<void> {
  if (!activeCron || running) return;
  if (!matchesCron(activeCron, now)) return;
  const runKey = minuteKey(now);
  if (lastRunKey === runKey) return;
  lastRunKey = runKey;
  running = true;
  try {
    const result = await cleanupExpiredProxyLogs(now.getTime());
    if (result.deleted > 0) {
      console.info(`[proxyLogRetention] deleted ${result.deleted} proxy logs before ${result.cutoffUtc}`);
    }
  } catch (error) {
    console.warn('[proxyLogRetention] cleanup failed', error);
  } finally {
    running = false;
  }
}

export async function cleanupExpiredProxyLogs(nowMs = Date.now()): Promise<ProxyLogCleanupResult> {
  const retentionDays = normalizeRetentionDays(config.logCleanupRetentionDays);
  const cutoffUtc = getProxyLogRetentionCutoffUtc(retentionDays, nowMs);
  const result = await db.delete(schema.proxyLogs).where(lt(schema.proxyLogs.createdAt, cutoffUtc)).run();
  return {
    enabled: true,
    retentionDays,
    cutoffUtc,
    deleted: result.changes
  };
}

export function getProxyLogRetentionCutoffUtc(retentionDays = config.logCleanupRetentionDays, nowMs = Date.now()): string {
  const normalizedDays = normalizeRetentionDays(retentionDays);
  return new Date(nowMs - normalizedDays * 24 * 60 * 60 * 1000).toISOString();
}

export function normalizeRetentionDays(value: number): number {
  return Math.max(1, Math.trunc(Number.isFinite(value) ? value : 30));
}
