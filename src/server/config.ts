import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyServerOptions } from 'fastify';

export type AppConfig = {
  authToken: string;
  proxyToken: string;
  host: string;
  port: number;
  dataDir: string;
  sqlitePath: string;
  systemProxyUrl: string;
  adminIpAllowlist: string[];
  requestBodyLimit: number;
  proxyMaxChannelAttempts: number;
  defaultRoutingStrategy: 'weighted' | 'stable_first';
  proxyFirstByteTimeoutSec: number;
  tokenRouterCacheTtlMs: number;
  balanceRefreshCron: string;
  logCleanupCron: string;
  logCleanupRetentionDays: number;
  notificationWebhookEnabled: boolean;
  notificationWebhookUrl: string;
  notifyCooldownSec: number;
};

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePort(value: string | undefined): number {
  const port = Math.trunc(parseNumber(value, 4000));
  if (port < 1 || port > 65535) {
    throw new Error('PORT must be between 1 and 65535');
  }
  return port;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseRoutingStrategy(value: string | undefined): AppConfig['defaultRoutingStrategy'] {
  const normalized = value?.trim();
  if (normalized === 'stable_first') return 'stable_first';
  return 'weighted';
}

export function buildConfig(env: NodeJS.ProcessEnv): AppConfig {
  const dataDir = resolve(env.DATA_DIR || './data');
  mkdirSync(dataDir, { recursive: true });

  const authToken = env.AUTH_TOKEN || 'change-me-admin-token';
  const proxyToken = env.PROXY_TOKEN || 'change-me-proxy-sk-token';

  if (env.NODE_ENV === 'production') {
    if (authToken === 'change-me-admin-token') {
      throw new Error('AUTH_TOKEN must be changed in production');
    }
    if (proxyToken === 'change-me-proxy-sk-token') {
      throw new Error('PROXY_TOKEN must be changed in production');
    }
  }

  return {
    authToken,
    proxyToken,
    host: (env.HOST || '0.0.0.0').trim() || '0.0.0.0',
    port: normalizePort(env.PORT),
    dataDir,
    sqlitePath: env.DB_URL?.trim() || resolve(dataDir, 'a2api.sqlite'),
    systemProxyUrl: env.SYSTEM_PROXY_URL || '',
    adminIpAllowlist: parseCsv(env.ADMIN_IP_ALLOWLIST),
    requestBodyLimit: Math.max(1024, Math.trunc(parseNumber(env.REQUEST_BODY_LIMIT, 20 * 1024 * 1024))),
    proxyMaxChannelAttempts: Math.max(1, Math.trunc(parseNumber(env.PROXY_MAX_CHANNEL_ATTEMPTS, 3))),
    defaultRoutingStrategy: parseRoutingStrategy(env.DEFAULT_ROUTING_STRATEGY),
    proxyFirstByteTimeoutSec: Math.max(0, Math.trunc(parseNumber(env.PROXY_FIRST_BYTE_TIMEOUT_SEC, 0))),
    tokenRouterCacheTtlMs: Math.max(100, Math.trunc(parseNumber(env.TOKEN_ROUTER_CACHE_TTL_MS, 1500))),
    balanceRefreshCron: env.BALANCE_REFRESH_CRON?.trim() || '0 * * * *',
    logCleanupCron: env.LOG_CLEANUP_CRON?.trim() || '0 6 * * *',
    logCleanupRetentionDays: Math.max(1, Math.trunc(parseNumber(env.LOG_CLEANUP_RETENTION_DAYS, 30))),
    notificationWebhookEnabled: parseBoolean(env.WEBHOOK_ENABLED, false),
    notificationWebhookUrl: env.WEBHOOK_URL?.trim() || '',
    notifyCooldownSec: Math.max(0, Math.trunc(parseNumber(env.NOTIFY_COOLDOWN_SEC, 300)))
  };
}

export const config = buildConfig(process.env);

export function buildFastifyOptions(appConfig: AppConfig): FastifyServerOptions {
  return {
    logger: true,
    bodyLimit: appConfig.requestBodyLimit,
    trustProxy: true
  };
}
