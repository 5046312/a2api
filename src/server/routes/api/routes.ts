import type { FastifyInstance } from 'fastify';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/index.js';
import { rebuildRoutes } from '../../services/routeRefreshService.js';
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
      .orderBy(desc(schema.tokenRoutes.id))
      .all();
    const channels = await db
      .select({
        routeId: schema.routeChannels.routeId,
        enabled: schema.routeChannels.enabled,
        siteName: schema.sites.name
      })
      .from(schema.routeChannels)
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.routeChannels.accountId))
      .innerJoin(schema.sites, eq(schema.sites.id, schema.accounts.siteId))
      .all();
    const summaryByRoute = new Map<number, { channelCount: number; enabledChannelCount: number; siteNames: Set<string> }>();

    for (const channel of channels) {
      const summary = summaryByRoute.get(channel.routeId) || { channelCount: 0, enabledChannelCount: 0, siteNames: new Set<string>() };
      summary.channelCount += 1;
      if (channel.enabled) summary.enabledChannelCount += 1;
      summary.siteNames.add(channel.siteName);
      summaryByRoute.set(channel.routeId, summary);
    }

    return routes.map((route) => {
      const summary = summaryByRoute.get(route.id);
      return {
        ...route,
        channelCount: summary?.channelCount || 0,
        enabledChannelCount: summary?.enabledChannelCount || 0,
        siteNames: summary ? [...summary.siteNames] : []
      };
    });
  });

  app.get('/api/routes', async () => {
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
      .leftJoin(schema.routeChannels, eq(schema.routeChannels.routeId, schema.tokenRoutes.id))
      .groupBy(schema.tokenRoutes.id)
      .orderBy(desc(schema.tokenRoutes.id))
      .all();
    return { items: rows, total: rows.length };
  });

  app.put('/api/routes/:id', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const updated = await db
      .update(schema.tokenRoutes)
      .set({ enabled: parsed.data.enabled, updatedAt: nowIso() })
      .where(eq(schema.tokenRoutes.id, params.id))
      .returning()
      .get();
    if (!updated) return sendError(reply, 404, 'validation_error', 'Route not found', 'route_not_found');
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
        tokenId: schema.routeChannels.tokenId,
        sourceModel: schema.routeChannels.sourceModel,
        priority: schema.routeChannels.priority,
        weight: schema.routeChannels.weight,
        enabled: schema.routeChannels.enabled,
        successCount: schema.routeChannels.successCount,
        failCount: schema.routeChannels.failCount,
        cooldownUntil: schema.routeChannels.cooldownUntil,
        siteName: schema.sites.name,
        accountName: schema.accounts.username,
        tokenName: schema.accountTokens.name
      })
      .from(schema.routeChannels)
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.routeChannels.accountId))
      .innerJoin(schema.sites, eq(schema.sites.id, schema.accounts.siteId))
      .leftJoin(schema.accountTokens, eq(schema.accountTokens.id, schema.routeChannels.tokenId))
      .where(eq(schema.routeChannels.routeId, params.id))
      .orderBy(schema.routeChannels.priority, desc(schema.routeChannels.weight))
      .all();
    return { items: rows, total: rows.length };
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
    if (!snapshot) return sendError(reply, 404, 'validation_error', 'Route snapshot not found', 'route_snapshot_not_found');
    return snapshot;
  });

  app.post('/api/routes/:id/snapshot/refresh', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const parsed = z.object({ model: z.string().trim().optional() }).safeParse(request.body ?? {});
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const snapshot = await refreshRouteDecisionSnapshot(params.id, parsed.data.model);
    if (!snapshot) return sendError(reply, 404, 'validation_error', 'Route not found', 'route_not_found');
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
    if (!result) return sendError(reply, 404, 'validation_error', 'Route not found', 'route_not_found');
    return result;
  });

  app.post('/api/routes/:id/cooldown/clear', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const result = await db
      .update(schema.routeChannels)
      .set({ cooldownUntil: null, cooldownLevel: 0, consecutiveFailCount: 0 })
      .where(eq(schema.routeChannels.routeId, params.id))
      .run();
    if (result.changes === 0) return sendError(reply, 404, 'validation_error', 'Route not found', 'route_not_found');
    clearTokenRouterCache();
    return { ok: true, cleared: result.changes };
  });
}
