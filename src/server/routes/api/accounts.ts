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
import { listAccountModels, previewAccountModels, refreshAccountModels, updateAccountModels } from '../../services/modelDiscoveryService.js';
import { rebuildRoutes } from '../../services/routeRefreshService.js';
import { sendError } from '../../shared/errors.js';
import { compactObject } from '../../shared/object.js';

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const accountModelsPayloadSchema = z.object({
  models: z.array(z.string().trim()).default([])
});
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
      siteId: z.number().int().positive().optional(),
      baseUrl: z.string().trim().url().optional(),
      platform: z.string().trim().optional(),
      proxyUrl: z.string().trim().optional().nullable(),
      customHeaders: z.record(z.string(), z.string()).optional().nullable(),
      token: z.string().optional(),
      apiKey: z.string().optional(),
      credentialMode: z.enum(['auto', 'session', 'apikey', 'oauth']).default('apikey')
    }).safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const token = parsed.data.token || parsed.data.apiKey || '';
    if (!token) return sendError(reply, 400, 'validation_error', 'API Key is required', 'missing_token');
    try {
      const verifyPayload: Parameters<typeof verifyAccountToken>[0] = {
        token,
        credentialMode: parsed.data.credentialMode
      };
      if (parsed.data.siteId !== undefined) verifyPayload.siteId = parsed.data.siteId;
      if (parsed.data.baseUrl !== undefined) verifyPayload.baseUrl = parsed.data.baseUrl;
      if (parsed.data.platform !== undefined) verifyPayload.platform = parsed.data.platform;
      if (parsed.data.proxyUrl !== undefined) verifyPayload.proxyUrl = parsed.data.proxyUrl;
      if (parsed.data.customHeaders !== undefined) verifyPayload.customHeaders = parsed.data.customHeaders;
      const result = await verifyAccountToken(verifyPayload);
      return { ok: result.tokenType === 'apikey', ...result };
    } catch (error) {
      return sendError(reply, 400, 'validation_error', error instanceof Error ? error.message : 'Verify token failed', 'verify_failed');
    }
  });

  app.post('/api/accounts', async (request, reply) => {
    const parsed = accountPayloadSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    if (!parsed.data.siteId && !parsed.data.baseUrl) {
      return sendError(reply, 400, 'validation_error', 'siteId or baseUrl is required', 'missing_upstream');
    }
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

  app.get('/api/accounts/:id/models', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    try {
      return await listAccountModels(params.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'List account models failed';
      return sendError(reply, message === 'Account not found' ? 404 : 400, 'validation_error', message, 'list_models_failed');
    }
  });

  app.put('/api/accounts/:id/models', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const parsed = accountModelsPayloadSchema.safeParse(request.body ?? {});
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    try {
      return await updateAccountModels(params.id, parsed.data.models);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update account models failed';
      return sendError(reply, message === 'Account not found' ? 404 : 400, 'validation_error', message, 'update_models_failed');
    }
  });

  app.post('/api/accounts/:id/models/preview', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    try {
      return await previewAccountModels(params.id);
    } catch (error) {
      return sendError(reply, 400, 'validation_error', error instanceof Error ? error.message : 'Preview models failed', 'preview_models_failed');
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
