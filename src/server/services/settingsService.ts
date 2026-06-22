import { eq } from 'drizzle-orm';
import { fetch } from 'undici';
import { z } from 'zod';
import { config, type TemporaryDisableRule } from '../config.js';
import { db, schema } from '../db/index.js';
import { isValidCronExpression } from '../shared/cron.js';
import { fetchDispatcher } from '../shared/http.js';
import { maskSecret } from '../shared/mask.js';
import { updateBalanceRefreshCron } from './balanceScheduler.js';
import { normalizeRetentionDays, updateProxyLogRetentionSchedule } from './proxyLogRetentionService.js';
import { clearTokenRouterCache } from './tokenRouter.js';

const settingKeys = [
  'systemProxyUrl',
  'adminIpAllowlist',
  'proxyFirstByteTimeoutSec',
  'proxyMaxChannelAttempts',
  'proxyChannelRetryAttempts',
  'defaultRoutingStrategy',
  'tokenRouterCacheTtlMs',
  'balanceRefreshCron',
  'logCleanupCron',
  'logCleanupRetentionDays',
  'notificationWebhookEnabled',
  'notificationWebhookUrl',
  'notifyCooldownSec',
  'temporaryDisableRules',
  'costDisplayDigits'
] as const;
const legacySettingKeys = ['temporaryDisableEnabled'] as const;

const systemProxyProbeUrl = 'https://www.gstatic.com/generate_204';
const systemProxyTestTimeoutMs = 15_000;

const temporaryDisableRuleSchema = z.object({
  matchType: z.enum(['http_status', 'fetch_error']).optional().default('http_status'),
  statusCode: z.number().int().min(100).max(599),
  keywords: z.array(z.string().trim().min(1)).min(1),
  durationMinutes: z.number().int().min(1),
  description: z.string().trim().optional().default('')
});

export const settingsPayloadSchema = z.object({
  systemProxyUrl: z.string().trim().optional(),
  adminIpAllowlist: z.array(z.string().trim()).optional(),
  proxyFirstByteTimeoutSec: z.number().int().min(0).optional(),
  proxyMaxChannelAttempts: z.number().int().min(1).max(20).optional(),
  proxyChannelRetryAttempts: z.number().int().min(1).max(20).optional(),
  defaultRoutingStrategy: z.enum(['weighted', 'stable_first', 'round_robin']).optional(),
  tokenRouterCacheTtlMs: z.number().int().min(100).optional(),
  balanceRefreshCron: z.string().trim().optional(),
  logCleanupCron: z.string().trim().optional(),
  logCleanupRetentionDays: z.number().int().min(1).optional(),
  notificationWebhookEnabled: z.boolean().optional(),
  notificationWebhookUrl: z.string().trim().optional(),
  clearNotificationWebhookUrl: z.boolean().optional(),
  notifyCooldownSec: z.number().int().min(0).optional(),
  temporaryDisableRules: z.array(temporaryDisableRuleSchema).optional(),
  costDisplayDigits: z.number().int().min(0).max(12).optional()
});

export type SettingsPayload = z.infer<typeof settingsPayloadSchema>;
export type SettingsSnapshot = Omit<Required<SettingsPayload>, 'notificationWebhookUrl' | 'clearNotificationWebhookUrl'> & {
  notificationWebhookUrl: string;
  notificationWebhookUrlMasked: string;
};

export type SystemProxyTestResult = {
  ok: true;
  proxyUrl: string;
  probeUrl: string;
  finalUrl: string;
  reachable: true;
  statusCode: number;
  upstreamOk: boolean;
  latencyMs: number;
};

export type RuntimeDatabaseState = {
  success: true;
  active: {
    dialect: 'sqlite';
    connection: string;
    ssl: false;
  };
  saved: null;
  restartRequired: false;
};

const supportedPlatforms = [
  'openai',
  'new-api',
  'one-api',
  'one-hub',
  'done-hub',
  'veloera',
  'anyrouter',
  'sub2api',
  'cliproxyapi',
  'claude',
  'gemini',
  'codex',
  'gemini-cli',
  'antigravity'
];

function normalizeAdminIpAllowlist(value: string[]): string[] {
  return value.map((item) => item.trim()).filter(Boolean);
}

function normalizeTemporaryDisableRules(value: TemporaryDisableRule[]): TemporaryDisableRule[] {
  return value
    .map((rule) => ({
      matchType: rule.matchType === 'fetch_error' ? 'fetch_error' as const : 'http_status' as const,
      statusCode: rule.statusCode,
      keywords: [...new Set(rule.keywords.map((item) => item.trim()).filter(Boolean))],
      durationMinutes: rule.durationMinutes,
      description: rule.description.trim()
    }))
    .filter((rule) => rule.keywords.length > 0);
}

function snapshotFromConfig(): SettingsSnapshot {
  return {
    systemProxyUrl: config.systemProxyUrl,
    adminIpAllowlist: config.adminIpAllowlist,
    proxyFirstByteTimeoutSec: config.proxyFirstByteTimeoutSec,
    proxyMaxChannelAttempts: config.proxyMaxChannelAttempts,
    proxyChannelRetryAttempts: config.proxyChannelRetryAttempts,
    defaultRoutingStrategy: config.defaultRoutingStrategy,
    tokenRouterCacheTtlMs: config.tokenRouterCacheTtlMs,
    balanceRefreshCron: config.balanceRefreshCron,
    logCleanupCron: config.logCleanupCron,
    logCleanupRetentionDays: config.logCleanupRetentionDays,
    notificationWebhookEnabled: config.notificationWebhookEnabled,
    notificationWebhookUrl: '',
    notificationWebhookUrlMasked: maskSecret(config.notificationWebhookUrl),
    notifyCooldownSec: config.notifyCooldownSec,
    temporaryDisableRules: config.temporaryDisableRules,
    costDisplayDigits: config.costDisplayDigits
  };
}

function parseStoredSettings(rows: Array<{ key: string; value: string | null }>): SettingsPayload {
  const values: Record<string, unknown> = {};
  for (const row of rows) {
    if (!settingKeys.includes(row.key as (typeof settingKeys)[number]) && !legacySettingKeys.includes(row.key as (typeof legacySettingKeys)[number])) continue;
    try {
      values[row.key] = row.value ? JSON.parse(row.value) : null;
    } catch {
      values[row.key] = undefined;
    }
  }
  for (const key of legacySettingKeys) delete values[key];
  const parsed = settingsPayloadSchema.safeParse(values);
  if (!parsed.success) return {};
  if (parsed.data.balanceRefreshCron !== undefined && !isValidCronExpression(parsed.data.balanceRefreshCron)) {
    delete parsed.data.balanceRefreshCron;
  }
  if (parsed.data.logCleanupCron !== undefined && !isValidCronExpression(parsed.data.logCleanupCron)) {
    delete parsed.data.logCleanupCron;
  }
  return parsed.data;
}

function applySettings(payload: SettingsPayload): void {
  if (payload.systemProxyUrl !== undefined) config.systemProxyUrl = payload.systemProxyUrl;
  if (payload.adminIpAllowlist !== undefined) config.adminIpAllowlist = normalizeAdminIpAllowlist(payload.adminIpAllowlist);
  if (payload.proxyFirstByteTimeoutSec !== undefined) config.proxyFirstByteTimeoutSec = payload.proxyFirstByteTimeoutSec;
  if (payload.proxyMaxChannelAttempts !== undefined) config.proxyMaxChannelAttempts = payload.proxyMaxChannelAttempts;
  if (payload.proxyChannelRetryAttempts !== undefined) config.proxyChannelRetryAttempts = payload.proxyChannelRetryAttempts;
  if (payload.defaultRoutingStrategy !== undefined) {
    config.defaultRoutingStrategy = payload.defaultRoutingStrategy;
    clearTokenRouterCache();
  }
  if (payload.balanceRefreshCron !== undefined) updateBalanceRefreshCron(payload.balanceRefreshCron);
  if (payload.logCleanupCron !== undefined || payload.logCleanupRetentionDays !== undefined) {
    const retentionPayload: { cron?: string; retentionDays?: number } = {};
    if (payload.logCleanupCron !== undefined) retentionPayload.cron = payload.logCleanupCron;
    if (payload.logCleanupRetentionDays !== undefined) retentionPayload.retentionDays = payload.logCleanupRetentionDays;
    updateProxyLogRetentionSchedule(retentionPayload);
  }
  if (payload.notificationWebhookEnabled !== undefined) config.notificationWebhookEnabled = payload.notificationWebhookEnabled;
  if (payload.clearNotificationWebhookUrl) config.notificationWebhookUrl = '';
  if (payload.notificationWebhookUrl !== undefined) config.notificationWebhookUrl = resolveNotificationWebhookUrl(payload.notificationWebhookUrl);
  if (payload.notifyCooldownSec !== undefined) config.notifyCooldownSec = payload.notifyCooldownSec;
  if (payload.temporaryDisableRules !== undefined) {
    config.temporaryDisableRules = normalizeTemporaryDisableRules(payload.temporaryDisableRules);
    clearTokenRouterCache();
  }
  if (payload.costDisplayDigits !== undefined) config.costDisplayDigits = payload.costDisplayDigits;
  if (payload.tokenRouterCacheTtlMs !== undefined) {
    config.tokenRouterCacheTtlMs = payload.tokenRouterCacheTtlMs;
    clearTokenRouterCache();
  }
}

function resolveNotificationWebhookUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return config.notificationWebhookUrl;
  return trimmed === maskSecret(config.notificationWebhookUrl) ? config.notificationWebhookUrl : trimmed;
}

function validateNotificationSettings(payload: SettingsPayload): SettingsPayload {
  const nextWebhookUrl = payload.clearNotificationWebhookUrl
    ? ''
    : payload.notificationWebhookUrl === undefined
    ? config.notificationWebhookUrl
    : resolveNotificationWebhookUrl(payload.notificationWebhookUrl);
  const nextWebhookEnabled = payload.notificationWebhookEnabled ?? config.notificationWebhookEnabled;

  if (nextWebhookUrl) {
    try {
      new URL(nextWebhookUrl);
    } catch {
      throw new Error('Webhook URL 格式无效');
    }
  }
  if (nextWebhookEnabled && !nextWebhookUrl) {
    throw new Error('启用 Webhook 通知前必须填写 Webhook URL');
  }

  const next: SettingsPayload = { ...payload };
  if (payload.clearNotificationWebhookUrl || payload.notificationWebhookUrl === undefined || !payload.notificationWebhookUrl.trim()) {
    delete next.notificationWebhookUrl;
  } else {
    next.notificationWebhookUrl = nextWebhookUrl;
  }
  return next;
}

function validateBalanceRefreshCron(payload: SettingsPayload): SettingsPayload {
  if (payload.balanceRefreshCron !== undefined && !isValidCronExpression(payload.balanceRefreshCron)) {
    throw new Error('余额刷新 Cron 格式无效');
  }
  return payload;
}

function validateLogCleanupSettings(payload: SettingsPayload): SettingsPayload {
  if (payload.logCleanupCron !== undefined && !isValidCronExpression(payload.logCleanupCron)) {
    throw new Error('日志清理 Cron 格式无效');
  }
  const next: SettingsPayload = { ...payload };
  if (payload.logCleanupRetentionDays !== undefined) {
    next.logCleanupRetentionDays = normalizeRetentionDays(payload.logCleanupRetentionDays);
  }
  return next;
}

function validateTemporaryDisableSettings(payload: SettingsPayload): SettingsPayload {
  const next: SettingsPayload = { ...payload };
  if (payload.temporaryDisableRules !== undefined) {
    next.temporaryDisableRules = normalizeTemporaryDisableRules(payload.temporaryDisableRules);
  }
  return next;
}

function describeSystemProxyTestError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '未知错误');
  if (/AbortError|aborted|timeout|timed out/i.test(message)) return '系统代理测试超时，请检查代理服务或网络连接';
  if (/ECONNREFUSED/i.test(message)) return '系统代理测试失败：连接被拒绝，请检查代理地址和端口';
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return '系统代理测试失败：域名解析失败';
  if (/ECONNRESET/i.test(message)) return '系统代理测试失败：连接被重置';
  if (/407|proxy authentication/i.test(message)) return '系统代理测试失败：代理认证失败';
  return `系统代理测试失败：${message}`;
}

function resolveSystemProxyTestUrl(proxyUrl: string | undefined): string {
  const rawProxyUrl = proxyUrl === undefined ? config.systemProxyUrl : proxyUrl;
  const trimmed = rawProxyUrl.trim();
  if (!trimmed) throw new Error('请先填写系统代理地址');
  try {
    new URL(trimmed);
  } catch {
    throw new Error('系统代理地址格式无效');
  }
  return trimmed;
}

export async function testSystemProxy(payload: { proxyUrl?: string | undefined } = {}): Promise<SystemProxyTestResult> {
  const proxyUrl = resolveSystemProxyTestUrl(payload.proxyUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), systemProxyTestTimeoutMs);
  const startedAt = Date.now();

  try {
    const dispatcher = fetchDispatcher(proxyUrl);
    const fetchOptions: NonNullable<Parameters<typeof fetch>[1]> = {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'cache-control': 'no-cache',
        'user-agent': 'a2api-system-proxy-tester/1.0'
      }
    };
    if (dispatcher) fetchOptions.dispatcher = dispatcher;

    const response = await fetch(systemProxyProbeUrl, fetchOptions);
    try {
      await response.arrayBuffer();
    } catch {
      // 只要收到响应即可证明代理链路可达，body drain 失败不影响测试结论。
    }
    return {
      ok: true,
      proxyUrl,
      probeUrl: systemProxyProbeUrl,
      finalUrl: response.url || systemProxyProbeUrl,
      reachable: true,
      statusCode: response.status,
      upstreamOk: response.ok,
      latencyMs: Math.max(1, Date.now() - startedAt)
    };
  } catch (error) {
    throw new Error(describeSystemProxyTestError(error));
  } finally {
    clearTimeout(timeout);
  }
}

export function hydrateRuntimeSettings(): SettingsSnapshot {
  const rows = db.select({ key: schema.settings.key, value: schema.settings.value }).from(schema.settings).all();
  applySettings(parseStoredSettings(rows));
  return snapshotFromConfig();
}

export function getSettings(): SettingsSnapshot {
  return snapshotFromConfig();
}

export function getBrandList(): { brands: string[] } {
  return { brands: supportedPlatforms };
}

export function getRuntimeDatabaseState(): RuntimeDatabaseState {
  return {
    success: true,
    active: {
      dialect: 'sqlite',
      connection: config.sqlitePath,
      ssl: false
    },
    saved: null,
    restartRequired: false
  };
}

export function updateSettings(payload: SettingsPayload): SettingsSnapshot {
  const normalizedAdminPayload: SettingsPayload = { ...payload };
  if (payload.adminIpAllowlist !== undefined) {
    normalizedAdminPayload.adminIpAllowlist = normalizeAdminIpAllowlist(payload.adminIpAllowlist);
  }
  const normalized: SettingsPayload = validateLogCleanupSettings(
    validateBalanceRefreshCron(
      validateNotificationSettings(
        validateTemporaryDisableSettings(normalizedAdminPayload)
      )
    )
  );

  for (const key of settingKeys) {
    if (normalized[key] === undefined) continue;
    db.insert(schema.settings)
      .values({ key, value: JSON.stringify(normalized[key]) })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: JSON.stringify(normalized[key]) }
      })
      .run();
  }

  applySettings(normalized);
  return snapshotFromConfig();
}

export function resetSetting(key: (typeof settingKeys)[number]): void {
  db.delete(schema.settings).where(eq(schema.settings.key, key)).run();
  hydrateRuntimeSettings();
}

export function getNotificationSettings() {
  return {
    webhookEnabled: config.notificationWebhookEnabled,
    webhookUrlMasked: maskSecret(config.notificationWebhookUrl),
    notifyCooldownSec: config.notifyCooldownSec
  };
}

export function updateNotificationSettings(payload: {
  webhookEnabled?: boolean | undefined;
  webhookUrl?: string | undefined;
  clearWebhookUrl?: boolean | undefined;
  notifyCooldownSec?: number | undefined;
}) {
  const settingsPayload: SettingsPayload = {};
  if (payload.webhookEnabled !== undefined) settingsPayload.notificationWebhookEnabled = payload.webhookEnabled;
  if (payload.webhookUrl !== undefined) settingsPayload.notificationWebhookUrl = payload.webhookUrl;
  if (payload.clearWebhookUrl !== undefined) settingsPayload.clearNotificationWebhookUrl = payload.clearWebhookUrl;
  if (payload.notifyCooldownSec !== undefined) settingsPayload.notifyCooldownSec = payload.notifyCooldownSec;
  const next = updateSettings(settingsPayload);
  return {
    webhookEnabled: next.notificationWebhookEnabled,
    webhookUrlMasked: next.notificationWebhookUrlMasked,
    notifyCooldownSec: next.notifyCooldownSec
  };
}
