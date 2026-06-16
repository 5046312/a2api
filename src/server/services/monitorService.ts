import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';

const LDOH_COOKIE_SETTING_KEY = 'monitorLdohCookie';
export const MONITOR_AUTH_COOKIE = 'a2api_monitor_auth';

export type MonitorConfig = {
  ldohCookieConfigured: boolean;
  ldohCookieMasked: string;
};

function maskCookieValue(value: string): string {
  const cookie = value.trim();
  if (!cookie) return '';
  const raw = cookie.includes('=') ? cookie.slice(cookie.indexOf('=') + 1) : cookie;
  if (raw.length <= 10) return `${raw.slice(0, 2)}****`;
  return `${raw.slice(0, 6)}****${raw.slice(-4)}`;
}

function normalizeLdohCookie(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.includes('ld_auth_session=')) {
    const firstPair = trimmed.split(';')[0]?.trim() || '';
    return firstPair.startsWith('ld_auth_session=') ? firstPair : '';
  }
  return `ld_auth_session=${trimmed}`;
}

function getSettingString(key: string): string {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  if (!row?.value) return '';
  try {
    const parsed = JSON.parse(row.value);
    return typeof parsed === 'string' ? parsed : '';
  } catch {
    return '';
  }
}

export function getStoredLdohCookie(): string {
  return getSettingString(LDOH_COOKIE_SETTING_KEY);
}

function upsertSetting(key: string, value: string): void {
  db.insert(schema.settings)
    .values({ key, value: JSON.stringify(value) })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: JSON.stringify(value) }
    })
    .run();
}

export function getMonitorConfig(): MonitorConfig {
  const cookie = getStoredLdohCookie();
  return {
    ldohCookieConfigured: !!cookie,
    ldohCookieMasked: cookie ? maskCookieValue(cookie) : ''
  };
}

export function updateMonitorConfig(payload: { ldohCookie?: string | null | undefined }): MonitorConfig & { ok: true; message: string } {
  const rawCookie = String(payload.ldohCookie || '').trim();
  if (!rawCookie) {
    upsertSetting(LDOH_COOKIE_SETTING_KEY, '');
    return { ok: true, message: 'LDOH Cookie 已清空', ldohCookieConfigured: false, ldohCookieMasked: '' };
  }

  const normalized = normalizeLdohCookie(rawCookie);
  if (!normalized.startsWith('ld_auth_session=') || normalized.length < 24) {
    throw new Error('Cookie 格式无效，请填写 ld_auth_session 或其值');
  }
  upsertSetting(LDOH_COOKIE_SETTING_KEY, normalized);
  return {
    ok: true,
    message: 'LDOH Cookie 已保存',
    ldohCookieConfigured: true,
    ldohCookieMasked: maskCookieValue(normalized)
  };
}

export function monitorSessionCookie(): string {
  return `${MONITOR_AUTH_COOKIE}=${encodeURIComponent(config.authToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200`;
}
