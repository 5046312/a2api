import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { nowIso } from '../shared/time.js';

export type SiteAnnouncementQuery = {
  siteId?: number | undefined;
  level?: string | undefined;
  unreadOnly?: boolean | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
};

export async function listSiteAnnouncements(query: SiteAnnouncementQuery) {
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize || 50));
  const filters: SQL[] = [isNull(schema.siteAnnouncements.dismissedAt)];

  if (query.siteId) filters.push(eq(schema.siteAnnouncements.siteId, query.siteId));
  if (query.level) filters.push(eq(schema.siteAnnouncements.level, query.level));
  if (query.unreadOnly) filters.push(isNull(schema.siteAnnouncements.readAt));

  const where = and(...filters);
  const items = await db
    .select({
      id: schema.siteAnnouncements.id,
      siteId: schema.siteAnnouncements.siteId,
      siteName: schema.sites.name,
      platform: schema.siteAnnouncements.platform,
      sourceKey: schema.siteAnnouncements.sourceKey,
      title: schema.siteAnnouncements.title,
      content: schema.siteAnnouncements.content,
      level: schema.siteAnnouncements.level,
      sourceUrl: schema.siteAnnouncements.sourceUrl,
      startsAt: schema.siteAnnouncements.startsAt,
      endsAt: schema.siteAnnouncements.endsAt,
      upstreamCreatedAt: schema.siteAnnouncements.upstreamCreatedAt,
      upstreamUpdatedAt: schema.siteAnnouncements.upstreamUpdatedAt,
      firstSeenAt: schema.siteAnnouncements.firstSeenAt,
      lastSeenAt: schema.siteAnnouncements.lastSeenAt,
      readAt: schema.siteAnnouncements.readAt,
      dismissedAt: schema.siteAnnouncements.dismissedAt
    })
    .from(schema.siteAnnouncements)
    .leftJoin(schema.sites, eq(schema.sites.id, schema.siteAnnouncements.siteId))
    .where(where)
    .orderBy(desc(schema.siteAnnouncements.firstSeenAt), desc(schema.siteAnnouncements.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();
  const totalRow = await db.select({ count: sql<number>`count(*)` }).from(schema.siteAnnouncements).where(where).get();

  return { items, total: Number(totalRow?.count || 0), page, pageSize };
}

export async function markSiteAnnouncementRead(id: number): Promise<boolean> {
  const result = await db
    .update(schema.siteAnnouncements)
    .set({ readAt: nowIso() })
    .where(eq(schema.siteAnnouncements.id, id))
    .run();
  return result.changes > 0;
}

export async function markAllSiteAnnouncementsRead(): Promise<number> {
  const result = await db
    .update(schema.siteAnnouncements)
    .set({ readAt: nowIso() })
    .where(isNull(schema.siteAnnouncements.readAt))
    .run();
  return result.changes;
}

export async function dismissSiteAnnouncement(id: number): Promise<boolean> {
  const result = await db
    .update(schema.siteAnnouncements)
    .set({ dismissedAt: nowIso() })
    .where(eq(schema.siteAnnouncements.id, id))
    .run();
  return result.changes > 0;
}

export async function clearSiteAnnouncements(): Promise<number> {
  const result = await db.delete(schema.siteAnnouncements).run();
  return result.changes;
}
