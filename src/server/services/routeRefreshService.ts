import { and, eq, inArray, isNull } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { isModelDisabled } from '../shared/modelMatch.js';
import { nowIso } from '../shared/time.js';
import { clearTokenRouterCache } from './tokenRouter.js';

export type RouteRebuildResult = {
  routesCreated: number;
  routesUpdated: number;
  channelsCreated: number;
  channelsUpdated: number;
  channelsRemoved: number;
};

type DesiredChannel = {
  routeId: number;
  accountId: number;
  tokenId: number | null;
  sourceModel: string;
};

export async function rebuildRoutes(_options: { preserveManual?: boolean } = {}): Promise<RouteRebuildResult> {
  const availabilityRows = await db
    .select({
      modelName: schema.modelAvailability.modelName,
      accountId: schema.modelAvailability.accountId,
      siteId: schema.sites.id,
      accountStatus: schema.accounts.status,
      siteStatus: schema.sites.status
    })
    .from(schema.modelAvailability)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.modelAvailability.accountId))
    .innerJoin(schema.sites, eq(schema.sites.id, schema.accounts.siteId))
    .where(and(eq(schema.modelAvailability.available, true), eq(schema.accounts.status, 'active'), eq(schema.sites.status, 'active')))
    .all();
  const disabledBySiteId = await loadDisabledModelsBySiteId();
  // 禁用模型不生成自动通道；手工通道也会在 tokenRouter 运行时二次拦截。
  const usableAvailabilityRows = availabilityRows.filter((row) => !isModelDisabled(row.modelName, disabledBySiteId.get(row.siteId) || []));

  const now = nowIso();
  let routesCreated = 0;
  let routesUpdated = 0;
  let channelsCreated = 0;
  let channelsUpdated = 0;

  const routeByModel = new Map<string, number>();
  for (const row of usableAvailabilityRows) {
    if (routeByModel.has(row.modelName)) continue;
    const existing = await db
      .select()
      .from(schema.tokenRoutes)
      .where(and(eq(schema.tokenRoutes.modelPattern, row.modelName), eq(schema.tokenRoutes.manualOverride, false)))
      .get();
    if (existing) {
      await db
        .update(schema.tokenRoutes)
        .set({ displayName: row.modelName, updatedAt: now })
        .where(eq(schema.tokenRoutes.id, existing.id))
        .run();
      routeByModel.set(row.modelName, existing.id);
      routesUpdated += 1;
    } else {
      const inserted = await db
        .insert(schema.tokenRoutes)
        .values({
          modelPattern: row.modelName,
          displayName: row.modelName,
          routeMode: 'exact',
          // 自动模型初始策略跟随系统默认值，单个模型后续可在模型页单独覆盖。
          routingStrategy: config.defaultRoutingStrategy,
          enabled: true,
          manualOverride: false,
          createdAt: now,
          updatedAt: now
        })
        .returning()
        .get();
      routeByModel.set(row.modelName, inserted.id);
      routesCreated += 1;
    }
  }

  const desired: DesiredChannel[] = [];
  for (const row of usableAvailabilityRows) {
    const routeId = routeByModel.get(row.modelName);
    if (!routeId) continue;
    desired.push({ routeId, accountId: row.accountId, tokenId: null, sourceModel: row.modelName });
  }

  const desiredKeys = new Set<string>();
  for (const item of desired) {
    const key = channelKey(item);
    desiredKeys.add(key);
    const existing = await findAutoChannel(item);
    if (existing) {
      await db
        .update(schema.routeChannels)
        .set({ sourceModel: item.sourceModel })
        .where(eq(schema.routeChannels.id, existing.id))
        .run();
      channelsUpdated += 1;
    } else {
      const inserted = await db
        .insert(schema.routeChannels)
        .values({
          routeId: item.routeId,
          accountId: item.accountId,
          tokenId: item.tokenId,
          sourceModel: item.sourceModel,
          enabled: true,
          manualOverride: false
        })
        .returning()
        .get();
      channelsCreated += 1;
    }
  }

  const autoChannels = await db.select().from(schema.routeChannels).where(eq(schema.routeChannels.manualOverride, false)).all();
  const staleIds = autoChannels
    .filter((channel) => !desiredKeys.has(channelKey(channel)))
    .map((channel) => channel.id);
  if (staleIds.length > 0) {
    await db.delete(schema.routeChannels).where(inArray(schema.routeChannels.id, staleIds)).run();
  }

  clearTokenRouterCache();
  return { routesCreated, routesUpdated, channelsCreated, channelsUpdated, channelsRemoved: staleIds.length };
}

async function loadDisabledModelsBySiteId(): Promise<Map<number, string[]>> {
  const rows = await db.select().from(schema.siteDisabledModels).all();
  const output = new Map<number, string[]>();
  for (const row of rows) {
    const current = output.get(row.siteId) || [];
    current.push(row.modelName);
    output.set(row.siteId, current);
  }
  return output;
}

async function findAutoChannel(item: DesiredChannel) {
  const filters = [
    eq(schema.routeChannels.routeId, item.routeId),
    eq(schema.routeChannels.accountId, item.accountId),
    eq(schema.routeChannels.manualOverride, false),
    eq(schema.routeChannels.sourceModel, item.sourceModel)
  ];
  if (item.tokenId === null) {
    filters.push(isNull(schema.routeChannels.tokenId));
  } else {
    filters.push(eq(schema.routeChannels.tokenId, item.tokenId));
  }
  return db.select().from(schema.routeChannels).where(and(...filters)).get();
}

function channelKey(item: { routeId: number; accountId: number; tokenId: number | null; sourceModel: string | null }): string {
  return `${item.routeId}:${item.accountId}:${item.tokenId ?? 'account'}:${item.sourceModel || ''}`;
}
