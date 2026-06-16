import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  accountBatchPayloadSchema,
  accountPayloadSchema,
  batchUpdateAccounts,
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
  verifyAccountToken
} from '../../services/accountService.js';
import { refreshAccountBalance, refreshAllAccountBalances } from '../../services/balanceService.js';
import { refreshAccountModels } from '../../services/modelDiscoveryService.js';
import { rebuildRoutes } from '../../services/routeRefreshService.js';
import { sendError } from '../../shared/errors.js';
import { compactObject } from '../../shared/object.js';

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const listQuerySchema = z.object({
  siteId: z.coerce.number().int().optional(),
  status: z.string().optional(),
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional()
});

export async function accountsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/accounts', async (request) => listAccounts(compactObject(listQuerySchema.parse(request.query))));

  app.post('/api/accounts/verify-token', async (request, reply) => {
    const parsed = z.object({
      siteId: z.number().int().positive(),
      token: z.string().min(1),
      credentialMode: z.enum(['auto', 'session', 'apikey', 'oauth']).default('apikey')
    }).safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    try {
      const result = await verifyAccountToken(parsed.data);
      return { ok: result.tokenType === 'apikey', ...result };
    } catch (error) {
      return sendError(reply, 400, 'validation_error', error instanceof Error ? error.message : 'Verify token failed', 'verify_failed');
    }
  });

  app.post('/api/accounts', async (request, reply) => {
    const parsed = accountPayloadSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const account = await createAccount(parsed.data);
    return account;
  });

  app.post('/api/accounts/balance/refresh-all', async () => refreshAllAccountBalances());

  app.post('/api/accounts/batch', async (request, reply) => {
    const parsed = accountBatchPayloadSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const result = await batchUpdateAccounts(parsed.data);
    const routeRebuilt = result.successIds.length > 0 && result.action !== 'refreshBalance';
    if (routeRebuilt) await rebuildRoutes({ preserveManual: true });
    return { ...result, routeRebuilt };
  });

  app.put('/api/accounts/:id', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const parsed = accountPayloadSchema.partial().safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const account = await updateAccount(params.id, compactObject(parsed.data));
    if (!account) return sendError(reply, 404, 'validation_error', 'Account not found', 'account_not_found');
    await rebuildRoutes({ preserveManual: true });
    return account;
  });

  app.delete('/api/accounts/:id', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const deleted = await deleteAccount(params.id);
    if (!deleted) return sendError(reply, 404, 'validation_error', 'Account not found', 'account_not_found');
    await rebuildRoutes({ preserveManual: true });
    return { ok: true };
  });

  app.post('/api/accounts/:id/balance', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    try {
      return await refreshAccountBalance(params.id);
    } catch (error) {
      return sendError(reply, 400, 'validation_error', error instanceof Error ? error.message : 'Refresh balance failed', 'balance_refresh_failed');
    }
  });

  app.post('/api/accounts/:id/models/refresh', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    try {
      return await refreshAccountModels(params.id, { rebuild: true });
    } catch (error) {
      return sendError(reply, 400, 'validation_error', error instanceof Error ? error.message : 'Refresh models failed', 'refresh_failed');
    }
  });
}
