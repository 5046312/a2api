import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema, sqlite } from '../db/index.js';
import { stringifyJson, parseJsonObject } from '../shared/json.js';
import { nowIso } from '../shared/time.js';
import { explainRouteDecision } from './tokenRouter.js';

export async function listRouteDecisionSnapshots(limit = 100) {
  const rows = await db
    .select()
    .from(schema.routeDecisionSnapshots)
    .orderBy(desc(schema.routeDecisionSnapshots.refreshedAt))
    .limit(Math.min(200, Math.max(1, limit)))
    .all();
  return {
    items: rows.map((row) => ({
      ...row,
      snapshot: parseJsonObject(row.snapshotJson)
    }))
  };
}

export async function getRouteDecisionSnapshot(routeId: number) {
  const row = await db.select().from(schema.routeDecisionSnapshots).where(eq(schema.routeDecisionSnapshots.routeId, routeId)).get();
  if (!row) return null;
  return {
    ...row,
    snapshot: parseJsonObject(row.snapshotJson)
  };
}

export async function refreshRouteDecisionSnapshot(routeId: number, requestedModel?: string | undefined) {
  const route = await db.select().from(schema.tokenRoutes).where(eq(schema.tokenRoutes.id, routeId)).get();
  if (!route) return null;
  const model = requestedModel?.trim() || route.displayName || route.modelPattern;
  const snapshot = await explainRouteDecision(routeId, model);
  const refreshedAt = nowIso();
  const payload = stringifyJson(snapshot);
  const row = await db
    .insert(schema.routeDecisionSnapshots)
    .values({
      routeId,
      requestedModel: model,
      snapshotJson: payload,
      refreshedAt
    })
    .onConflictDoUpdate({
      target: schema.routeDecisionSnapshots.routeId,
      set: {
        requestedModel: model,
        snapshotJson: payload,
        refreshedAt
      }
    })
    .returning()
    .get();
  return {
    ...row,
    snapshot
  };
}

export async function listRouteGroupSources(groupRouteId: number) {
  const rows = await db
    .select({
      id: schema.routeGroupSources.id,
      groupRouteId: schema.routeGroupSources.groupRouteId,
      sourceRouteId: schema.routeGroupSources.sourceRouteId,
      createdAt: schema.routeGroupSources.createdAt,
      modelPattern: schema.tokenRoutes.modelPattern,
      displayName: schema.tokenRoutes.displayName,
      enabled: schema.tokenRoutes.enabled
    })
    .from(schema.routeGroupSources)
    .innerJoin(schema.tokenRoutes, eq(schema.tokenRoutes.id, schema.routeGroupSources.sourceRouteId))
    .where(eq(schema.routeGroupSources.groupRouteId, groupRouteId))
    .orderBy(schema.routeGroupSources.id)
    .all();
  return { items: rows, total: rows.length };
}

export async function replaceRouteGroupSources(groupRouteId: number, sourceRouteIds: number[]) {
  const uniqueIds = Array.from(new Set(sourceRouteIds.filter((id) => Number.isInteger(id) && id > 0 && id !== groupRouteId)));
  const groupRoute = await db.select().from(schema.tokenRoutes).where(eq(schema.tokenRoutes.id, groupRouteId)).get();
  if (!groupRoute) return null;
  const existingSources = uniqueIds.length > 0
    ? await db.select({ id: schema.tokenRoutes.id }).from(schema.tokenRoutes).where(inArray(schema.tokenRoutes.id, uniqueIds)).all()
    : [];
  const validSourceIds = new Set(existingSources.map((row) => row.id));
  const now = nowIso();

  sqlite.transaction(() => {
    db.delete(schema.routeGroupSources).where(eq(schema.routeGroupSources.groupRouteId, groupRouteId)).run();
    for (const sourceRouteId of validSourceIds) {
      db.insert(schema.routeGroupSources)
        .values({ groupRouteId, sourceRouteId, createdAt: now })
        .run();
    }
    db.update(schema.tokenRoutes)
      .set({ routeMode: 'explicit_group', manualOverride: true, updatedAt: now })
      .where(and(eq(schema.tokenRoutes.id, groupRouteId), eq(schema.tokenRoutes.manualOverride, true)))
      .run();
  })();

  return {
    groupRouteId,
    requestedSourceRouteIds: uniqueIds,
    savedSourceRouteIds: [...validSourceIds],
    skippedSourceRouteIds: uniqueIds.filter((id) => !validSourceIds.has(id))
  };
}
