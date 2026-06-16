import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getProxyAuthContext } from '../../middleware/auth.js';
import { sendError } from '../../shared/errors.js';
import {
  openAiProxyBodySchema,
  proxyOpenAiEndpoint,
  type OpenAiProxyEndpointOptions
} from './chat.js';

const embeddingsBodySchema = openAiProxyBodySchema.extend({
  input: z.unknown().refine((value) => value !== undefined && value !== null, 'input is required')
});

const embeddingsProxyOptions: OpenAiProxyEndpointOptions = {
  downstreamPath: '/v1/embeddings',
  upstreamPath: '/v1/embeddings',
  transformBody: sanitizeEmbeddingsBody
};

export async function embeddingsProxyRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/embeddings', async (request, reply) => {
    const auth = getProxyAuthContext(request);
    if (!auth) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
    const parsed = embeddingsBodySchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
    if (parsed.data.stream) {
      return sendError(reply, 400, 'validation_error', 'stream is not supported on /v1/embeddings', 'stream_not_supported');
    }
    return proxyOpenAiEndpoint(
      { ...parsed.data, stream: false },
      auth.keyId,
      auth.policy,
      request.headers,
      reply,
      embeddingsProxyOptions
    );
  });
}

function sanitizeEmbeddingsBody(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };
  // Embeddings 是非流式接口，避免把测试或客户端误传的 stream 字段转给上游。
  delete next.stream;
  delete next.stream_options;
  return next;
}
