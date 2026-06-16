import { asc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { normalizeBaseUrl } from '../shared/http.js';
import { nowIso } from '../shared/time.js';

const ENDPOINT_COOLDOWN_MS = 5 * 60 * 1000;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const NETWORK_FAILURE_PATTERNS = [
  /network error/i,
  /fetch failed/i,
  /socket hang up/i,
  /econnreset/i,
  /econnrefused/i,
  /enotfound/i,
  /ehostunreach/i,
  /abort/i,
  /timeout/i
];

type SiteApiEndpointRow = typeof schema.siteApiEndpoints.$inferSelect;

export type SiteApiEndpointTarget = {
  kind: 'site_fallback' | 'endpoint';
  siteId: number;
  endpointId: number | null;
  baseUrl: string;
  configuredEndpointCount: number;
};

export type SiteApiEndpointFailureInput = {
  status?: number | null;
  message?: string | null;
};

export type SiteApiEndpointFailureResult = {
  retryable: boolean;
  failureReason: string;
  cooldownUntil: string | null;
};

function compareNullableTime(left: string | null, right: string | null): number {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
}

function isCoolingDown(endpoint: SiteApiEndpointRow, now: string): boolean {
  return !!endpoint.cooldownUntil && endpoint.cooldownUntil > now;
}

function formatFailureReason(input: SiteApiEndpointFailureInput): string {
  const status = typeof input.status === 'number' ? input.status : null;
  const message = input.message?.trim() || '';
  if (status && message) return message.match(new RegExp(`^HTTP\\s+${status}\\b`, 'i')) ? message : `HTTP ${status}: ${message}`;
  if (status) return `HTTP ${status}`;
  return message || 'endpoint failure';
}

function isRetryableFailure(input: SiteApiEndpointFailureInput): boolean {
  if (typeof input.status === 'number') return RETRYABLE_STATUS_CODES.has(input.status);
  const message = input.message || '';
  return NETWORK_FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}

export async function selectSiteApiEndpointTarget(
  siteId: number,
  siteUrl: string,
  excludedEndpointIds: number[] = []
): Promise<SiteApiEndpointTarget | null> {
  const now = nowIso();
  const endpoints = await db
    .select()
    .from(schema.siteApiEndpoints)
    .where(eq(schema.siteApiEndpoints.siteId, siteId))
    .orderBy(asc(schema.siteApiEndpoints.sortOrder), asc(schema.siteApiEndpoints.id))
    .all();

  // 未配置地址池时兼容旧站点配置，继续使用站点主地址。
  if (endpoints.length === 0) {
    return {
      kind: 'site_fallback',
      siteId,
      endpointId: null,
      baseUrl: normalizeBaseUrl(siteUrl),
      configuredEndpointCount: 0
    };
  }

  const excluded = new Set(excludedEndpointIds);
  const eligible = endpoints
    .filter((endpoint) => endpoint.enabled && !excluded.has(endpoint.id) && !isCoolingDown(endpoint, now))
    .sort((left, right) => {
      const sortOrder = left.sortOrder - right.sortOrder;
      if (sortOrder !== 0) return sortOrder;
      const selectedAt = compareNullableTime(left.lastSelectedAt, right.lastSelectedAt);
      if (selectedAt !== 0) return selectedAt;
      return left.id - right.id;
    });
  const selected = eligible[0];
  if (!selected) return null;

  return {
    kind: 'endpoint',
    siteId,
    endpointId: selected.id,
    baseUrl: normalizeBaseUrl(selected.url),
    configuredEndpointCount: endpoints.length
  };
}

export async function recordSiteApiEndpointSuccess(endpointId: number | null): Promise<void> {
  if (endpointId === null) return;
  const now = nowIso();
  await db
    .update(schema.siteApiEndpoints)
    .set({
      cooldownUntil: null,
      lastSelectedAt: now,
      lastFailureReason: null,
      updatedAt: now
    })
    .where(eq(schema.siteApiEndpoints.id, endpointId))
    .run();
}

export async function recordSiteApiEndpointFailure(
  endpointId: number | null,
  input: SiteApiEndpointFailureInput
): Promise<SiteApiEndpointFailureResult> {
  const retryable = isRetryableFailure(input);
  const failureReason = formatFailureReason(input);
  const now = nowIso();
  // 只有可重试错误进入短冷却，避免永久跳过配置错误。
  const cooldownUntil = retryable ? new Date(Date.parse(now) + ENDPOINT_COOLDOWN_MS).toISOString() : null;

  if (endpointId !== null) {
    await db
      .update(schema.siteApiEndpoints)
      .set({
        cooldownUntil,
        lastFailedAt: now,
        lastFailureReason: failureReason,
        updatedAt: now
      })
      .where(eq(schema.siteApiEndpoints.id, endpointId))
      .run();
  }

  return { retryable, failureReason, cooldownUntil };
}
