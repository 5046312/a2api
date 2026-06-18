import { and, asc, eq } from 'drizzle-orm';
import { getAdapter, type UpstreamPlatform } from '../adapters/index.js';
import { db, schema } from '../db/index.js';
import { parseJsonObject } from '../shared/json.js';
import { nowIso } from '../shared/time.js';
import { resolveDefaultAccountCredential } from './accountTokenService.js';
import { getDefaultModelCostMap } from './modelCostService.js';
import { rebuildRoutes } from './routeRefreshService.js';

export type ModelRefreshResult = {
  accountId: number;
  created: number;
  updated: number;
  removed: number;
  routeRebuilt: boolean;
};

export type AccountModelsResult = {
  accountId: number;
  models: AccountModelItem[];
};

type DiscoveredAccountModel = {
  name: string;
  contextLength: number | null;
};

export type AccountModelItem = {
  model: string;
  unitCost: number | null;
};

export type AccountModelInput = string | AccountModelItem;

export type AccountModelsUpdateResult = AccountModelsResult & {
  created: number;
  updated: number;
  routeRebuilt: boolean;
};

export async function listAccountModels(accountId: number): Promise<AccountModelsResult> {
  await assertAccountExists(accountId);
  const rows = await db
    .select({ modelName: schema.modelAvailability.modelName, modelCost: schema.modelAvailability.modelCost })
    .from(schema.modelAvailability)
    .where(and(eq(schema.modelAvailability.accountId, accountId), eq(schema.modelAvailability.available, true)))
    .orderBy(asc(schema.modelAvailability.modelName))
    .all();
  return { accountId, models: rows.map((row) => ({ model: row.modelName, unitCost: row.modelCost })) };
}

export async function previewAccountModels(accountId: number): Promise<AccountModelsResult> {
  // 预览只返回可选择模型，不落库，确认保存由账号模型接口完成。
  const modelNames = normalizeModelNames(
    (await discoverAccountModels(accountId)).map((model) => model.name)
  );
  const defaultCostMap = getDefaultModelCostMap();
  return {
    accountId,
    models: modelNames.map((model) => ({
      model,
      unitCost: defaultCostMap.get(model.toLowerCase()) ?? null
    }))
  };
}

export async function updateAccountModels(accountId: number, models: AccountModelInput[]): Promise<AccountModelsUpdateResult> {
  await assertAccountExists(accountId);
  const normalizedModels = normalizeAccountModels(models);
  const now = nowIso();
  const existingRows = await db
    .select()
    .from(schema.modelAvailability)
    .where(eq(schema.modelAvailability.accountId, accountId))
    .all();
  const existingByModel = new Map(existingRows.map((row) => [row.modelName, row]));

  // 固定模型采用全量替换：未提交的模型立即下线，避免旧模型通道继续可用。
  await db
    .update(schema.modelAvailability)
    .set({ available: false, checkedAt: now })
    .where(eq(schema.modelAvailability.accountId, accountId))
    .run();

  let created = 0;
  let updated = 0;
  for (const model of normalizedModels) {
    const existing = existingByModel.get(model.model);
    if (existing) {
      await db
        .update(schema.modelAvailability)
        .set({ available: true, isManual: true, modelCost: model.unitCost, checkedAt: now })
        .where(eq(schema.modelAvailability.id, existing.id))
        .run();
      updated += 1;
    } else {
      await db
        .insert(schema.modelAvailability)
        .values({
          accountId,
          modelName: model.model,
          available: true,
          isManual: true,
          modelCost: model.unitCost,
          contextLength: null,
          checkedAt: now
        })
        .run();
      created += 1;
    }
  }

  await rebuildRoutes({ preserveManual: true });
  return { accountId, models: normalizedModels, created, updated, routeRebuilt: true };
}

export async function refreshAccountModels(accountId: number, options: { rebuild?: boolean } = {}): Promise<ModelRefreshResult> {
  const models = await discoverAccountModels(accountId);
  const account = await db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).get();
  if (!account) throw new Error('Account not found');
  let created = 0;
  let updated = 0;
  let removed = 0;
  const now = nowIso();
  const defaultCostMap = getDefaultModelCostMap();

  for (const model of models) {
    const existing = await db
      .select()
      .from(schema.modelAvailability)
      .where(and(eq(schema.modelAvailability.accountId, accountId), eq(schema.modelAvailability.modelName, model.name)))
      .get();
    if (existing) {
      await db
        .update(schema.modelAvailability)
        .set({
          available: true,
          contextLength: model.contextLength ?? existing.contextLength,
          checkedAt: now
        })
        .where(eq(schema.modelAvailability.id, existing.id))
        .run();
      updated += 1;
    } else {
      await db
        .insert(schema.modelAvailability)
        .values({
          accountId,
          modelName: model.name,
          available: true,
          modelCost: defaultCostMap.get(model.name.toLowerCase()) ?? null,
          contextLength: model.contextLength ?? null,
          checkedAt: now
        })
        .run();
      created += 1;
    }
  }

  const routeRebuilt = options.rebuild !== false;
  if (routeRebuilt) {
    await rebuildRoutes({ preserveManual: true });
  }

  return { accountId, created, updated, removed, routeRebuilt };
}

async function discoverAccountModels(accountId: number): Promise<DiscoveredAccountModel[]> {
  const account = await db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).get();
  if (!account) throw new Error('Account not found');

  const credential = await resolveDefaultAccountCredential(account.id, {
    apiToken: account.apiToken,
    accessToken: account.accessToken,
    includeAccessToken: true
  });
  const token = credential?.token || '';
  if (!token) throw new Error('Account has no usable token');

  const adapter = getAdapter(account.platform);
  const models = await adapter.getModels({
    accountId: account.id,
    baseUrl: account.baseUrl,
    platform: account.platform as UpstreamPlatform,
    proxyUrl: account.proxyUrl,
    customHeaders: parseJsonObject(account.customHeaders) as Record<string, string> | null,
    token,
    credentialMode: account.credentialMode === 'oauth' ? 'oauth' : 'apikey'
  });
  return models
    .map((model) => ({
      name: model.name,
      contextLength: model.contextLength ?? null
    }));
}

async function assertAccountExists(accountId: number): Promise<void> {
  const account = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.id, accountId)).get();
  if (!account) throw new Error('Account not found');
}

function normalizeModelNames(models: string[]): string[] {
  return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function normalizeAccountModels(models: AccountModelInput[]): AccountModelItem[] {
  const byName = new Map<string, AccountModelItem>();
  for (const item of models) {
    const model = typeof item === 'string' ? item.trim() : item.model.trim();
    if (!model) continue;
    byName.set(model.toLowerCase(), {
      model,
      unitCost: typeof item === 'string' ? null : normalizeUnitCost(item.unitCost)
    });
  }
  return Array.from(byName.values()).sort((left, right) => left.model.localeCompare(right.model));
}

function normalizeUnitCost(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 1_000_000) / 1_000_000;
}
