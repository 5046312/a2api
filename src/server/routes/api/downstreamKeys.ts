import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  batchUpdateDownstreamKeys,
  createDownstreamKey,
  deleteDownstreamKey,
  downstreamKeyBatchPayloadSchema,
  downstreamKeyPayloadSchema,
  listDownstreamKeys,
  resetDownstreamKeyUsage,
  updateDownstreamKey
} from '../../services/downstreamKeyService.js';
import { sendError } from '../../shared/errors.js';
import { compactObject } from '../../shared/object.js';

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export async function downstreamKeysRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/downstream-keys', async () => ({ items: await listDownstreamKeys() }));

  app.post('/api/downstream-keys', async (request, reply) => {
    const parsed = downstreamKeyPayloadSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    return createDownstreamKey(parsed.data);
  });

  app.post('/api/downstream-keys/batch', async (request, reply) => {
    const parsed = downstreamKeyBatchPayloadSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    return batchUpdateDownstreamKeys(parsed.data);
  });

  app.put('/api/downstream-keys/:id', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const parsed = downstreamKeyPayloadSchema.partial().safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    const key = await updateDownstreamKey(params.id, compactObject(parsed.data));
    if (!key) return sendError(reply, 404, 'validation_error', 'Downstream key not found', 'downstream_key_not_found');
    return key;
  });

  app.delete('/api/downstream-keys/:id', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const deleted = await deleteDownstreamKey(params.id);
    if (!deleted) return sendError(reply, 404, 'validation_error', 'Downstream key not found', 'downstream_key_not_found');
    return { ok: true };
  });

  app.post('/api/downstream-keys/:id/reset-usage', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const key = await resetDownstreamKeyUsage(params.id);
    if (!key) return sendError(reply, 404, 'validation_error', 'Downstream key not found', 'downstream_key_not_found');
    return key;
  });
}
