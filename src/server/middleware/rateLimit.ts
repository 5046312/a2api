export type RateLimitResult = {
  limited: boolean;
  retryAfterSec: number;
};

type RateLimitEntry = {
  count: number;
  windowStartedAt: number;
  blockedUntil: number;
};

const ADMIN_AUTH_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_AUTH_MAX_FAILURES = 20;
const adminAuthFailures = new Map<string, RateLimitEntry>();

function normalizeIp(rawIp: string | null | undefined): string {
  const ip = (rawIp || '').trim();
  if (!ip) return 'unknown';
  if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

function retryAfterSec(until: number, now: number): number {
  return Math.max(1, Math.ceil((until - now) / 1000));
}

function cleanupExpiredEntries(now: number): void {
  if (adminAuthFailures.size < 1024) return;
  for (const [key, entry] of adminAuthFailures) {
    const expiredWindow = now - entry.windowStartedAt >= ADMIN_AUTH_WINDOW_MS;
    if (entry.blockedUntil <= now && expiredWindow) adminAuthFailures.delete(key);
  }
}

export function getAdminAuthRateLimit(rawIp: string | null | undefined): RateLimitResult {
  const now = Date.now();
  const entry = adminAuthFailures.get(normalizeIp(rawIp));
  if (!entry || entry.blockedUntil <= now) return { limited: false, retryAfterSec: 0 };
  return { limited: true, retryAfterSec: retryAfterSec(entry.blockedUntil, now) };
}

export function recordAdminAuthFailure(rawIp: string | null | undefined): RateLimitResult {
  const now = Date.now();
  const key = normalizeIp(rawIp);
  cleanupExpiredEntries(now);

  const existing = adminAuthFailures.get(key);
  if (existing?.blockedUntil && existing.blockedUntil > now) {
    return { limited: true, retryAfterSec: retryAfterSec(existing.blockedUntil, now) };
  }

  let entry: RateLimitEntry;
  if (!existing || now - existing.windowStartedAt >= ADMIN_AUTH_WINDOW_MS) {
    entry = { count: 1, windowStartedAt: now, blockedUntil: 0 };
  } else {
    entry = { ...existing, count: existing.count + 1 };
  }

  if (entry.count >= ADMIN_AUTH_MAX_FAILURES) {
    // 管理 token 连续失败后临时封锁来源 IP，降低暴力猜测风险。
    entry.blockedUntil = now + ADMIN_AUTH_WINDOW_MS;
    adminAuthFailures.set(key, entry);
    return { limited: true, retryAfterSec: retryAfterSec(entry.blockedUntil, now) };
  }

  adminAuthFailures.set(key, entry);
  return { limited: false, retryAfterSec: 0 };
}

export function clearAdminAuthFailures(rawIp: string | null | undefined): void {
  adminAuthFailures.delete(normalizeIp(rawIp));
}
