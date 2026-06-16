import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/index.js';
import { sendError } from '../../shared/errors.js';
import { optionalBooleanQuery } from '../../shared/query.js';

const listQuerySchema = z.object({
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional(),
  type: z.string().optional(),
  level: z.string().optional(),
  read: optionalBooleanQuery,
  from: z.string().optional(),
  to: z.string().optional()
});

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/events', async (request) => {
    const query = listQuerySchema.parse(request.query);
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize || 50));
    const filters: SQL[] = [];

    if (query.type) filters.push(eq(schema.events.type, query.type));
    if (query.level) filters.push(eq(schema.events.level, query.level));
    if (typeof query.read === 'boolean') filters.push(eq(schema.events.read, query.read));
    if (query.from) filters.push(gte(schema.events.createdAt, query.from));
    if (query.to) filters.push(lte(schema.events.createdAt, query.to));

    const where = filters.length > 0 ? and(...filters) : undefined;
    const items = await db
      .select()
      .from(schema.events)
      .where(where)
      .orderBy(desc(schema.events.createdAt), desc(schema.events.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all();
    const totalRow = await db.select({ count: sql<number>`count(*)` }).from(schema.events).where(where).get();

    return { items, total: Number(totalRow?.count || 0), page, pageSize };
  });

  app.get('/api/events/count', async () => {
    const row = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.events)
      .where(eq(schema.events.read, false))
      .get();
    return { count: Number(row?.count || 0) };
  });

  app.post('/api/events/:id/read', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const result = await db.update(schema.events).set({ read: true }).where(eq(schema.events.id, params.id)).run();
    if (result.changes === 0) return sendError(reply, 404, 'validation_error', 'Event not found', 'event_not_found');
    return { ok: true };
  });

  app.post('/api/events/read-all', async () => {
    const result = await db.update(schema.events).set({ read: true }).where(eq(schema.events.read, false)).run();
    return { ok: true, updated: result.changes };
  });

  app.delete('/api/events', async () => {
    const result = await db.delete(schema.events).run();
    return { ok: true, deleted: result.changes };
  });
}
