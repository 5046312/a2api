import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/index.js';
import { rebuildRoutes, rebuildRoutesIfNeeded } from '../../services/routeRefreshService.js';
import {
  getRouteDecisionSnapshot,
  listRouteDecisionSnapshots,
  listRouteGroupSources,
  refreshRouteDecisionSnapshot,
  replaceRouteGroupSources
} from '../../services/routeDecisionSnapshotService.js';
import { getDownstreamKeyPolicyById } from '../../services/downstreamKeyService.js';
import { clearTokenRouterCache, explainRouteDecision } from '../../services/tokenRouter.js';
import { sendError } from '../../shared/errors.js';
import { nowIso } from '../../shared/time.js';

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const channelParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  channelId: z.coerce.number().int().positive()
});
const routingStrategySchema = z.enum(['weighted', 'stable_first']);

export async function tokenRoutesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/routes/rebuild', async () => rebuildRoutes({ preserveManual: true }));

  app.get('/api/routes/snapshots', async (request) => {
    const query = z.object({ limit: z.coerce.number().int().optional() }).parse(request.query);
    return listRouteDecisionSnapshots(query.limit);
  });

  app.get('/api/routes/lite', async () => {
    return db
      .select({
        id: schema.tokenRoutes.id,
        modelPattern: schema.tokenRoutes.modelPattern,
        displayName: schema.tokenRoutes.displayName,
        routeMode: schema.tokenRoutes.routeMode,
        modelMapping: schema.tokenRoutes.modelMapping,
        routingStrategy: schema.tokenRoutes.routingStrategy,
        enabled: schema.tokenRoutes.enabled,
        manualOverride: schema.tokenRoutes.manualOverride
      })
      .from(schema.tokenRoutes)
      .innerJoin(schema.routeChannels, eq(schema.routeChannels.routeId, schema.tokenRoutes.id))
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.routeChannels.accountId))
      .where(enabledModelChannelFilter())
      .groupBy(schema.tokenRoutes.id)
      .orderBy(desc(schema.tokenRoutes.id))
      .all();
  });

  app.get('/api/routes/summary', async () => {
    const routes = await db
      .select({
        id: schema.tokenRoutes.id,
        modelPattern: schema.tokenRoutes.modelPattern,
        displayName: schema.tokenRoutes.displayName,
        routeMode: schema.tokenRoutes.routeMode,
        modelMapping: schema.tokenRoutes.modelMapping,
        routingStrategy: schema.tokenRoutes.routingStrategy,
        enabled: schema.tokenRoutes.enabled,
        manualOverride: schema.tokenRoutes.manualOverride
      })
      .from(schema.tokenRoutes)
      .innerJoin(schema.routeChannels, eq(schema.routeChannels.routeId, schema.tokenRoutes.id))
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.routeChannels.accountId))
      .where(enabledModelChannelFilter())
      .groupBy(schema.tokenRoutes.id)
      .orderBy(desc(schema.tokenRoutes.id))
      .all();
    const channels = await db
      .select({
        routeId: schema.routeChannels.routeId,
        enabled: schema.routeChannels.enabled,
        accountName: schema.accounts.username,
        upstreamUrl: schema.accounts.baseUrl
      })
      .from(schema.routeChannels)
      .innerJoin(schema.tokenRoutes, eq(schema.tokenRoutes.id, schema.routeChannels.routeId))
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.routeChannels.accountId))
      .where(enabledModelChannelFilter())
      .all();
    const summaryByRoute = new Map<number, { channelCount: number; enabledChannelCount: number; accountNames: Set<string> }>();

    for (const channel of channels) {
      const summary = summaryByRoute.get(channel.routeId) || { channelCount: 0, enabledChannelCount: 0, accountNames: new Set<string>() };
      summary.channelCount += 1;
      if (channel.enabled) summary.enabledChannelCount += 1;
      summary.accountNames.add(channel.accountName || channel.upstreamUrl);
      summaryByRoute.set(channel.routeId, summary);
    }

    return routes.map((route) => {
      const summary = summaryByRoute.get(route.id);
      return {
        ...route,
        channelCount: summary?.channelCount || 0,
        enabledChannelCount: summary?.enabledChannelCount || 0,
        accountNames: summary ? [...summary.accountNames] : []
      };
    });
  });

  app.get('/api/routes', async () => {
    await rebuildRoutesIfNeeded();
    const rows = await db
      .select({
        id: schema.tokenRoutes.id,
        modelPattern: schema.tokenRoutes.modelPattern,
        displayName: schema.tokenRoutes.displayName,
        routeMode: schema.tokenRoutes.routeMode,
        routingStrategy: schema.tokenRoutes.routingStrategy,
        enabled: schema.tokenRoutes.enabled,
        manualOverride: schema.tokenRoutes.manualOverride,
        createdAt: schema.tokenRoutes.createdAt,
        updatedAt: schema.tokenRoutes.updatedAt,
        channelCount: sql<number>`count(${schema.routeChannels.id})`,
        successCount: sql<number>`coalesce(sum(${schema.routeChannels.successCount}), 0)`,
        failCount: sql<number>`coalesce(sum(${schema.routeChannels.failCount}), 0)`
      })
      .from(schema.tokenRoutes)
      .innerJoin(schema.routeChannels, eq(schema.routeChannels.routeId, schema.tokenRoutes.id))
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.routeChannels.accountId))
      .where(activeAccountAnyChannelFilter())
      .groupBy(schema.tokenRoutes.id)
      .orderBy(desc(schema.tokenRoutes.id))
      .all();
    return { items: rows, total: rows.length };
  });

  app.put('/api/routes/:id', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const parsed = z.object({
      enabled: z.boolean().optional(),
      routingStrategy: routingStrategySchema.optional()
    }).refine((value) => value.enabled !== undefined || value.routingStrategy !== undefined, {
      message: 'enabled or routingStrategy is required'
    }).safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const values: { enabled?: boolean; routingStrategy?: string; updatedAt: string } = { updatedAt: nowIso() };
    if (parsed.data.enabled !== undefined) values.enabled = parsed.data.enabled;
    if (parsed.data.routingStrategy !== undefined) values.routingStrategy = parsed.data.routingStrategy;
    const updated = await db
      .update(schema.tokenRoutes)
      .set(values)
      .where(eq(schema.tokenRoutes.id, params.id))
      .returning()
      .get();
    if (!updated) return sendError(reply, 404, 'validation_error', 'Model not found', 'route_not_found');
    clearTokenRouterCache();
    return updated;
  });

  app.get('/api/routes/:id/channels', async (request) => {
    const params = idParamsSchema.parse(request.params);
    const rows = await db
      .select({
        id: schema.routeChannels.id,
        routeId: schema.routeChannels.routeId,
        accountId: schema.routeChannels.accountId,
        sourceModel: schema.routeChannels.sourceModel,
        priority: schema.routeChannels.priority,
        weight: schema.routeChannels.weight,
        enabled: schema.routeChannels.enabled,
        successCount: schema.routeChannels.successCount,
        failCount: schema.routeChannels.failCount,
        cooldownUntil: schema.routeChannels.cooldownUntil,
        lastFailAt: schema.routeChannels.lastFailAt,
        accountName: schema.accounts.username,
        upstreamUrl: schema.accounts.baseUrl,
        platform: schema.accounts.platform
      })
      .from(schema.routeChannels)
      .innerJoin(schema.tokenRoutes, eq(schema.tokenRoutes.id, schema.routeChannels.routeId))
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.routeChannels.accountId))
      .where(and(eq(schema.routeChannels.routeId, params.id), activeAccountAnyChannelFilter()))
      .orderBy(schema.routeChannels.priority, desc(schema.routeChannels.weight))
      .all();
    const channelIds = rows.map((row) => row.id);
    // 失败详情存在事件表，通道列表只取每个通道最近一次冷却事件。
    const failureEvents =
      channelIds.length > 0
        ? await db
            .select({
              relatedId: schema.events.relatedId,
              message: schema.events.message
            })
            .from(schema.events)
            .where(and(eq(schema.events.relatedType, 'route_channel'), inArray(schema.events.relatedId, channelIds)))
            .orderBy(desc(schema.events.createdAt), desc(schema.events.id))
            .all()
        : [];
    const latestFailureByChannel = new Map<number, string | null>();
    for (const event of failureEvents) {
      if (event.relatedId && !latestFailureByChannel.has(event.relatedId)) {
        latestFailureByChannel.set(event.relatedId, event.message);
      }
    }
    const items = rows.map((row) => ({
      ...row,
      lastFailureReason: latestFailureByChannel.get(row.id) ?? null
    }));
    return { items, total: items.length };
  });

  app.put('/api/routes/:id/channels/:channelId', async (request, reply) => {
    const params = channelParamsSchema.parse(request.params);
    const parsed = z.object({
      priority: z.number().int().min(0).optional(),
      weight: z.number().int().min(1).optional(),
      enabled: z.boolean().optional()
    }).refine((value) => value.priority !== undefined || value.weight !== undefined || value.enabled !== undefined, {
      message: 'priority, weight or enabled is required'
    }).safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const values: { priority?: number; weight?: number; enabled?: boolean } = {};
    if (parsed.data.priority !== undefined) values.priority = parsed.data.priority;
    if (parsed.data.weight !== undefined) values.weight = parsed.data.weight;
    if (parsed.data.enabled !== undefined) values.enabled = parsed.data.enabled;
    const updated = await db
      .update(schema.routeChannels)
      .set(values)
      .where(and(
        eq(schema.routeChannels.id, params.channelId),
        eq(schema.routeChannels.routeId, params.id),
        isNull(schema.routeChannels.tokenId)
      ))
      .returning()
      .get();
    if (!updated) return sendError(reply, 404, 'validation_error', 'Channel not found', 'route_channel_not_found');
    clearTokenRouterCache();
    return updated;
  });

  app.get('/api/routes/:id/decision', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const query = z.object({
      model: z.string().trim().min(1),
      downstreamApiKeyId: z.coerce.number().int().positive().optional(),
      forcedChannelId: z.coerce.number().int().positive().optional()
    }).safeParse(request.query);
    if (!query.success) return sendError(reply, 400, 'validation_error', 'model is required', 'missing_model');
    if (query.data.downstreamApiKeyId) {
      const keyResult = await getDownstreamKeyPolicyById(query.data.downstreamApiKeyId);
      if (!keyResult.ok) return sendError(reply, keyResult.statusCode, 'auth_error', keyResult.error, keyResult.code);
      return explainRouteDecision(params.id, query.data.model, keyResult.policy, [], {
        forcedChannelId: query.data.forcedChannelId ?? null
      });
    }
    return explainRouteDecision(params.id, query.data.model, undefined, [], {
      forcedChannelId: query.data.forcedChannelId ?? null
    });
  });

  app.get('/api/routes/:id/snapshot', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const snapshot = await getRouteDecisionSnapshot(params.id);
    if (!snapshot) return sendError(reply, 404, 'validation_error', 'Model snapshot not found', 'route_snapshot_not_found');
    return snapshot;
  });

  app.post('/api/routes/:id/snapshot/refresh', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const parsed = z.object({ model: z.string().trim().optional() }).safeParse(request.body ?? {});
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const snapshot = await refreshRouteDecisionSnapshot(params.id, parsed.data.model);
    if (!snapshot) return sendError(reply, 404, 'validation_error', 'Model not found', 'route_not_found');
    return snapshot;
  });

  app.get('/api/routes/:id/group-sources', async (request) => {
    const params = idParamsSchema.parse(request.params);
    return listRouteGroupSources(params.id);
  });

  app.put('/api/routes/:id/group-sources', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const parsed = z.object({ sourceRouteIds: z.array(z.coerce.number().int().positive()).default([]) }).safeParse(request.body ?? {});
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const result = await replaceRouteGroupSources(params.id, parsed.data.sourceRouteIds);
    if (!result) return sendError(reply, 404, 'validation_error', 'Model not found', 'route_not_found');
    return result;
  });

  app.post('/api/routes/:id/cooldown/clear', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const result = await db
      .update(schema.routeChannels)
      .set({ cooldownUntil: null, cooldownLevel: 0, consecutiveFailCount: 0 })
      .where(eq(schema.routeChannels.routeId, params.id))
      .run();
    if (result.changes === 0) return sendError(reply, 404, 'validation_error', 'Model not found', 'route_not_found');
    clearTokenRouterCache();
    return { ok: true, cleared: result.changes };
  });
}

function enabledModelChannelFilter() {
  // 客户端选择器只返回可参与转发的启用模型。
  return and(
    eq(schema.tokenRoutes.enabled, true),
    activeAccountChannelFilter()
  );
}

function activeAccountChannelFilter() {
  // 模型停用后仍保留在管理列表；实际转发由 token_routes.enabled 控制。
  return and(
    eq(schema.routeChannels.enabled, true),
    activeAccountAnyChannelFilter()
  );
}

function activeAccountAnyChannelFilter() {
  // 通道抽屉需要展示停用通道，便于重新启用。
  return and(
    eq(schema.accounts.status, 'active'),
    isNull(schema.routeChannels.tokenId)
  );
}
