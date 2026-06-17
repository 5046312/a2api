import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  checkAllMonitorAccounts,
  checkMonitorAccount,
  cleanupMonitorHeartbeats,
  getMonitorAccount,
  getMonitorOverview,
  getMonitorSettings,
  listMonitorAccounts,
  monitorAccountPatchSchema,
  monitorSettingsPayloadSchema,
  updateMonitorAccount,
  updateMonitorSettings
} from '../../services/accountMonitorService.js';
import { sendError } from '../../shared/errors.js';
import { compactObject } from '../../shared/object.js';

const idParamsSchema = z.object({ accountId: z.coerce.number().int().positive() });
const listQuerySchema = z.object({
  status: z.string().optional(),
  keyword: z.string().trim().optional(),
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional()
});

export async function monitorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/monitor/overview', async () => getMonitorOverview());

  app.get('/api/monitor/accounts', async (request) => {
    const query = compactObject(listQuerySchema.parse(request.query));
    return listMonitorAccounts(query);
  });

  app.get('/api/monitor/accounts/:accountId', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const result = await getMonitorAccount(params.accountId);
    if (!result) return sendError(reply, 404, 'validation_error', 'Account monitor not found', 'monitor_not_found');
    return result;
  });

  app.post('/api/monitor/accounts/:accountId/check', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    try {
      return await checkMonitorAccount(params.accountId);
    } catch (error) {
      return sendError(reply, 400, 'validation_error', error instanceof Error ? error.message : 'Monitor check failed', 'monitor_check_failed');
    }
  });

  app.post('/api/monitor/check-all', async () => checkAllMonitorAccounts());

  app.patch('/api/monitor/accounts/:accountId', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const parsed = monitorAccountPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const result = await updateMonitorAccount(params.accountId, parsed.data);
    if (!result) return sendError(reply, 404, 'validation_error', 'Account monitor not found', 'monitor_not_found');
    return result;
  });

  app.get('/api/monitor/settings', async () => getMonitorSettings());

  app.put('/api/monitor/settings', async (request, reply) => {
    const parsed = monitorSettingsPayloadSchema.safeParse(request.body ?? {});
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    return updateMonitorSettings(compactObject(parsed.data));
  });

  app.delete('/api/monitor/heartbeats', async () => cleanupMonitorHeartbeats(0));
}
