import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  clearSiteAnnouncements,
  dismissSiteAnnouncement,
  listSiteAnnouncements,
  markAllSiteAnnouncementsRead,
  markSiteAnnouncementRead
} from '../../services/siteAnnouncementService.js';
import { sendError } from '../../shared/errors.js';
import { compactObject } from '../../shared/object.js';
import { optionalBooleanQuery } from '../../shared/query.js';

const listQuerySchema = z.object({
  siteId: z.coerce.number().int().positive().optional(),
  level: z.enum(['info', 'warning', 'error']).optional(),
  unreadOnly: optionalBooleanQuery,
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional()
});

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export async function siteAnnouncementsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/site-announcements', async (request) => {
    const query = listQuerySchema.parse(request.query);
    return listSiteAnnouncements(compactObject(query));
  });

  app.post('/api/site-announcements/:id/read', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const updated = await markSiteAnnouncementRead(params.id);
    if (!updated) return sendError(reply, 404, 'validation_error', 'Site announcement not found', 'site_announcement_not_found');
    return { ok: true };
  });

  app.post('/api/site-announcements/read-all', async () => {
    const updated = await markAllSiteAnnouncementsRead();
    return { ok: true, updated };
  });

  app.post('/api/site-announcements/:id/dismiss', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const updated = await dismissSiteAnnouncement(params.id);
    if (!updated) return sendError(reply, 404, 'validation_error', 'Site announcement not found', 'site_announcement_not_found');
    return { ok: true };
  });

  app.delete('/api/site-announcements', async () => {
    const deleted = await clearSiteAnnouncements();
    return { ok: true, deleted };
  });
}
