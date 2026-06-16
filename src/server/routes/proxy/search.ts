import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getProxyAuthContext } from '../../middleware/auth.js';
import { sendError } from '../../shared/errors.js';
import {
  proxyOpenAiEndpoint,
  type OpenAiProxyBody,
  type OpenAiProxyEndpointOptions
} from './chat.js';

const DEFAULT_SEARCH_MODEL = '__search';
const DEFAULT_MAX_RESULTS = 10;
const MAX_MAX_RESULTS = 20;

const searchBodySchema = z.object({
  model: z.string().trim().min(1).optional(),
  query: z.string().trim().min(1),
  max_results: z.unknown().optional(),
  stream: z.boolean().optional()
}).passthrough();

const searchProxyOptions: OpenAiProxyEndpointOptions = {
  downstreamPath: '/v1/search',
  upstreamPath: '/v1/search',
  transformBody: sanitizeSearchBody
};

export async function searchProxyRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/search', async (request, reply) => {
    const auth = getProxyAuthContext(request);
    if (!auth) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
    const parsed = searchBodySchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    if (parsed.data.stream) {
      return sendError(reply, 400, 'validation_error', 'search does not support streaming', 'stream_not_supported');
    }

    const maxResults = normalizeSearchMaxResults(parsed.data.max_results);
    if (maxResults === null) {
      return sendError(
        reply,
        400,
        'validation_error',
        `max_results must be an integer between 1 and ${MAX_MAX_RESULTS}`,
        'invalid_payload'
      );
    }

    return proxyOpenAiEndpoint(
      {
        ...parsed.data,
        model: parsed.data.model || DEFAULT_SEARCH_MODEL,
        max_results: maxResults,
        stream: false
      },
      auth.keyId,
      auth.policy,
      request.headers,
      reply,
      searchProxyOptions
    );
  });
}

function normalizeSearchMaxResults(value: unknown): number | null {
  if (value === undefined || value === null) return DEFAULT_MAX_RESULTS;
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 1 || value > MAX_MAX_RESULTS) return null;
  return value;
}

function sanitizeSearchBody(body: Record<string, unknown>): OpenAiProxyBody {
  const next = { ...body };
  // Search 是非流式接口，避免把客户端误传的 stream 字段转给上游。
  delete next.stream;
  delete next.stream_options;
  return next as OpenAiProxyBody;
}
