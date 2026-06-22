import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, sqlite } from '../db/index.js';
import { parseJsonArray, stringifyJson } from '../shared/json.js';
import { nowIso } from '../shared/time.js';
import { rebuildRoutes, type RouteRebuildResult } from './routeRefreshService.js';
import { monitorSettingsPayloadSchema, updateMonitorSettings, type MonitorSettings } from './accountMonitorService.js';
import { settingsPayloadSchema, updateSettings } from './settingsService.js';
import { clearTokenRouterCache } from './tokenRouter.js';
import type { CredentialRef } from './downstreamPolicy.js';
import type { ProxyResourceOwner } from '../middleware/auth.js';

export const backupTypeSchema = z.enum(['accounts', 'preferences', 'all']);

const backupDocumentSchema = z.object({
  version: z.string(),
  timestamp: z.number().optional(),
  type: backupTypeSchema,
  accounts: z.unknown().optional(),
  preferences: z.record(z.string(), z.unknown()).optional()
}).passthrough();

export type BackupType = z.infer<typeof backupTypeSchema>;

type AccountRow = typeof schema.accounts.$inferSelect;
type AccountTokenRow = typeof schema.accountTokens.$inferSelect;
type ModelAvailabilityRow = typeof schema.modelAvailability.$inferSelect;
type TokenModelAvailabilityRow = typeof schema.tokenModelAvailability.$inferSelect;
type TokenRouteRow = typeof schema.tokenRoutes.$inferSelect;
type RouteChannelRow = typeof schema.routeChannels.$inferSelect;
type DownstreamKeyRow = typeof schema.downstreamApiKeys.$inferSelect;
type ProxyFileRow = typeof schema.proxyFiles.$inferSelect;
type ProxyVideoTaskRow = typeof schema.proxyVideoTasks.$inferSelect;
type AccountMonitorRow = typeof schema.accountMonitors.$inferSelect;
type MonitorHeartbeatRow = typeof schema.monitorHeartbeats.$inferSelect;

type BackupAccountsSection = {
  accounts: AccountRow[];
  accountTokens: AccountTokenRow[];
  modelAvailability: ModelAvailabilityRow[];
  tokenModelAvailability: TokenModelAvailabilityRow[];
  tokenRoutes: TokenRouteRow[];
  routeChannels: RouteChannelRow[];
  downstreamApiKeys: DownstreamKeyRow[];
  proxyFiles: ProxyFileRow[];
  proxyVideoTasks: ProxyVideoTaskRow[];
  accountMonitors: AccountMonitorRow[];
  monitorHeartbeats: MonitorHeartbeatRow[];
};

export type BackupDocument = {
  version: 'a2api-1';
  timestamp: number;
  type: BackupType;
  accounts?: BackupAccountsSection;
  preferences?: Record<string, unknown>;
};

export type BackupImportResult = {
  allImported: boolean;
  sections: {
    accounts: boolean;
    preferences: boolean;
  };
  summary: {
    created: number;
    updated: number;
    skipped: number;
    importedAccounts: number;
    importedTokens: number;
    importedRoutes: number;
    importedDownstreamKeys: number;
    importedProxyFiles: number;
    importedProxyVideoTasks: number;
    importedPreferences: number;
  };
  warnings: string[];
  routeRebuild?: RouteRebuildResult;
};

type ImportSummary = BackupImportResult['summary'];

const importablePreferenceKeys = [
  'proxyFirstByteTimeoutSec',
  'proxyMaxChannelAttempts',
  'proxyChannelRetryAttempts',
  'tokenRouterCacheTtlMs',
  'balanceRefreshCron',
  'logCleanupCron',
  'logCleanupRetentionDays',
  'notificationWebhookEnabled',
  'notificationWebhookUrl',
  'notifyCooldownSec',
  'temporaryDisableRules',
  'costDisplayDigits',
  'monitorSettings'
] as const;

export function exportBackup(type: BackupType): BackupDocument {
  const document: BackupDocument = {
    version: 'a2api-1',
    timestamp: Date.now(),
    type
  };

  if (type === 'accounts' || type === 'all') {
    document.accounts = {
      accounts: db.select().from(schema.accounts).all(),
      accountTokens: db.select().from(schema.accountTokens).all(),
      modelAvailability: db.select().from(schema.modelAvailability).all(),
      tokenModelAvailability: db.select().from(schema.tokenModelAvailability).all(),
      tokenRoutes: db.select().from(schema.tokenRoutes).all(),
      routeChannels: db.select().from(schema.routeChannels).all(),
      downstreamApiKeys: db.select().from(schema.downstreamApiKeys).all(),
      proxyFiles: db.select().from(schema.proxyFiles).all(),
      proxyVideoTasks: db.select().from(schema.proxyVideoTasks).all(),
      accountMonitors: db.select().from(schema.accountMonitors).all(),
      monitorHeartbeats: db.select().from(schema.monitorHeartbeats).all()
    };
  }

  if (type === 'preferences' || type === 'all') {
    document.preferences = exportPreferences();
  }

  return document;
}

export async function importBackup(input: unknown, requestedType?: BackupType): Promise<BackupImportResult> {
  const parsed = backupDocumentSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid backup document');
  if (parsed.data.version !== 'a2api-1') throw new Error(`Unsupported backup version: ${parsed.data.version}`);

  const result = emptyImportResult();
  const importType = requestedType ?? parsed.data.type;
  const warnings = result.warnings;
  let shouldRebuildRoutes = false;

  sqlite.transaction(() => {
    if (importType === 'accounts' || importType === 'all') {
      const section = sectionObject(parsed.data.accounts, 'accounts', warnings);
      importAccountsSection(section, result.summary, warnings);
      result.sections.accounts = true;
      shouldRebuildRoutes = true;
    }

    if (importType === 'preferences' || importType === 'all') {
      importPreferences(parsed.data.preferences ?? {}, result.summary, warnings);
      result.sections.preferences = true;
    }
  })();

  result.allImported = importType === 'all'
    ? result.sections.accounts && result.sections.preferences
    : importType === 'accounts'
      ? result.sections.accounts
      : result.sections.preferences;

  if (shouldRebuildRoutes) {
    result.routeRebuild = await rebuildRoutes({ preserveManual: true });
  } else {
    clearTokenRouterCache();
  }

  return result;
}

function emptyImportResult(): BackupImportResult {
  return {
    allImported: false,
    sections: { accounts: false, preferences: false },
    summary: {
      created: 0,
      updated: 0,
      skipped: 0,
      importedAccounts: 0,
      importedTokens: 0,
      importedRoutes: 0,
      importedDownstreamKeys: 0,
      importedProxyFiles: 0,
      importedProxyVideoTasks: 0,
      importedPreferences: 0
    },
    warnings: []
  };
}

function exportPreferences(): Record<string, unknown> {
  const rows = db.select().from(schema.settings).all();
  const output: Record<string, unknown> = {};
  for (const row of rows) {
    if (!importablePreferenceKeys.includes(row.key as (typeof importablePreferenceKeys)[number])) continue;
    try {
      output[row.key] = row.value ? JSON.parse(row.value) : null;
    } catch {
      output[row.key] = null;
    }
  }
  return output;
}

function importPreferences(preferences: Record<string, unknown>, summary: ImportSummary, warnings: string[]): void {
  const payload: Record<string, unknown> = {};
  for (const key of importablePreferenceKeys) {
    if (key === 'monitorSettings') continue;
    if (Object.prototype.hasOwnProperty.call(preferences, key)) {
      payload[key] = preferences[key];
    }
  }

  const parsed = settingsPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    warnings.push(`Preferences skipped: ${parsed.error.message}`);
    summary.skipped += 1;
    return;
  }
  try {
    updateSettings(parsed.data);
    summary.importedPreferences = Object.keys(parsed.data).length;
    summary.updated += summary.importedPreferences;
    if (Object.prototype.hasOwnProperty.call(preferences, 'monitorSettings')) {
      const monitorSettings = monitorSettingsPayloadSchema.safeParse(preferences.monitorSettings);
      if (monitorSettings.success) {
        updateMonitorSettings(compactMonitorSettings(monitorSettings.data));
        summary.importedPreferences += 1;
        summary.updated += 1;
      } else {
        warnings.push(`Monitor settings skipped: ${monitorSettings.error.message}`);
        summary.skipped += 1;
      }
    }
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'Preferences import failed');
    summary.skipped += 1;
  }
}

function importAccountsSection(section: Record<string, unknown>, summary: ImportSummary, warnings: string[]): void {
  const accountIdMap = new Map<number, number>();
  const tokenIdMap = new Map<number, number>();
  const routeIdMap = new Map<number, number>();
  const channelIdMap = new Map<number, number>();
  const downstreamKeyIdMap = new Map<number, number>();

  importAccounts(rows<AccountRow>(section, 'accounts', warnings), accountIdMap, summary, warnings);
  importAccountTokens(rows<AccountTokenRow>(section, 'accountTokens', warnings), accountIdMap, tokenIdMap, summary, warnings);
  importModelAvailability(rows<ModelAvailabilityRow>(section, 'modelAvailability', warnings), accountIdMap, summary, warnings);
  importTokenModelAvailability(rows<TokenModelAvailabilityRow>(section, 'tokenModelAvailability', warnings), tokenIdMap, summary, warnings);
  importTokenRoutes(rows<TokenRouteRow>(section, 'tokenRoutes', warnings), routeIdMap, summary);
  importRouteChannels(rows<RouteChannelRow>(section, 'routeChannels', warnings), routeIdMap, accountIdMap, tokenIdMap, channelIdMap, summary, warnings);
  importDownstreamKeys(rows<DownstreamKeyRow>(section, 'downstreamApiKeys', warnings), {
    accountIdMap,
    tokenIdMap,
    routeIdMap,
    downstreamKeyIdMap,
    summary,
    warnings
  });
  importProxyFiles(rows<ProxyFileRow>(section, 'proxyFiles', warnings), downstreamKeyIdMap, summary, warnings);
  importProxyVideoTasks(rows<ProxyVideoTaskRow>(section, 'proxyVideoTasks', warnings), accountIdMap, tokenIdMap, channelIdMap, summary, warnings);
}

function importAccounts(
  rowsToImport: AccountRow[],
  accountIdMap: Map<number, number>,
  summary: ImportSummary,
  warnings: string[]
): void {
  const now = nowIso();
  for (const row of rowsToImport) {
    if (!row.baseUrl) {
      skip(warnings, summary, `Account skipped, missing upstream: #${row.id}`);
      continue;
    }
    const existing = db.select().from(schema.accounts).where(and(eq(schema.accounts.baseUrl, row.baseUrl), eq(schema.accounts.platform, row.platform))).all().find((item) => (
      sameNullable(item.username, row.username)
      && item.credentialMode === row.credentialMode
      && sameNullable(item.oauthAccountKey, row.oauthAccountKey)
    ));
    if (existing) {
      db.update(schema.accounts)
        .set({
          username: row.username,
          baseUrl: row.baseUrl,
          platform: row.platform,
          proxyUrl: row.proxyUrl,
          useSystemProxy: row.useSystemProxy,
          customHeaders: row.customHeaders,
          credentialMode: row.credentialMode,
          accessToken: row.accessToken,
          apiToken: row.apiToken,
          balance: row.balance,
          balanceUsed: row.balanceUsed,
          quota: row.quota,
          unitCost: row.unitCost,
          valueScore: row.valueScore,
          isPinned: row.isPinned,
          sortOrder: row.sortOrder,
          lastBalanceRefresh: row.lastBalanceRefresh,
          oauthProvider: row.oauthProvider,
          oauthAccountKey: row.oauthAccountKey,
          oauthProjectId: row.oauthProjectId,
          extraConfig: row.extraConfig,
          updatedAt: now
        })
        .where(eq(schema.accounts.id, existing.id))
        .run();
      accountIdMap.set(row.id, existing.id);
      summary.updated += 1;
    } else {
      const inserted = db.insert(schema.accounts).values(withoutId(row)).returning().get();
      accountIdMap.set(row.id, inserted.id);
      summary.created += 1;
    }
    summary.importedAccounts += 1;
  }
}

function importAccountTokens(
  rowsToImport: AccountTokenRow[],
  accountIdMap: Map<number, number>,
  tokenIdMap: Map<number, number>,
  summary: ImportSummary,
  warnings: string[]
): void {
  const now = nowIso();
  for (const row of rowsToImport) {
    const accountId = accountIdMap.get(row.accountId);
    if (!accountId) {
      skip(warnings, summary, `Token skipped, missing account #${row.accountId}`);
      continue;
    }
    if (row.source === 'account_default') {
      // 旧备份里的默认账号 key 合并回账号 API Key，避免重新生成 default 记录。
      db.update(schema.accounts).set({ apiToken: row.token, updatedAt: now }).where(eq(schema.accounts.id, accountId)).run();
      continue;
    }
    const existing = db.select().from(schema.accountTokens).where(eq(schema.accountTokens.accountId, accountId)).all().find((item) => item.name === row.name);
    if (existing) {
      db.update(schema.accountTokens)
        .set({
          token: row.token,
          valueStatus: row.valueStatus,
          source: row.source,
          localNameLocked: row.localNameLocked,
          localStatusLocked: row.localStatusLocked,
          updatedAt: now
        })
        .where(eq(schema.accountTokens.id, existing.id))
        .run();
      tokenIdMap.set(row.id, existing.id);
      summary.updated += 1;
    } else {
      const inserted = db.insert(schema.accountTokens).values({ ...withoutId(row), accountId }).returning().get();
      tokenIdMap.set(row.id, inserted.id);
      summary.created += 1;
    }
    summary.importedTokens += 1;
  }
}

function importModelAvailability(rowsToImport: ModelAvailabilityRow[], accountIdMap: Map<number, number>, summary: ImportSummary, warnings: string[]): void {
  for (const row of rowsToImport) {
    const accountId = accountIdMap.get(row.accountId);
    if (!accountId) {
      skip(warnings, summary, `Model availability skipped, missing account #${row.accountId}`);
      continue;
    }
    const existing = db.select().from(schema.modelAvailability).where(and(eq(schema.modelAvailability.accountId, accountId), eq(schema.modelAvailability.modelName, row.modelName))).get();
    if (existing) {
      db.update(schema.modelAvailability)
        .set({
          available: row.available,
          isManual: row.isManual,
          latencyMs: row.latencyMs,
          contextLength: row.contextLength,
          checkedAt: row.checkedAt
        })
        .where(eq(schema.modelAvailability.id, existing.id))
        .run();
      summary.updated += 1;
    } else {
      db.insert(schema.modelAvailability).values({ ...withoutId(row), accountId }).run();
      summary.created += 1;
    }
  }
}

function importTokenModelAvailability(rowsToImport: TokenModelAvailabilityRow[], tokenIdMap: Map<number, number>, summary: ImportSummary, warnings: string[]): void {
  for (const row of rowsToImport) {
    const tokenId = tokenIdMap.get(row.tokenId);
    if (!tokenId) {
      skip(warnings, summary, `Token model availability skipped, missing token #${row.tokenId}`);
      continue;
    }
    const existing = db.select().from(schema.tokenModelAvailability).where(and(eq(schema.tokenModelAvailability.tokenId, tokenId), eq(schema.tokenModelAvailability.modelName, row.modelName))).get();
    if (existing) {
      db.update(schema.tokenModelAvailability)
        .set({
          available: row.available,
          latencyMs: row.latencyMs,
          contextLength: row.contextLength,
          checkedAt: row.checkedAt
        })
        .where(eq(schema.tokenModelAvailability.id, existing.id))
        .run();
      summary.updated += 1;
    } else {
      db.insert(schema.tokenModelAvailability).values({ ...withoutId(row), tokenId }).run();
      summary.created += 1;
    }
  }
}

function importTokenRoutes(rowsToImport: TokenRouteRow[], routeIdMap: Map<number, number>, summary: ImportSummary): void {
  const now = nowIso();
  for (const row of rowsToImport) {
    const existing = db.select().from(schema.tokenRoutes).all().find((item) => (
      item.modelPattern === row.modelPattern && item.routeMode === row.routeMode
    ));
    if (existing) {
      if (!existing.manualOverride) {
        db.update(schema.tokenRoutes)
          .set({
            displayName: row.displayName,
            modelMapping: row.modelMapping,
            routingStrategy: row.routingStrategy,
            enabled: row.enabled,
            updatedAt: now
          })
          .where(eq(schema.tokenRoutes.id, existing.id))
          .run();
        summary.updated += 1;
      }
      routeIdMap.set(row.id, existing.id);
    } else {
      const inserted = db.insert(schema.tokenRoutes).values(withoutId(row)).returning().get();
      routeIdMap.set(row.id, inserted.id);
      summary.created += 1;
    }
    summary.importedRoutes += 1;
  }
}

function importRouteChannels(
  rowsToImport: RouteChannelRow[],
  routeIdMap: Map<number, number>,
  accountIdMap: Map<number, number>,
  tokenIdMap: Map<number, number>,
  channelIdMap: Map<number, number>,
  summary: ImportSummary,
  warnings: string[]
): void {
  for (const row of rowsToImport) {
    const routeId = routeIdMap.get(row.routeId);
    const accountId = accountIdMap.get(row.accountId);
    const tokenId = row.tokenId === null ? null : tokenIdMap.get(row.tokenId);
    if (!routeId || !accountId || tokenId === undefined) {
      skip(warnings, summary, `Route channel skipped, missing relation route=${row.routeId} account=${row.accountId} token=${row.tokenId ?? 'account'}`);
      continue;
    }
    const existing = db.select().from(schema.routeChannels).where(eq(schema.routeChannels.routeId, routeId)).all().find((item) => (
      item.accountId === accountId
      && item.tokenId === tokenId
      && sameNullable(item.sourceModel, row.sourceModel)
    ));
    if (existing) {
      channelIdMap.set(row.id, existing.id);
      summary.updated += 1;
    } else {
      const inserted = db.insert(schema.routeChannels).values({ ...withoutId(row), routeId, accountId, tokenId }).returning().get();
      channelIdMap.set(row.id, inserted.id);
      summary.created += 1;
    }
  }
}

function importDownstreamKeys(
  rowsToImport: DownstreamKeyRow[],
  input: {
    accountIdMap: Map<number, number>;
    tokenIdMap: Map<number, number>;
    routeIdMap: Map<number, number>;
    downstreamKeyIdMap: Map<number, number>;
    summary: ImportSummary;
    warnings: string[];
  }
): void {
  for (const row of rowsToImport) {
    const existing = db.select().from(schema.downstreamApiKeys).where(eq(schema.downstreamApiKeys.key, row.key)).get();
    if (existing) {
      input.downstreamKeyIdMap.set(row.id, existing.id);
      skip(input.warnings, input.summary, `Downstream key skipped, key already exists: ${row.name}`);
      continue;
    }
    const inserted = db.insert(schema.downstreamApiKeys)
      .values({
        ...withoutId(row),
        allowedRouteIds: stringifyJson(remapNumberArray(row.allowedRouteIds, input.routeIdMap)),
        allowedCredentialRefs: stringifyJson(remapCredentialRefs(row.allowedCredentialRefs, input)),
        excludedCredentialRefs: stringifyJson(remapCredentialRefs(row.excludedCredentialRefs, input))
      })
      .returning()
      .get();
    input.downstreamKeyIdMap.set(row.id, inserted.id);
    input.summary.created += 1;
    input.summary.importedDownstreamKeys += 1;
  }
}

function importProxyFiles(
  rowsToImport: ProxyFileRow[],
  downstreamKeyIdMap: Map<number, number>,
  summary: ImportSummary,
  warnings: string[]
): void {
  const now = nowIso();
  for (const row of rowsToImport) {
    const owner = remapProxyFileOwner(row, downstreamKeyIdMap);
    if (!owner) {
      skip(warnings, summary, `Proxy file skipped, missing owner: ${row.publicId}`);
      continue;
    }
    const existing = db.select().from(schema.proxyFiles).where(eq(schema.proxyFiles.publicId, row.publicId)).get();
    const values = {
      ...withoutId(row),
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      updatedAt: row.updatedAt || now
    };
    if (existing) {
      db.update(schema.proxyFiles)
        .set(values)
        .where(eq(schema.proxyFiles.id, existing.id))
        .run();
      summary.updated += 1;
    } else {
      db.insert(schema.proxyFiles).values(values).run();
      summary.created += 1;
    }
    summary.importedProxyFiles += 1;
  }
}

function remapProxyFileOwner(row: ProxyFileRow, downstreamKeyIdMap: Map<number, number>): ProxyResourceOwner | null {
  if (row.ownerType === 'global_proxy_token') {
    return { ownerType: 'global_proxy_token', ownerId: 'global' };
  }
  if (row.ownerType === 'managed_key') {
    // 文件 owner 绑定导入后的下游 Key ID，避免恢复后越权访问旧 ID 的文件。
    const nextId = downstreamKeyIdMap.get(Number(row.ownerId));
    return nextId ? { ownerType: 'managed_key', ownerId: String(nextId) } : null;
  }
  return null;
}

function importProxyVideoTasks(
  rowsToImport: ProxyVideoTaskRow[],
  accountIdMap: Map<number, number>,
  tokenIdMap: Map<number, number>,
  channelIdMap: Map<number, number>,
  summary: ImportSummary,
  warnings: string[]
): void {
  const now = nowIso();
  for (const row of rowsToImport) {
    const tokenRef = remapProxyVideoTokenRef(row.tokenRef, accountIdMap, tokenIdMap);
    if (!tokenRef) {
      skip(warnings, summary, `Proxy video task skipped, missing token ref: ${row.publicId}`);
      continue;
    }
    const existing = db.select().from(schema.proxyVideoTasks).where(eq(schema.proxyVideoTasks.publicId, row.publicId)).get();
    const values = {
      ...withoutId(row),
      tokenRef,
      accountId: row.accountId ? accountIdMap.get(row.accountId) ?? null : null,
      channelId: row.channelId ? channelIdMap.get(row.channelId) ?? null : null,
      updatedAt: row.updatedAt || now
    };
    if (existing) {
      db.update(schema.proxyVideoTasks)
        .set(values)
        .where(eq(schema.proxyVideoTasks.id, existing.id))
        .run();
      summary.updated += 1;
    } else {
      db.insert(schema.proxyVideoTasks).values(values).run();
      summary.created += 1;
    }
    summary.importedProxyVideoTasks += 1;
  }
}

function remapProxyVideoTokenRef(
  tokenRef: string,
  accountIdMap: Map<number, number>,
  tokenIdMap: Map<number, number>
): string | null {
  const [kind, rawId] = tokenRef.split(':', 2);
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (kind === 'account') {
    const nextId = accountIdMap.get(id);
    return nextId ? `account:${nextId}` : null;
  }
  if (kind === 'account_token') {
    const nextId = tokenIdMap.get(id);
    return nextId ? `account_token:${nextId}` : null;
  }
  return null;
}

function sectionObject(value: unknown, label: string, warnings: string[]): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  warnings.push(`${label} section missing or invalid`);
  return {};
}

function rows<T>(section: Record<string, unknown>, key: string, warnings: string[]): T[] {
  const value = section[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push(`${key} skipped: expected array`);
    return [];
  }
  return value as T[];
}

function withoutId<T extends { id: number }>(row: T): Omit<T, 'id'> {
  const { id: _id, ...rest } = row;
  return rest;
}

function compactMonitorSettings(value: z.infer<typeof monitorSettingsPayloadSchema>): Partial<MonitorSettings> {
  const output: Partial<MonitorSettings> = {};
  if (value.enabled !== undefined) output.enabled = value.enabled;
  if (value.intervalSec !== undefined) output.intervalSec = value.intervalSec;
  if (value.timeoutSec !== undefined) output.timeoutSec = value.timeoutSec;
  if (value.maxRetries !== undefined) output.maxRetries = value.maxRetries;
  if (value.concurrency !== undefined) output.concurrency = value.concurrency;
  if (value.retentionDays !== undefined) output.retentionDays = value.retentionDays;
  if (value.notifyOnDown !== undefined) output.notifyOnDown = value.notifyOnDown;
  if (value.notifyOnRecovery !== undefined) output.notifyOnRecovery = value.notifyOnRecovery;
  return output;
}

function sameNullable(left: string | null, right: string | null): boolean {
  return (left ?? null) === (right ?? null);
}

function skip(warnings: string[], summary: ImportSummary, message: string): void {
  warnings.push(message);
  summary.skipped += 1;
}

function remapNumberArray(value: string, idMap: Map<number, number>): number[] {
  return parseJsonArray<number>(value)
    .map((id) => idMap.get(id))
    .filter((id): id is number => typeof id === 'number');
}

function remapCredentialRefs(
  value: string,
  input: {
    accountIdMap: Map<number, number>;
    tokenIdMap: Map<number, number>;
  }
): CredentialRef[] {
  const refs = parseJsonArray<CredentialRef>(value);
  const output: CredentialRef[] = [];
  for (const ref of refs) {
    const accountId = input.accountIdMap.get(ref.accountId);
    if (!accountId) continue;
    if (ref.kind === 'account') {
      output.push({ kind: 'account', accountId });
      continue;
    }
    const tokenId = input.tokenIdMap.get(ref.tokenId);
    if (tokenId) output.push({ kind: 'account_token', accountId, tokenId });
  }
  return output;
}
