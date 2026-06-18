import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getModelUsageStats, getStatsMarketplace, getStatsOverview, getUpstreamUsageStats } from '../../services/statsService.js';

const rangeSchema = z.enum(['24h', '7d', '30d']).optional().default('7d');

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/stats/overview', async () => getStatsOverview());

  app.get('/api/stats/upstream-usage', async (request) => {
    const query = z.object({
      range: rangeSchema,
      bucket: z.enum(['hour', 'day']).optional().default('day'),
      accountId: z.coerce.number().int().positive().optional()
    }).parse(request.query);
    return { items: await getUpstreamUsageStats(query) };
  });

  app.get('/api/stats/model-usage', async (request) => {
    const query = z.object({
      range: rangeSchema,
      model: z.string().trim().optional(),
      accountId: z.coerce.number().int().positive().optional()
    }).parse(request.query);
    return { items: await getModelUsageStats(query) };
  });

  app.get('/api/stats/marketplace', async () => ({ items: await getStatsMarketplace() }));
}
