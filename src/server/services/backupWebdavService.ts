import { Buffer } from 'node:buffer';
import { eq } from 'drizzle-orm';
import { fetch } from 'undici';
import { db, schema } from '../db/index.js';
import { isValidCronExpression, matchesCron, minuteKey, parseCronExpression, type ParsedCron } from '../shared/cron.js';
import { maskSecret } from '../shared/mask.js';
import { backupTypeSchema, exportBackup, importBackup, type BackupImportResult, type BackupType } from './backupService.js';
import { z } from 'zod';

const backupWebdavConfigSettingKey = 'backup_webdav_config_v1';
const backupWebdavStateSettingKey = 'backup_webdav_state_v1';
const backupWebdavDefaultAutoSyncCron = '0 */6 * * *';
const backupWebdavFetchTimeoutMs = 15_000;

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let activeCron: ParsedCron | null = null;
let lastRunKey: string | null = null;
let running = false;

export type BackupWebdavConfig = {
  enabled: boolean;
  fileUrl: string;
  username: string;
  password: string;
  exportType: BackupType;
  autoSyncEnabled: boolean;
  autoSyncCron: string;
};

export type BackupWebdavConfigView = Omit<BackupWebdavConfig, 'password'> & {
  hasPassword: boolean;
  passwordMasked: string;
};

export type BackupWebdavState = {
  lastSyncAt: string | null;
  lastError: string | null;
};

export type BackupWebdavSnapshot = {
  success: true;
  config: BackupWebdavConfigView;
  state: BackupWebdavState;
};

export type BackupWebdavExportResult = {
  success: true;
  fileUrl: string;
  exportType: BackupType;
  syncedAt: string;
  lastSyncAt: string;
  lastError: null;
};

export type BackupWebdavImportResult = BackupImportResult & {
  success: true;
  fileUrl: string;
  syncedAt: string;
  lastSyncAt: string;
  lastError: null;
};

export const backupWebdavConfigPayloadSchema = z.object({
  enabled: z.boolean().optional(),
  fileUrl: z.string().trim().optional(),
  username: z.string().trim().optional(),
  password: z.string().optional(),
  clearPassword: z.boolean().optional(),
  exportType: backupTypeSchema.optional(),
  autoSyncEnabled: z.boolean().optional(),
  autoSyncCron: z.string().trim().optional()
});

export const backupWebdavExportPayloadSchema = z.object({
  type: backupTypeSchema.optional()
});

type BackupWebdavConfigPayload = z.infer<typeof backupWebdavConfigPayloadSchema>;
type FetchOptions = NonNullable<Parameters<typeof fetch>[1]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidHttpUrl(value: string): boolean {
  if (!value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isBackupType(value: unknown): value is BackupType {
  return backupTypeSchema.safeParse(value).success;
}

function parseSettingValue(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readSettingValue(key: string): unknown {
  const row = db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, key)).get();
  return parseSettingValue(row?.value);
}

function writeSettingValue(key: string, value: unknown): void {
  const serialized = JSON.stringify(value) ?? 'null';
  db.insert(schema.settings)
    .values({ key, value: serialized })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: serialized }
    })
    .run();
}

function normalizeBackupWebdavConfig(raw: unknown): BackupWebdavConfig {
  const source = isRecord(raw) ? raw : {};
  const exportType = isBackupType(source.exportType) ? source.exportType : 'all';
  const autoSyncCron = typeof source.autoSyncCron === 'string' && isValidCronExpression(source.autoSyncCron)
    ? source.autoSyncCron
    : backupWebdavDefaultAutoSyncCron;
  return {
    enabled: source.enabled === true,
    fileUrl: asString(source.fileUrl),
    username: asString(source.username),
    password: typeof source.password === 'string' ? source.password : '',
    exportType,
    autoSyncEnabled: source.autoSyncEnabled === true,
    autoSyncCron
  };
}

function normalizeBackupWebdavState(raw: unknown): BackupWebdavState {
  const source = isRecord(raw) ? raw : {};
  return {
    lastSyncAt: typeof source.lastSyncAt === 'string' && source.lastSyncAt.trim() ? source.lastSyncAt : null,
    lastError: typeof source.lastError === 'string' && source.lastError.trim() ? source.lastError : null
  };
}

function toBackupWebdavConfigView(config: BackupWebdavConfig): BackupWebdavConfigView {
  return {
    enabled: config.enabled,
    fileUrl: config.fileUrl,
    username: config.username,
    exportType: config.exportType,
    autoSyncEnabled: config.autoSyncEnabled,
    autoSyncCron: config.autoSyncCron,
    hasPassword: config.password.length > 0,
    passwordMasked: maskSecret(config.password)
  };
}

function loadBackupWebdavConfig(): BackupWebdavConfig {
  return normalizeBackupWebdavConfig(readSettingValue(backupWebdavConfigSettingKey));
}

function loadBackupWebdavState(): BackupWebdavState {
  return normalizeBackupWebdavState(readSettingValue(backupWebdavStateSettingKey));
}

function writeBackupWebdavState(state: BackupWebdavState): void {
  writeSettingValue(backupWebdavStateSettingKey, state);
}

function validateBackupWebdavConfig(config: BackupWebdavConfig): void {
  if (config.enabled && !isValidHttpUrl(config.fileUrl)) {
    throw new Error('WebDAV 文件地址无效，请填写 http/https 文件 URL');
  }
  if (!isValidCronExpression(config.autoSyncCron)) {
    throw new Error('WebDAV 自动同步 Cron 表达式无效');
  }
  if (config.autoSyncEnabled && !config.enabled) {
    throw new Error('启用自动同步前请先启用 WebDAV 备份');
  }
}

function resolveBackupWebdavAuthHeader(config: BackupWebdavConfig): string | null {
  if (!config.username && !config.password) return null;
  return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
}

async function fetchBackupWebdav(url: string, init: FetchOptions) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), backupWebdavFetchTimeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('WebDAV 请求超时（15s）');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readFailureText(response: Awaited<ReturnType<typeof fetch>>): Promise<string> {
  const text = await response.text().catch(() => '');
  return text ? ` ${text.slice(0, 120)}` : '';
}

async function assertWebdavResponse(response: Awaited<ReturnType<typeof fetch>>, action: '导出' | '导入'): Promise<void> {
  if (response.ok) return;
  const detail = await readFailureText(response);
  if (response.status === 409) {
    throw new Error(`WebDAV ${action}失败：HTTP 409，远端目录不存在或路径冲突`);
  }
  throw new Error(`WebDAV ${action}失败：HTTP ${response.status}${detail}`);
}

function buildHeaders(config: BackupWebdavConfig, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (contentType) headers['Content-Type'] = contentType;
  const authHeader = resolveBackupWebdavAuthHeader(config);
  if (authHeader) headers.Authorization = authHeader;
  return headers;
}

function updateSyncStateSuccess(): { syncedAt: string; state: BackupWebdavState } {
  const syncedAt = new Date().toISOString();
  const state = { lastSyncAt: syncedAt, lastError: null };
  writeBackupWebdavState(state);
  return { syncedAt, state };
}

function updateSyncStateFailure(message: string): void {
  const previous = loadBackupWebdavState();
  writeBackupWebdavState({
    lastSyncAt: previous.lastSyncAt,
    lastError: message
  });
}

export function getBackupWebdavConfig(): BackupWebdavSnapshot {
  return {
    success: true,
    config: toBackupWebdavConfigView(loadBackupWebdavConfig()),
    state: loadBackupWebdavState()
  };
}

export function saveBackupWebdavConfig(input: BackupWebdavConfigPayload): BackupWebdavSnapshot {
  const existing = loadBackupWebdavConfig();
  const next: BackupWebdavConfig = {
    enabled: input.enabled === undefined ? existing.enabled : input.enabled,
    fileUrl: input.fileUrl === undefined ? existing.fileUrl : input.fileUrl,
    username: input.username === undefined ? existing.username : input.username,
    password: input.clearPassword ? '' : input.password === undefined ? existing.password : input.password,
    exportType: input.exportType === undefined ? existing.exportType : input.exportType,
    autoSyncEnabled: input.autoSyncEnabled === undefined ? existing.autoSyncEnabled : input.autoSyncEnabled,
    autoSyncCron: input.autoSyncCron ? input.autoSyncCron : existing.autoSyncCron
  };
  if (!next.enabled) next.autoSyncEnabled = false;
  validateBackupWebdavConfig(next);
  writeSettingValue(backupWebdavConfigSettingKey, next);
  reloadBackupWebdavScheduler();
  return getBackupWebdavConfig();
}

export async function exportBackupToWebdav(type?: BackupType): Promise<BackupWebdavExportResult> {
  const config = loadBackupWebdavConfig();
  validateBackupWebdavConfig(config);
  if (!config.enabled) throw new Error('WebDAV 备份未启用');
  if (!config.fileUrl) throw new Error('WebDAV 文件地址不能为空');

  const exportType = type ?? config.exportType;
  const payload = exportBackup(exportType);
  try {
    const response = await fetchBackupWebdav(config.fileUrl, {
      method: 'PUT',
      headers: buildHeaders(config, 'application/json'),
      body: JSON.stringify(payload, null, 2)
    });
    await assertWebdavResponse(response, '导出');
    const { syncedAt } = updateSyncStateSuccess();
    return {
      success: true,
      fileUrl: config.fileUrl,
      exportType,
      syncedAt,
      lastSyncAt: syncedAt,
      lastError: null
    };
  } catch (error) {
    updateSyncStateFailure(error instanceof Error ? error.message : 'WebDAV 导出失败');
    throw error;
  }
}

export async function importBackupFromWebdav(): Promise<BackupWebdavImportResult> {
  const config = loadBackupWebdavConfig();
  validateBackupWebdavConfig(config);
  if (!config.enabled) throw new Error('WebDAV 备份未启用');
  if (!config.fileUrl) throw new Error('WebDAV 文件地址不能为空');

  try {
    const response = await fetchBackupWebdav(config.fileUrl, {
      method: 'GET',
      headers: buildHeaders(config)
    });
    await assertWebdavResponse(response, '导入');
    const raw = await response.text();
    let documentData: unknown;
    try {
      documentData = JSON.parse(raw);
    } catch {
      throw new Error('WebDAV 文件不是有效 JSON');
    }
    const result = await importBackup(documentData);
    const { syncedAt } = updateSyncStateSuccess();
    return {
      ...result,
      success: true,
      fileUrl: config.fileUrl,
      syncedAt,
      lastSyncAt: syncedAt,
      lastError: null
    };
  } catch (error) {
    updateSyncStateFailure(error instanceof Error ? error.message : 'WebDAV 导入失败');
    throw error;
  }
}

export function startBackupWebdavScheduler(): void {
  reloadBackupWebdavScheduler();
}

export function stopBackupWebdavScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  activeCron = null;
  lastRunKey = null;
  running = false;
}

export function reloadBackupWebdavScheduler(): void {
  stopBackupWebdavScheduler();
  const config = loadBackupWebdavConfig();
  if (!config.enabled || !config.autoSyncEnabled) return;
  try {
    validateBackupWebdavConfig(config);
  } catch (error) {
    console.warn('[backupWebdav] invalid auto export config', error);
    return;
  }
  const parsed = parseCronExpression(config.autoSyncCron);
  if (!parsed) throw new Error('WebDAV 自动同步 Cron 表达式无效');
  activeCron = parsed;
  schedulerTimer = setInterval(() => {
    void runDueBackupWebdavSync(new Date());
  }, 60_000);
  schedulerTimer.unref?.();
}

export async function runDueBackupWebdavSync(now = new Date()): Promise<void> {
  if (!activeCron || running) return;
  if (!matchesCron(activeCron, now)) return;
  const runKey = minuteKey(now);
  if (lastRunKey === runKey) return;
  lastRunKey = runKey;
  running = true;
  try {
    await exportBackupToWebdav();
  } catch (error) {
    console.warn('[backupWebdav] auto export failed', error);
  } finally {
    running = false;
  }
}
