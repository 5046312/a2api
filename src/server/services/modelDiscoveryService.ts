import { and, eq } from 'drizzle-orm';
import { getAdapter, type SitePlatform } from '../adapters/index.js';
import { db, schema } from '../db/index.js';
import { parseJsonObject } from '../shared/json.js';
import { isModelDisabled } from '../shared/modelMatch.js';
import { nowIso } from '../shared/time.js';
import { rebuildRoutes } from './routeRefreshService.js';

export type ModelRefreshResult = {
  accountId: number;
  created: number;
  updated: number;
  removed: number;
  routeRebuilt: boolean;
};

export async function refreshAccountModels(accountId: number, options: { rebuild?: boolean } = {}): Promise<ModelRefreshResult> {
  const account = await db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).get();
  if (!account) throw new Error('Account not found');
  const site = await db.select().from(schema.sites).where(eq(schema.sites.id, account.siteId)).get();
  if (!site) throw new Error('Site not found');

  const defaultToken = await db
    .select()
    .from(schema.accountTokens)
    .where(and(eq(schema.accountTokens.accountId, account.id), eq(schema.accountTokens.enabled, true), eq(schema.accountTokens.isDefault, true)))
    .get();
  const token = defaultToken?.token || account.apiToken || account.accessToken || '';
  if (!token) throw new Error('Account has no usable token');

  const adapter = getAdapter(site.platform);
  const models = await adapter.getModels({
    siteId: site.id,
    baseUrl: site.url,
    platform: site.platform as SitePlatform,
    proxyUrl: accountProxyUrl(account.extraConfig) || site.proxyUrl,
    customHeaders: parseJsonObject(site.customHeaders) as Record<string, string> | null,
    token,
    credentialMode: account.credentialMode === 'oauth' ? 'oauth' : 'apikey'
  });

  let created = 0;
  let updated = 0;
  let removed = 0;
  const now = nowIso();
  const disabledModels = await db
    .select({ modelName: schema.siteDisabledModels.modelName })
    .from(schema.siteDisabledModels)
    .where(eq(schema.siteDisabledModels.siteId, site.id))
    .all();
  const disabledPatterns = disabledModels.map((row) => row.modelName);

  for (const model of models) {
    const existing = await db
      .select()
      .from(schema.modelAvailability)
      .where(and(eq(schema.modelAvailability.accountId, account.id), eq(schema.modelAvailability.modelName, model.name)))
      .get();
    // 站点禁用模型在发现阶段即标记不可用，避免后续路由误用旧数据。
    if (isModelDisabled(model.name, disabledPatterns)) {
      if (existing && existing.available) {
        await db
          .update(schema.modelAvailability)
          .set({ available: false, checkedAt: now })
          .where(eq(schema.modelAvailability.id, existing.id))
          .run();
        removed += 1;
      }
      continue;
    }
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
          accountId: account.id,
          modelName: model.name,
          available: true,
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

function accountProxyUrl(extraConfig: string | null): string | null {
  const parsed = parseJsonObject(extraConfig);
  const value = parsed?.proxyUrl;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
