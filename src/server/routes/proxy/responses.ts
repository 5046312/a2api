import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getProxyAuthContext } from '../../middleware/auth.js';
import { sendError } from '../../shared/errors.js';
import {
  openAiProxyBodySchema,
  proxyOpenAiEndpoint,
  type OpenAiProxyBody,
  type OpenAiProxyEndpointOptions
} from './chat.js';

const responsesProxyOptions: OpenAiProxyEndpointOptions = {
  downstreamPath: '/v1/responses',
  upstreamPath: '/v1/responses'
};

const compactResponsesProxyOptions: OpenAiProxyEndpointOptions = {
  downstreamPath: '/v1/responses/compact',
  upstreamPath: '/v1/responses',
  transformPayload: compactResponsesPayload
};

function resolveAliasedResponsesPath(request: FastifyRequest): '/v1/responses' | '/v1/responses/compact' | null {
  const pathname = (request.raw.url || request.url).split('?')[0] || request.url;
  if (pathname === '/responses') return '/v1/responses';
  if (pathname.endsWith('/compact')) return '/v1/responses/compact';
  return null;
}

function webSocketRequired(reply: FastifyReply, path: string) {
  return reply.code(426).send({
    error: {
      message: `WebSocket upgrade required for GET ${path}`,
      type: 'invalid_request_error'
    }
  });
}

async function handleResponsesRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  options: OpenAiProxyEndpointOptions
) {
  const auth = getProxyAuthContext(request);
  if (!auth) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
  const parsed = openAiProxyBodySchema.safeParse(request.body);
  if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
  return proxyOpenAiEndpoint(parsed.data, auth.keyId, auth.policy, request.headers, reply, options);
}

async function handleCompactResponsesRequest(request: FastifyRequest, reply: FastifyReply) {
  const auth = getProxyAuthContext(request);
  if (!auth) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
  const parsed = openAiProxyBodySchema.safeParse(request.body);
  if (!parsed.success) return sendError(reply, 400, 'validation_error', parsed.error.message, 'invalid_payload');
  if (parsed.data.stream) {
    return sendError(reply, 400, 'validation_error', 'stream is not supported on /v1/responses/compact', 'stream_not_supported');
  }
  return proxyOpenAiEndpoint(
    sanitizeCompactResponsesBody(parsed.data),
    auth.keyId,
    auth.policy,
    request.headers,
    reply,
    compactResponsesProxyOptions
  );
}

export async function responsesProxyRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/responses', async (request, reply) => handleResponsesRequest(request, reply, responsesProxyOptions));

  app.get('/v1/responses', async (_request, reply) => webSocketRequired(reply, '/v1/responses'));

  app.post('/v1/responses/compact', handleCompactResponsesRequest);

  app.post('/responses', async (request, reply) => handleResponsesRequest(request, reply, responsesProxyOptions));

  app.post('/responses/*', async (request, reply) => {
    const path = resolveAliasedResponsesPath(request);
    if (path !== '/v1/responses/compact') {
      return sendError(reply, 404, 'route_not_found', 'Unknown /responses alias path', 'responses_alias_not_found');
    }
    return handleCompactResponsesRequest(request, reply);
  });

  app.get('/responses', async (_request, reply) => webSocketRequired(reply, '/v1/responses'));

  app.get('/responses/*', async (request, reply) => {
    const path = resolveAliasedResponsesPath(request);
    if (!path) return sendError(reply, 404, 'route_not_found', 'Unknown /responses alias path', 'responses_alias_not_found');
    return webSocketRequired(reply, path);
  });
}

function sanitizeCompactResponsesBody(body: OpenAiProxyBody): OpenAiProxyBody {
  const next: Record<string, unknown> = { ...body };
  // compact 端点只保留非流式 JSON 请求，避免上游拒绝 stream 参数。
  delete next.stream;
  delete next.stream_options;
  return next as OpenAiProxyBody;
}

function compactResponsesPayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.object === 'response.compaction') return payload;
  if (payload.object !== 'response') return payload;
  const output: Record<string, unknown> = {
    id: payload.id,
    object: 'response.compaction',
    created_at: payload.created_at,
    output: Array.isArray(payload.output) ? payload.output : []
  };
  if (payload.usage !== undefined) output.usage = payload.usage;
  return output;
}
