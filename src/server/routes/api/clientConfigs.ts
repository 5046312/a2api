import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getClientConfigs } from '../../services/clientConfigService.js';
import { sendError } from '../../shared/errors.js';

const clientConfigQuerySchema = z.object({
  baseUrl: z.string().trim().optional(),
  model: z.string().trim().optional()
});

function firstHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() || '';
  return value?.split(',')[0]?.trim() || '';
}

function resolveRequestBaseUrl(request: FastifyRequest): string {
  const requestProtocol = (request as { protocol?: string }).protocol;
  const proto = firstHeaderValue(request.headers['x-forwarded-proto']) || requestProtocol || 'http';
  const host = firstHeaderValue(request.headers['x-forwarded-host']) || request.headers.host || '127.0.0.1:4000';
  return `${proto}://${host}`;
}

export async function clientConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/client-configs', async (request, reply) => {
    const parsed = clientConfigQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    try {
      return getClientConfigs({
        baseUrl: parsed.data.baseUrl || resolveRequestBaseUrl(request),
        model: parsed.data.model
      });
    } catch (err) {
      return sendError(reply, 400, 'validation_error', err instanceof Error ? err.message : 'Invalid client config input', 'invalid_payload');
    }
  });
}
