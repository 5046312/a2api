import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  accountTokenPayloadSchema,
  batchSetAccountTokensEnabled,
  createAccountToken,
  deleteAccountToken,
  listAccountTokens,
  syncAccountTokens,
  updateAccountToken
} from '../../services/accountTokenService.js';
import { rebuildRoutes } from '../../services/routeRefreshService.js';
import { sendError } from '../../shared/errors.js';
import { compactObject } from '../../shared/object.js';
import { optionalBooleanQuery } from '../../shared/query.js';

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export async function accountTokensRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/account-tokens', async (request) => {
    const query = z.object({
      accountId: z.coerce.number().int().optional(),
      enabled: optionalBooleanQuery,
      tokenGroup: z.string().trim().optional(),
      page: z.coerce.number().int().optional(),
      pageSize: z.coerce.number().int().optional()
    }).parse(request.query);
    return listAccountTokens(compactObject(query));
  });

  app.post('/api/account-tokens', async (request, reply) => {
    const parsed = accountTokenPayloadSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const token = await createAccountToken(parsed.data);
    await rebuildRoutes({ preserveManual: true });
    return token;
  });

  app.post('/api/account-tokens/batch-enabled', async (request, reply) => {
    const parsed = z.object({
      ids: z.array(z.number().int().positive()).min(1).max(200),
      enabled: z.boolean()
    }).safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const updated = await batchSetAccountTokensEnabled(parsed.data.ids, parsed.data.enabled);
    await rebuildRoutes({ preserveManual: true });
    return { ok: true, updated };
  });

  app.put('/api/account-tokens/:id', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const parsed = accountTokenPayloadSchema.partial().safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const token = await updateAccountToken(params.id, compactObject(parsed.data));
    if (!token) return sendError(reply, 404, 'validation_error', 'Token not found', 'token_not_found');
    await rebuildRoutes({ preserveManual: true });
    return token;
  });

  app.delete('/api/account-tokens/:id', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const deleted = await deleteAccountToken(params.id);
    if (!deleted) return sendError(reply, 404, 'validation_error', 'Token not found', 'token_not_found');
    await rebuildRoutes({ preserveManual: true });
    return { ok: true };
  });

  app.post('/api/account-tokens/sync', async (request, reply) => {
    const parsed = z.object({ accountId: z.number().int().positive() }).safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    try {
      const result = await syncAccountTokens(parsed.data.accountId);
      await rebuildRoutes({ preserveManual: true });
      return result;
    } catch (error) {
      return sendError(reply, 400, 'validation_error', error instanceof Error ? error.message : 'Sync account tokens failed', 'token_sync_failed');
    }
  });
}
